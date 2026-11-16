import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { assertEntityExists, canAttachTo, canViewEntity, type EntityType } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { canReadFile, filePath, storeUpload, uploader } from "../lib/files.js";
import { optText, parseId } from "../lib/validate.js";

const ENTITY_TYPES = ["job", "user", "customer", "item", "maintenance", "inspection"] as const;

export function fileRoutes(db: DB) {
  const r = Router();
  const upload = uploader();

  /** Download / view a stored file after an authorization check. */
  r.get("/files/:id", (req, res) => {
    const id = parseId(req.params.id);
    const f = db.prepare("SELECT * FROM files WHERE id = ?").get(id) as
      | { storage_key: string; original_name: string; mime_type: string; size_bytes: number }
      | undefined;
    if (!f || !canReadFile(db, req.user!, id)) throw notFound("File");
    const full = filePath(f.storage_key);
    if (!fs.existsSync(full)) throw notFound("File");
    const inline = req.query.download !== "1" && (f.mime_type.startsWith("image/") || f.mime_type === "application/pdf");
    res.setHeader("Content-Type", f.mime_type);
    res.setHeader("Content-Length", String(f.size_bytes));
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    // Only PDFs and raster images are shown inline; everything else is forced to download inside a sandbox.
    if (!inline) res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("Cache-Control", "private, max-age=300");
    fs.createReadStream(full).pipe(res);
  });

  /** Upload photos/attachments to a record. multipart: entity_type, entity_id, caption, files[] */
  r.post("/attachments", upload.array("files", 10), (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    try {
      const b = z.object({ entity_type: z.enum(ENTITY_TYPES), entity_id: z.coerce.number().int().positive(), caption: optText(300) }).parse(req.body);
      if (!files.length) throw badRequest("Choose at least one file.");
      assertEntityExists(db, b.entity_type, b.entity_id);
      if (!canAttachTo(db, req.user!, b.entity_type as EntityType, b.entity_id)) throw forbidden();
      const ids = db.transaction(() =>
        files.map((f) => {
          const fileId = storeUpload(db, f, req.user!.id);
          const info = db
            .prepare("INSERT INTO attachments (file_id, entity_type, entity_id, caption, created_by) VALUES (?,?,?,?,?)")
            .run(fileId, b.entity_type, b.entity_id, b.caption, req.user!.id);
          return Number(info.lastInsertRowid);
        }),
      )();
      audit(db, {
        userId: req.user!.id,
        action: "attachment.add",
        entityType: b.entity_type,
        entityId: b.entity_id,
        summary: `uploaded ${files.length} file(s): ${files.map((f) => f.originalname).join(", ")}`,
      });
      res.status(201).json({ ids });
    } finally {
      for (const f of files) if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    }
  });

  /** Detach (the stored file is retained for audit purposes). */
  r.delete("/attachments/:id", (req, res) => {
    const id = parseId(req.params.id);
    const a = db.prepare("SELECT a.*, f.original_name FROM attachments a JOIN files f ON f.id = a.file_id WHERE a.id = ?").get(id) as
      | { entity_type: EntityType; entity_id: number; created_by: number; original_name: string }
      | undefined;
    if (!a || !canViewEntity(db, req.user!, a.entity_type, a.entity_id)) throw notFound("Attachment");
    if (a.created_by !== req.user!.id && !canAttachTo(db, req.user!, a.entity_type, a.entity_id)) throw forbidden();
    db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    audit(db, { userId: req.user!.id, action: "attachment.remove", entityType: a.entity_type, entityId: a.entity_id, summary: `removed attachment ${a.original_name}` });
    res.json({ ok: true });
  });

  /** Set an inventory item's photo. */
  r.post("/inventory-photo/:itemId", requirePerm("inventory.manage"), upload.single("file"), (req, res) => {
    const itemId = parseId(req.params.itemId);
    const file = req.file;
    try {
      if (!file || !file.mimetype.startsWith("image/")) throw badRequest("Choose an image.");
      if (!db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(itemId)) throw notFound("Item");
      const fileId = storeUpload(db, file, req.user!.id);
      db.prepare("UPDATE inventory_items SET photo_file_id = ? WHERE id = ?").run(fileId, itemId);
      audit(db, { userId: req.user!.id, action: "inventory.photo", entityType: "item", entityId: itemId, summary: "updated the item photo" });
      res.status(201).json({ fileId });
    } finally {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  });

  return r;
}
