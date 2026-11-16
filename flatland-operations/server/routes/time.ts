import { Router, type Request } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { assertSelfOr, canViewJob } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import {
  addDays,
  companyTz,
  dayRange,
  getSetting,
  isValidTimeZone,
  isWeekStart,
  localToUtc,
  nowIso,
  todayIn,
  weekRange,
  weekStartOf,
} from "../lib/time.js";
import {
  addManualEntry,
  clockIn,
  clockOut,
  editEntry,
  endBreak,
  getBreaks,
  getEntry,
  loadEntries,
  openEntryFor,
  startBreak,
  switchJob,
  timesheetStatus,
  voidEntry,
  workedMinutes,
} from "../lib/timeService.js";
import { isoDate, optId, optNumber, optText, parseId, reqText } from "../lib/validate.js";

function toUtc(db: DB, value: string, field: string): string {
  try {
    return localToUtc(value, companyTz(db));
  } catch (e) {
    throw badRequest((e as Error).message, { fields: { [field]: (e as Error).message } });
  }
}

function assertClockableJob(db: DB, req: Request, jobId: number | null) {
  if (jobId === null) return;
  const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as { status: string } | undefined;
  if (!job || !canViewJob(db, req.user!, jobId)) throw badRequest("You are not assigned to that job.");
  if (["completed", "invoiced", "cancelled"].includes(job.status)) throw badRequest("That job is closed. Choose another job.");
}

export function timeRoutes(db: DB) {
  const r = Router();

  // ───────────── Employee: my status ─────────────
  r.get("/me", requirePerm("time.clock"), (req, res) => {
    const uid = req.user!.id;
    const tz = companyTz(db);
    const today = todayIn(tz);
    const week = weekStartOf(nowIso(), tz);
    const { start: dStart, end: dEnd } = dayRange(today, tz);
    const { start: wStart, end: wEnd } = weekRange(week, tz);
    const open = openEntryFor(db, uid);
    let current = null;
    if (open) {
      const breaks = getBreaks(db, open.id);
      const job = open.job_id ? db.prepare("SELECT id, job_number, name FROM jobs WHERE id = ?").get(open.job_id) : null;
      current = { ...open, breaks, on_break: breaks.some((b) => !b.end_at), worked_minutes: workedMinutes(open, breaks), job };
    }
    const weekEntries = loadEntries(db, "t.user_id = ? AND t.clock_in_at >= ? AND t.clock_in_at < ? AND t.status <> 'void'", [uid, wStart, wEnd]);
    const todayMinutes = weekEntries.filter((e) => e.clock_in_at >= dStart && e.clock_in_at < dEnd).reduce((s, e) => s + e.worked_minutes, 0);
    const weekMinutes = weekEntries.reduce((s, e) => s + e.worked_minutes, 0);
    const jobs = db
      .prepare(
        `SELECT j.id, j.job_number, j.name, j.status, j.scheduled_start, j.site_address, c.name AS customer_name
         FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
         WHERE j.status IN ('new','quoted','scheduled','in_progress','on_hold')
           AND (j.id IN (SELECT job_id FROM job_assignments WHERE user_id = ?) OR ?)
         ORDER BY CASE j.status WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, j.scheduled_start LIMIT 100`,
      )
      .all(uid, can(req.user!, "jobs.view_all") ? 1 : 0);
    res.json({
      current,
      todayMinutes,
      weekMinutes,
      weekStart: week,
      weekEntries,
      timesheetStatus: timesheetStatus(db, uid, week),
      jobs,
      timezone: tz,
    });
  });

  const clockInSchema = z.object({
    job_id: optId,
    device_tz: z.string().max(64).nullish(),
    lat: optNumber,
    lng: optNumber,
  });

  r.post("/clock-in", requirePerm("time.clock"), (req, res) => {
    const b = clockInSchema.parse(req.body ?? {});
    assertClockableJob(db, req, b.job_id);
    const deviceTz = b.device_tz && isValidTimeZone(b.device_tz) ? b.device_tz : null;
    const entry = clockIn(db, req.user!.id, { jobId: b.job_id, deviceTz, lat: b.lat, lng: b.lng });
    // First clock-in on a scheduled job marks it In Progress.
    if (b.job_id) {
      const job = db.prepare("SELECT job_number, status FROM jobs WHERE id = ?").get(b.job_id) as { job_number: string; status: string };
      if (job.status === "scheduled") {
        db.prepare("UPDATE jobs SET status = 'in_progress', updated_at = ? WHERE id = ?").run(nowIso(), b.job_id);
        audit(db, { userId: req.user!.id, action: "job.status", entityType: "job", entityId: b.job_id, summary: `started work on job ${job.job_number} (now in progress)`, changes: { status: ["scheduled", "in_progress"] } });
      }
    }
    res.status(201).json({ entry });
  });

  r.post("/clock-out", requirePerm("time.clock"), (req, res) => {
    const b = z.object({ notes: optText(1000) }).parse(req.body ?? {});
    res.json({ entry: clockOut(db, req.user!.id, b.notes) });
  });

  r.post("/break/start", requirePerm("time.clock"), (req, res) => {
    startBreak(db, req.user!.id);
    res.json({ ok: true });
  });

  r.post("/break/end", requirePerm("time.clock"), (req, res) => {
    endBreak(db, req.user!.id);
    res.json({ ok: true });
  });

  r.post("/switch-job", requirePerm("time.clock"), (req, res) => {
    const b = z.object({ job_id: optId }).parse(req.body);
    assertClockableJob(db, req, b.job_id);
    switchJob(db, req.user!.id, b.job_id);
    res.json({ ok: true });
  });

  // ───────────── Entries (self or managers) ─────────────
  r.get("/entries", (req, res) => {
    const tz = companyTz(db);
    const userId = req.query.user_id ? parseId(req.query.user_id) : req.user!.id;
    assertSelfOr(req.user!, userId, "time.view_all");
    const week = req.query.week_start ? isoDate.parse(req.query.week_start) : weekStartOf(nowIso(), tz);
    const { start, end } = weekRange(week, tz);
    const entries = loadEntries(db, "t.user_id = ? AND t.clock_in_at >= ? AND t.clock_in_at < ?", [userId, start, end]);
    res.json({ entries, weekStart: week });
  });

  r.get("/entries/:id", (req, res) => {
    const id = parseId(req.params.id);
    const entry = getEntry(db, id);
    assertSelfOr(req.user!, entry.user_id, "time.view_all");
    const [full] = loadEntries(db, "t.id = ?", [id]);
    const revisions = db
      .prepare(
        `SELECT r.*, u.first_name || ' ' || u.last_name AS changed_by_name FROM time_entry_revisions r
         JOIN users u ON u.id = r.changed_by WHERE r.time_entry_id = ? ORDER BY r.id`,
      )
      .all(id);
    res.json({ entry: full, revisions });
  });

  const breakInput = z.object({ start_at: z.string().min(1), end_at: z.string().nullish() });
  const reason = reqText(500);

  r.put("/entries/:id", requirePerm("time.edit"), (req, res) => {
    const id = parseId(req.params.id);
    const b = z
      .object({
        clock_in_at: z.string().optional(),
        clock_out_at: z.string().nullish(),
        job_id: optId.optional(),
        notes: optText(1000).optional(),
        breaks: z.array(breakInput).max(20).optional(),
        reason,
      })
      .parse(req.body);
    const entry = editEntry(
      db,
      id,
      {
        clock_in_at: b.clock_in_at ? toUtc(db, b.clock_in_at, "clock_in_at") : undefined,
        clock_out_at: b.clock_out_at === undefined ? undefined : b.clock_out_at ? toUtc(db, b.clock_out_at, "clock_out_at") : null,
        job_id: b.job_id,
        notes: b.notes,
        breaks: b.breaks?.map((x) => ({ start_at: toUtc(db, x.start_at, "breaks"), end_at: x.end_at ? toUtc(db, x.end_at, "breaks") : null })),
      },
      b.reason,
      req.user!.id,
      req.ip,
    );
    res.json({ entry });
  });

  r.post("/entries", requirePerm("time.edit"), (req, res) => {
    const b = z
      .object({
        user_id: z.number().int().positive(),
        clock_in_at: z.string().min(1),
        clock_out_at: z.string().min(1),
        job_id: optId,
        notes: optText(1000),
        breaks: z.array(z.object({ start_at: z.string().min(1), end_at: z.string().min(1) })).max(20).default([]),
        reason,
      })
      .parse(req.body);
    const target = db.prepare("SELECT status FROM users WHERE id = ?").get(b.user_id) as { status: string } | undefined;
    if (!target) throw notFound("Person");
    if (b.job_id && !db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(b.job_id)) throw badRequest("Job not found.");
    const entry = addManualEntry(
      db,
      {
        user_id: b.user_id,
        clock_in_at: toUtc(db, b.clock_in_at, "clock_in_at"),
        clock_out_at: toUtc(db, b.clock_out_at, "clock_out_at"),
        job_id: b.job_id,
        notes: b.notes,
        breaks: b.breaks.map((x) => ({ start_at: toUtc(db, x.start_at, "breaks"), end_at: toUtc(db, x.end_at, "breaks") })),
      },
      b.reason,
      req.user!.id,
      req.ip,
    );
    res.status(201).json({ entry });
  });

  r.post("/entries/:id/void", requirePerm("time.edit"), (req, res) => {
    const b = z.object({ reason }).parse(req.body);
    voidEntry(db, parseId(req.params.id), b.reason, req.user!.id, req.ip);
    res.json({ ok: true });
  });

  /** Who is clocked in right now. */
  r.get("/active", requirePerm("time.view_all"), (_req, res) => {
    const rows = loadEntries(db, "t.status = 'open'", []);
    res.json({ entries: rows });
  });

  // ───────────── Weekly timesheets ─────────────
  r.get("/timesheets", requirePerm("time.view_all"), (req, res) => {
    const tz = companyTz(db);
    const week = req.query.week_start ? isoDate.parse(req.query.week_start) : weekStartOf(nowIso(), tz);
    if (!isWeekStart(week, tz)) throw badRequest("week_start must be a Monday.");
    const { start, end } = weekRange(week, tz);
    const people = db
      .prepare(
        `SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.role, u.status
         FROM users u
         WHERE (u.status = 'active' AND (u.role <> 'subcontractor' OR u.can_record_time = 1))
            OR u.id IN (SELECT user_id FROM time_entries WHERE clock_in_at >= ? AND clock_in_at < ?)
         ORDER BY u.last_name, u.first_name`,
      )
      .all(start, end) as { id: number; name: string; role: string; status: string }[];
    const overtime = Number(getSetting(db, "overtime_weekly_hours") || 40) * 60;
    const rows = people.map((p) => {
      const entries = loadEntries(db, "t.user_id = ? AND t.clock_in_at >= ? AND t.clock_in_at < ? AND t.status <> 'void'", [p.id, start, end]);
      const minutes = entries.reduce((s, e) => s + e.worked_minutes, 0);
      const ts = db
        .prepare(
          `SELECT t.*, a.first_name || ' ' || a.last_name AS approved_by_name FROM timesheets t
           LEFT JOIN users a ON a.id = t.approved_by WHERE t.user_id = ? AND t.week_start = ?`,
        )
        .get(p.id, week) as Record<string, unknown> | undefined;
      return {
        ...p,
        minutes,
        overtime_minutes: Math.max(0, minutes - overtime),
        entry_count: entries.length,
        open_count: entries.filter((e) => e.status === "open").length,
        flag_count: entries.filter((e) => e.flags.length).length,
        edited_count: entries.filter((e) => e.revision_count > 0).length,
        status: (ts?.status as string) ?? "open",
        approved_by_name: ts?.approved_by_name ?? null,
        approved_at: ts?.approved_at ?? null,
        submitted_at: ts?.submitted_at ?? null,
      };
    });
    res.json({ weekStart: week, timezone: tz, overtimeThresholdHours: overtime / 60, rows });
  });

  function weekParams(req: Request) {
    const tz = companyTz(db);
    const userId = parseId(req.params.userId);
    const week = isoDate.parse(req.params.week);
    if (!isWeekStart(week, tz)) throw badRequest("Week must start on a Monday.");
    return { tz, userId, week, ...weekRange(week, tz) };
  }

  r.get("/timesheets/:userId/:week", (req, res) => {
    const { userId, week, start, end } = weekParams(req);
    assertSelfOr(req.user!, userId, "time.view_all");
    const person = db.prepare("SELECT id, first_name || ' ' || last_name AS name, role FROM users WHERE id = ?").get(userId);
    if (!person) throw notFound("Person");
    const entries = loadEntries(db, "t.user_id = ? AND t.clock_in_at >= ? AND t.clock_in_at < ?", [userId, start, end]);
    const timesheet =
      db
        .prepare(
          `SELECT t.*, a.first_name || ' ' || a.last_name AS approved_by_name FROM timesheets t
           LEFT JOIN users a ON a.id = t.approved_by WHERE t.user_id = ? AND t.week_start = ?`,
        )
        .get(userId, week) ?? { status: "open", week_start: week, user_id: userId };
    const tsId = (timesheet as { id?: number }).id;
    const history = tsId
      ? db
          .prepare(
            `SELECT a.summary, a.created_at, u.first_name || ' ' || u.last_name AS actor FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id WHERE a.entity_type = 'timesheet' AND a.entity_id = ? ORDER BY a.id DESC`,
          )
          .all(tsId)
      : [];
    res.json({ person, weekStart: week, entries, timesheet, history, nextWeek: addDays(week, 7), prevWeek: addDays(week, -7) });
  });

  function upsertTimesheet(userId: number, week: string) {
    db.prepare("INSERT OR IGNORE INTO timesheets (user_id, week_start) VALUES (?, ?)").run(userId, week);
    return db.prepare("SELECT * FROM timesheets WHERE user_id = ? AND week_start = ?").get(userId, week) as { id: number; status: string };
  }

  r.post("/timesheets/:userId/:week/submit", (req, res) => {
    const { userId, week, start, end } = weekParams(req);
    if (userId !== req.user!.id) throw forbidden("You can only submit your own timesheet.");
    const b = z.object({ note: optText(1000) }).parse(req.body ?? {});
    db.transaction(() => {
      const ts = upsertTimesheet(userId, week);
      if (ts.status === "approved") throw conflict("This timesheet is already approved.");
      if (db.prepare("SELECT 1 FROM time_entries WHERE user_id = ? AND status = 'open' AND clock_in_at >= ? AND clock_in_at < ?").get(userId, start, end)) {
        throw conflict("Clock out before submitting your timesheet.");
      }
      db.prepare("UPDATE timesheets SET status = 'submitted', submitted_at = ?, employee_note = ?, updated_at = ? WHERE id = ?").run(nowIso(), b.note, nowIso(), ts.id);
      audit(db, { userId: req.user!.id, action: "timesheet.submit", entityType: "timesheet", entityId: ts.id, summary: `submitted their timesheet for the week of ${week}` });
    })();
    res.json({ ok: true });
  });

  r.post("/timesheets/:userId/:week/approve", requirePerm("timesheets.approve"), (req, res) => {
    const { userId, week, start, end } = weekParams(req);
    if (userId === req.user!.id && req.user!.role !== "owner") throw forbidden("Your own timesheet must be approved by someone else.");
    const person = db.prepare("SELECT first_name || ' ' || last_name AS name FROM users WHERE id = ?").get(userId) as { name: string } | undefined;
    if (!person) throw notFound("Person");
    db.transaction(() => {
      const ts = upsertTimesheet(userId, week);
      if (ts.status === "approved") throw conflict("Already approved.");
      const entries = loadEntries(db, "t.user_id = ? AND t.clock_in_at >= ? AND t.clock_in_at < ? AND t.status <> 'void'", [userId, start, end]);
      if (entries.some((e) => e.status === "open")) throw conflict(`${person.name} has an open shift this week. Resolve it before approving.`);
      if (entries.some((e) => e.flags.includes("open_break"))) throw conflict("An entry has an unfinished break. Correct it before approving.");
      const minutes = entries.reduce((s, e) => s + e.worked_minutes, 0);
      db.prepare(
        "UPDATE timesheets SET status = 'approved', approved_by = ?, approved_at = ?, approved_minutes = ?, updated_at = ? WHERE id = ?",
      ).run(req.user!.id, nowIso(), minutes, nowIso(), ts.id);
      audit(db, {
        userId: req.user!.id,
        action: "timesheet.approve",
        entityType: "timesheet",
        entityId: ts.id,
        summary: `approved ${person.name}'s timesheet for the week of ${week} (${(minutes / 60).toFixed(2)} h)`,
        ip: req.ip,
      });
    })();
    res.json({ ok: true });
  });

  r.post("/timesheets/:userId/:week/reopen", requirePerm("timesheets.approve"), (req, res) => {
    const { userId, week } = weekParams(req);
    const b = z.object({ reason }).parse(req.body);
    const person = db.prepare("SELECT first_name || ' ' || last_name AS name FROM users WHERE id = ?").get(userId) as { name: string };
    db.transaction(() => {
      const ts = db.prepare("SELECT * FROM timesheets WHERE user_id = ? AND week_start = ?").get(userId, week) as { id: number; status: string } | undefined;
      if (!ts || ts.status !== "approved") throw conflict("Only approved timesheets can be reopened.");
      db.prepare("UPDATE timesheets SET status = 'open', approved_by = NULL, approved_at = NULL, approved_minutes = NULL, updated_at = ? WHERE id = ?").run(nowIso(), ts.id);
      audit(db, {
        userId: req.user!.id,
        action: "timesheet.reopen",
        entityType: "timesheet",
        entityId: ts.id,
        summary: `reopened ${person.name}'s timesheet for the week of ${week} — ${b.reason}`,
        ip: req.ip,
      });
    })();
    res.json({ ok: true });
  });

  /** Payroll CSV of APPROVED hours only. */
  r.get("/payroll-export", requirePerm("payroll.export"), (req, res) => {
    const tz = companyTz(db);
    const week = isoDate.parse(req.query.week_start);
    if (!isWeekStart(week, tz)) throw badRequest("week_start must be a Monday.");
    const overtime = Number(getSetting(db, "overtime_weekly_hours") || 40) * 60;
    const rows = db
      .prepare(
        `SELECT t.approved_minutes, t.approved_at, u.id AS employee_id, u.first_name, u.last_name, u.email, u.role,
                a.first_name || ' ' || a.last_name AS approved_by
         FROM timesheets t JOIN users u ON u.id = t.user_id LEFT JOIN users a ON a.id = t.approved_by
         WHERE t.week_start = ? AND t.status = 'approved' ORDER BY u.last_name, u.first_name`,
      )
      .all(week) as { approved_minutes: number; approved_at: string; employee_id: number; first_name: string; last_name: string; email: string; role: string; approved_by: string }[];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      // Neutralise spreadsheet formula injection and quote.
      const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [
      ["Employee ID", "Last name", "First name", "Email", "Role", "Week start", "Regular hours", "Overtime hours", "Total hours", "Approved by", "Approved at (UTC)"].map(esc).join(","),
      ...rows.map((r) => {
        const reg = Math.min(r.approved_minutes, overtime);
        const ot = Math.max(0, r.approved_minutes - overtime);
        return [r.employee_id, r.last_name, r.first_name, r.email, r.role, week, (reg / 60).toFixed(2), (ot / 60).toFixed(2), (r.approved_minutes / 60).toFixed(2), r.approved_by, r.approved_at]
          .map(esc)
          .join(",");
      }),
    ];
    db.prepare("INSERT INTO payroll_exports (week_start, row_count, exported_by) VALUES (?,?,?)").run(week, rows.length, req.user!.id);
    audit(db, { userId: req.user!.id, action: "payroll.export", summary: `exported approved payroll hours for the week of ${week} (${rows.length} people)`, ip: req.ip });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="payroll-${week}.csv"`);
    res.send(lines.join("\r\n") + "\r\n");
  });

  /** Hours by job over a date range. */
  r.get("/by-job", requirePerm("time.view_all"), (req, res) => {
    const tz = companyTz(db);
    const from = req.query.from ? isoDate.parse(req.query.from) : weekStartOf(nowIso(), tz);
    const to = req.query.to ? isoDate.parse(req.query.to) : addDays(from, 6);
    const start = dayRange(from, tz).start;
    const end = dayRange(to, tz).end;
    const rows = db
      .prepare(
        `SELECT j.id, j.job_number, j.name, j.status, j.estimated_hours,
                ROUND(SUM(w.worked_minutes)/60.0, 2) AS hours, COUNT(DISTINCT w.user_id) AS people
         FROM v_time_worked w JOIN jobs j ON j.id = w.job_id
         WHERE w.clock_in_at >= ? AND w.clock_in_at < ?
         GROUP BY j.id ORDER BY hours DESC`,
      )
      .all(start, end);
    const unassigned = db
      .prepare("SELECT ROUND(COALESCE(SUM(worked_minutes),0)/60.0, 2) AS hours FROM v_time_worked WHERE job_id IS NULL AND clock_in_at >= ? AND clock_in_at < ?")
      .get(start, end);
    res.json({ from, to, rows, unassigned });
  });

  return r;
}
