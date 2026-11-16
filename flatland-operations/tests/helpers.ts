import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

// Isolated data directory per test file (uploads/backups); database is in-memory.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flatland-test-"));
process.env.DATA_DIR = dir;
process.env.DB_PATH = ":memory:";

const { openDatabase } = await import("../server/db/db.js");
const { createApp } = await import("../server/app.js");
const { resetLoginThrottle } = await import("../server/lib/auth.js");

export function makeApp() {
  resetLoginThrottle();
  const db = openDatabase(":memory:");
  const app = createApp(db);
  return { db, app };
}

export type Agent = ReturnType<typeof request.agent>;

/** A supertest agent that keeps cookies and sends the CSRF header. */
export function agent(app: Parameters<typeof request.agent>[0]) {
  const a = request.agent(app);
  const wrap = (method: "get" | "post" | "put" | "delete") => (url: string) => a[method](url).set("X-Flatland-Request", "1");
  return { raw: a, get: wrap("get"), post: wrap("post"), put: wrap("put"), del: wrap("delete") };
}

export const OWNER_PW = "OwnerPassword123";

/** Runs first-time setup and returns a signed-in owner agent. */
export async function setupOwner(app: Parameters<typeof request.agent>[0]) {
  const owner = agent(app);
  const res = await owner.post("/api/auth/setup").send({
    company_name: "Test Company",
    timezone: "America/Chicago",
    first_name: "Olive",
    last_name: "Owner",
    email: "owner@example.test",
    password: OWNER_PW,
  });
  if (res.status !== 201) throw new Error("setup failed: " + JSON.stringify(res.body));
  return owner;
}

/** Creates a user via the API, signs them in and sets a permanent password. */
export async function createUser(
  app: Parameters<typeof request.agent>[0],
  admin: ReturnType<typeof agent>,
  role: "manager" | "employee" | "subcontractor",
  emailAddr: string,
  extra: Record<string, unknown> = {},
) {
  const res = await admin.post("/api/users").send({ first_name: role, last_name: "Person", email: emailAddr, role, ...extra });
  if (res.status !== 201) throw new Error("create user failed: " + JSON.stringify(res.body));
  const a = agent(app);
  const login = await a.post("/api/auth/login").send({ email: emailAddr, password: res.body.temporaryPassword });
  if (login.status !== 200) throw new Error("login failed");
  const pw = await a.post("/api/auth/change-password").send({ current_password: res.body.temporaryPassword, new_password: "NewPassword456" });
  if (pw.status !== 200) throw new Error("pw change failed " + JSON.stringify(pw.body));
  return { agent: a, id: res.body.id as number };
}
