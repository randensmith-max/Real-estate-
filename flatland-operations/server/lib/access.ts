import type { DB } from "../db/db.js";
import { forbidden, notFound } from "./errors.js";
import { can, type AuthUser } from "./permissions.js";

/** Row-level access rules shared by routes. Permissions alone are not enough for assigned-only data. */

export function isAssignedToJob(db: DB, userId: number, jobId: number): boolean {
  return Boolean(db.prepare("SELECT 1 FROM job_assignments WHERE job_id = ? AND user_id = ?").get(jobId, userId));
}

export function canViewJob(db: DB, user: AuthUser, jobId: number): boolean {
  if (can(user, "jobs.view_all")) return true;
  return isAssignedToJob(db, user.id, jobId);
}

export function assertCanViewJob(db: DB, user: AuthUser, jobId: number) {
  const exists = db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(jobId);
  if (!exists) throw notFound("Job");
  if (!canViewJob(db, user, jobId)) throw notFound("Job"); // don't reveal existence
}

export function canViewDocument(db: DB, user: AuthUser, documentId: number): boolean {
  if (can(user, "documents.view_all")) return true;
  const doc = db.prepare("SELECT visibility, status FROM documents WHERE id = ?").get(documentId) as
    | { visibility: string; status: string }
    | undefined;
  if (!doc || doc.status !== "active") return false;
  if (doc.visibility === "company" && user.role !== "subcontractor") return true;
  if (db.prepare("SELECT 1 FROM document_access WHERE document_id = ? AND user_id = ?").get(documentId, user.id)) return true;
  // Documents linked to a job the user is assigned to.
  const viaJob = db
    .prepare(
      `SELECT 1 FROM document_links dl JOIN job_assignments ja ON ja.job_id = dl.entity_id
       WHERE dl.document_id = ? AND dl.entity_type = 'job' AND ja.user_id = ? AND ?`,
    )
    .get(documentId, user.id, doc.visibility !== "managers" ? 1 : 0);
  return Boolean(viaJob);
}

export type EntityType = "job" | "user" | "customer" | "item" | "maintenance" | "inspection";

export function canViewEntity(db: DB, user: AuthUser, type: EntityType, id: number): boolean {
  switch (type) {
    case "job":
      return canViewJob(db, user, id);
    case "user":
      return user.id === id || can(user, "users.view");
    case "customer":
      return can(user, "customers.view");
    case "item":
      return can(user, "inventory.view");
    case "maintenance": {
      if (can(user, "maintenance.manage")) return true;
      const r = db.prepare("SELECT reported_by, assigned_to FROM maintenance_records WHERE id = ?").get(id) as
        | { reported_by: number; assigned_to: number }
        | undefined;
      return Boolean(r && (r.reported_by === user.id || r.assigned_to === user.id));
    }
    case "inspection": {
      if (can(user, "inspections.manage")) return true;
      const r = db.prepare("SELECT performed_by FROM inspections WHERE id = ?").get(id) as { performed_by: number } | undefined;
      return Boolean(r && r.performed_by === user.id);
    }
  }
}

/** Who may add attachments to a record. */
export function canAttachTo(db: DB, user: AuthUser, type: EntityType, id: number): boolean {
  switch (type) {
    case "job":
      return can(user, "jobs.manage") || isAssignedToJob(db, user.id, id); // crews can add job-site photos
    case "user":
      return can(user, "users.manage");
    case "customer":
      return can(user, "customers.manage");
    case "item":
      return can(user, "inventory.manage");
    case "maintenance":
    case "inspection":
      return canViewEntity(db, user, type, id);
  }
}

export function assertEntityExists(db: DB, type: EntityType, id: number) {
  const table = {
    job: "jobs",
    user: "users",
    customer: "customers",
    item: "inventory_items",
    maintenance: "maintenance_records",
    inspection: "inspections",
  }[type];
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw notFound();
}

export function assertSelfOr(user: AuthUser, targetUserId: number, perm: Parameters<typeof can>[1]) {
  if (user.id !== targetUserId && !can(user, perm)) throw forbidden();
}
