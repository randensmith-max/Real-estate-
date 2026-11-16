import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { audit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { companyTz, nowIso, todayIn } from "../lib/time.js";
import { isoDate, optText, parseId } from "../lib/validate.js";

export function timeOffRoutes(db: DB) {
  const r = Router();

  /** Mine by default; managers can pass scope=all and filter by status / date window. */
  r.get("/", (req, res) => {
    const all = req.query.scope === "all";
    if (all && !can(req.user!, "timeoff.review")) throw forbidden();
    const where: string[] = [];
    const params: unknown[] = [];
    if (!all) {
      where.push("t.user_id = ?");
      params.push(req.user!.id);
    }
    if (typeof req.query.status === "string" && req.query.status) {
      where.push("t.status = ?");
      params.push(req.query.status);
    }
    if (req.query.from) {
      where.push("t.end_date >= ?");
      params.push(isoDate.parse(req.query.from));
    }
    if (req.query.to) {
      where.push("t.start_date <= ?");
      params.push(isoDate.parse(req.query.to));
    }
    const rows = db
      .prepare(
        `SELECT t.*, u.first_name || ' ' || u.last_name AS user_name, rv.first_name || ' ' || rv.last_name AS reviewed_by_name
         FROM time_off_requests t JOIN users u ON u.id = t.user_id LEFT JOIN users rv ON rv.id = t.reviewed_by
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, t.start_date DESC LIMIT 500`,
      )
      .all(...params);
    res.json({ requests: rows });
  });

  r.post("/", requirePerm("timeoff.request"), (req, res) => {
    const b = z
      .object({
        type: z.enum(["vacation", "sick", "personal", "unpaid", "other"]),
        start_date: isoDate,
        end_date: isoDate,
        partial_day: z.boolean().default(false),
        reason: optText(1000),
      })
      .parse(req.body);
    if (b.end_date < b.start_date) throw badRequest("End date must be on or after the start date.", { fields: { end_date: "Must be on or after start" } });
    if (b.type !== "sick" && b.end_date < todayIn(companyTz(db))) throw badRequest("Requests for past dates must be entered by a manager.");
    const overlap = db
      .prepare("SELECT 1 FROM time_off_requests WHERE user_id = ? AND status IN ('pending','approved') AND start_date <= ? AND end_date >= ?")
      .get(req.user!.id, b.end_date, b.start_date);
    if (overlap) throw conflict("You already have a request covering some of those dates.");
    const info = db
      .prepare("INSERT INTO time_off_requests (user_id, type, start_date, end_date, partial_day, reason) VALUES (?,?,?,?,?,?)")
      .run(req.user!.id, b.type, b.start_date, b.end_date, b.partial_day ? 1 : 0, b.reason);
    audit(db, { userId: req.user!.id, action: "timeoff.request", entityType: "time_off", entityId: info.lastInsertRowid, summary: `requested ${b.type} time off ${b.start_date} to ${b.end_date}` });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.post("/:id/review", requirePerm("timeoff.review"), (req, res) => {
    const id = parseId(req.params.id);
    const b = z.object({ decision: z.enum(["approved", "denied"]), note: optText(1000) }).parse(req.body);
    const t = db
      .prepare("SELECT t.*, u.first_name || ' ' || u.last_name AS name FROM time_off_requests t JOIN users u ON u.id = t.user_id WHERE t.id = ?")
      .get(id) as { status: string; user_id: number; name: string; start_date: string; end_date: string } | undefined;
    if (!t) throw notFound("Request");
    if (t.status !== "pending") throw conflict("This request has already been decided.");
    if (t.user_id === req.user!.id && req.user!.role !== "owner") throw forbidden("Your own request must be reviewed by someone else.");
    db.prepare("UPDATE time_off_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?").run(
      b.decision, req.user!.id, nowIso(), b.note, id,
    );
    audit(db, {
      userId: req.user!.id,
      action: `timeoff.${b.decision}`,
      entityType: "time_off",
      entityId: id,
      summary: `${b.decision === "approved" ? "approved" : "denied"} ${t.name}'s time off ${t.start_date} to ${t.end_date}`,
    });
    res.json({ ok: true });
  });

  r.post("/:id/cancel", (req, res) => {
    const id = parseId(req.params.id);
    const t = db.prepare("SELECT * FROM time_off_requests WHERE id = ?").get(id) as { status: string; user_id: number; start_date: string } | undefined;
    if (!t) throw notFound("Request");
    if (t.user_id !== req.user!.id && !can(req.user!, "timeoff.review")) throw forbidden();
    if (!["pending", "approved"].includes(t.status)) throw conflict("This request can no longer be cancelled.");
    db.prepare("UPDATE time_off_requests SET status = 'cancelled' WHERE id = ?").run(id);
    audit(db, { userId: req.user!.id, action: "timeoff.cancel", entityType: "time_off", entityId: id, summary: `cancelled a time-off request starting ${t.start_date}` });
    res.json({ ok: true });
  });

  /** Team calendar: approved/pending absences and weekly availability for a date window. */
  r.get("/calendar", requirePerm("availability.view_all"), (req, res) => {
    const from = isoDate.parse(req.query.from);
    const to = isoDate.parse(req.query.to);
    const absences = db
      .prepare(
        `SELECT t.id, t.user_id, t.type, t.start_date, t.end_date, t.status, u.first_name || ' ' || u.last_name AS user_name
         FROM time_off_requests t JOIN users u ON u.id = t.user_id
         WHERE t.status IN ('pending','approved') AND t.start_date <= ? AND t.end_date >= ? ORDER BY t.start_date`,
      )
      .all(to, from);
    const availability = db
      .prepare(
        `SELECT a.*, u.first_name || ' ' || u.last_name AS user_name FROM availability a JOIN users u ON u.id = a.user_id
         WHERE u.status = 'active' ORDER BY u.last_name, a.weekday`,
      )
      .all();
    const people = db
      .prepare("SELECT id, first_name || ' ' || last_name AS name, role FROM users WHERE status = 'active' AND role <> 'owner' ORDER BY last_name")
      .all();
    res.json({ absences, availability, people });
  });

  return r;
}
