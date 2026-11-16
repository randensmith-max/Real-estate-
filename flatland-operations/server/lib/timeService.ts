import type { DB } from "../db/db.js";
import { audit } from "./audit.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { companyTz, minutesBetween, nowIso, weekStartOf } from "./time.js";

/**
 * Core time-tracking rules. Every mutation that a manager makes goes through `recordRevision`,
 * so the original value, new value, editor, timestamp and reason are always preserved.
 */

export interface TimeEntry {
  id: number;
  user_id: number;
  job_id: number | null;
  clock_in_at: string;
  clock_out_at: string | null;
  device_tz: string | null;
  source: "clock" | "manual";
  status: "open" | "closed" | "void";
  notes: string | null;
}
export interface TimeBreak {
  id: number;
  time_entry_id: number;
  start_at: string;
  end_at: string | null;
}

export const MAX_SHIFT_HOURS = 24;
export const LONG_SHIFT_HOURS = 14; // flagged for manager review (likely missed punch)

export function getEntry(db: DB, id: number): TimeEntry {
  const e = db.prepare("SELECT * FROM time_entries WHERE id = ?").get(id) as TimeEntry | undefined;
  if (!e) throw notFound("Time entry");
  return e;
}

export function getBreaks(db: DB, entryId: number): TimeBreak[] {
  return db.prepare("SELECT * FROM time_breaks WHERE time_entry_id = ? ORDER BY start_at").all(entryId) as TimeBreak[];
}

export function openEntryFor(db: DB, userId: number): TimeEntry | undefined {
  return db.prepare("SELECT * FROM time_entries WHERE user_id = ? AND status = 'open'").get(userId) as TimeEntry | undefined;
}

/** Worked minutes = shift length − breaks. Open shifts/breaks are measured up to `asOf`. */
export function workedMinutes(entry: TimeEntry, breaks: TimeBreak[], asOf = nowIso()): number {
  if (entry.status === "void") return 0;
  const end = entry.clock_out_at ?? asOf;
  const gross = minutesBetween(entry.clock_in_at, end);
  const breakMin = breaks.reduce((sum, b) => sum + minutesBetween(b.start_at, b.end_at ?? end), 0);
  return Math.max(0, Math.round(gross - breakMin));
}

export function breakMinutes(breaks: TimeBreak[], end: string): number {
  return Math.round(breaks.reduce((s, b) => s + minutesBetween(b.start_at, b.end_at ?? end), 0));
}

// ── Timesheet locking ──

export function timesheetStatus(db: DB, userId: number, weekStart: string): "open" | "submitted" | "approved" {
  const row = db.prepare("SELECT status FROM timesheets WHERE user_id = ? AND week_start = ?").get(userId, weekStart) as
    | { status: "open" | "submitted" | "approved" }
    | undefined;
  return row?.status ?? "open";
}

/** Throws if any of the instants fall into an approved week for the user. */
export function assertWeeksUnlocked(db: DB, userId: number, ...instants: (string | null | undefined)[]) {
  const tz = companyTz(db);
  for (const iso of instants) {
    if (!iso) continue;
    const ws = weekStartOf(iso, tz);
    if (timesheetStatus(db, userId, ws) === "approved") {
      throw conflict(`The timesheet for the week of ${ws} is approved and locked. Reopen it before making changes.`);
    }
  }
}

/** Rejects shifts that overlap another non-void shift for the same person. */
export function assertNoOverlap(db: DB, userId: number, start: string, end: string | null, excludeId?: number) {
  const endCmp = end ?? "9999-12-31T00:00:00.000Z";
  const clash = db
    .prepare(
      `SELECT id, clock_in_at, clock_out_at FROM time_entries
       WHERE user_id = ? AND status <> 'void' AND id <> ?
         AND clock_in_at < ? AND COALESCE(clock_out_at, '9999-12-31T00:00:00.000Z') > ?
       LIMIT 1`,
    )
    .get(userId, excludeId ?? -1, endCmp, start) as { id: number } | undefined;
  if (clash) throw conflict("This shift overlaps another recorded shift for this person.");
}

function validateShape(start: string, end: string | null) {
  if (end) {
    if (end <= start) throw badRequest("Clock-out must be after clock-in.");
    if (minutesBetween(start, end) > MAX_SHIFT_HOURS * 60) {
      throw badRequest(`A single shift cannot be longer than ${MAX_SHIFT_HOURS} hours. Split it into separate shifts.`);
    }
  }
  if (start > new Date(Date.now() + 5 * 60_000).toISOString()) throw badRequest("Clock-in cannot be in the future.");
  if (end && end > new Date(Date.now() + 5 * 60_000).toISOString()) throw badRequest("Clock-out cannot be in the future.");
}

function validateBreaks(breaks: { start_at: string; end_at: string | null }[], start: string, end: string | null) {
  const sorted = [...breaks].sort((a, b) => a.start_at.localeCompare(b.start_at));
  let prevEnd = "";
  for (const b of sorted) {
    if (b.start_at < start) throw badRequest("A break cannot start before the shift starts.");
    if (end && b.start_at >= end) throw badRequest("A break must start before the shift ends.");
    if (b.end_at && b.end_at <= b.start_at) throw badRequest("A break must end after it starts.");
    if (end && b.end_at && b.end_at > end) throw badRequest("A break cannot end after the shift ends.");
    if (prevEnd && b.start_at < prevEnd) throw badRequest("Breaks cannot overlap.");
    prevEnd = b.end_at ?? "9999";
  }
}

export function recordRevision(
  db: DB,
  entryId: number,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string,
  changedBy: number,
) {
  const s = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
  db.prepare(
    `INSERT INTO time_entry_revisions (time_entry_id, field, old_value, new_value, reason, changed_by, changed_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(entryId, field, s(oldValue), s(newValue), reason, changedBy, nowIso());
}

// ── Employee actions ──

export function clockIn(
  db: DB,
  userId: number,
  opts: { jobId: number | null; deviceTz: string | null; lat?: number | null; lng?: number | null },
): TimeEntry {
  return db.transaction(() => {
    if (openEntryFor(db, userId)) throw conflict("You are already clocked in.");
    const now = nowIso();
    assertWeeksUnlocked(db, userId, now);
    const info = db
      .prepare(
        `INSERT INTO time_entries (user_id, job_id, clock_in_at, device_tz, source, status, clock_in_lat, clock_in_lng, created_by)
         VALUES (?,?,?,?, 'clock', 'open', ?, ?, ?)`,
      )
      .run(userId, opts.jobId, now, opts.deviceTz, opts.lat ?? null, opts.lng ?? null, userId);
    audit(db, {
      userId,
      action: "time.clock_in",
      entityType: "time_entry",
      entityId: info.lastInsertRowid,
      summary: "clocked in",
    });
    return getEntry(db, Number(info.lastInsertRowid));
  })();
}

export function clockOut(db: DB, userId: number, notes: string | null): TimeEntry {
  return db.transaction(() => {
    const entry = openEntryFor(db, userId);
    if (!entry) throw conflict("You are not clocked in.");
    const now = nowIso();
    if (now <= entry.clock_in_at) throw conflict("Clock-out must be after clock-in.");
    // Any open break ends at clock-out.
    db.prepare("UPDATE time_breaks SET end_at = ? WHERE time_entry_id = ? AND end_at IS NULL").run(now, entry.id);
    db.prepare(
      "UPDATE time_entries SET clock_out_at = ?, status = 'closed', notes = COALESCE(?, notes), updated_at = ? WHERE id = ?",
    ).run(now, notes, now, entry.id);
    audit(db, { userId, action: "time.clock_out", entityType: "time_entry", entityId: entry.id, summary: "clocked out" });
    return getEntry(db, entry.id);
  })();
}

export function startBreak(db: DB, userId: number) {
  return db.transaction(() => {
    const entry = openEntryFor(db, userId);
    if (!entry) throw conflict("You are not clocked in.");
    if (db.prepare("SELECT 1 FROM time_breaks WHERE time_entry_id = ? AND end_at IS NULL").get(entry.id)) {
      throw conflict("You are already on a break.");
    }
    db.prepare("INSERT INTO time_breaks (time_entry_id, start_at) VALUES (?, ?)").run(entry.id, nowIso());
  })();
}

export function endBreak(db: DB, userId: number) {
  return db.transaction(() => {
    const entry = openEntryFor(db, userId);
    if (!entry) throw conflict("You are not clocked in.");
    const res = db
      .prepare("UPDATE time_breaks SET end_at = ? WHERE time_entry_id = ? AND end_at IS NULL")
      .run(nowIso(), entry.id);
    if (res.changes === 0) throw conflict("You are not on a break.");
  })();
}

export function switchJob(db: DB, userId: number, jobId: number | null) {
  return db.transaction(() => {
    const entry = openEntryFor(db, userId);
    if (!entry) throw conflict("You are not clocked in.");
    db.prepare("UPDATE time_entries SET job_id = ?, updated_at = ? WHERE id = ?").run(jobId, nowIso(), entry.id);
    if (entry.job_id !== jobId) recordRevision(db, entry.id, "job_id", entry.job_id, jobId, "Changed by employee while clocked in", userId);
  })();
}

// ── Manager actions (always with a reason) ──

export interface EntryEdit {
  clock_in_at?: string;
  clock_out_at?: string | null;
  job_id?: number | null;
  notes?: string | null;
  breaks?: { start_at: string; end_at: string | null }[];
}

export function editEntry(db: DB, entryId: number, edit: EntryEdit, reason: string, editorId: number, ip?: string) {
  if (!reason.trim()) throw badRequest("A reason is required for every time correction.");
  return db.transaction(() => {
    const before = getEntry(db, entryId);
    if (before.status === "void") throw conflict("This entry was voided and cannot be edited.");
    const newIn = edit.clock_in_at ?? before.clock_in_at;
    const newOut = edit.clock_out_at === undefined ? before.clock_out_at : edit.clock_out_at;
    if (before.clock_out_at && newOut === null) throw badRequest("A completed shift must keep a clock-out time.");

    assertWeeksUnlocked(db, before.user_id, before.clock_in_at, newIn);
    validateShape(newIn, newOut);
    assertNoOverlap(db, before.user_id, newIn, newOut, entryId);

    const newBreaks = edit.breaks;
    const oldBreaks = getBreaks(db, entryId);
    validateBreaks(newBreaks ?? oldBreaks, newIn, newOut);

    const changes: Record<string, [unknown, unknown]> = {};
    const now = nowIso();
    if (newIn !== before.clock_in_at) changes.clock_in_at = [before.clock_in_at, newIn];
    if (newOut !== before.clock_out_at) changes.clock_out_at = [before.clock_out_at, newOut];
    if (edit.job_id !== undefined && edit.job_id !== before.job_id) changes.job_id = [before.job_id, edit.job_id];
    if (edit.notes !== undefined && (edit.notes ?? null) !== before.notes) changes.notes = [before.notes, edit.notes];

    const status = newOut ? "closed" : "open";
    if (status === "open" && before.status !== "open" && openEntryFor(db, before.user_id)) {
      throw conflict("This person already has an open shift.");
    }

    db.prepare(
      `UPDATE time_entries SET clock_in_at = ?, clock_out_at = ?, status = ?, job_id = ?, notes = ?, updated_at = ? WHERE id = ?`,
    ).run(
      newIn,
      newOut,
      status,
      edit.job_id !== undefined ? edit.job_id : before.job_id,
      edit.notes !== undefined ? edit.notes : before.notes,
      now,
      entryId,
    );

    for (const [field, [o, n]] of Object.entries(changes)) recordRevision(db, entryId, field, o, n, reason, editorId);

    if (newBreaks) {
      const norm = (bs: { start_at: string; end_at: string | null }[]) =>
        JSON.stringify(bs.map((b) => ({ start_at: b.start_at, end_at: b.end_at })).sort((a, b) => a.start_at.localeCompare(b.start_at)));
      const oldNorm = norm(oldBreaks);
      const newNorm = norm(newBreaks);
      if (oldNorm !== newNorm) {
        db.prepare("DELETE FROM time_breaks WHERE time_entry_id = ?").run(entryId);
        const ins = db.prepare("INSERT INTO time_breaks (time_entry_id, start_at, end_at) VALUES (?,?,?)");
        for (const b of newBreaks) ins.run(entryId, b.start_at, b.end_at);
        recordRevision(db, entryId, "breaks", JSON.parse(oldNorm), JSON.parse(newNorm), reason, editorId);
        changes.breaks = [JSON.parse(oldNorm), JSON.parse(newNorm)];
      }
    }

    if (Object.keys(changes).length === 0) throw badRequest("No changes to save.");
    audit(db, {
      userId: editorId,
      action: "time.edit",
      entityType: "time_entry",
      entityId: entryId,
      summary: `corrected a time entry (${Object.keys(changes).join(", ")}) — ${reason}`,
      changes,
      ip,
    });
    return getEntry(db, entryId);
  })();
}

export function addManualEntry(
  db: DB,
  data: { user_id: number; clock_in_at: string; clock_out_at: string; job_id: number | null; notes: string | null; breaks: { start_at: string; end_at: string }[] },
  reason: string,
  editorId: number,
  ip?: string,
): TimeEntry {
  if (!reason.trim()) throw badRequest("A reason is required when adding a missing shift.");
  return db.transaction(() => {
    validateShape(data.clock_in_at, data.clock_out_at);
    assertWeeksUnlocked(db, data.user_id, data.clock_in_at);
    assertNoOverlap(db, data.user_id, data.clock_in_at, data.clock_out_at);
    validateBreaks(data.breaks, data.clock_in_at, data.clock_out_at);
    const info = db
      .prepare(
        `INSERT INTO time_entries (user_id, job_id, clock_in_at, clock_out_at, source, status, notes, created_by)
         VALUES (?,?,?,?, 'manual', 'closed', ?, ?)`,
      )
      .run(data.user_id, data.job_id, data.clock_in_at, data.clock_out_at, data.notes, editorId);
    const id = Number(info.lastInsertRowid);
    const ins = db.prepare("INSERT INTO time_breaks (time_entry_id, start_at, end_at) VALUES (?,?,?)");
    for (const b of data.breaks) ins.run(id, b.start_at, b.end_at);
    recordRevision(db, id, "created", null, { clock_in_at: data.clock_in_at, clock_out_at: data.clock_out_at, job_id: data.job_id, breaks: data.breaks }, reason, editorId);
    audit(db, {
      userId: editorId,
      action: "time.manual_add",
      entityType: "time_entry",
      entityId: id,
      summary: `added a missing shift — ${reason}`,
      ip,
    });
    return getEntry(db, id);
  })();
}

export function voidEntry(db: DB, entryId: number, reason: string, editorId: number, ip?: string) {
  if (!reason.trim()) throw badRequest("A reason is required to void a shift.");
  db.transaction(() => {
    const e = getEntry(db, entryId);
    if (e.status === "void") throw conflict("Entry is already void.");
    assertWeeksUnlocked(db, e.user_id, e.clock_in_at);
    db.prepare("UPDATE time_entries SET status = 'void', updated_at = ? WHERE id = ?").run(nowIso(), entryId);
    recordRevision(db, entryId, "status", e.status, "void", reason, editorId);
    audit(db, { userId: editorId, action: "time.void", entityType: "time_entry", entityId: entryId, summary: `voided a shift — ${reason}`, ip });
  })();
}

/** Loads entries for a user/time range with breaks and computed minutes and review flags. */
export function loadEntries(db: DB, where: string, params: unknown[]) {
  const rows = db
    .prepare(
      `SELECT t.*, u.first_name || ' ' || u.last_name AS user_name, j.job_number, j.name AS job_name,
              (SELECT COUNT(*) FROM time_entry_revisions r WHERE r.time_entry_id = t.id) AS revision_count
       FROM time_entries t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN jobs j ON j.id = t.job_id
       WHERE ${where}
       ORDER BY t.clock_in_at`,
    )
    .all(...params) as (TimeEntry & { user_name: string; job_number: string | null; job_name: string | null; revision_count: number })[];
  const now = nowIso();
  return rows.map((e) => {
    const breaks = getBreaks(db, e.id);
    const end = e.clock_out_at ?? now;
    const worked = workedMinutes(e, breaks, now);
    const flags: string[] = [];
    if (e.status === "open" && minutesBetween(e.clock_in_at, now) > LONG_SHIFT_HOURS * 60) flags.push("missed_punch");
    if (e.status === "closed" && minutesBetween(e.clock_in_at, end) > LONG_SHIFT_HOURS * 60) flags.push("long_shift");
    if (breaks.some((b) => !b.end_at) && e.status !== "open") flags.push("open_break");
    return { ...e, breaks, break_minutes: breakMinutes(breaks, end), worked_minutes: worked, flags };
  });
}
