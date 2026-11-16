import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { canViewDocument } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { requirePerm } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { storeUpload, uploader } from "../lib/files.js";
import { can } from "../lib/permissions.js";
import { nowIso } from "../lib/time.js";
import { likeContains, optText, parseId, reqText } from "../lib/validate.js";

const idList = z
  .union([z.string(), z.array(z.string()), z.array(z.number())])
  .optional()
  .transform((v) => {
    if (v === undefined) return [] as number[];
    const arr = Array.isArray(v) ? v : String(v).split(",");
    return arr.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  });

export function documentRoutes(db: DB) {
  const r = Router();
  const upload = uploader();

  r.get("/", (req, res) => {
    const user = req.user!;
    const where: string[] = ["d.status = 'active'"];
    const params: unknown[] = [];
    if (req.query.folder_id) {
      where.push("d.folder_id = ?");
      params.push(parseId(req.query.folder_id));
    }
    if (req.query.templates === "1") where.push("d.is_template = 1");
    const q = String(req.query.q ?? "").trim();
    if (q) {
      where.push("(d.title LIKE ? ESCAPE '\\' OR d.category LIKE ? ESCAPE '\\' OR d.description LIKE ? ESCAPE '\\')");
      params.push(likeContains(q), likeContains(q), likeContains(q));
    }
    const rows = (
      db
        .prepare(
          `SELECT d.*, f.name AS folder_name, v.version_no, v.file_id, fl.original_name, fl.mime_type, fl.size_bytes,
                  (SELECT COUNT(*) FROM signature_requests s WHERE s.document_id = d.id AND s.status IN ('sent','partially_signed')) AS pending_signatures
           FROM documents d LEFT JOIN document_folders f ON f.id = d.folder_id
           LEFT JOIN document_versions v ON v.document_id = d.id AND v.version_no = (SELECT MAX(version_no) FROM document_versions WHERE document_id = d.id)
           LEFT JOIN files fl ON fl.id = v.file_id
           WHERE ${where.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 500`,
        )
        .all(...params) as { id: number }[]
    ).filter((d) => canViewDocument(db, user, d.id));
    const folders = db.prepare("SELECT * FROM document_folders ORDER BY name").all();
    res.json({ documents: rows, folders, esignConfigured: config.esign.configured });
  });

  r.get("/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!canViewDocument(db, req.user!, id)) throw notFound("Document");
    const doc = db.prepare("SELECT d.*, f.name AS folder_name FROM documents d LEFT JOIN document_folders f ON f.id = d.folder_id WHERE d.id = ?").get(id);
    const versions = db
      .prepare(
        `SELECT v.*, fl.original_name, fl.mime_type, fl.size_bytes, u.first_name || ' ' || u.last_name AS uploaded_by_name
         FROM document_versions v JOIN files fl ON fl.id = v.file_id LEFT JOIN users u ON u.id = v.uploaded_by
         WHERE v.document_id = ? ORDER BY v.version_no DESC`,
      )
      .all(id);
    const links = db
      .prepare(
        `SELECT l.entity_type, l.entity_id,
           CASE l.entity_type
             WHEN 'job' THEN (SELECT job_number || ' ' || name FROM jobs WHERE id = l.entity_id)
             WHEN 'user' THEN (SELECT first_name || ' ' || last_name FROM users WHERE id = l.entity_id)
             WHEN 'customer' THEN (SELECT name FROM customers WHERE id = l.entity_id)
             WHEN 'item' THEN (SELECT name FROM inventory_items WHERE id = l.entity_id)
           END AS label
         FROM document_links l WHERE l.document_id = ?`,
      )
      .all(id);
    const access = can(req.user!, "documents.manage")
      ? db.prepare("SELECT a.user_id, u.first_name || ' ' || u.last_name AS name FROM document_access a JOIN users u ON u.id = a.user_id WHERE a.document_id = ?").all(id)
      : [];
    const signatures = db
      .prepare("SELECT * FROM signature_requests WHERE document_id = ? ORDER BY created_at DESC")
      .all(id)
      .map((s) => ({ ...(s as object), signers: db.prepare("SELECT * FROM signature_signers WHERE request_id = ? ORDER BY sign_order").all((s as { id: number }).id) }));
    res.json({ document: doc, versions, links, access, signatures, esignConfigured: config.esign.configured });
  });

  const metaSchema = z.object({
    title: reqText(200),
    folder_id: z.coerce.number().int().positive().nullish().or(z.literal("")).transform((v) => (v ? Number(v) : null)),
    category: optText(60),
    description: optText(2000),
    is_template: z.union([z.boolean(), z.enum(["true", "false", "1", "0"])]).optional().transform((v) => v === true || v === "true" || v === "1"),
    visibility: z.enum(["managers", "assigned", "company"]).default("managers"),
    job_ids: idList,
    user_ids: idList, // linked people (e.g. employee file)
    customer_ids: idList,
    item_ids: idList,
    access_user_ids: idList, // explicitly shared with
  });

  function writeLinks(docId: number, b: z.infer<typeof metaSchema>) {
    db.prepare("DELETE FROM document_links WHERE document_id = ?").run(docId);
    db.prepare("DELETE FROM document_access WHERE document_id = ?").run(docId);
    const link = db.prepare("INSERT OR IGNORE INTO document_links (document_id, entity_type, entity_id) VALUES (?,?,?)");
    b.job_ids.forEach((id) => link.run(docId, "job", id));
    b.user_ids.forEach((id) => link.run(docId, "user", id));
    b.customer_ids.forEach((id) => link.run(docId, "customer", id));
    b.item_ids.forEach((id) => link.run(docId, "item", id));
    const acc = db.prepare("INSERT OR IGNORE INTO document_access (document_id, user_id) VALUES (?,?)");
    b.access_user_ids.forEach((id) => acc.run(docId, id));
  }

  /** multipart: file + metadata fields */
  r.post("/", requirePerm("documents.manage"), upload.single("file"), (req, res) => {
    const file = req.file;
    try {
      if (!file) throw badRequest("Choose a file to upload.");
      const b = metaSchema.parse(req.body);
      const id = db.transaction(() => {
        const fileId = storeUpload(db, file, req.user!.id);
        const info = db
          .prepare("INSERT INTO documents (title, folder_id, category, description, is_template, visibility, created_by) VALUES (?,?,?,?,?,?,?)")
          .run(b.title, b.folder_id, b.category, b.description, b.is_template ? 1 : 0, b.visibility, req.user!.id);
        const docId = Number(info.lastInsertRowid);
        db.prepare("INSERT INTO document_versions (document_id, version_no, file_id, note, uploaded_by) VALUES (?, 1, ?, 'Initial upload', ?)").run(docId, fileId, req.user!.id);
        writeLinks(docId, b);
        audit(db, { userId: req.user!.id, action: "document.create", entityType: "document", entityId: docId, summary: `uploaded document "${b.title}"` });
        return docId;
      })();
      res.status(201).json({ id });
    } finally {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  });

  r.put("/:id", requirePerm("documents.manage"), (req, res) => {
    const id = parseId(req.params.id);
    if (!db.prepare("SELECT 1 FROM documents WHERE id = ?").get(id)) throw notFound("Document");
    const b = metaSchema.extend({ status: z.enum(["active", "archived"]).default("active") }).parse(req.body);
    db.transaction(() => {
      db.prepare("UPDATE documents SET title=?, folder_id=?, category=?, description=?, is_template=?, visibility=?, status=?, updated_at=? WHERE id=?").run(
        b.title, b.folder_id, b.category, b.description, b.is_template ? 1 : 0, b.visibility, b.status, nowIso(), id,
      );
      writeLinks(id, b);
      audit(db, { userId: req.user!.id, action: "document.update", entityType: "document", entityId: id, summary: `updated document "${b.title}"${b.status === "archived" ? " (archived)" : ""}` });
    })();
    res.json({ ok: true });
  });

  r.post("/:id/versions", requirePerm("documents.manage"), upload.single("file"), (req, res) => {
    const id = parseId(req.params.id);
    const file = req.file;
    try {
      if (!file) throw badRequest("Choose a file to upload.");
      const doc = db.prepare("SELECT title FROM documents WHERE id = ?").get(id) as { title: string } | undefined;
      if (!doc) throw notFound("Document");
      const note = optText(500).parse(req.body.note);
      const v = db.transaction(() => {
        const fileId = storeUpload(db, file, req.user!.id);
        const next = (db.prepare("SELECT COALESCE(MAX(version_no),0)+1 AS n FROM document_versions WHERE document_id = ?").get(id) as { n: number }).n;
        db.prepare("INSERT INTO document_versions (document_id, version_no, file_id, note, uploaded_by) VALUES (?,?,?,?,?)").run(id, next, fileId, note, req.user!.id);
        db.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(nowIso(), id);
        audit(db, { userId: req.user!.id, action: "document.version", entityType: "document", entityId: id, summary: `uploaded version ${next} of "${doc.title}"` });
        return next;
      })();
      res.status(201).json({ version: v });
    } finally {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  });

  r.post("/folders", requirePerm("documents.manage"), (req, res) => {
    const b = z.object({ name: reqText(100), parent_id: z.number().int().positive().nullish() }).parse(req.body);
    const info = db.prepare("INSERT INTO document_folders (name, parent_id) VALUES (?, ?)").run(b.name, b.parent_id ?? null);
    audit(db, { userId: req.user!.id, action: "document.folder", summary: `created folder "${b.name}"` });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  /**
   * Signature requests are intentionally NOT simulated. Sending requires a configured
   * e-signature provider (Dropbox Sign, DocuSign, …) whose audit certificate is the legal record.
   */
  r.post("/:id/signature-requests", requirePerm("documents.manage"), (_req, _res) => {
    if (!config.esign.configured) {
      throw new HttpError(501, "Electronic signatures are not configured yet. An owner must connect an e-signature provider (see docs/INTEGRATIONS.md).", {
        code: "ESIGN_NOT_CONFIGURED",
      });
    }
    throw new HttpError(501, "The e-signature provider adapter has not been implemented yet (Phase 3).", { code: "ESIGN_ADAPTER_MISSING" });
  });

  return r;
}
