import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { canViewEntity } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { nowIso } from "../lib/time.js";
import { optId, optNumber, optText, parseId, reqText } from "../lib/validate.js";
import { createIssue } from "./maintenance.js";

/** Starter checklists an owner can install and then edit. Not company data — generic industry checklists. */
const STARTER_TEMPLATES: { name: string; description: string; applies_to: string | null; items: string[] }[] = [
  { name: "Daily equipment inspection", description: "Walk-around before the first start of the day.", applies_to: null,
    items: ["Engine oil level", "Coolant level", "Hydraulic oil level", "Fuel level", "Belts and hoses", "Tires / tracks", "Lights and flashers", "Fire extinguisher present and charged", "Leaks under machine", "Safety shields in place"] },
  { name: "Pre-operation inspection (chopper)", description: "Forage harvester checks before operating.", applies_to: "chopper",
    items: ["Knives sharp and secure", "Shear bar adjusted", "Kernel processor condition", "Spout and deflector operate", "Header / pickup condition", "Metal detector test", "Grease points serviced", "Air filter / screen clean"] },
  { name: "Post-operation inspection", description: "End-of-shift check and cleanup.", applies_to: null,
    items: ["Machine cleaned of crop residue", "Damage noted", "Fuel topped off", "Hour meter recorded", "Parked and secured"] },
  { name: "Truck inspection", description: "Driver vehicle inspection.", applies_to: "truck",
    items: ["Brakes", "Steering", "Tires and wheels", "Lights and reflectors", "Horn", "Mirrors and windshield", "Coupling devices", "Emergency equipment", "Paperwork / registration"] },
  { name: "Trailer inspection", description: "Trailer check before hauling.", applies_to: "trailer",
    items: ["Hitch / kingpin secure", "Safety chains", "Brake and light connections", "Tires", "Floor and sides", "Gate / doors latch"] },
  { name: "Job completion checklist", description: "Before leaving the job site.", applies_to: null,
    items: ["Field / site finished per instructions", "Customer walk-through or sign-off", "Gates closed", "No equipment or debris left", "Photos taken", "Hours and notes recorded"] },
  { name: "Safety checklist", description: "Crew safety review.", applies_to: null,
    items: ["PPE available and worn", "First-aid kit stocked", "Overhead lines identified", "Communication plan / radios", "Emergency contacts known"] },
];

export function inspectionRoutes(db: DB) {
  const r = Router();

  // ── Templates ──
  r.get("/templates", (req, res) => {
    const all = req.query.all === "1" && can(req.user!, "inspections.manage");
    const templates = db.prepare(`SELECT * FROM inspection_templates ${all ? "" : "WHERE active = 1"} ORDER BY name`).all() as { id: number }[];
    const items = db.prepare("SELECT * FROM inspection_template_items WHERE template_id = ? ORDER BY position");
    res.json({ templates: templates.map((t) => ({ ...t, items: items.all(t.id) })) });
  });

  const templateSchema = z.object({
    name: reqText(120),
    description: optText(1000),
    applies_to: optText(40),
    requires_signature: z.boolean().default(false),
    active: z.boolean().default(true),
    items: z.array(z.object({ label: reqText(200), help_text: optText(500), create_issue_on_fail: z.boolean().default(true) })).min(1, "Add at least one checklist item").max(100),
  });

  function writeTemplate(id: number | null, b: z.infer<typeof templateSchema>, userId: number): number {
    return db.transaction(() => {
      let tid = id;
      if (tid) {
        db.prepare("UPDATE inspection_templates SET name=?, description=?, applies_to=?, requires_signature=?, active=? WHERE id=?").run(
          b.name, b.description, b.applies_to, b.requires_signature ? 1 : 0, b.active ? 1 : 0, tid,
        );
        // Past inspections keep their own snapshot of labels, so items can be replaced safely.
        db.prepare("UPDATE inspection_responses SET template_item_id = NULL WHERE template_item_id IN (SELECT id FROM inspection_template_items WHERE template_id = ?)").run(tid);
        db.prepare("DELETE FROM inspection_template_items WHERE template_id = ?").run(tid);
      } else {
        tid = Number(
          db.prepare("INSERT INTO inspection_templates (name, description, applies_to, requires_signature, active, created_by) VALUES (?,?,?,?,?,?)")
            .run(b.name, b.description, b.applies_to, b.requires_signature ? 1 : 0, b.active ? 1 : 0, userId).lastInsertRowid,
        );
      }
      const ins = db.prepare("INSERT INTO inspection_template_items (template_id, position, label, help_text, create_issue_on_fail) VALUES (?,?,?,?,?)");
      b.items.forEach((it, i) => ins.run(tid, i + 1, it.label, it.help_text, it.create_issue_on_fail ? 1 : 0));
      audit(db, { userId, action: id ? "inspection.template_update" : "inspection.template_create", entityType: "inspection_template", entityId: tid, summary: `${id ? "updated" : "created"} checklist "${b.name}"` });
      return tid!;
    })();
  }

  r.post("/templates", requirePerm("inspections.manage"), (req, res) => {
    const b = templateSchema.parse(req.body);
    if (db.prepare("SELECT 1 FROM inspection_templates WHERE name = ?").get(b.name)) throw conflict("A checklist with that name already exists.");
    res.status(201).json({ id: writeTemplate(null, b, req.user!.id) });
  });

  r.put("/templates/:id", requirePerm("inspections.manage"), (req, res) => {
    const id = parseId(req.params.id);
    if (!db.prepare("SELECT 1 FROM inspection_templates WHERE id = ?").get(id)) throw notFound("Checklist");
    const b = templateSchema.parse(req.body);
    if (db.prepare("SELECT 1 FROM inspection_templates WHERE name = ? AND id <> ?").get(b.name, id)) throw conflict("A checklist with that name already exists.");
    writeTemplate(id, b, req.user!.id);
    res.json({ ok: true });
  });

  r.post("/templates/install-starters", requirePerm("inspections.manage"), (req, res) => {
    let added = 0;
    for (const t of STARTER_TEMPLATES) {
      if (db.prepare("SELECT 1 FROM inspection_templates WHERE name = ?").get(t.name)) continue;
      writeTemplate(null, { name: t.name, description: t.description, applies_to: t.applies_to, requires_signature: false, active: true, items: t.items.map((label) => ({ label, help_text: null, create_issue_on_fail: true })) }, req.user!.id);
      added++;
    }
    res.json({ added });
  });

  // ── Inspections ──
  r.get("/", (req, res) => {
    const manage = can(req.user!, "inspections.manage");
    const where: string[] = [];
    const params: unknown[] = [];
    if (!manage) {
      where.push("s.performed_by = ?");
      params.push(req.user!.id);
    }
    if (req.query.result) {
      where.push("s.overall_result = ?");
      params.push(String(req.query.result));
    }
    if (req.query.unreviewed === "1") where.push("s.status = 'submitted'");
    const rows = db
      .prepare(
        `SELECT s.id, s.template_name, s.overall_result, s.status, s.performed_at, s.item_id, s.job_id, i.name AS item_name, j.job_number,
                u.first_name || ' ' || u.last_name AS performed_by_name,
                (SELECT COUNT(*) FROM inspection_responses x WHERE x.inspection_id = s.id AND x.result = 'fail') AS fail_count,
                (SELECT COUNT(*) FROM inspection_responses x WHERE x.inspection_id = s.id AND x.result = 'attention') AS attention_count
         FROM inspections s JOIN users u ON u.id = s.performed_by LEFT JOIN inventory_items i ON i.id = s.item_id LEFT JOIN jobs j ON j.id = s.job_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.performed_at DESC LIMIT 300`,
      )
      .all(...params);
    res.json({ inspections: rows });
  });

  r.get("/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!canViewEntity(db, req.user!, "inspection", id)) throw notFound("Inspection");
    const inspection = db
      .prepare(
        `SELECT s.*, i.name AS item_name, j.job_number, j.name AS job_name, u.first_name || ' ' || u.last_name AS performed_by_name,
                rv.first_name || ' ' || rv.last_name AS reviewed_by_name
         FROM inspections s JOIN users u ON u.id = s.performed_by LEFT JOIN users rv ON rv.id = s.reviewed_by
         LEFT JOIN inventory_items i ON i.id = s.item_id LEFT JOIN jobs j ON j.id = s.job_id WHERE s.id = ?`,
      )
      .get(id);
    const responses = db.prepare("SELECT * FROM inspection_responses WHERE inspection_id = ? ORDER BY id").all(id);
    const issues = db.prepare("SELECT id, title, status, priority FROM maintenance_records WHERE inspection_id = ?").all(id);
    const attachments = db
      .prepare(
        `SELECT a.id, a.caption, f.id AS file_id, f.original_name, f.mime_type FROM attachments a JOIN files f ON f.id = a.file_id
         WHERE a.entity_type = 'inspection' AND a.entity_id = ?`,
      )
      .all(id);
    res.json({ inspection, responses, issues, attachments });
  });

  r.post("/", requirePerm("inspections.perform"), (req, res) => {
    const b = z
      .object({
        template_id: z.number().int().positive(),
        item_id: optId,
        job_id: optId,
        meter_hours: optNumber,
        notes: optText(4000),
        responses: z.array(z.object({ template_item_id: z.number().int().positive(), result: z.enum(["pass", "attention", "fail", "na"]), note: optText(1000) })).min(1),
      })
      .parse(req.body);
    const template = db.prepare("SELECT * FROM inspection_templates WHERE id = ? AND active = 1").get(b.template_id) as { id: number; name: string } | undefined;
    if (!template) throw badRequest("Checklist not found.");
    const items = db.prepare("SELECT * FROM inspection_template_items WHERE template_id = ?").all(b.template_id) as { id: number; label: string; create_issue_on_fail: number }[];
    const byId = new Map(items.map((i) => [i.id, i]));
    if (b.responses.length !== items.length || b.responses.some((r) => !byId.has(r.template_item_id))) throw badRequest("Answer every checklist item.");
    for (const resp of b.responses) {
      if ((resp.result === "fail" || resp.result === "attention") && !resp.note) {
        throw badRequest(`Add a note explaining "${byId.get(resp.template_item_id)!.label}".`);
      }
    }
    if (b.item_id && !db.prepare("SELECT 1 FROM inventory_items WHERE id = ? AND kind = 'equipment'").get(b.item_id)) throw badRequest("Equipment not found.");
    const overall = b.responses.some((r) => r.result === "fail") ? "fail" : b.responses.some((r) => r.result === "attention") ? "attention" : "pass";

    const result = db.transaction(() => {
      const info = db
        .prepare("INSERT INTO inspections (template_id, template_name, item_id, job_id, performed_by, performed_at, overall_result, meter_hours, notes) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(template.id, template.name, b.item_id, b.job_id, req.user!.id, nowIso(), overall, b.meter_hours, b.notes);
      const sid = Number(info.lastInsertRowid);
      const ins = db.prepare("INSERT INTO inspection_responses (inspection_id, template_item_id, label, result, note) VALUES (?,?,?,?,?)");
      for (const resp of b.responses) ins.run(sid, resp.template_item_id, byId.get(resp.template_item_id)!.label, resp.result, resp.note);
      // Keep the equipment hour meter current (only moves forward).
      if (b.item_id && b.meter_hours !== null) {
        db.prepare("UPDATE inventory_items SET meter_hours = ? WHERE id = ? AND (meter_hours IS NULL OR meter_hours < ?)").run(b.meter_hours, b.item_id, b.meter_hours);
      }
      // Failed items automatically open an equipment issue.
      const issueIds: number[] = [];
      const failed = b.responses.filter((r) => r.result === "fail" && byId.get(r.template_item_id)!.create_issue_on_fail);
      if (failed.length && b.item_id) {
        const mid = createIssue(db, {
          item_id: b.item_id,
          title: `Failed inspection: ${failed.map((f) => byId.get(f.template_item_id)!.label).join(", ")}`.slice(0, 150),
          description: failed.map((f) => `• ${byId.get(f.template_item_id)!.label}: ${f.note}`).join("\n"),
          priority: "high",
          equipment_down: false,
          reported_by: req.user!.id,
          inspection_id: sid,
        });
        issueIds.push(mid);
        audit(db, { userId: req.user!.id, action: "maintenance.create", entityType: "maintenance", entityId: mid, summary: `opened an issue from a failed ${template.name}` });
      }
      audit(db, { userId: req.user!.id, action: "inspection.submit", entityType: "inspection", entityId: sid, summary: `completed ${template.name} — ${overall.toUpperCase()}` });
      return { id: sid, overall, issueIds };
    })();
    res.status(201).json(result);
  });

  r.post("/:id/review", requirePerm("inspections.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const b = z.object({ notes: optText(2000) }).parse(req.body ?? {});
    const s = db.prepare("SELECT status, template_name FROM inspections WHERE id = ?").get(id) as { status: string; template_name: string } | undefined;
    if (!s) throw notFound("Inspection");
    if (s.status === "reviewed") throw conflict("Already reviewed.");
    db.prepare("UPDATE inspections SET status = 'reviewed', reviewed_by = ?, reviewed_at = ?, review_notes = ? WHERE id = ?").run(req.user!.id, nowIso(), b.notes, id);
    audit(db, { userId: req.user!.id, action: "inspection.review", entityType: "inspection", entityId: id, summary: `reviewed ${s.template_name}` });
    res.json({ ok: true });
  });

  return r;
}
