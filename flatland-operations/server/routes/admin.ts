import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { audit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { badRequest, notFound } from "../lib/errors.js";
import { isValidTimeZone } from "../lib/time.js";
import { pageParams, reqText } from "../lib/validate.js";

/** Tables included in data exports. Secrets (password hashes, sessions, tokens) are never exported. */
const EXPORT_TABLES: Record<string, string> = {
  users: "SELECT id, email, role, first_name, last_name, phone, status, can_record_time, last_login_at, created_at, updated_at FROM users",
  employee_profiles: "SELECT * FROM employee_profiles",
  pay_rates: "SELECT * FROM pay_rates",
  certifications: "SELECT * FROM certifications",
  availability: "SELECT * FROM availability",
  time_off_requests: "SELECT * FROM time_off_requests",
  customers: "SELECT * FROM customers",
  jobs: "SELECT * FROM jobs",
  job_assignments: "SELECT * FROM job_assignments",
  job_equipment: "SELECT * FROM job_equipment",
  job_notes: "SELECT * FROM job_notes",
  time_entries: "SELECT * FROM time_entries",
  time_breaks: "SELECT * FROM time_breaks",
  time_entry_revisions: "SELECT * FROM time_entry_revisions",
  timesheets: "SELECT * FROM timesheets",
  inventory_items: "SELECT * FROM inventory_items",
  inventory_movements: "SELECT * FROM inventory_movements",
  maintenance_records: "SELECT * FROM maintenance_records",
  maintenance_schedules: "SELECT * FROM maintenance_schedules",
  documents: "SELECT * FROM documents",
  document_versions: "SELECT * FROM document_versions",
  files: "SELECT id, original_name, mime_type, size_bytes, sha256, uploaded_by, created_at, storage_key FROM files",
  inspections: "SELECT * FROM inspections",
  inspection_responses: "SELECT * FROM inspection_responses",
  audit_log: "SELECT * FROM audit_log",
};

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}

export async function backupDatabase(db: DB): Promise<string> {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const name = `flatland-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  await db.backup(path.join(config.backupsDir, name));
  return name;
}

export function adminRoutes(db: DB) {
  const r = Router();

  r.get("/settings", requirePerm("settings.manage"), (_req, res) => {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'job_seq_%'").all() as { key: string; value: string }[];
    res.json({
      settings: Object.fromEntries(rows.map((r) => [r.key, r.value])),
      integrations: {
        esign: { configured: config.esign.configured, provider: config.esign.provider },
        quickbooks: { configured: config.quickbooks.configured, connected: false },
      },
      storage: { dataDir: config.dataDir },
    });
  });

  r.put("/settings", requirePerm("settings.manage"), (req, res) => {
    const b = z
      .object({
        company_name: reqText(120),
        timezone: z.string(),
        overtime_weekly_hours: z.coerce.number().min(1).max(168),
      })
      .parse(req.body);
    if (!isValidTimeZone(b.timezone)) throw badRequest("Unknown time zone.", { fields: { timezone: "Unknown time zone" } });
    const before = Object.fromEntries((db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    db.transaction(() => {
      const set = db.prepare("INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at");
      const changes: Record<string, [unknown, unknown]> = {};
      for (const [k, v] of Object.entries(b)) {
        if (String(before[k] ?? "") !== String(v)) changes[k] = [before[k] ?? null, String(v)];
        set.run(k, String(v), req.user!.id);
      }
      if (Object.keys(changes).length) audit(db, { userId: req.user!.id, action: "settings.update", summary: `updated company settings (${Object.keys(changes).join(", ")})`, changes, ip: req.ip });
    })();
    res.json({ ok: true });
  });

  r.get("/audit", requirePerm("audit.view"), (req, res) => {
    const { limit, offset } = pageParams(req.query, 100);
    const where: string[] = [];
    const params: unknown[] = [];
    if (req.query.user_id) {
      where.push("a.user_id = ?");
      params.push(Number(req.query.user_id));
    }
    if (req.query.action) {
      where.push("a.action LIKE ?");
      params.push(`${String(req.query.action).replace(/[%_]/g, "")}%`);
    }
    if (req.query.entity_type) {
      where.push("a.entity_type = ?");
      params.push(String(req.query.entity_type));
    }
    if (req.query.entity_id) {
      where.push("a.entity_id = ?");
      params.push(Number(req.query.entity_id));
    }
    const sqlWhere = where.length ? "WHERE " + where.join(" AND ") : "";
    const rows = db
      .prepare(
        `SELECT a.*, u.first_name || ' ' || u.last_name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         ${sqlWhere} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    const total = (db.prepare(`SELECT COUNT(*) n FROM audit_log a ${sqlWhere}`).get(...params) as { n: number }).n;
    res.json({ rows, total, limit, offset });
  });

  r.get("/export/:table.csv", requirePerm("data.export"), (req, res) => {
    const sql = EXPORT_TABLES[String(req.params.table)];
    if (!sql) throw notFound("Export");
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    audit(db, { userId: req.user!.id, action: "data.export", summary: `exported ${req.params.table} (${rows.length} rows)`, ip: req.ip });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.table}.csv"`);
    res.send(toCsv(rows));
  });

  r.get("/export.json", requirePerm("data.export"), (req, res) => {
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), format: "flatland-operations-export/1" };
    for (const [t, sql] of Object.entries(EXPORT_TABLES)) out[t] = db.prepare(sql).all();
    audit(db, { userId: req.user!.id, action: "data.export", summary: "exported a full JSON data export", ip: req.ip });
    res.setHeader("Content-Disposition", `attachment; filename="flatland-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(out);
  });

  r.get("/export-tables", requirePerm("data.export"), (_req, res) => {
    res.json({ tables: Object.keys(EXPORT_TABLES) });
  });

  r.post("/backup", requirePerm("data.export"), async (req, res) => {
    const name = await backupDatabase(db);
    audit(db, { userId: req.user!.id, action: "data.backup", summary: `created database backup ${name}`, ip: req.ip });
    res.json({ file: name, directory: config.backupsDir });
  });

  return r;
}
