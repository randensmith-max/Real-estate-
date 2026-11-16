import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../lib/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ordered list of migrations. Never edit a shipped migration — append a new one.
 * Migrations are applied in a transaction and tracked in schema_migrations.
 */
const migrations: { id: string; sql: () => string }[] = [
  { id: "001_initial", sql: () => fs.readFileSync(path.join(here, "schema.sql"), "utf8") },
];

export type DB = Database.Database;

export function openDatabase(file: string = config.dbPath): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((r) => r.id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql());
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(m.id, new Date().toISOString());
    })();
  }
}
