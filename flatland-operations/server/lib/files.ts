import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import type { DB } from "../db/db.js";
import { canViewDocument, canViewEntity, type EntityType } from "./access.js";
import { config } from "./config.js";
import { badRequest } from "./errors.js";
import { can, type AuthUser } from "./permissions.js";

/** Allowed upload types. Extension and declared MIME type must agree. */
const ALLOWED: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/msword": [".doc"],
  "application/vnd.ms-excel": [".xls"],
};

export function uploader() {
  const tmp = path.join(config.uploadsDir, "tmp");
  fs.mkdirSync(tmp, { recursive: true });
  return multer({
    dest: tmp,
    limits: { fileSize: config.maxUploadBytes, files: 10 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const ok = ALLOWED[file.mimetype]?.includes(ext);
      if (!ok) return cb(badRequest(`File type not allowed: ${file.originalname}. Upload PDF, images, or Office documents.`));
      cb(null, true);
    },
  });
}

/** Magic-byte check for the types we preview inline, so a renamed file can't masquerade as a PDF/image. */
function sniffOk(filePath: string, mime: string): boolean {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const hex = buf.toString("hex");
  switch (mime) {
    case "application/pdf":
      return buf.subarray(0, 5).toString() === "%PDF-";
    case "image/jpeg":
      return hex.startsWith("ffd8ff");
    case "image/png":
      return hex.startsWith("89504e470d0a1a0a");
    case "image/gif":
      return buf.subarray(0, 4).toString() === "GIF8";
    case "image/webp":
      return buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
    default:
      return true;
  }
}

/** Moves an uploaded temp file into permanent storage and records it. Returns the file id. */
export function storeUpload(db: DB, file: Express.Multer.File, userId: number): number {
  try {
    if (!sniffOk(file.path, file.mimetype)) throw badRequest(`${file.originalname} does not look like a valid ${file.mimetype} file.`);
    const data = fs.readFileSync(file.path);
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    const now = new Date();
    const rel = path.join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      crypto.randomBytes(16).toString("hex") + path.extname(file.originalname).toLowerCase(),
    );
    const dest = path.join(config.uploadsDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file.path, dest);
    const info = db
      .prepare("INSERT INTO files (storage_key, original_name, mime_type, size_bytes, sha256, uploaded_by) VALUES (?,?,?,?,?,?)")
      .run(rel, file.originalname.slice(0, 250), file.mimetype, file.size, sha, userId);
    return Number(info.lastInsertRowid);
  } finally {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
}

export function filePath(storageKey: string): string {
  const full = path.resolve(config.uploadsDir, storageKey);
  if (!full.startsWith(path.resolve(config.uploadsDir) + path.sep)) throw badRequest("Invalid file path.");
  return full;
}

/** A user may read a file if they can see any record it belongs to. */
export function canReadFile(db: DB, user: AuthUser, fileId: number): boolean {
  const f = db.prepare("SELECT uploaded_by FROM files WHERE id = ?").get(fileId) as { uploaded_by: number } | undefined;
  if (!f) return false;
  if (f.uploaded_by === user.id) return true;
  const links = db.prepare("SELECT entity_type, entity_id FROM attachments WHERE file_id = ?").all(fileId) as { entity_type: EntityType; entity_id: number }[];
  if (links.some((l) => canViewEntity(db, user, l.entity_type, l.entity_id))) return true;
  const docs = db.prepare("SELECT document_id FROM document_versions WHERE file_id = ?").all(fileId) as { document_id: number }[];
  if (docs.some((d) => canViewDocument(db, user, d.document_id))) return true;
  if (db.prepare("SELECT 1 FROM inventory_items WHERE photo_file_id = ?").get(fileId) && can(user, "inventory.view")) return true;
  return false;
}
