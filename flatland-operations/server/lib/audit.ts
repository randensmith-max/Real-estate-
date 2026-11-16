import type { DB } from "../db/db.js";

export interface AuditInput {
  userId: number | null;
  action: string;
  entityType?: string;
  entityId?: number | bigint | null;
  summary: string;
  changes?: Record<string, [unknown, unknown]> | Record<string, unknown> | null;
  ip?: string | null;
}

export function audit(db: DB, a: AuditInput) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, summary, changes, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.userId,
    a.action,
    a.entityType ?? null,
    a.entityId == null ? null : Number(a.entityId),
    a.summary,
    a.changes ? JSON.stringify(a.changes) : null,
    a.ip ?? null,
    new Date().toISOString(),
  );
}

/** Returns {field: [old, new]} for fields whose values differ. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] ?? null;
    const b = (after as Record<string, unknown>)[k] ?? null;
    if (a !== b) out[k] = [a, b];
  }
  return out;
}
