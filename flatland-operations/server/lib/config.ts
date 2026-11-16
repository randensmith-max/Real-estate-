import path from "node:path";
import fs from "node:fs";

// Minimal .env loader (no extra dependency). Real environment variables win.
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export const config = {
  port: Number(process.env.PORT || 4000),
  isProd: process.env.NODE_ENV === "production",
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, "flatland.db"),
  uploadsDir: path.join(dataDir, "uploads"),
  backupsDir: path.join(dataDir, "backups"),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 72),
  maxUploadBytes: 25 * 1024 * 1024,
  esign: {
    provider: process.env.ESIGN_PROVIDER || null,
    configured: Boolean(process.env.ESIGN_PROVIDER && process.env.ESIGN_API_KEY),
  },
  quickbooks: {
    configured: Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET),
  },
};
