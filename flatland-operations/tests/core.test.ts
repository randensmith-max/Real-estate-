import { describe, expect, it } from "vitest";
import { OWNER_PW, agent, createUser, makeApp, setupOwner } from "./helpers.js";

describe("authentication & setup", () => {
  it("allows first-time setup exactly once", async () => {
    const { app } = makeApp();
    const status = await agent(app).get("/api/auth/status");
    expect(status.body.needsSetup).toBe(true);
    await setupOwner(app);
    const again = await agent(app).post("/api/auth/setup").send({
      company_name: "X", timezone: "America/Chicago", first_name: "A", last_name: "B", email: "x@example.test", password: "Password1234",
    });
    expect(again.status).toBe(409);
  });

  it("rejects requests without the CSRF header", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const res = await owner.raw.post("/api/customers").send({ name: "No header" });
    expect(res.status).toBe(403);
  });

  it("locks out after repeated failed logins", async () => {
    const { app } = makeApp();
    await setupOwner(app);
    const a = agent(app);
    for (let i = 0; i < 5; i++) {
      expect((await a.post("/api/auth/login").send({ email: "owner@example.test", password: "wrong-password-1" })).status).toBe(401);
    }
    const locked = await a.post("/api/auth/login").send({ email: "owner@example.test", password: OWNER_PW });
    expect(locked.status).toBe(429);
  });

  it("forces new users to change their temporary password", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const created = await owner.post("/api/users").send({ first_name: "Eve", last_name: "E", email: "eve@example.test", role: "employee" });
    const eve = agent(app);
    await eve.post("/api/auth/login").send({ email: "eve@example.test", password: created.body.temporaryPassword });
    const blocked = await eve.get("/api/dashboard");
    expect(blocked.status).toBe(403);
    expect(blocked.body.details.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });
});

describe("role-based authorization (server-side)", () => {
  it("prevents employees from manager actions and hides unassigned jobs", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const emp = await createUser(app, owner, "employee", "emp@example.test");
    const job = await owner.post("/api/jobs").send({ name: "Field 12 chopping", job_type: "chopping" });
    expect(job.status).toBe(201);

    expect((await emp.agent.post("/api/jobs").send({ name: "x", job_type: "other" })).status).toBe(403);
    expect((await emp.agent.get("/api/users")).status).toBe(403);
    expect((await emp.agent.get("/api/time/timesheets")).status).toBe(403);
    expect((await emp.agent.get(`/api/jobs/${job.body.id}`)).status).toBe(404);
    expect((await emp.agent.get("/api/jobs")).body.jobs).toHaveLength(0);

    await owner.put(`/api/jobs/${job.body.id}/assignments`).send({ user_ids: [emp.id] });
    expect((await emp.agent.get(`/api/jobs/${job.body.id}`)).status).toBe(200);
    expect((await emp.agent.get("/api/jobs")).body.jobs).toHaveLength(1);
  });

  it("stops managers from creating owners or seeing pay rates", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const mgr = await createUser(app, owner, "manager", "mgr@example.test");
    const res = await mgr.agent.post("/api/users").send({ first_name: "X", last_name: "Y", email: "x@example.test", role: "owner" });
    expect(res.status).toBe(403);
    const emp = await createUser(app, mgr.agent, "employee", "emp2@example.test");
    await owner.post(`/api/users/${emp.id}/pay-rates`).send({ hourly: 22.5 });
    const profile = await mgr.agent.get(`/api/users/${emp.id}`);
    expect(profile.body.payRates).toBeUndefined();
    const asOwner = await owner.get(`/api/users/${emp.id}`);
    expect(asOwner.body.payRates[0].hourly_cents).toBe(2250);
  });

  it("only lets subcontractors clock in when authorised", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const sub = await createUser(app, owner, "subcontractor", "sub@example.test");
    expect((await sub.agent.post("/api/time/clock-in").send({})).status).toBe(403);
    await owner.put(`/api/users/${sub.id}`).send({ first_name: "Sub", last_name: "Co", email: "sub@example.test", role: "subcontractor", can_record_time: true });
    expect((await sub.agent.post("/api/time/clock-in").send({})).status).toBe(201);
  });
});

describe("time clock", () => {
  it("prevents duplicate clock-ins and invalid clock-outs", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const emp = await createUser(app, owner, "employee", "emp@example.test");
    expect((await emp.agent.post("/api/time/clock-out").send({})).status).toBe(409);
    expect((await emp.agent.post("/api/time/clock-in").send({ device_tz: "America/Denver" })).status).toBe(201);
    expect((await emp.agent.post("/api/time/clock-in").send({})).status).toBe(409);
    expect((await emp.agent.post("/api/time/break/start")).status).toBe(200);
    expect((await emp.agent.post("/api/time/break/start")).status).toBe(409);
    const me = await emp.agent.get("/api/time/me");
    expect(me.body.current.on_break).toBe(true);
    expect((await emp.agent.post("/api/time/clock-out").send({})).status).toBe(200);
    const after = await emp.agent.get("/api/time/me");
    expect(after.body.current).toBeNull();
    // Clocking out closed the open break.
    expect(after.body.weekEntries[0].breaks[0].end_at).not.toBeNull();
  });

  it("rejects clocking into a job the employee is not assigned to", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const emp = await createUser(app, owner, "employee", "emp@example.test");
    const job = await owner.post("/api/jobs").send({ name: "Haul", job_type: "hauling" });
    expect((await emp.agent.post("/api/time/clock-in").send({ job_id: job.body.id })).status).toBe(400);
  });
});

describe("manager corrections", () => {
  async function setupShift() {
    const { app, db } = makeApp();
    const owner = await setupOwner(app);
    const mgr = await createUser(app, owner, "manager", "mgr@example.test");
    const emp = await createUser(app, owner, "employee", "emp@example.test");
    // Missing shift spanning midnight (overnight) — entered in company local time.
    const add = await mgr.agent.post("/api/time/entries").send({
      user_id: emp.id,
      clock_in_at: "2026-11-02T20:00",
      clock_out_at: "2026-11-03T04:30",
      breaks: [{ start_at: "2026-11-02T23:00", end_at: "2026-11-02T23:30" }],
      reason: "Forgot to clock in at the silage pit",
    });
    return { app, db, owner, mgr, emp, add };
  }

  it("adds overnight shifts with correct durations and requires a reason", async () => {
    const { mgr, emp, add } = await setupShift();
    expect(add.status).toBe(201);
    // 2026-11-02 20:00 CST = 2026-11-03T02:00Z
    expect(add.body.entry.clock_in_at).toBe("2026-11-03T02:00:00.000Z");
    const week = await mgr.agent.get(`/api/time/entries?user_id=${emp.id}&week_start=2026-11-02`);
    expect(week.body.entries[0].worked_minutes).toBe(480); // 8.5 h − 30 min break
    const noReason = await mgr.agent.post("/api/time/entries").send({ user_id: emp.id, clock_in_at: "2026-11-04T08:00", clock_out_at: "2026-11-04T09:00" });
    expect(noReason.status).toBe(400);
  });

  it("keeps a full, append-only revision history", async () => {
    const { db, mgr, add } = await setupShift();
    const id = add.body.entry.id;
    const edit = await mgr.agent.put(`/api/time/entries/${id}`).send({ clock_out_at: "2026-11-03T05:00", reason: "Employee stayed to clean the chopper" });
    expect(edit.status).toBe(200);
    const detail = await mgr.agent.get(`/api/time/entries/${id}`);
    const rev = detail.body.revisions.find((r: { field: string }) => r.field === "clock_out_at");
    expect(rev.old_value).toBe("2026-11-03T10:30:00.000Z");
    expect(rev.new_value).toBe("2026-11-03T11:00:00.000Z");
    expect(rev.reason).toMatch(/clean the chopper/);
    expect(rev.changed_by_name).toBeTruthy();
    expect(() => db.prepare("UPDATE time_entry_revisions SET reason = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  });

  it("rejects overlapping shifts", async () => {
    const { mgr, emp } = await setupShift();
    const overlap = await mgr.agent.post("/api/time/entries").send({
      user_id: emp.id, clock_in_at: "2026-11-03T03:00", clock_out_at: "2026-11-03T06:00", reason: "dup",
    });
    expect(overlap.status).toBe(409);
  });

  it("locks approved weeks until reopened, and exports approved hours", async () => {
    const { mgr, owner, emp, add } = await setupShift();
    const approve = await mgr.agent.post(`/api/time/timesheets/${emp.id}/2026-11-02/approve`).send({});
    expect(approve.status).toBe(200);
    const blocked = await mgr.agent.put(`/api/time/entries/${add.body.entry.id}`).send({ clock_out_at: "2026-11-03T05:00", reason: "late fix" });
    expect(blocked.status).toBe(409);
    const csv = await mgr.agent.get("/api/time/payroll-export?week_start=2026-11-02");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('"8.00"');
    expect((await mgr.agent.post(`/api/time/timesheets/${emp.id}/2026-11-02/reopen`).send({})).status).toBe(400);
    expect((await owner.post(`/api/time/timesheets/${emp.id}/2026-11-02/reopen`).send({ reason: "Correction requested" })).status).toBe(200);
    expect((await mgr.agent.put(`/api/time/entries/${add.body.entry.id}`).send({ clock_out_at: "2026-11-03T05:00", reason: "late fix" })).status).toBe(200);
  });

  it("rejects wall-clock times that don't exist due to DST", async () => {
    const { mgr, emp } = await setupShift();
    const res = await mgr.agent.post("/api/time/entries").send({
      user_id: emp.id, clock_in_at: "2026-03-08T02:30", clock_out_at: "2026-03-08T06:00", reason: "dst",
    });
    expect(res.status).toBe(400);
  });
});

describe("inventory & inspections", () => {
  it("tracks every quantity change and blocks negative stock", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const item = await owner.post("/api/inventory").send({ kind: "consumable", category: "fluids", name: "Hydraulic oil", unit: "gal", initial_quantity: 10, low_stock_threshold: 5 });
    expect(item.status).toBe(201);
    expect((await owner.post(`/api/inventory/${item.body.id}/movements`).send({ type: "usage", quantity: 6 })).body.quantity).toBe(4);
    expect((await owner.post(`/api/inventory/${item.body.id}/movements`).send({ type: "usage", quantity: 6 })).status).toBe(409);
    const detail = await owner.get(`/api/inventory/${item.body.id}`);
    expect(detail.body.movements).toHaveLength(2);
    const dash = await owner.get("/api/dashboard");
    expect(dash.body.lowStock[0].name).toBe("Hydraulic oil");
  });

  it("opens an equipment issue automatically when an inspection fails", async () => {
    const { app } = makeApp();
    const owner = await setupOwner(app);
    const emp = await createUser(app, owner, "employee", "emp@example.test");
    const chopper = await owner.post("/api/inventory").send({ kind: "equipment", category: "chopper", name: "Chopper A" });
    await owner.post("/api/inspections/templates/install-starters").send({});
    const t = (await emp.agent.get("/api/inspections/templates")).body.templates.find((x: { name: string }) => x.name === "Daily equipment inspection");
    const responses = t.items.map((it: { id: number }, i: number) => ({ template_item_id: it.id, result: i === 0 ? "fail" : "pass", note: i === 0 ? "Oil low and leaking" : null }));
    const res = await emp.agent.post("/api/inspections").send({ template_id: t.id, item_id: chopper.body.id, responses });
    expect(res.status).toBe(201);
    expect(res.body.overall).toBe("fail");
    expect(res.body.issueIds).toHaveLength(1);
  });
});
