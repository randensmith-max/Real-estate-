/**
 * Phase 1 acceptance tests — run with separate OWNER, MANAGER and EMPLOYEE accounts (plus a subcontractor).
 * Covers: backend permission matrix, persistence across sign-out/sign-in, propagation of changes,
 * clear validation errors, and audit history for every important change.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { agent, createUser, makeApp, OWNER_PW, setupOwner } from "./helpers.js";

type A = ReturnType<typeof agent>;
let app: ReturnType<typeof makeApp>["app"];
let db: ReturnType<typeof makeApp>["db"];
let owner: A, manager: A, employee: A, sub: A;
let managerId: number, employeeId: number, subId: number;

beforeEach(async () => {
  ({ app, db } = makeApp());
  owner = await setupOwner(app);
  const m = await createUser(app, owner, "manager", "manager@example.test");
  const e = await createUser(app, owner, "employee", "employee@example.test");
  const s = await createUser(app, owner, "subcontractor", "sub@example.test", { company_name: "Sub Hauling" });
  [manager, managerId, employee, employeeId, sub, subId] = [m.agent, m.id, e.agent, e.id, s.agent, s.id];
});

const auditCount = (action: string) => (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;
const lastWeekMonday = () => {
  const d = new Date();
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow - 7);
  return d.toISOString().slice(0, 10);
};

describe("backend permission matrix (Phase 1)", () => {
  it("returns the right status for each role on manager-only endpoints", async () => {
    const job = (await manager.post("/api/jobs").send({ name: "Matrix job", job_type: "other" })).body.id;
    const cust = (await manager.post("/api/customers").send({ name: "Matrix Farm" })).body.id;
    const checks: [string, string, Record<string, unknown>?][] = [
      ["get", "/api/users"],
      ["post", "/api/users", { first_name: "X", last_name: "Y", email: "x@example.test", role: "employee" }],
      ["get", "/api/customers"],
      ["post", "/api/customers", { name: "Nope Farm" }],
      ["put", `/api/customers/${cust}`, { name: "Renamed" }],
      ["post", "/api/jobs", { name: "Nope", job_type: "other" }],
      ["put", `/api/jobs/${job}`, { name: "Nope", job_type: "other" }],
      ["post", `/api/jobs/${job}/status`, { status: "scheduled" }],
      ["put", `/api/jobs/${job}/assignments`, { user_ids: [] }],
      ["get", "/api/time/timesheets"],
      ["get", "/api/time/active"],
      ["get", "/api/time/by-job"],
      ["post", "/api/time/entries", { user_id: 1, clock_in_at: "2026-01-05T08:00", clock_out_at: "2026-01-05T09:00", reason: "x" }],
      ["get", `/api/time/payroll-export?week_start=${lastWeekMonday()}`],
      ["get", "/api/time-off?scope=all"],
      ["get", `/api/time-off/calendar?from=2026-01-01&to=2026-01-31`],
      ["get", `/api/users/${managerId}`],
    ];
    for (const who of [employee, sub]) {
      for (const [m, url, body] of checks) {
        const res = await who[m as "get"](url).send(body ?? {});
        expect([403, 404], `${m.toUpperCase()} ${url} should be refused`).toContain(res.status);
      }
    }
    // Manager is allowed all of these (spot check) but not owner-only ones.
    expect((await manager.get("/api/users")).status).toBe(200);
    expect((await manager.get("/api/time/timesheets")).status).toBe(200);
    expect((await manager.get("/api/admin/settings")).status).toBe(403);
    expect((await manager.get("/api/admin/audit")).status).toBe(403);
    expect((await manager.get("/api/admin/export.json")).status).toBe(403);
    expect((await manager.post(`/api/users/${employeeId}/pay-rates`).send({ hourly: 30 })).status).toBe(403);
    expect((await owner.get("/api/admin/audit")).status).toBe(200);
  });

  it("rejects unauthenticated requests everywhere", async () => {
    const anon = agent(app);
    for (const url of ["/api/dashboard", "/api/jobs", "/api/time/me", "/api/users", "/api/customers"]) {
      expect((await anon.get(url)).status).toBe(401);
    }
  });

  it("hides financial fields from managers and employees", async () => {
    const job = (await owner.post("/api/jobs").send({ name: "Quoted job", job_type: "chopping", quoted_amount: 5000, assigned_user_ids: [employeeId] })).body.id;
    expect((await owner.get(`/api/jobs/${job}`)).body.job.quoted_amount_cents).toBe(500000);
    expect((await manager.get(`/api/jobs/${job}`)).body.job.quoted_amount_cents).toBeUndefined();
    expect((await employee.get(`/api/jobs/${job}`)).body.job.quoted_amount_cents).toBeUndefined();
    expect((await manager.get("/api/jobs")).body.jobs[0].quoted_amount_cents).toBeUndefined();
    // A manager editing the job must not wipe the owner's quote.
    await manager.put(`/api/jobs/${job}`).send({ name: "Quoted job (edited)", job_type: "chopping" });
    expect((await owner.get(`/api/jobs/${job}`)).body.job.quoted_amount_cents).toBe(500000);
  });

  it("stops managers from editing owners and from changing roles", async () => {
    const ownerId = (await owner.get("/api/auth/me")).body.user.id;
    expect((await manager.put(`/api/users/${ownerId}`).send({ first_name: "X", last_name: "Y", email: "owner@example.test", role: "owner" })).status).toBe(403);
    expect((await manager.post(`/api/users/${ownerId}/reset-password`)).status).toBe(403);
    const res = await manager.put(`/api/users/${employeeId}`).send({ first_name: "E", last_name: "P", email: "employee@example.test", role: "manager" });
    expect(res.status).toBe(403);
  });

  it("never lets the last owner be demoted or deactivated", async () => {
    const ownerId = (await owner.get("/api/auth/me")).body.user.id;
    const res = await owner.put(`/api/users/${ownerId}`).send({ first_name: "Olive", last_name: "Owner", email: "owner@example.test", role: "manager" });
    expect(res.status).toBe(400);
  });
});

describe("persistence across sign-out / sign-in", () => {
  it("keeps jobs, customers, profiles and time after signing out and back in", async () => {
    const cust = (await manager.post("/api/customers").send({ name: "Persist Dairy", phone: "555-0101" })).body.id;
    const job = (await manager.post("/api/jobs").send({ name: "Persist job", job_type: "hauling", customer_id: cust, assigned_user_ids: [employeeId] })).body.id;
    await employee.put(`/api/users/${employeeId}`).send({ phone: "555-0199", emergency_contact_name: "Sam" });
    await employee.post("/api/time/clock-in").send({ job_id: job });

    await manager.post("/api/auth/logout");
    expect((await manager.get("/api/jobs")).status).toBe(401);
    await employee.post("/api/auth/logout");

    const m2 = agent(app);
    await m2.post("/api/auth/login").send({ email: "manager@example.test", password: "NewPassword456" });
    const e2 = agent(app);
    await e2.post("/api/auth/login").send({ email: "employee@example.test", password: "NewPassword456" });

    const j = (await m2.get(`/api/jobs/${job}`)).body;
    expect(j.job.name).toBe("Persist job");
    expect(j.job.customer_name).toBe("Persist Dairy");
    expect(j.crew[0].on_site).toBe(1);
    const me = (await e2.get("/api/time/me")).body;
    expect(me.current.job.id).toBe(job);
    const profile = (await e2.get(`/api/users/${employeeId}`)).body.user;
    expect(profile.phone).toBe("555-0199");
    expect(profile.emergency_contact_name).toBe("Sam");
  });
});

describe("changes propagate everywhere they are used", () => {
  it("customer rename, job status and clock-in show on job, list, dashboard and employee views", async () => {
    const cust = (await manager.post("/api/customers").send({ name: "Old Name Farm" })).body.id;
    const job = (await manager.post("/api/jobs").send({ name: "Prop job", job_type: "chopping", customer_id: cust, assigned_user_ids: [employeeId] })).body.id;
    await manager.put(`/api/customers/${cust}`).send({ name: "New Name Farm" });
    expect((await manager.get("/api/jobs")).body.jobs[0].customer_name).toBe("New Name Farm");
    expect((await employee.get(`/api/jobs/${job}`)).body.job.customer_name).toBe("New Name Farm");

    await manager.post(`/api/jobs/${job}/status`).send({ status: "scheduled" });
    await employee.post("/api/time/clock-in").send({ job_id: job });
    // Clocking in moves the job to In Progress — visible to the manager.
    expect((await manager.get(`/api/jobs/${job}`)).body.job.status).toBe("in_progress");
    const dash = (await manager.get("/api/dashboard")).body;
    expect(dash.clockedIn.map((c: { user_id: number }) => c.user_id)).toContain(employeeId);
    expect(dash.activeJobs.map((j: { id: number }) => j.id)).toContain(job);
    expect((await manager.get("/api/users")).body.users.find((u: { id: number }) => u.id === employeeId).clocked_in_at).toBeTruthy();
  });

  it("a manager correction updates the job's hours and the weekly timesheet total", async () => {
    const job = (await manager.post("/api/jobs").send({ name: "Hours job", job_type: "farming", assigned_user_ids: [employeeId] })).body.id;
    const wk = lastWeekMonday();
    const add = await manager.post("/api/time/entries").send({ user_id: employeeId, job_id: job, clock_in_at: `${wk}T08:00`, clock_out_at: `${wk}T12:00`, reason: "Missed punch" });
    expect(add.status).toBe(201);
    expect((await manager.get(`/api/jobs/${job}`)).body.totals.actual_hours).toBe(4);
    await manager.put(`/api/time/entries/${add.body.entry.id}`).send({ clock_out_at: `${wk}T14:00`, reason: "Confirmed with foreman" });
    expect((await manager.get(`/api/jobs/${job}`)).body.totals.actual_hours).toBe(6);
    const ts = (await manager.get(`/api/time/timesheets?week_start=${wk}`)).body.rows.find((r: { id: number }) => r.id === employeeId);
    expect(ts.minutes).toBe(360);
    expect(ts.edited_count).toBe(1);
    // The employee sees the corrected hours on their own timesheet too.
    const mine = (await employee.get(`/api/time/timesheets/${employeeId}/${wk}`)).body;
    expect(mine.entries[0].worked_minutes).toBe(360);
  });

  it("editing a job keeps a crew member who was later deactivated", async () => {
    const job = (await manager.post("/api/jobs").send({ name: "Crew job", job_type: "custom", assigned_user_ids: [employeeId] })).body.id;
    await owner.put(`/api/users/${employeeId}`).send({ first_name: "employee", last_name: "Person", email: "employee@example.test", role: "employee", status: "inactive" });
    const res = await manager.put(`/api/jobs/${job}`).send({ name: "Crew job v2", job_type: "custom", assigned_user_ids: [employeeId] });
    expect(res.status).toBe(200);
    // …but cannot newly assign an inactive person
    const job2 = (await manager.post("/api/jobs").send({ name: "Other", job_type: "custom" })).body.id;
    expect((await manager.put(`/api/jobs/${job2}/assignments`).send({ user_ids: [employeeId] })).status).toBe(400);
  });

  it("deactivating a person signs them out immediately", async () => {
    await owner.put(`/api/users/${employeeId}`).send({ first_name: "employee", last_name: "Person", email: "employee@example.test", role: "employee", status: "inactive" });
    expect((await employee.get("/api/time/me")).status).toBe(401);
    const again = await agent(app).post("/api/auth/login").send({ email: "employee@example.test", password: "NewPassword456" });
    expect(again.status).toBe(401);
  });
});

describe("time rules added in Phase 1 verification", () => {
  it("managers cannot correct their own time; owners can", async () => {
    const wk = lastWeekMonday();
    const self = await manager.post("/api/time/entries").send({ user_id: managerId, clock_in_at: `${wk}T08:00`, clock_out_at: `${wk}T10:00`, reason: "self" });
    expect(self.status).toBe(403);
    const byOwner = await owner.post("/api/time/entries").send({ user_id: managerId, clock_in_at: `${wk}T08:00`, clock_out_at: `${wk}T10:00`, reason: "Owner fixing manager punch" });
    expect(byOwner.status).toBe(201);
    expect((await manager.put(`/api/time/entries/${byOwner.body.entry.id}`).send({ clock_out_at: `${wk}T11:00`, reason: "self" })).status).toBe(403);
    expect((await manager.post(`/api/time/entries/${byOwner.body.entry.id}/void`).send({ reason: "self" })).status).toBe(403);
  });

  it("cannot approve a week that is still in progress", async () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const thisMonday = d.toISOString().slice(0, 10);
    const res = await manager.post(`/api/time/timesheets/${employeeId}/${thisMonday}/approve`);
    // Either "not over yet" (409) or, right at a UTC/local boundary, a week mismatch (400) — never approved.
    expect([400, 409]).toContain(res.status);
  });

  it("subcontractors only see their assigned jobs and cannot clock in unless authorised", async () => {
    const j1 = (await manager.post("/api/jobs").send({ name: "Sub job", job_type: "hauling", assigned_user_ids: [subId] })).body.id;
    await manager.post("/api/jobs").send({ name: "Not theirs", job_type: "hauling" });
    const list = (await sub.get("/api/jobs")).body.jobs;
    expect(list.map((j: { id: number }) => j.id)).toEqual([j1]);
    expect((await sub.post("/api/time/clock-in").send({ job_id: j1 })).status).toBe(403);
  });
});

describe("clear errors", () => {
  it("returns field-level validation messages", async () => {
    const res = await manager.post("/api/jobs").send({ name: "", job_type: "nonsense" });
    expect(res.status).toBe(400);
    expect(res.body.fields.name).toBeTruthy();
    expect(res.body.fields.job_type).toBeTruthy();
    const dup = await manager.post("/api/customers").send({ name: "Dup Farm" });
    expect(dup.status).toBe(201);
    const dup2 = await manager.post("/api/customers").send({ name: "dup farm" });
    expect(dup2.status).toBe(409);
    expect(dup2.body.error).toMatch(/already exists/);
    const badTime = await manager.post("/api/time/entries").send({ user_id: employeeId, clock_in_at: "2026-01-05T10:00", clock_out_at: "2026-01-05T09:00", reason: "x" });
    expect(badTime.body.error).toMatch(/after clock-in/);
  });

  it("enforces password rules with a readable message", async () => {
    const res = await employee.post("/api/auth/change-password").send({ current_password: "NewPassword456", new_password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 10/);
  });
});

describe("audit history", () => {
  it("records every important Phase 1 change", async () => {
    const cust = (await manager.post("/api/customers").send({ name: "Audit Farm" })).body.id;
    await manager.put(`/api/customers/${cust}`).send({ name: "Audit Farm 2" });
    const job = (await manager.post("/api/jobs").send({ name: "Audit job", job_type: "other", customer_id: cust })).body.id;
    await manager.put(`/api/jobs/${job}/assignments`).send({ user_ids: [employeeId] });
    await manager.post(`/api/jobs/${job}/status`).send({ status: "on_hold", note: "Rain" });
    await employee.post("/api/time/clock-in").send({ job_id: job });
    await employee.post("/api/time/clock-out").send({});
    const tor = (await employee.post("/api/time-off").send({ type: "vacation", start_date: "2099-06-01", end_date: "2099-06-03" })).body.id;
    await manager.post(`/api/time-off/${tor}/review`).send({ decision: "approved" });
    await employee.put(`/api/users/${employeeId}/availability`).send({ days: [{ weekday: 6, available: false, start_time: "", end_time: "", note: "Church" }] });
    await owner.post(`/api/users/${employeeId}/pay-rates`).send({ hourly: 25 });
    await manager.post(`/api/users/${employeeId}/reset-password`);

    for (const action of [
      "customer.create", "customer.update", "job.create", "job.assign", "job.status", "time.clock_in", "time.clock_out",
      "timeoff.request", "timeoff.approved", "user.availability", "user.pay_rate", "user.password_reset", "user.create", "auth.login",
    ]) {
      expect(auditCount(action), action).toBeGreaterThan(0);
    }
    const owners = await owner.get(`/api/admin/audit?entity_type=job&entity_id=${job}`);
    expect(owners.body.rows.length).toBeGreaterThanOrEqual(3);
    // Customer change diff is recorded field-by-field.
    const row = db.prepare("SELECT changes FROM audit_log WHERE action = 'customer.update'").get() as { changes: string };
    expect(JSON.parse(row.changes).name).toEqual(["Audit Farm", "Audit Farm 2"]);
  });

  it("does not let a failed login reveal whether an account exists", async () => {
    const a = await agent(app).post("/api/auth/login").send({ email: "nobody@example.test", password: "x" });
    const b = await agent(app).post("/api/auth/login").send({ email: "owner@example.test", password: "wrong-" + OWNER_PW });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });
});
