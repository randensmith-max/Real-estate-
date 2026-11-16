import { createApp } from "./app.js";
import { openDatabase } from "./db/db.js";
import { config } from "./lib/config.js";
import { backupDatabase } from "./routes/admin.js";

const db = openDatabase();
const app = createApp(db);

const server = app.listen(config.port, () => {
  console.log(`Flatland Operations API listening on http://localhost:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
});

// Nightly automatic backup (keeps working as long as the server runs). See docs/OPERATIONS.md.
const DAY = 24 * 3600_000;
setInterval(() => {
  backupDatabase(db)
    .then((f) => console.log(`[backup] wrote ${f}`))
    .catch((e) => console.error("[backup] failed", e));
}, DAY).unref();

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
