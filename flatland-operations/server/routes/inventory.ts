import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { audit, diff } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { nowIso } from "../lib/time.js";
import { likeContains, optDate, optId, optMoney, optNumber, optText, parseId, reqText } from "../lib/validate.js";

export const EQUIPMENT_CATEGORIES = ["chopper", "tractor", "truck", "trailer", "implement", "tool", "other"] as const;
export const CONSUMABLE_CATEGORIES = ["fuel", "fluids", "parts", "filters", "supplies", "components", "other"] as const;
const CONDITIONS = ["new", "good", "fair", "poor", "out_of_service"] as const;
const MOVE_TYPES = ["purchase", "usage", "transfer", "return", "adjustment", "damaged", "missing"] as const;

const itemSchema = z.object({
  kind: z.enum(["equipment", "consumable"]),
  category: reqText(40),
  name: reqText(150),
  description: optText(2000),
  asset_number: optText(60),
  serial_number: optText(100),
  barcode: optText(120),
  make: optText(80),
  model: optText(80),
  year: optNumber,
  unit: z.string().trim().min(1).max(30).default("each"),
  low_stock_threshold: optNumber,
  storage_location: optText(150),
  assigned_user_id: optId,
  assigned_job_id: optId,
  purchase_price: optMoney,
  unit_cost: optMoney,
  hourly_cost: optMoney,
  supplier: optText(150),
  purchase_date: optDate,
  meter_hours: optNumber,
  condition: z.enum(CONDITIONS).default("good"),
  notes: optText(4000),
  initial_quantity: optNumber,
});

export function inventoryRoutes(db: DB) {
  const r = Router();
  const fin = (req: Express.Request) => can(req.user!, "financials.view");

  r.get("/", requirePerm("inventory.view"), (req, res) => {
    const where: string[] = ["i.status = ?"];
    const params: unknown[] = [req.query.status === "retired" ? "retired" : "active"];
    if (req.query.kind === "equipment" || req.query.kind === "consumable") {
      where.push("i.kind = ?");
      params.push(req.query.kind);
    }
    if (req.query.category) {
      where.push("i.category = ?");
      params.push(String(req.query.category));
    }
    if (req.query.low === "1") where.push("i.low_stock_threshold IS NOT NULL AND i.quantity <= i.low_stock_threshold");
    const q = String(req.query.q ?? "").trim();
    if (q) {
      where.push(
        "(i.name LIKE ? ESCAPE '\\' OR i.asset_number LIKE ? ESCAPE '\\' OR i.serial_number LIKE ? ESCAPE '\\' OR i.barcode = ? OR i.storage_location LIKE ? ESCAPE '\\' OR i.make LIKE ? ESCAPE '\\' OR i.model LIKE ? ESCAPE '\\')",
      );
      const l = likeContains(q);
      params.push(l, l, l, q, l, l, l);
    }
    const rows = db
      .prepare(
        `SELECT i.id, i.kind, i.category, i.name, i.asset_number, i.serial_number, i.barcode, i.quantity, i.unit, i.low_stock_threshold,
                i.storage_location, i.condition, i.make, i.model, i.meter_hours, i.photo_file_id,
                u.first_name || ' ' || u.last_name AS assigned_to, j.job_number AS assigned_job,
                (i.low_stock_threshold IS NOT NULL AND i.quantity <= i.low_stock_threshold) AS low_stock,
                EXISTS (SELECT 1 FROM maintenance_records m WHERE m.item_id = i.id AND m.status NOT IN ('completed','cancelled')) AS open_issues,
                EXISTS (SELECT 1 FROM maintenance_records m WHERE m.item_id = i.id AND m.status NOT IN ('completed','cancelled') AND m.equipment_down = 1) AS down,
                EXISTS (SELECT 1 FROM job_equipment e JOIN jobs jj ON jj.id = e.job_id WHERE e.item_id = i.id AND jj.status = 'in_progress') AS in_use
         FROM inventory_items i
         LEFT JOIN users u ON u.id = i.assigned_user_id LEFT JOIN jobs j ON j.id = i.assigned_job_id
         WHERE ${where.join(" AND ")} ORDER BY i.kind, i.category, i.name LIMIT 1000`,
      )
      .all(...params);
    res.json({ items: rows, categories: { equipment: EQUIPMENT_CATEGORIES, consumable: CONSUMABLE_CATEGORIES } });
  });

  /** Exact lookup by scanned QR/barcode or asset number. */
  r.get("/lookup", requirePerm("inventory.view"), (req, res) => {
    const code = String(req.query.code ?? "").trim();
    if (!code) throw badRequest("No code provided.");
    const item = db.prepare("SELECT id FROM inventory_items WHERE barcode = ? OR asset_number = ? LIMIT 1").get(code, code) as { id: number } | undefined;
    if (!item) throw notFound("Item with that code");
    res.json({ id: item.id });
  });

  r.get("/:id", requirePerm("inventory.view"), (req, res) => {
    const id = parseId(req.params.id);
    const item = db
      .prepare(
        `SELECT i.*, u.first_name || ' ' || u.last_name AS assigned_to, j.job_number AS assigned_job, j.name AS assigned_job_name
         FROM inventory_items i LEFT JOIN users u ON u.id = i.assigned_user_id LEFT JOIN jobs j ON j.id = i.assigned_job_id WHERE i.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!item) throw notFound("Item");
    if (!fin(req)) {
      delete item.purchase_price_cents;
      delete item.unit_cost_cents;
      delete item.hourly_cost_cents;
    }
    const movements = db
      .prepare(
        `SELECT m.*, u.first_name || ' ' || u.last_name AS user_name, j.job_number FROM inventory_movements m
         JOIN users u ON u.id = m.user_id LEFT JOIN jobs j ON j.id = m.job_id WHERE m.item_id = ? ORDER BY m.id DESC LIMIT 200`,
      )
      .all(id) as Record<string, unknown>[];
    if (!fin(req)) movements.forEach((m) => delete m.unit_cost_cents);
    const maintenance = db
      .prepare(
        `SELECT m.id, m.kind, m.title, m.priority, m.status, m.reported_at, m.completed_at, m.equipment_down
         FROM maintenance_records m WHERE m.item_id = ? ORDER BY m.reported_at DESC LIMIT 50`,
      )
      .all(id);
    const schedules = db.prepare("SELECT * FROM maintenance_schedules WHERE item_id = ? AND active = 1").all(id);
    const jobs = db
      .prepare(
        `SELECT j.id, j.job_number, j.name, j.status, j.scheduled_start FROM job_equipment e JOIN jobs j ON j.id = e.job_id
         WHERE e.item_id = ? ORDER BY j.scheduled_start DESC LIMIT 25`,
      )
      .all(id);
    const attachments = db
      .prepare(
        `SELECT a.id, a.caption, a.created_at, f.id AS file_id, f.original_name, f.mime_type, f.size_bytes
         FROM attachments a JOIN files f ON f.id = a.file_id WHERE a.entity_type = 'item' AND a.entity_id = ? ORDER BY a.created_at DESC`,
      )
      .all(id);
    const inspections = db
      .prepare(
        `SELECT s.id, s.template_name, s.overall_result, s.performed_at, u.first_name || ' ' || u.last_name AS performed_by_name
         FROM inspections s JOIN users u ON u.id = s.performed_by WHERE s.item_id = ? ORDER BY s.performed_at DESC LIMIT 25`,
      )
      .all(id);
    res.json({ item, movements, maintenance, schedules, jobs, attachments, inspections });
  });

  function checkRefs(b: { assigned_user_id: number | null; assigned_job_id: number | null }) {
    if (b.assigned_user_id && !db.prepare("SELECT 1 FROM users WHERE id = ?").get(b.assigned_user_id)) throw badRequest("Assigned person not found.");
    if (b.assigned_job_id && !db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(b.assigned_job_id)) throw badRequest("Assigned job not found.");
  }

  r.post("/", requirePerm("inventory.manage"), (req, res) => {
    const b = itemSchema.parse(req.body);
    checkRefs(b);
    const qty = b.kind === "equipment" ? (b.initial_quantity ?? 1) : (b.initial_quantity ?? 0);
    if (qty < 0) throw badRequest("Quantity cannot be negative.");
    const id = db.transaction(() => {
      // Every item gets a scannable code; a supplied barcode wins.
      const barcode = b.barcode ?? `FO-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
      const info = db
        .prepare(
          `INSERT INTO inventory_items (kind, category, name, description, asset_number, serial_number, barcode, make, model, year, quantity, unit,
             low_stock_threshold, storage_location, assigned_user_id, assigned_job_id, purchase_price_cents, unit_cost_cents, hourly_cost_cents,
             supplier, purchase_date, meter_hours, condition, notes, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          b.kind, b.category, b.name, b.description, b.asset_number, b.serial_number, barcode, b.make, b.model, b.year, qty, b.unit,
          b.low_stock_threshold, b.storage_location, b.assigned_user_id, b.assigned_job_id,
          fin(req) ? b.purchase_price : null, fin(req) ? b.unit_cost : null, fin(req) ? b.hourly_cost : null,
          b.supplier, b.purchase_date, b.meter_hours, b.condition, b.notes, req.user!.id,
        );
      const itemId = Number(info.lastInsertRowid);
      if (qty !== 0) {
        db.prepare(
          "INSERT INTO inventory_movements (item_id, type, quantity_change, quantity_after, unit_cost_cents, reason, user_id) VALUES (?, 'initial', ?, ?, ?, 'Initial quantity', ?)",
        ).run(itemId, qty, qty, fin(req) ? b.unit_cost : null, req.user!.id);
      }
      audit(db, { userId: req.user!.id, action: "inventory.create", entityType: "item", entityId: itemId, summary: `added ${b.kind} "${b.name}"`, ip: req.ip });
      return itemId;
    })();
    res.status(201).json({ id });
  });

  r.put("/:id", requirePerm("inventory.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const before = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!before) throw notFound("Item");
    const b = itemSchema.omit({ initial_quantity: true, kind: true }).extend({ status: z.enum(["active", "retired"]).optional() }).parse(req.body);
    checkRefs(b);
    const updates: Record<string, unknown> = {
      category: b.category, name: b.name, description: b.description, asset_number: b.asset_number, serial_number: b.serial_number,
      barcode: b.barcode ?? before.barcode, make: b.make, model: b.model, year: b.year, unit: b.unit, low_stock_threshold: b.low_stock_threshold,
      storage_location: b.storage_location, assigned_user_id: b.assigned_user_id, assigned_job_id: b.assigned_job_id, supplier: b.supplier,
      purchase_date: b.purchase_date, meter_hours: b.meter_hours, condition: b.condition, notes: b.notes, status: b.status ?? before.status,
    };
    if (fin(req)) Object.assign(updates, { purchase_price_cents: b.purchase_price, unit_cost_cents: b.unit_cost, hourly_cost_cents: b.hourly_cost });
    const cols = Object.keys(updates);
    db.prepare(`UPDATE inventory_items SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => updates[c]), nowIso(), id);
    audit(db, { userId: req.user!.id, action: "inventory.update", entityType: "item", entityId: id, summary: `updated "${b.name}"`, changes: diff(before, updates), ip: req.ip });
    res.json({ ok: true });
  });

  /**
   * Record a quantity movement. Purchases/returns add stock; usage/damaged/missing remove it;
   * adjustments set a counted quantity; transfers move location without changing quantity.
   */
  r.post("/:id/movements", (req, res) => {
    const id = parseId(req.params.id);
    const b = z
      .object({
        type: z.enum(MOVE_TYPES),
        quantity: optNumber,
        counted_quantity: optNumber,
        unit_cost: optMoney,
        job_id: optId,
        to_location: optText(150),
        reason: optText(500),
      })
      .parse(req.body);
    const manage = can(req.user!, "inventory.manage");
    // Field staff may record usage (e.g. fuel or parts used on a job); everything else is a manager action.
    if (!manage && !(b.type === "usage" && can(req.user!, "inventory.use"))) throw badRequest("You can only record usage.");
    if (b.job_id && !db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(b.job_id)) throw badRequest("Job not found.");
    const result = db.transaction(() => {
      const item = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id) as
        | { id: number; name: string; quantity: number; unit: string; storage_location: string | null; unit_cost_cents: number | null; status: string }
        | undefined;
      if (!item) throw notFound("Item");
      if (item.status !== "active") throw conflict("This item is retired.");
      let change = 0;
      let fromLoc: string | null = null;
      let toLoc: string | null = null;
      switch (b.type) {
        case "purchase":
        case "return":
          if (!b.quantity || b.quantity <= 0) throw badRequest("Enter a quantity greater than zero.");
          change = b.quantity;
          break;
        case "usage":
        case "damaged":
        case "missing":
          if (!b.quantity || b.quantity <= 0) throw badRequest("Enter a quantity greater than zero.");
          change = -b.quantity;
          break;
        case "adjustment":
          if (b.counted_quantity === null || b.counted_quantity < 0) throw badRequest("Enter the counted quantity.");
          if (!b.reason) throw badRequest("A reason is required for adjustments.");
          change = b.counted_quantity - item.quantity;
          break;
        case "transfer":
          if (!b.to_location) throw badRequest("Enter the new storage location.");
          fromLoc = item.storage_location;
          toLoc = b.to_location;
          break;
      }
      const after = Math.round((item.quantity + change) * 1000) / 1000;
      if (after < 0) throw conflict(`Only ${item.quantity} ${item.unit} on hand.`);
      // Weighted-average unit cost on purchases.
      let unitCost = item.unit_cost_cents;
      if (b.type === "purchase" && b.unit_cost !== null && fin(req)) {
        unitCost = item.quantity > 0 && item.unit_cost_cents !== null
          ? Math.round((item.quantity * item.unit_cost_cents + change * b.unit_cost) / after)
          : b.unit_cost;
      }
      db.prepare("UPDATE inventory_items SET quantity = ?, storage_location = COALESCE(?, storage_location), unit_cost_cents = ?, updated_at = ? WHERE id = ?").run(
        after, toLoc, unitCost, nowIso(), id,
      );
      const info = db
        .prepare(
          `INSERT INTO inventory_movements (item_id, type, quantity_change, quantity_after, unit_cost_cents, job_id, from_location, to_location, reason, user_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(id, b.type, change, after, b.type === "purchase" && fin(req) ? b.unit_cost : item.unit_cost_cents, b.job_id, fromLoc, toLoc, b.reason, req.user!.id);
      audit(db, {
        userId: req.user!.id,
        action: `inventory.${b.type}`,
        entityType: "item",
        entityId: id,
        summary:
          b.type === "transfer"
            ? `moved "${item.name}" to ${toLoc}`
            : `recorded ${b.type} of ${Math.abs(change)} ${item.unit} — "${item.name}" now ${after}`,
        ip: req.ip,
      });
      return { movementId: Number(info.lastInsertRowid), quantity: after };
    })();
    res.status(201).json(result);
  });

  return r;
}
