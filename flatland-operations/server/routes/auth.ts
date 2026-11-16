import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { audit } from "../lib/audit.js";
import {
  SESSION_COOKIE,
  clearLoginFailures,
  createSession,
  destroyAllSessions,
  destroySession,
  dummyVerify,
  hashPassword,
  loginLockedMinutes,
  passwordProblem,
  recordLoginFailure,
  setSessionCookie,
  verifyPassword,
} from "../lib/auth.js";
import { config } from "../lib/config.js";
import { HttpError, badRequest, conflict } from "../lib/errors.js";
import { permissionsFor } from "../lib/permissions.js";
import { DEFAULT_TZ, companyTz, getSetting, isValidTimeZone, nowIso } from "../lib/time.js";
import { email, reqText } from "../lib/validate.js";

export function authRoutes(db: DB) {
  const r = Router();

  const userCount = () => (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;

  /** Public: tells the login page whether first-time setup is needed. */
  r.get("/status", (_req, res) => {
    res.json({
      needsSetup: userCount() === 0,
      companyName: getSetting(db, "company_name"),
    });
  });

  /** First-run only: creates the company owner account. Disabled once any user exists. */
  r.post("/setup", (req, res) => {
    const body = z
      .object({
        company_name: reqText(120),
        timezone: z.string().default(DEFAULT_TZ),
        first_name: reqText(60),
        last_name: reqText(60),
        email,
        password: z.string(),
      })
      .parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) throw badRequest(problem, { fields: { password: problem } });
    if (!isValidTimeZone(body.timezone)) throw badRequest("Unknown time zone.");

    const user = db.transaction(() => {
      if (userCount() > 0) throw conflict("Setup has already been completed.");
      const now = nowIso();
      const info = db
        .prepare(
          `INSERT INTO users (email, password_hash, role, first_name, last_name, must_change_password, password_changed_at)
           VALUES (?,?,'owner',?,?,0,?)`,
        )
        .run(body.email, hashPassword(body.password), body.first_name, body.last_name, now);
      const id = Number(info.lastInsertRowid);
      db.prepare("INSERT INTO employee_profiles (user_id, job_title) VALUES (?, 'Owner')").run(id);
      const set = db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_by) VALUES (?,?,?)");
      set.run("company_name", body.company_name, id);
      set.run("timezone", body.timezone, id);
      set.run("overtime_weekly_hours", "40", id);
      audit(db, { userId: id, action: "system.setup", summary: `completed first-time setup for ${body.company_name}` });
      return id;
    })();
    const s = createSession(db, user, req);
    setSessionCookie(res, s.token, s.expires);
    res.status(201).json({ ok: true });
  });

  r.post("/login", (req, res) => {
    const body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) }).parse(req.body);
    const key = `${body.email}|${req.ip}`;
    const locked = loginLockedMinutes(key);
    if (locked) throw new HttpError(429, `Too many failed attempts. Try again in ${locked} minute(s).`);

    const user = db
      .prepare("SELECT id, password_hash, status FROM users WHERE email = ?")
      .get(body.email) as { id: number; password_hash: string; status: string } | undefined;
    const ok = user ? verifyPassword(body.password, user.password_hash) : dummyVerify(body.password);
    if (!user || !ok || user.status !== "active") {
      recordLoginFailure(key);
      audit(db, { userId: user?.id ?? null, action: "auth.login_failed", summary: `failed sign-in for ${body.email}`, ip: req.ip });
      throw new HttpError(401, "Email or password is incorrect.");
    }
    clearLoginFailures(key);
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(nowIso(), user.id);
    const s = createSession(db, user.id, req);
    setSessionCookie(res, s.token, s.expires);
    audit(db, { userId: user.id, action: "auth.login", summary: "signed in", ip: req.ip });
    res.json({ ok: true });
  });

  r.post("/logout", (req, res) => {
    destroySession(db, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  /** Current user + permissions + company context. Available even with a temporary password. */
  r.get("/me", (req, res) => {
    if (!req.user) throw new HttpError(401, "Please sign in.");
    res.json({
      user: req.user,
      permissions: permissionsFor(req.user),
      company: {
        name: getSetting(db, "company_name"),
        timezone: companyTz(db),
      },
      integrations: {
        esign: config.esign.configured,
        quickbooks: config.quickbooks.configured,
      },
    });
  });

  r.post("/change-password", (req, res) => {
    if (!req.user) throw new HttpError(401, "Please sign in.");
    const body = z.object({ current_password: z.string(), new_password: z.string() }).parse(req.body);
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id) as { password_hash: string };
    if (!verifyPassword(body.current_password, row.password_hash)) {
      throw badRequest("Current password is incorrect.", { fields: { current_password: "Incorrect password" } });
    }
    const problem = passwordProblem(body.new_password);
    if (problem) throw badRequest(problem, { fields: { new_password: problem } });
    if (body.new_password === body.current_password) throw badRequest("Choose a password different from the current one.");
    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?",
    ).run(hashPassword(body.new_password), nowIso(), nowIso(), req.user.id);
    destroyAllSessions(db, req.user.id, req.cookies?.[SESSION_COOKIE]);
    audit(db, { userId: req.user.id, action: "auth.password_change", summary: "changed their password", ip: req.ip });
    res.json({ ok: true });
  });

  return r;
}
