import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { canViewEntity } from "../lib/access.js";
import { audit, diff } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { nowIso } from "../lib/time.js";
import { optId, optMoney, optNumber, optText, parseId, reqText } from "../lib/validate.js";

const STATUSES = ["open", "in_progress", "waiting_parts", "completed", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high", "critical"] as const;

/** Creates an equipment issue. Shared with inspections (failed items auto-create issues). */
export function createIssue(
  db: DB,
  data: { item_id: number | null; title: string; description: string | null; priority: string; equipment_down: boolean; reported_by: number; kind?: string; inspection_id?: number | null },
): number {
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO maintenance_records (item_id, kind, title, description, priority, status, equipment_down, reported_by, reported_at, downtime_start, inspection_id)
       VALUES (?,?,?,?,?, 'open', ?, ?, ?, ?, ?)`,
    )
    .run(
      data.item_id, data.kind ?? "issue", data.title, data.description, data.priority, data.equipment_down ? 1 : 0,
      data.reported_by, now, data.equipment_down ? now : null, data.inspection_id ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function maintenanceRoutes(db: DB) {
  const r = Router();

  r.get("/", (req, res) => {
    const manage = can(req.user!, "maintenance.manage");
    const where: string[] = [];
    const params: unknown[] = [];
    if (!manage) {
      where.push("(m.reported_by = ? OR m.assigned_to = ?)");
      params.push(req.user!.id, req.user!.id);
    }
    const status = String(req.query.status ?? "active");
    if (status === "active") where.push("m.status NOT IN ('completed','cancelled')");
    else if ((STATUSES as readonly string[]).includes(status)) {
      where.push("m.status = ?");
      params.push(status);
    }
    if (req.query.item_id) {
      where.push("m.item_id = ?");
      params.push(parseId(req.query.item_id));
    }
    if (req.query.kind) {
      where.push("m.kind = ?");
      params.push(String(req.query.kind));
    }
    const rows = db
      .prepare(
        `SELECT m.*, i.name AS item_name, i.asset_number, rb.first_name || ' ' || rb.last_name AS reported_by_name,
                at.first_name || ' ' || at.last_name AS assigned_to_name
         FROM maintenance_records m LEFT JOIN inventory_items i ON i.id = m.item_id
         LEFT JOIN users rb ON rb.id = m.reported_by LEFT JOIN users at ON at.id = m.assigned_to
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY CASE m.status WHEN 'completed' THEN 2 WHEN 'cancelled' THEN 3 ELSE 0 END,
                  CASE m.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, m.reported_at DESC
         LIMIT 500`,
      )
      .all(...params);

    // Recurring maintenance that is due (by date or meter hours).
    const due = manage
      ? db
          .prepare(
            `SELECT s.*, i.name AS item_name, i.meter_hours,
               CASE WHEN s.interval_days IS NOT NULL THEN date(COALESCE(s.last_done_at, s.created_at), '+' || s.interval_days || ' days') END AS next_due_date,
               CASE WHEN s.interval_hours IS NOT NULL THEN COALESCE(s.last_done_hours, 0) + s.interval_hours END AS next_due_hours
             FROM maintenance_schedules s JOIN inventory_items i ON i.id = s.item_id WHERE s.active = 1 AND i.status = 'active'`,
          )
          .all()
          .map((s) => {
            const x = s as { next_due_date: string | null; next_due_hours: number | null; meter_hours: number | null };
            const today = new Date().toISOString().slice(0, 10);
            const soon = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
            const byDate = x.next_due_date ? (x.next_due_date <= today ? "overdue" : x.next_due_date <= soon ? "soon" : null) : null;
            const byHours =
              x.next_due_hours !== null && x.meter_hours !== null
                ? x.meter_hours >= x.next_due_hours ? "overdue" : x.next_due_hours - x.meter_hours <= 25 ? "soon" : null
                : null;
            return { ...x, due_state: byDate === "overdue" || byHours === "overdue" ? "overdue" : byDate || byHours };
          })
          .filter((s) => s.due_state)
      : [];
    res.json({ records: rows, due });
  });

  r.get("/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!canViewEntity(db, req.user!, "maintenance", id)) throw notFound("Maintenance record");
    const record = db
      .prepare(
        `SELECT m.*, i.name AS item_name, i.asset_number, rb.first_name || ' ' || rb.last_name AS reported_by_name,
                at.first_name || ' ' || at.last_name AS assigned_to_name
         FROM maintenance_records m LEFT JOIN inventory_items i ON i.id = m.item_id
         LEFT JOIN users rb ON rb.id = m.reported_by LEFT JOIN users at ON at.id = m.assigned_to WHERE m.id = ?`,
      )
      .get(id) as Record<string, unknown>;
    if (!can(req.user!, "financials.view")) delete record.outside_cost_cents;
    const parts = db
      .prepare(
        `SELECT mv.id, mv.quantity_change, mv.created_at, i.name, i.unit FROM inventory_movements mv JOIN inventory_items i ON i.id = mv.item_id
         WHERE mv.maintenance_id = ? ORDER BY mv.id`,
      )
      .all(id);
    const attachments = db
      .prepare(
        `SELECT a.id, a.caption, a.created_at, f.id AS file_id, f.original_name, f.mime_type, f.size_bytes
         FROM attachments a JOIN files f ON f.id = a.file_id WHERE a.entity_type = 'maintenance' AND a.entity_id = ?`,
      )
      .all(id);
    const activity = db
      .prepare(
        `SELECT a.summary, a.created_at, u.first_name || ' ' || u.last_name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.entity_type = 'maintenance' AND a.entity_id = ? ORDER BY a.id DESC`,
      )
      .all(id);
    res.json({ record, parts, attachments, activity });
  });

  /** Anyone with maintenance.report can report a problem — the "Report Equipment Issue" quick action. */
  r.post("/", requirePerm("maintenance.report"), (req, res) => {
    const b = z
      .object({
        item_id: optId,
        kind: z.enum(["issue", "repair", "preventative", "shop_project"]).default("issue"),
        title: reqText(150),
        description: optText(4000),
        priority: z.enum(PRIORITIES).default("normal"),
        equipment_down: z.boolean().default(false),
        assigned_to: optId,
      })
      .parse(req.body);
    if (b.kind !== "issue" && !can(req.user!, "maintenance.manage")) throw badRequest("Only managers can create work orders.");
    if (b.item_id && !db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(b.item_id)) throw badRequest("Equipment not found.");
    const id = db.transaction(() => {
      const mid = createIssue(db, { ...b, reported_by: req.user!.id });
      if (b.assigned_to && can(req.user!, "maintenance.manage")) db.prepare("UPDATE maintenance_records SET assigned_to = ? WHERE id = ?").run(b.assigned_to, mid);
      audit(db, { userId: req.user!.id, action: "maintenance.create", entityType: "maintenance", entityId: mid, summary: `reported "${b.title}"${b.equipment_down ? " (equipment down)" : ""}`, ip: req.ip });
      return mid;
    })();
    res.status(201).json({ id });
  });

  r.put("/:id", requirePerm("maintenance.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const before = db.prepare("SELECT * FROM maintenance_records WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!before) throw notFound("Maintenance record");
    const b = z
      .object({
        title: reqText(150),
        description: optText(4000),
        priority: z.enum(PRIORITIES),
        status: z.enum(STATUSES),
        assigned_to: optId,
        labor_hours: optNumber,
        outside_cost: optMoney,
        repair_notes: optText(4000),
        equipment_down: z.boolean(),
      })
      .parse(req.body);
    const now = nowIso();
    const closing = (b.status === "completed" || b.status === "cancelled") && before.completed_at === null;
    const updates: Record<string, unknown> = {
      title: b.title, description: b.description, priority: b.priority, status: b.status, assigned_to: b.assigned_to,
      labor_hours: b.labor_hours ?? 0, repair_notes: b.repair_notes, equipment_down: closing ? 0 : b.equipment_down ? 1 : 0,
    };
    if (can(req.user!, "financials.view")) updates.outside_cost_cents = b.outside_cost ?? 0;
    if (closing) {
      updates.completed_at = now;
      if (before.downtime_start && !before.downtime_end) updates.downtime_end = now;
    }
    if (!closing && b.equipment_down && !before.downtime_start) updates.downtime_start = now;
    if (!closing && !b.equipment_down && before.downtime_start && !before.downtime_end) updates.downtime_end = now;
    const cols = Object.keys(updates);
    db.transaction(() => {
      db.prepare(`UPDATE maintenance_records SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => updates[c]), now, id);
      // Completing a scheduled job resets its recurring schedule.
      if (b.status === "completed" && before.schedule_id) {
        const item = db.prepare("SELECT meter_hours FROM inventory_items WHERE id = ?").get(before.item_id) as { meter_hours: number | null } | undefined;
        db.prepare("UPDATE maintenance_schedules SET last_done_at = ?, last_done_hours = ? WHERE id = ?").run(now.slice(0, 10), item?.meter_hours ?? null, before.schedule_id);
      }
      audit(db, { userId: req.user!.id, action: "maintenance.update", entityType: "maintenance", entityId: id, summary: `updated "${b.title}" (${b.status.replace("_", " ")})`, changes: diff(before, updates), ip: req.ip });
    })();
    res.json({ ok: true });
  });

  /** Use parts from inventory on a repair — decrements stock with a linked movement. */
  r.post("/:id/parts", requirePerm("maintenance.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const b = z.object({ item_id: z.number().int().positive(), quantity: z.number().positive() }).parse(req.body);
    db.transaction(() => {
      const rec = db.prepare("SELECT title FROM maintenance_records WHERE id = ?").get(id) as { title: string } | undefined;
      if (!rec) throw notFound("Maintenance record");
      const part = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(b.item_id) as { name: string; quantity: number; unit: string; unit_cost_cents: number | null } | undefined;
      if (!part) throw notFound("Part");
      if (part.quantity < b.quantity) throw conflict(`Only ${part.quantity} ${part.unit} of ${part.name} on hand.`);
      const after = part.quantity - b.quantity;
      db.prepare("UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?").run(after, nowIso(), b.item_id);
      db.prepare(
        `INSERT INTO inventory_movements (item_id, type, quantity_change, quantity_after, unit_cost_cents, maintenance_id, reason, user_id)
         VALUES (?, 'usage', ?, ?, ?, ?, ?, ?)`,
      ).run(b.item_id, -b.quantity, after, part.unit_cost_cents, id, `Used on repair: ${rec.title}`, req.user!.id);
      audit(db, { userId: req.user!.id, action: "maintenance.part", entityType: "maintenance", entityId: id, summary: `used ${b.quantity} ${part.unit} of ${part.name}` });
    })();
    res.status(201).json({ ok: true });
  });

  // ── Recurring schedules ──
  r.post("/schedules", requirePerm("maintenance.manage"), (req, res) => {
    const b = z
      .object({ item_id: z.number().int().positive(), title: reqText(150), interval_days: optNumber, interval_hours: optNumber, last_done_at: optText(10), last_done_hours: optNumber })
      .parse(req.body);
    if (!b.interval_days && !b.interval_hours) throw badRequest("Set an interval in days and/or equipment hours.");
    const info = db
      .prepare("INSERT INTO maintenance_schedules (item_id, title, interval_days, interval_hours, last_done_at, last_done_hours) VALUES (?,?,?,?,?,?)")
      .run(b.item_id, b.title, b.interval_days, b.interval_hours, b.last_done_at, b.last_done_hours);
    audit(db, { userId: req.user!.id, action: "maintenance.schedule", entityType: "item", entityId: b.item_id, summary: `added recurring maintenance "${b.title}"` });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  /** Turn a due schedule into a work order. */
  r.post("/schedules/:id/work-order", requirePerm("maintenance.manage"), (req, res) => {
    const sid = parseId(req.params.id);
    const s = db.prepare("SELECT * FROM maintenance_schedules WHERE id = ?").get(sid) as { item_id: number; title: string } | undefined;
    if (!s) throw notFound("Schedule");
    const open = db.prepare("SELECT id FROM maintenance_records WHERE schedule_id = ? AND status NOT IN ('completed','cancelled')").get(sid) as { id: number } | undefined;
    if (open) return res.json({ id: open.id });
    const id = createIssue(db, { item_id: s.item_id, title: s.title, description: "Scheduled preventative maintenance", priority: "normal", equipment_down: false, reported_by: req.user!.id, kind: "preventative" });
    db.prepare("UPDATE maintenance_records SET schedule_id = ? WHERE id = ?").run(sid, id);
    audit(db, { userId: req.user!.id, action: "maintenance.create", entityType: "maintenance", entityId: id, summary: `opened preventative work order "${s.title}"` });
    res.status(201).json({ id });
  });

  return r;
}
