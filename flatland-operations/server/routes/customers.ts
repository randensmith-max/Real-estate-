import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { audit, diff } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { conflict, notFound } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { nowIso } from "../lib/time.js";
import { likeContains, optEmail, optText, parseId, reqText } from "../lib/validate.js";

const customerSchema = z.object({
  name: reqText(150),
  contact_name: optText(120),
  email: optEmail,
  phone: optText(40),
  billing_address: optText(300),
  notes: optText(4000),
});

export function customerRoutes(db: DB) {
  const r = Router();

  r.get("/", requirePerm("customers.view"), (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const status = req.query.status === "archived" ? "archived" : "active";
    const params: unknown[] = [status];
    let where = "c.status = ?";
    if (q) {
      where += " AND (c.name LIKE ? ESCAPE '\\' OR c.contact_name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')";
      params.push(...Array(4).fill(likeContains(q)));
    }
    const rows = db
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id) AS job_count,
           (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id AND j.status IN ('scheduled','in_progress','on_hold')) AS active_jobs,
           (SELECT MAX(scheduled_start) FROM jobs j WHERE j.customer_id = c.id) AS last_job_at
         FROM customers c WHERE ${where} ORDER BY c.name COLLATE NOCASE`,
      )
      .all(...params);
    res.json({ customers: rows });
  });

  r.get("/:id", requirePerm("customers.view"), (req, res) => {
    const id = parseId(req.params.id);
    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
    if (!customer) throw notFound("Customer");
    const jobs = db
      .prepare(
        `SELECT id, job_number, name, job_type, status, scheduled_start, estimated_hours ${can(req.user!, "financials.view") ? ", quoted_amount_cents" : ""}
         FROM jobs WHERE customer_id = ? ORDER BY COALESCE(scheduled_start, created_at) DESC`,
      )
      .all(id);
    const attachments = db
      .prepare(
        `SELECT a.id, a.caption, a.created_at, f.id AS file_id, f.original_name, f.mime_type, f.size_bytes
         FROM attachments a JOIN files f ON f.id = a.file_id WHERE a.entity_type = 'customer' AND a.entity_id = ?`,
      )
      .all(id);
    res.json({ customer, jobs, attachments });
  });

  r.post("/", requirePerm("customers.manage"), (req, res) => {
    const b = customerSchema.parse(req.body);
    if (db.prepare("SELECT 1 FROM customers WHERE name = ? COLLATE NOCASE AND status = 'active'").get(b.name)) {
      throw conflict(`A customer named "${b.name}" already exists.`);
    }
    const info = db
      .prepare(
        `INSERT INTO customers (name, contact_name, email, phone, billing_address, notes, created_by) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(b.name, b.contact_name, b.email, b.phone, b.billing_address, b.notes, req.user!.id);
    audit(db, { userId: req.user!.id, action: "customer.create", entityType: "customer", entityId: info.lastInsertRowid, summary: `added customer ${b.name}`, ip: req.ip });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put("/:id", requirePerm("customers.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const before = db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!before) throw notFound("Customer");
    const b = customerSchema.extend({ status: z.enum(["active", "archived"]).optional() }).parse(req.body);
    if (
      (b.status ?? before.status) === "active" &&
      db.prepare("SELECT 1 FROM customers WHERE name = ? COLLATE NOCASE AND status = 'active' AND id <> ?").get(b.name, id)
    ) {
      throw conflict(`A customer named "${b.name}" already exists.`);
    }
    const cols = Object.keys(b) as (keyof typeof b)[];
    db.prepare(`UPDATE customers SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
      ...cols.map((c) => b[c] ?? null),
      nowIso(),
      id,
    );
    audit(db, { userId: req.user!.id, action: "customer.update", entityType: "customer", entityId: id, summary: `updated customer ${b.name}`, changes: diff(before, b), ip: req.ip });
    res.json({ ok: true });
  });

  return r;
}
