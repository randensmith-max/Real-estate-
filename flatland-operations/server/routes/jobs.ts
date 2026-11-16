import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { assertCanViewJob } from "../lib/access.js";
import { audit, diff } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { badRequest, notFound } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { companyTz, localToUtc, nowIso } from "../lib/time.js";
import { likeContains, optDateTime, optId, optMoney, optNumber, optText, parseId, reqText } from "../lib/validate.js";

export const JOB_STATUSES = ["new", "quoted", "scheduled", "in_progress", "on_hold", "completed", "invoiced", "cancelled"] as const;
export const JOB_TYPES = ["chopping", "farming", "hauling", "custom", "other"] as const;

const jobSchema = z.object({
  name: reqText(150),
  customer_id: optId,
  job_type: z.enum(JOB_TYPES),
  description: optText(4000),
  instructions: optText(4000),
  site_address: optText(300),
  site_lat: optNumber,
  site_lng: optNumber,
  site_directions: optText(2000),
  scheduled_start: optDateTime,
  scheduled_end: optDateTime,
  estimated_hours: optNumber,
  quoted_amount: optMoney,
  acres: optNumber,
  assigned_user_ids: z.array(z.number().int().positive()).optional(),
  equipment_ids: z.array(z.number().int().positive()).optional(),
});

function nextJobNumber(db: DB): string {
  const year = new Date().getFullYear();
  const key = `job_seq_${year}`;
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  const n = (row ? Number(row.value) : 0) + 1;
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, String(n));
  return `${year}-${String(n).padStart(4, "0")}`;
}

export function jobRoutes(db: DB) {
  const r = Router();

  const financial = (req: Express.Request) => can(req.user!, "financials.view");

  function normalizeSchedule(b: { scheduled_start: string | null; scheduled_end: string | null }) {
    const tz = companyTz(db);
    let start: string | null = null;
    let end: string | null = null;
    try {
      start = b.scheduled_start ? localToUtc(b.scheduled_start, tz) : null;
      end = b.scheduled_end ? localToUtc(b.scheduled_end, tz) : null;
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    if (start && end && end <= start) throw badRequest("Scheduled end must be after the start.", { fields: { scheduled_end: "Must be after start" } });
    return { start, end };
  }

  function setAssignments(jobId: number, userIds: number[], actorId: number): string[] {
    const current = (db.prepare("SELECT user_id FROM job_assignments WHERE job_id = ?").all(jobId) as { user_id: number }[]).map((r) => r.user_id);
    const want = [...new Set(userIds)];
    const users = want.length
      ? (db.prepare(`SELECT id, status FROM users WHERE id IN (${want.map(() => "?").join(",")})`).all(...want) as { id: number; status: string }[])
      : [];
    if (users.length !== want.length || users.some((u) => u.status !== "active")) throw badRequest("One or more selected people are not active users.");
    const add = want.filter((id) => !current.includes(id));
    const remove = current.filter((id) => !want.includes(id));
    const ins = db.prepare("INSERT INTO job_assignments (job_id, user_id, assigned_by) VALUES (?,?,?)");
    const del = db.prepare("DELETE FROM job_assignments WHERE job_id = ? AND user_id = ?");
    add.forEach((u) => ins.run(jobId, u, actorId));
    remove.forEach((u) => del.run(jobId, u));
    const names = (ids: number[]) =>
      ids.length
        ? (db.prepare(`SELECT first_name || ' ' || last_name AS n FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { n: string }[]).map((x) => x.n)
        : [];
    const parts: string[] = [];
    if (add.length) parts.push(`assigned ${names(add).join(", ")}`);
    if (remove.length) parts.push(`unassigned ${names(remove).join(", ")}`);
    return parts;
  }

  function setEquipment(jobId: number, itemIds: number[], actorId: number): string[] {
    const current = (db.prepare("SELECT item_id FROM job_equipment WHERE job_id = ?").all(jobId) as { item_id: number }[]).map((r) => r.item_id);
    const want = [...new Set(itemIds)];
    const items = want.length
      ? (db.prepare(`SELECT id, name, kind, status FROM inventory_items WHERE id IN (${want.map(() => "?").join(",")})`).all(...want) as { id: number; name: string; kind: string; status: string }[])
      : [];
    if (items.length !== want.length || items.some((i) => i.kind !== "equipment" || i.status !== "active")) {
      throw badRequest("Only active equipment can be assigned to a job.");
    }
    const add = want.filter((id) => !current.includes(id));
    const remove = current.filter((id) => !want.includes(id));
    add.forEach((i) => db.prepare("INSERT INTO job_equipment (job_id, item_id, assigned_by) VALUES (?,?,?)").run(jobId, i, actorId));
    remove.forEach((i) => db.prepare("DELETE FROM job_equipment WHERE job_id = ? AND item_id = ?").run(jobId, i));
    const nameOf = (id: number) => (db.prepare("SELECT name FROM inventory_items WHERE id = ?").get(id) as { name: string }).name;
    const parts: string[] = [];
    if (add.length) parts.push(`added equipment ${add.map(nameOf).join(", ")}`);
    if (remove.length) parts.push(`removed equipment ${remove.map(nameOf).join(", ")}`);
    return parts;
  }

  /** Scheduling conflicts: the same person or machine on overlapping active jobs. Returned as warnings. */
  function conflictsFor(jobId: number): string[] {
    const job = db.prepare("SELECT scheduled_start, scheduled_end FROM jobs WHERE id = ?").get(jobId) as { scheduled_start: string | null; scheduled_end: string | null };
    if (!job.scheduled_start) return [];
    const end = job.scheduled_end ?? new Date(Date.parse(job.scheduled_start) + 10 * 3600_000).toISOString();
    const overlapping = `j.id <> ? AND j.status IN ('scheduled','in_progress') AND j.scheduled_start < ?
      AND COALESCE(j.scheduled_end, strftime('%Y-%m-%dT%H:%M:%fZ', j.scheduled_start, '+10 hours')) > ?`;
    const people = db
      .prepare(
        `SELECT DISTINCT u.first_name || ' ' || u.last_name AS who, j.job_number FROM job_assignments a
         JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = a.user_id
         WHERE a.user_id IN (SELECT user_id FROM job_assignments WHERE job_id = ?) AND ${overlapping}`,
      )
      .all(jobId, jobId, end, job.scheduled_start) as { who: string; job_number: string }[];
    const machines = db
      .prepare(
        `SELECT DISTINCT i.name AS who, j.job_number FROM job_equipment e
         JOIN jobs j ON j.id = e.job_id JOIN inventory_items i ON i.id = e.item_id
         WHERE e.item_id IN (SELECT item_id FROM job_equipment WHERE job_id = ?) AND ${overlapping}`,
      )
      .all(jobId, jobId, end, job.scheduled_start) as { who: string; job_number: string }[];
    return [...people, ...machines].map((c) => `${c.who} is also scheduled on job ${c.job_number} at an overlapping time.`);
  }

  r.get("/", (req, res) => {
    const user = req.user!;
    const where: string[] = [];
    const params: unknown[] = [];
    if (!can(user, "jobs.view_all") || req.query.mine === "1") {
      where.push("j.id IN (SELECT job_id FROM job_assignments WHERE user_id = ?)");
      params.push(user.id);
    }
    const statuses = String(req.query.status ?? "").split(",").filter((s) => (JOB_STATUSES as readonly string[]).includes(s));
    if (statuses.length) {
      where.push(`j.status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    } else if (req.query.status !== "all") {
      where.push("j.status <> 'cancelled'");
    }
    if ((JOB_TYPES as readonly string[]).includes(String(req.query.type))) {
      where.push("j.job_type = ?");
      params.push(req.query.type);
    }
    if (req.query.customer_id) {
      where.push("j.customer_id = ?");
      params.push(parseId(req.query.customer_id));
    }
    if (req.query.from) {
      where.push("j.scheduled_start >= ?");
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push("j.scheduled_start < ?");
      params.push(String(req.query.to));
    }
    const q = String(req.query.q ?? "").trim();
    if (q) {
      where.push("(j.name LIKE ? ESCAPE '\\' OR j.job_number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR j.site_address LIKE ? ESCAPE '\\')");
      params.push(...Array(4).fill(likeContains(q)));
    }
    const rows = db
      .prepare(
        `SELECT j.id, j.job_number, j.name, j.job_type, j.status, j.scheduled_start, j.scheduled_end, j.estimated_hours,
                j.site_address, j.acres, c.name AS customer_name, c.id AS customer_id,
                ${financial(req) ? "j.quoted_amount_cents," : ""}
                ROUND(COALESCE((SELECT SUM(worked_minutes) FROM v_time_worked w WHERE w.job_id = j.id), 0) / 60.0, 2) AS actual_hours,
                (SELECT GROUP_CONCAT(u.first_name || ' ' || u.last_name, ', ') FROM job_assignments a JOIN users u ON u.id = a.user_id WHERE a.job_id = j.id) AS crew,
                (SELECT GROUP_CONCAT(i.name, ', ') FROM job_equipment e JOIN inventory_items i ON i.id = e.item_id WHERE e.job_id = j.id) AS equipment
         FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY CASE j.status WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'on_hold' THEN 2 WHEN 'new' THEN 3 WHEN 'quoted' THEN 4 ELSE 5 END,
                  j.scheduled_start IS NULL, j.scheduled_start, j.id DESC
         LIMIT 500`,
      )
      .all(...params);
    res.json({ jobs: rows });
  });

  r.get("/:id", (req, res) => {
    const id = parseId(req.params.id);
    assertCanViewJob(db, req.user!, id);
    const job = db
      .prepare(
        `SELECT j.*, c.name AS customer_name, c.contact_name AS customer_contact, c.phone AS customer_phone, c.email AS customer_email,
                cb.first_name || ' ' || cb.last_name AS created_by_name
         FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id LEFT JOIN users cb ON cb.id = j.created_by WHERE j.id = ?`,
      )
      .get(id) as Record<string, unknown>;
    if (!financial(req)) delete job.quoted_amount_cents;
    const crew = db
      .prepare(
        `SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.role, u.phone,
                ROUND(COALESCE((SELECT SUM(worked_minutes) FROM v_time_worked w WHERE w.job_id = a.job_id AND w.user_id = u.id), 0) / 60.0, 2) AS hours,
                EXISTS (SELECT 1 FROM time_entries t WHERE t.user_id = u.id AND t.status = 'open' AND t.job_id = a.job_id) AS on_site
         FROM job_assignments a JOIN users u ON u.id = a.user_id WHERE a.job_id = ? ORDER BY u.last_name`,
      )
      .all(id);
    const equipment = db
      .prepare(
        `SELECT i.id, i.name, i.category, i.asset_number, i.condition,
                EXISTS (SELECT 1 FROM maintenance_records m WHERE m.item_id = i.id AND m.status NOT IN ('completed','cancelled') AND m.equipment_down = 1) AS down
         FROM job_equipment e JOIN inventory_items i ON i.id = e.item_id WHERE e.job_id = ?`,
      )
      .all(id);
    const notes = db
      .prepare(
        `SELECT n.id, n.body, n.created_at, u.first_name || ' ' || u.last_name AS author FROM job_notes n
         JOIN users u ON u.id = n.user_id WHERE n.job_id = ? ORDER BY n.created_at DESC`,
      )
      .all(id);
    const attachments = db
      .prepare(
        `SELECT a.id, a.caption, a.created_at, f.id AS file_id, f.original_name, f.mime_type, f.size_bytes,
                u.first_name || ' ' || u.last_name AS uploaded_by
         FROM attachments a JOIN files f ON f.id = a.file_id LEFT JOIN users u ON u.id = a.created_by
         WHERE a.entity_type = 'job' AND a.entity_id = ? ORDER BY a.created_at DESC`,
      )
      .all(id);
    const documents = db
      .prepare(
        `SELECT d.id, d.title, d.category, d.updated_at FROM document_links l JOIN documents d ON d.id = l.document_id
         WHERE l.entity_type = 'job' AND l.entity_id = ? AND d.status = 'active'`,
      )
      .all(id);
    const activity = db
      .prepare(
        `SELECT a.id, a.summary, a.action, a.created_at, u.first_name || ' ' || u.last_name AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity_type = 'job' AND a.entity_id = ?
         ORDER BY a.id DESC LIMIT 100`,
      )
      .all(id);
    const totals = db
      .prepare("SELECT ROUND(COALESCE(SUM(worked_minutes),0)/60.0, 2) AS actual_hours FROM v_time_worked WHERE job_id = ?")
      .get(id);
    res.json({ job, crew, equipment, notes, attachments, documents, activity, totals, warnings: can(req.user!, "jobs.manage") ? conflictsFor(id) : [] });
  });

  r.post("/", requirePerm("jobs.manage"), (req, res) => {
    const b = jobSchema.parse(req.body);
    const { start, end } = normalizeSchedule(b);
    if (b.customer_id && !db.prepare("SELECT 1 FROM customers WHERE id = ?").get(b.customer_id)) throw badRequest("Customer not found.");
    const id = db.transaction(() => {
      const number = nextJobNumber(db);
      const status = start ? "scheduled" : "new";
      const info = db
        .prepare(
          `INSERT INTO jobs (job_number, name, customer_id, job_type, status, description, instructions, site_address, site_lat, site_lng,
             site_directions, scheduled_start, scheduled_end, estimated_hours, quoted_amount_cents, acres, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          number, b.name, b.customer_id, b.job_type, status, b.description, b.instructions, b.site_address, b.site_lat, b.site_lng,
          b.site_directions, start, end, b.estimated_hours, financial(req) ? b.quoted_amount : null, b.acres, req.user!.id,
        );
      const jobId = Number(info.lastInsertRowid);
      const parts = [
        ...(b.assigned_user_ids ? setAssignments(jobId, b.assigned_user_ids, req.user!.id) : []),
        ...(b.equipment_ids ? setEquipment(jobId, b.equipment_ids, req.user!.id) : []),
      ];
      audit(db, {
        userId: req.user!.id,
        action: "job.create",
        entityType: "job",
        entityId: jobId,
        summary: `created job ${number} "${b.name}"${parts.length ? "; " + parts.join("; ") : ""}`,
        ip: req.ip,
      });
      return jobId;
    })();
    res.status(201).json({ id, warnings: conflictsFor(id) });
  });

  r.put("/:id", requirePerm("jobs.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const before = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!before) throw notFound("Job");
    const b = jobSchema.parse(req.body);
    const { start, end } = normalizeSchedule(b);
    db.transaction(() => {
      const updates: Record<string, unknown> = {
        name: b.name, customer_id: b.customer_id, job_type: b.job_type, description: b.description, instructions: b.instructions,
        site_address: b.site_address, site_lat: b.site_lat, site_lng: b.site_lng, site_directions: b.site_directions,
        scheduled_start: start, scheduled_end: end, estimated_hours: b.estimated_hours, acres: b.acres,
      };
      if (financial(req)) updates.quoted_amount_cents = b.quoted_amount;
      // Scheduling a "new"/"quoted" job moves it to Scheduled automatically.
      if (start && (before.status === "new" || before.status === "quoted")) updates.status = "scheduled";
      const cols = Object.keys(updates);
      db.prepare(`UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => updates[c]), nowIso(), id);
      const parts = [
        ...(b.assigned_user_ids ? setAssignments(id, b.assigned_user_ids, req.user!.id) : []),
        ...(b.equipment_ids ? setEquipment(id, b.equipment_ids, req.user!.id) : []),
      ];
      const changes = diff(before, updates);
      if (Object.keys(changes).length || parts.length) {
        audit(db, {
          userId: req.user!.id,
          action: "job.update",
          entityType: "job",
          entityId: id,
          summary: `updated job ${before.job_number}${Object.keys(changes).length ? ` (${Object.keys(changes).join(", ")})` : ""}${parts.length ? "; " + parts.join("; ") : ""}`,
          changes,
          ip: req.ip,
        });
      }
    })();
    res.json({ ok: true, warnings: conflictsFor(id) });
  });

  r.post("/:id/status", requirePerm("jobs.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const b = z.object({ status: z.enum(JOB_STATUSES), note: optText(1000) }).parse(req.body);
    const job = db.prepare("SELECT job_number, status FROM jobs WHERE id = ?").get(id) as { job_number: string; status: string } | undefined;
    if (!job) throw notFound("Job");
    if (job.status === b.status) return res.json({ ok: true });
    db.transaction(() => {
      db.prepare(
        `UPDATE jobs SET status = ?, completed_at = CASE WHEN ? IN ('completed','invoiced') THEN COALESCE(completed_at, ?) ELSE NULL END, updated_at = ? WHERE id = ?`,
      ).run(b.status, b.status, nowIso(), nowIso(), id);
      if (b.note) db.prepare("INSERT INTO job_notes (job_id, user_id, body) VALUES (?,?,?)").run(id, req.user!.id, b.note);
      audit(db, {
        userId: req.user!.id,
        action: "job.status",
        entityType: "job",
        entityId: id,
        summary: `moved job ${job.job_number} from ${job.status.replace("_", " ")} to ${b.status.replace("_", " ")}`,
        changes: { status: [job.status, b.status] },
        ip: req.ip,
      });
    })();
    res.json({ ok: true });
  });

  r.put("/:id/assignments", requirePerm("jobs.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const job = db.prepare("SELECT job_number FROM jobs WHERE id = ?").get(id) as { job_number: string } | undefined;
    if (!job) throw notFound("Job");
    const b = z.object({ user_ids: z.array(z.number().int().positive()).optional(), equipment_ids: z.array(z.number().int().positive()).optional() }).parse(req.body);
    db.transaction(() => {
      const parts = [
        ...(b.user_ids ? setAssignments(id, b.user_ids, req.user!.id) : []),
        ...(b.equipment_ids ? setEquipment(id, b.equipment_ids, req.user!.id) : []),
      ];
      if (parts.length) audit(db, { userId: req.user!.id, action: "job.assign", entityType: "job", entityId: id, summary: `job ${job.job_number}: ${parts.join("; ")}`, ip: req.ip });
    })();
    res.json({ ok: true, warnings: conflictsFor(id) });
  });

  r.post("/:id/notes", (req, res) => {
    const id = parseId(req.params.id);
    assertCanViewJob(db, req.user!, id);
    const b = z.object({ body: reqText(4000) }).parse(req.body);
    const info = db.prepare("INSERT INTO job_notes (job_id, user_id, body) VALUES (?,?,?)").run(id, req.user!.id, b.body);
    audit(db, { userId: req.user!.id, action: "job.note", entityType: "job", entityId: id, summary: "added a note" });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  return r;
}
