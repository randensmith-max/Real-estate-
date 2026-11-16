// Usage: npm run backup  — writes a consistent SQLite snapshot to DATA_DIR/backups.
import { openDatabase } from "../db/db.js";
import { config } from "../lib/config.js";
import { backupDatabase } from "../routes/admin.js";

const db = openDatabase();
const name = await backupDatabase(db);
console.log(`Backup written: ${config.backupsDir}/${name}`);
console.log(`Remember to also copy uploaded files: ${config.uploadsDir}`);
db.close();
