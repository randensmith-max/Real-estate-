import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db/db.js";
import { assertSelfOr } from "../lib/access.js";
import { audit, diff } from "../lib/audit.js";
import { destroyAllSessions, generateTempPassword, hashPassword, requirePerm } from "../lib/auth.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { ROLES, can, isPrivilegedRole, type AuthUser, type Role } from "../lib/permissions.js";
import { companyTz, nowIso, todayIn } from "../lib/time.js";
import { email, likeContains, optDate, optMoney, optText, parseId, reqText } from "../lib/validate.js";

const EMPLOYMENT = ["full_time", "part_time", "seasonal", "contract", "on_leave", "terminated"] as const;

const profileFields = {
  job_title: optText(100),
  employment_status: z.enum(EMPLOYMENT).optional(),
  hire_date: optDate,
  termination_date: optDate,
  company_name: optText(150),
  address: optText(300),
  emergency_contact_name: optText(100),
  emergency_contact_phone: optText(40),
  emergency_contact_relation: optText(60),
  responsibilities: optText(2000),
  notes: optText(4000),
};

const userFields = {
  first_name: reqText(60),
  last_name: reqText(60),
  email,
  phone: optText(40),
  role: z.enum(ROLES as [Role, ...Role[]]),
  can_record_time: z.boolean().optional(),
};

function assertCanManageRole(actor: AuthUser, role: Role) {
  if (isPrivilegedRole(role) && !can(actor, "users.manage_privileged")) {
    throw forbidden("Only an owner can create or edit owner and manager accounts.");
  }
}

export function userRoutes(db: DB) {
  const r = Router();

  const getUserRow = (id: number) =>
    db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | { id: number; role: Role; status: string; email: string; first_name: string; last_name: string; phone: string | null; can_record_time: number }
      | undefined;

  /** Staff directory. Managers see everyone; others get a minimal list for pickers only via /users/directory. */
  r.get("/", requirePerm("users.view"), (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const role = String(req.query.role ?? "");
    const status = String(req.query.status ?? "active");
    const where: string[] = [];
    const params: unknown[] = [];
    if (status !== "all") {
      where.push("u.status = ?");
      params.push(status);
    }
    if (ROLES.includes(role as Role)) {
      where.push("u.role = ?");
      params.push(role);
    }
    if (q) {
      where.push("(u.first_name || ' ' || u.last_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR p.job_title LIKE ? ESCAPE '\\')");
      params.push(likeContains(q), likeContains(q), likeContains(q));
    }
    const rows = db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.last_login_at, u.can_record_time,
                p.job_title, p.employment_status, p.company_name,
                (SELECT t.clock_in_at FROM time_entries t WHERE t.user_id = u.id AND t.status = 'open') AS clocked_in_at
         FROM users u LEFT JOIN employee_profiles p ON p.user_id = u.id
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY u.status, u.last_name, u.first_name`,
      )
      .all(...params);
    res.json({ users: rows });
  });

  /** Minimal active-people list for assignment pickers (managers) — names and roles only. */
  r.get("/directory", requirePerm("jobs.manage"), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, first_name || ' ' || last_name AS name, role FROM users WHERE status = 'active' ORDER BY last_name, first_name`,
      )
      .all();
    res.json({ users: rows });
  });

  r.get("/:id", (req, res) => {
    const id = parseId(req.params.id);
    assertSelfOr(req.user!, id, "users.view");
    const user = db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.status, u.last_login_at,
                u.can_record_time, u.must_change_password, u.created_at, p.*
         FROM users u LEFT JOIN employee_profiles p ON p.user_id = u.id WHERE u.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!user) throw notFound("Person");
    user.id = id;
    const certifications = db.prepare("SELECT * FROM certifications WHERE user_id = ? ORDER BY expires_on IS NULL, expires_on").all(id);
    const availability = db.prepare("SELECT * FROM availability WHERE user_id = ? ORDER BY weekday").all(id);
    const timeOff = db
      .prepare(
        `SELECT t.*, rv.first_name || ' ' || rv.last_name AS reviewed_by_name FROM time_off_requests t
         LEFT JOIN users rv ON rv.id = t.reviewed_by WHERE t.user_id = ? ORDER BY t.start_date DESC LIMIT 50`,
      )
      .all(id);
    const equipment = db
      .prepare("SELECT id, name, category, asset_number FROM inventory_items WHERE assigned_user_id = ? AND status = 'active'")
      .all(id);
    const recentJobs = db
      .prepare(
        `SELECT j.id, j.job_number, j.name, j.status, j.scheduled_start,
                ROUND(COALESCE((SELECT SUM(w.worked_minutes) FROM v_time_worked w WHERE w.job_id = j.id AND w.user_id = ?), 0) / 60.0, 2) AS worked_hours
         FROM jobs j WHERE j.id IN (SELECT job_id FROM job_assignments WHERE user_id = ?
                                    UNION SELECT job_id FROM time_entries WHERE user_id = ? AND job_id IS NOT NULL)
         ORDER BY j.scheduled_start DESC LIMIT 25`,
      )
      .all(id, id, id);
    const attachments = db
      .prepare(
        `SELECT a.id, a.caption, a.created_at, f.id AS file_id, f.original_name, f.mime_type, f.size_bytes
         FROM attachments a JOIN files f ON f.id = a.file_id WHERE a.entity_type = 'user' AND a.entity_id = ? ORDER BY a.created_at DESC`,
      )
      .all(id);
    let payRates: unknown[] | undefined;
    if (can(req.user!, "financials.view")) {
      payRates = db.prepare("SELECT * FROM pay_rates WHERE user_id = ? ORDER BY effective_from DESC").all(id);
    }
    res.json({ user, certifications, availability, timeOff, equipment, recentJobs, attachments, payRates });
  });

  r.post("/", requirePerm("users.manage"), (req, res) => {
    const body = z.object({ ...userFields, ...profileFields }).parse(req.body);
    assertCanManageRole(req.user!, body.role);
    const temp = generateTempPassword();
    const id = db.transaction(() => {
      if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(body.email)) throw conflict("Someone with that email already exists.");
      const info = db
        .prepare(
          `INSERT INTO users (email, password_hash, role, first_name, last_name, phone, can_record_time, must_change_password)
           VALUES (?,?,?,?,?,?,?,1)`,
        )
        .run(
          body.email,
          hashPassword(temp),
          body.role,
          body.first_name,
          body.last_name,
          body.phone,
          body.can_record_time === undefined ? (body.role === "subcontractor" ? 0 : 1) : body.can_record_time ? 1 : 0,
        );
      const uid = Number(info.lastInsertRowid);
      db.prepare(
        `INSERT INTO employee_profiles (user_id, job_title, employment_status, hire_date, termination_date, company_name, address,
           emergency_contact_name, emergency_contact_phone, emergency_contact_relation, responsibilities, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        uid,
        body.job_title,
        body.employment_status ?? (body.role === "subcontractor" ? "contract" : "full_time"),
        body.hire_date,
        body.termination_date,
        body.company_name,
        body.address,
        body.emergency_contact_name,
        body.emergency_contact_phone,
        body.emergency_contact_relation,
        body.responsibilities,
        body.notes,
      );
      audit(db, {
        userId: req.user!.id,
        action: "user.create",
        entityType: "user",
        entityId: uid,
        summary: `added ${body.first_name} ${body.last_name} as ${body.role}`,
        ip: req.ip,
      });
      return uid;
    })();
    // The temporary password is returned exactly once so the manager can hand it over.
    res.status(201).json({ id, temporaryPassword: temp });
  });

  r.put("/:id", (req, res) => {
    const id = parseId(req.params.id);
    const actor = req.user!;
    const target = getUserRow(id);
    if (!target) throw notFound("Person");
    const isSelf = actor.id === id;
    if (!isSelf && !can(actor, "users.manage")) throw forbidden();
    if (!isSelf) assertCanManageRole(actor, target.role);

    // People may update their own contact/emergency details; managers can edit everything else.
    const selfSchema = z.object({
      phone: optText(40),
      address: optText(300),
      emergency_contact_name: optText(100),
      emergency_contact_phone: optText(40),
      emergency_contact_relation: optText(60),
    });
    const fullSchema = z.object({ ...userFields, ...profileFields, status: z.enum(["active", "inactive"]).optional() });
    const managing = can(actor, "users.manage") && (!isSelf || can(actor, "users.manage_privileged"));
    const body = (managing ? fullSchema : selfSchema).parse(req.body) as Record<string, unknown>;

    if (managing && body.role && body.role !== target.role) {
      assertCanManageRole(actor, body.role as Role);
      if (!can(actor, "users.manage_privileged")) throw forbidden("Only an owner can change roles.");
    }
    if (managing && isSelf && ((body.role !== undefined && body.role !== target.role) || body.status === "inactive")) {
      throw badRequest("You cannot change your own role or deactivate yourself.");
    }

    db.transaction(() => {
      // Never leave the company without an active owner.
      if (target.role === "owner" && (body.role !== undefined && body.role !== "owner" || body.status === "inactive")) {
        const owners = (db.prepare("SELECT COUNT(*) n FROM users WHERE role='owner' AND status='active'").get() as { n: number }).n;
        if (owners <= 1) throw badRequest("There must always be at least one active owner.");
      }
      if (body.email && body.email !== target.email && db.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").get(body.email, id)) {
        throw conflict("Someone with that email already exists.");
      }
      const userCols = ["first_name", "last_name", "email", "phone", "role", "status", "can_record_time"].filter((k) => k in body);
      const profileCols = Object.keys(profileFields).filter((k) => k in body);
      const before = db
        .prepare("SELECT u.*, p.* FROM users u LEFT JOIN employee_profiles p ON p.user_id = u.id WHERE u.id = ?")
        .get(id) as Record<string, unknown>;
      const vals: Record<string, unknown> = { ...body };
      if ("can_record_time" in vals) vals.can_record_time = vals.can_record_time ? 1 : 0;
      if (userCols.length) {
        db.prepare(`UPDATE users SET ${userCols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
          ...userCols.map((c) => vals[c]),
          nowIso(),
          id,
        );
      }
      if (profileCols.length) {
        db.prepare("INSERT OR IGNORE INTO employee_profiles (user_id) VALUES (?)").run(id);
        db.prepare(`UPDATE employee_profiles SET ${profileCols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE user_id = ?`).run(
          ...profileCols.map((c) => vals[c]),
          nowIso(),
          id,
        );
      }
      const changes = diff(before, Object.fromEntries([...userCols, ...profileCols].map((c) => [c, vals[c]])));
      if (body.status === "inactive" || (body.role && body.role !== target.role)) destroyAllSessions(db, id);
      if (Object.keys(changes).length) {
        audit(db, {
          userId: actor.id,
          action: changes.role ? "user.role_change" : "user.update",
          entityType: "user",
          entityId: id,
          summary: `updated ${target.first_name} ${target.last_name}'s profile`,
          changes,
          ip: req.ip,
        });
      }
    })();
    res.json({ ok: true });
  });

  r.post("/:id/reset-password", requirePerm("users.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const target = getUserRow(id);
    if (!target) throw notFound("Person");
    assertCanManageRole(req.user!, target.role);
    if (id === req.user!.id) throw badRequest("Use 'Change password' for your own account.");
    const temp = generateTempPassword();
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?").run(hashPassword(temp), nowIso(), id);
    destroyAllSessions(db, id);
    audit(db, { userId: req.user!.id, action: "user.password_reset", entityType: "user", entityId: id, summary: `reset the password for ${target.first_name} ${target.last_name}`, ip: req.ip });
    res.json({ temporaryPassword: temp });
  });

  // ── Pay rates (owner / financial access) ──
  r.post("/:id/pay-rates", requirePerm("financials.view", "users.manage"), (req, res) => {
    const id = parseId(req.params.id);
    if (!getUserRow(id)) throw notFound("Person");
    const body = z.object({ hourly: optMoney, effective_from: optDate }).parse(req.body);
    if (body.hourly === null) throw badRequest("Enter an hourly rate.");
    const eff = body.effective_from ?? todayIn(companyTz(db));
    db.prepare(
      `INSERT INTO pay_rates (user_id, hourly_cents, effective_from, created_by) VALUES (?,?,?,?)
       ON CONFLICT(user_id, effective_from) DO UPDATE SET hourly_cents = excluded.hourly_cents, created_by = excluded.created_by`,
    ).run(id, body.hourly, eff, req.user!.id);
    audit(db, { userId: req.user!.id, action: "user.pay_rate", entityType: "user", entityId: id, summary: `set pay rate effective ${eff}`, ip: req.ip });
    res.status(201).json({ ok: true });
  });

  // ── Certifications ──
  const certSchema = z.object({ name: reqText(150), issuer: optText(150), issued_on: optDate, expires_on: optDate, notes: optText(1000) });
  r.post("/:id/certifications", requirePerm("users.manage"), (req, res) => {
    const id = parseId(req.params.id);
    if (!getUserRow(id)) throw notFound("Person");
    const b = certSchema.parse(req.body);
    const info = db
      .prepare("INSERT INTO certifications (user_id, name, issuer, issued_on, expires_on, notes) VALUES (?,?,?,?,?,?)")
      .run(id, b.name, b.issuer, b.issued_on, b.expires_on, b.notes);
    audit(db, { userId: req.user!.id, action: "user.certification_add", entityType: "user", entityId: id, summary: `added certification "${b.name}"` });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.delete("/:id/certifications/:certId", requirePerm("users.manage"), (req, res) => {
    const id = parseId(req.params.id);
    const certId = parseId(req.params.certId);
    const cert = db.prepare("SELECT * FROM certifications WHERE id = ? AND user_id = ?").get(certId, id) as { name: string } | undefined;
    if (!cert) throw notFound("Certification");
    db.prepare("DELETE FROM certifications WHERE id = ?").run(certId);
    audit(db, { userId: req.user!.id, action: "user.certification_remove", entityType: "user", entityId: id, summary: `removed certification "${cert.name}"`, changes: { certification: cert } });
    res.json({ ok: true });
  });

  // ── Weekly availability (self or managers) ──
  r.put("/:id/availability", (req, res) => {
    const id = parseId(req.params.id);
    assertSelfOr(req.user!, id, "users.manage");
    const time = z.string().regex(/^\d{2}:\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null);
    const days = z
      .array(z.object({ weekday: z.number().int().min(0).max(6), available: z.boolean(), start_time: time, end_time: time, note: optText(200) }))
      .max(7)
      .parse(req.body.days);
    for (const d of days) {
      if (d.start_time && d.end_time && d.end_time <= d.start_time) throw badRequest("End time must be after start time.");
    }
    db.transaction(() => {
      const up = db.prepare(
        `INSERT INTO availability (user_id, weekday, available, start_time, end_time, note, updated_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(user_id, weekday) DO UPDATE SET available=excluded.available, start_time=excluded.start_time,
           end_time=excluded.end_time, note=excluded.note, updated_at=excluded.updated_at`,
      );
      for (const d of days) up.run(id, d.weekday, d.available ? 1 : 0, d.start_time, d.end_time, d.note, nowIso());
      audit(db, { userId: req.user!.id, action: "user.availability", entityType: "user", entityId: id, summary: "updated weekly availability" });
    })();
    res.json({ ok: true });
  });

  return r;
}
