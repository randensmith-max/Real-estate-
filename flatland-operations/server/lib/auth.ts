import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { DB } from "../db/db.js";
import { config } from "./config.js";
import { HttpError, forbidden } from "./errors.js";
import { can, type AuthUser, type Permission } from "./permissions.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = "flatland_session";

// ── Passwords (scrypt, per-password salt, constant-time compare) ──
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(key, expected);
}

// A precomputed hash so failed lookups take the same time as real ones.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString("hex"));
export const dummyVerify = (pw: string) => verifyPassword(pw, DUMMY_HASH);

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must include letters and numbers.";
  return null;
}

export function generateTempPassword(): string {
  // Readable temporary password in 4 groups, without ambiguous characters.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) out += "-";
  }
  return /[0-9]/.test(out) ? out : out.slice(0, -1) + "7";
}

// ── Sessions ──
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function createSession(db: DB, userId: number, req: Request): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlHours * 3600_000);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)",
  ).run(sha256(token), userId, now.toISOString(), expires.toISOString(), req.ip ?? null, (req.get("user-agent") || "").slice(0, 300));
  // Opportunistic cleanup of expired sessions.
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now.toISOString());
  return { token, expires };
}

export function destroySession(db: DB, token: string | undefined) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function destroyAllSessions(db: DB, userId: number, exceptToken?: string) {
  if (exceptToken) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, sha256(exceptToken));
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProd,
    expires,
    path: "/",
  });
}

/** Loads req.user from the session cookie, if any. Never throws for anonymous requests. */
export function loadUser(db: DB) {
  const stmt = db.prepare(`
    SELECT u.id, u.email, u.role, u.first_name, u.last_name, u.can_record_time, u.must_change_password, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.status = 'active'`);
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const row = stmt.get(sha256(token)) as (AuthUser & { expires_at: string }) | undefined;
      if (row && row.expires_at > new Date().toISOString()) {
        const { expires_at: _e, ...user } = row;
        req.user = user;
      }
    }
    next();
  };
}

/** Requires a signed-in user. Users holding a temporary password may only change it. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Please sign in."));
  if (req.user.must_change_password) {
    return next(new HttpError(403, "You must set a new password before continuing.", { code: "PASSWORD_CHANGE_REQUIRED" }));
  }
  next();
}

export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Please sign in."));
    if (!perms.every((p) => can(req.user!, p))) return next(forbidden());
    next();
  };
}

/**
 * CSRF defence: state-changing API requests must carry a custom header, which browsers
 * will not attach to cross-site form posts. Combined with SameSite=Strict cookies.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-flatland-request") !== "1") return next(new HttpError(403, "Request blocked (missing CSRF header)."));
  next();
}

// ── Login throttling (in-memory; adequate for a single server process) ──
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

export function loginLockedMinutes(key: string): number {
  const f = failures.get(key);
  if (f && f.count >= MAX_FAILS && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000);
  return 0;
}
export function recordLoginFailure(key: string) {
  const f = failures.get(key);
  const fresh = !f || f.until < Date.now();
  failures.set(key, { count: fresh ? 1 : f!.count + 1, until: Date.now() + LOCK_MS });
}
export function clearLoginFailures(key: string) {
  failures.delete(key);
}
export function resetLoginThrottle() {
  failures.clear();
}
