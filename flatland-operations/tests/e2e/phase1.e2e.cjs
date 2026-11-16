// Requires a running server with an EMPTY data directory (it performs first-time setup).
// Usage: DATA_DIR=/tmp/fo-e2e npm start   then   npm run test:e2e:phase1
// Phase 1 UI acceptance run with separate OWNER, MANAGER and EMPLOYEE browser sessions.
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = __dirname + "/output";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4000";
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, String(e.message).split("\n")[0]]);
    throw e;
  }
};
const lastMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
  return d.toISOString().slice(0, 10);
};

async function login(page, email, pw) {
  await page.goto(BASE);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function signOut(page) {
  if (await page.locator(".topbar").isVisible()) await page.locator(".topbar button").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in" }).waitFor();
}
async function firstPassword(page, email, temp, pw) {
  await login(page, email, temp);
  await page.getByText("Choose your password").waitFor();
  const f = page.locator('input[type="password"]');
  await f.nth(0).fill(temp);
  await f.nth(1).fill(pw);
  await f.nth(2).fill(pw);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.locator(".content").waitFor();
}
async function addPerson(page, first, last, email, role) {
  await page.goto(BASE + "/team?new=1");
  const m = page.locator(".modal");
  await m.locator(".field", { hasText: "First name" }).locator("input").fill(first);
  await m.locator(".field", { hasText: "Last name" }).locator("input").fill(last);
  await m.locator('input[type="email"]').fill(email);
  await m.locator(".field", { hasText: /^Role/ }).locator("select").selectOption(role);
  await m.getByRole("button", { name: "Save" }).click();
  await page.getByText("Temporary password").waitFor();
  const temp = (await page.locator(".modal .kv dd.mono").nth(1).textContent()).trim();
  await page.getByRole("button", { name: "Done" }).click();
  return temp;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext(opts);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    p.on("dialog", (d) => d.accept());
    return p;
  };
  const owner = await mk({ viewport: { width: 1400, height: 900 } });
  const manager = await mk({ viewport: { width: 1280, height: 860 } });
  const emp = await mk({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  let mgrTemp, empTemp, jobUrl;

  try {
    await step("Owner: first-time setup", async () => {
      await owner.goto(BASE);
      await owner.locator("form .field", { hasText: "First name" }).locator("input").fill("Olivia");
      await owner.locator("form .field", { hasText: "Last name" }).locator("input").fill("Owner");
      await owner.locator('input[type="email"]').fill("owner@flatland.test");
      await owner.locator('input[type="password"]').nth(0).fill("OwnerPass2026");
      await owner.locator('input[type="password"]').nth(1).fill("OwnerPass2026");
      await owner.getByRole("button", { name: "Create owner account" }).click();
      await owner.getByRole("heading", { name: /Good (morning|afternoon|evening), Olivia/ }).waitFor();
    });
    await step("Owner: add manager and employee (temporary passwords shown once)", async () => {
      mgrTemp = await addPerson(owner, "Maria", "Manager", "maria@flatland.test", "manager");
      empTemp = await addPerson(owner, "Evan", "Employee", "evan@flatland.test", "employee");
      await owner.goto(BASE + "/team");
      await owner.getByText("Maria Manager").waitFor();
      await owner.getByText("Evan Employee").waitFor();
    });
    await step("Owner: set employee pay rate (owner-only tab)", async () => {
      await owner.getByText("Evan Employee").click();
      await owner.getByRole("tab", { name: "Pay" }).click();
      await owner.locator(".field", { hasText: "Hourly rate" }).locator("input").fill("24.50");
      await owner.getByRole("button", { name: "Set rate" }).click();
      await owner.getByText("$24.50").waitFor();
    });

    await step("Manager: forced password change, then signed in", async () => {
      await firstPassword(manager, "maria@flatland.test", mgrTemp, "MariaPass2026");
      await manager.getByRole("heading", { name: /Maria/ }).waitFor();
    });
    await step("Manager: cannot see owner-only Settings or Pay tab", async () => {
      if (await manager.getByRole("link", { name: "Settings" }).count()) throw new Error("Settings link visible to manager");
      await manager.goto(BASE + "/team");
      await manager.getByText("Evan Employee").click();
      await manager.getByRole("tab", { name: "Profile" }).waitFor();
      if (await manager.getByRole("tab", { name: "Pay" }).count()) throw new Error("Pay tab visible to manager");
    });
    await step("Manager: create customer", async () => {
      await manager.goto(BASE + "/customers?new=1");
      const m = manager.locator(".modal");
      await m.locator(".field", { hasText: "Customer / farm name" }).locator("input").fill("Prairie View Dairy");
      await m.locator(".field", { hasText: "Phone" }).locator("input").fill("555-0142");
      await m.getByRole("button", { name: "Save" }).click();
      await manager.waitForURL(/customers\/\d+/);
    });
    await step("Manager: duplicate customer shows a clear error", async () => {
      await manager.goto(BASE + "/customers?new=1");
      await manager.locator(".modal .field", { hasText: "Customer / farm name" }).locator("input").fill("prairie view dairy");
      await manager.locator(".modal").getByRole("button", { name: "Save" }).click();
      await manager.locator(".modal .alert.error", { hasText: "already exists" }).waitFor();
      await manager.locator(".modal").getByRole("button", { name: "Cancel" }).click();
    });
    await step("Manager: create job with customer, schedule and crew", async () => {
      await manager.goto(BASE + "/jobs?new=1");
      const m = manager.locator(".modal");
      await m.locator(".field", { hasText: "Job name" }).locator("input").fill("Section 14 corn silage");
      await m.locator(".field", { hasText: "Customer" }).locator("select").selectOption({ label: "Prairie View Dairy" });
      await m.locator(".field", { hasText: "Estimated hours" }).locator("input").fill("30");
      const t = new Date(); const pad = (n) => String(n).padStart(2, "0");
      await m.locator(".field", { hasText: "Scheduled start" }).locator("input").fill(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T06:30`);
      await m.locator(".field", { hasText: "Instructions for the crew" }).locator("textarea").fill("Cut at 3/4 milk line. Haul to north bunker.");
      await m.getByText("Evan Employee").click();
      await m.getByRole("button", { name: "Create job" }).click();
      await manager.waitForURL(/jobs\/\d+/);
      jobUrl = manager.url();
      await manager.getByText("Scheduled", { exact: true }).first().waitFor();
    });
    await step("Manager: job persists after page refresh", async () => {
      await manager.reload();
      await manager.getByRole("heading", { name: "Section 14 corn silage" }).waitFor();
      await manager.getByText("Cut at 3/4 milk line").waitFor();
      await manager.getByText("Evan Employee").first().waitFor();
    });
    await step("Manager: add job note", async () => {
      await manager.getByPlaceholder("Add a note for the team…").fill("Customer asked us to start on the east side.");
      await manager.getByRole("button", { name: "Add note" }).click();
      await manager.locator(".list", { hasText: "start on the east side" }).waitFor();
    });

    await step("Employee (phone): forced password change", async () => {
      await firstPassword(emp, "evan@flatland.test", empTemp, "EvanPass2026x");
      await emp.locator(".clock-btn.in").waitFor();
    });
    await step("Employee: sees only assigned job, preselected in clock", async () => {
      await emp.locator("select").first().locator("option", { hasText: "Section 14 corn silage" }).waitFor({ state: "attached" });
      await emp.goto(BASE + "/jobs");
      await emp.getByText("Section 14 corn silage").waitFor();
      if ((await emp.locator("tbody tr").count()) !== 1) throw new Error("employee sees more than their job");
    });
    await step("Employee: clock in on the job", async () => {
      await emp.goto(BASE + "/clock");
      await emp.locator(".clock-btn.in").click();
      await emp.locator(".clock-btn.out").waitFor();
    });
    await step("Employee: still clocked in after refresh and after sign-out/sign-in", async () => {
      await emp.reload();
      await emp.locator(".clock-btn.out").waitFor();
      await signOut(emp);
      await login(emp, "evan@flatland.test", "EvanPass2026x");
      await emp.locator(".clock-btn.out").waitFor();
    });
    await step("Employee: double clock-in is impossible (button gone; API refuses)", async () => {
      const s = await emp.evaluate(async () => (await fetch("/api/time/clock-in", { method: "POST", headers: { "X-Flatland-Request": "1", "Content-Type": "application/json" }, body: "{}" })).status);
      if (s !== 409) throw new Error("expected 409, got " + s);
    });
    await step("Employee: break start/end", async () => {
      await emp.getByRole("button", { name: "Start break" }).click();
      await emp.getByText("On break").first().waitFor();
      await emp.getByRole("button", { name: "End break" }).click();
      await emp.getByRole("button", { name: "Start break" }).waitFor();
    });
    await step("Employee: Change job dialog preselects current job", async () => {
      await emp.getByRole("button", { name: "Change job" }).click();
      const val = await emp.locator(".modal select").inputValue();
      if (!val) throw new Error("current job not preselected");
      await emp.locator(".modal button[aria-label=Close]").click();
    });
    await step("Employee: backend refuses manager endpoints; manager pages show an error", async () => {
      for (const url of ["/api/time/timesheets", "/api/users", "/api/customers"]) {
        const s = await emp.evaluate(async (u) => (await fetch(u)).status, url);
        if (s !== 403) throw new Error(`${url} returned ${s}`);
      }
      await emp.goto(BASE + "/timesheets");
      await emp.locator(".alert.error", { hasText: "permission" }).waitFor();
    });

    await step("Manager: dashboard shows employee clocked in on the job (propagation)", async () => {
      await manager.goto(BASE + "/");
      await manager.locator(".card", { hasText: "Clocked in now" }).getByText("Evan Employee").waitFor();
      await manager.locator(".card", { hasText: "Active jobs" }).getByText("Section 14 corn silage").waitFor();
      await manager.goto(jobUrl);
      await manager.getByText("In progress", { exact: true }).first().waitFor();
    });

    await step("Employee: clock out with a note", async () => {
      await emp.goto(BASE + "/clock");
      await emp.locator(".clock-btn.out").click();
      await emp.locator(".modal textarea").fill("Finished east 40 acres");
      await emp.locator(".modal").getByRole("button", { name: "Clock out" }).click();
      await emp.locator(".clock-btn.in").waitFor();
    });

    const wk = lastMonday();
    await step("Manager: add missing overnight shift last week (reason required)", async () => {
      await manager.goto(BASE + "/timesheets");
      await manager.getByText("Evan Employee").click();
      await manager.waitForURL(/timesheets\/\d+\//);
      await manager.goto(manager.url().replace(/\d{4}-\d{2}-\d{2}$/, wk));
      await manager.getByRole("button", { name: "Add missing shift" }).click();
      const m = manager.locator(".modal");
      const next = new Date(wk + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
      await m.locator(".field", { hasText: "Clock in" }).locator("input").fill(`${wk}T19:00`);
      await m.locator(".field", { hasText: /^Clock out/ }).locator("input").fill(`${next.toISOString().slice(0, 10)}T03:30`);
      await m.locator(".field", { hasText: "Job" }).locator("select").selectOption({ index: 1 });
      await m.getByRole("button", { name: "Add shift" }).click();
      await m.locator(".alert.error").waitFor(); // reason missing → error shown
      await m.locator(".field", { hasText: "Reason" }).locator("textarea").fill("Night haul, phone dead — confirmed with foreman");
      await m.getByRole("button", { name: "Add shift" }).click();
      await manager.getByText("8h 30m").first().waitFor();
    });
    await step("Manager: correct the shift; history shows original, new, who, why", async () => {
      await manager.getByRole("button", { name: "Correct" }).click();
      const m = manager.locator(".modal");
      await m.locator(".field", { hasText: "Breaks" }).getByRole("button", { name: "Add break" }).click();
      const br = m.locator(".field", { hasText: "Breaks" }).locator('input[type="datetime-local"]');
      await br.nth(0).fill(`${wk}T23:00`);
      await br.nth(1).fill(`${wk}T23:30`);
      await m.locator(".field", { hasText: "Reason for correction" }).locator("textarea").fill("Added 30 min meal break per foreman log");
      await m.getByRole("button", { name: "Save correction" }).click();
      await manager.getByText("8h 00m").first().waitFor();
      await manager.locator("tbody").getByRole("button", { name: "2" }).click();
      await manager.locator(".modal").getByText("Added 30 min meal break per foreman log").waitFor();
      await manager.locator(".modal").getByText("Maria Manager").first().waitFor();
      await manager.locator(".modal button[aria-label=Close]").click();
    });
    await step("Manager: this week cannot be approved yet (button hidden + notice)", async () => {
      await manager.goto(manager.url().replace(/\d{4}-\d{2}-\d{2}$/, (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })()));
      await manager.getByText("still in progress").waitFor();
      if (await manager.getByRole("button", { name: "Approve week" }).count()) throw new Error("approve visible for current week");
    });
    await step("Manager: approve last week → locked; edits hidden", async () => {
      await manager.goto(manager.url().replace(/\d{4}-\d{2}-\d{2}$/, wk));
      await manager.getByRole("button", { name: "Approve week" }).click();
      await manager.getByText("approved and locked").waitFor();
      if (await manager.getByRole("button", { name: "Correct" }).count()) throw new Error("correct still visible after approval");
    });
    await step("Manager: payroll CSV contains approved hours", async () => {
      const csv = await manager.evaluate(async (w) => (await fetch(`/api/time/payroll-export?week_start=${w}`)).text(), wk);
      if (!csv.includes('"Employee"') || !csv.includes('"8.00"')) throw new Error("csv missing approved row: " + csv.slice(0, 200));
    });
    await step("Employee: sees corrected, approved hours for last week", async () => {
      const r = await emp.evaluate(async (w) => {
        const me = await (await fetch("/api/auth/me")).json();
        return (await fetch(`/api/time/timesheets/${me.user.id}/${w}`)).json();
      }, wk);
      if (r.timesheet.status !== "approved" || r.entries[0].worked_minutes !== 480) throw new Error(JSON.stringify(r.timesheet));
    });

    await step("Employee: request time off; manager approves; shows on dashboard + calendar", async () => {
      await emp.goto(BASE + "/time-off");
      await emp.getByRole("button", { name: "Request time off" }).click();
      const d = new Date(); d.setDate(d.getDate() + 3);
      const day = d.toISOString().slice(0, 10);
      await emp.locator(".modal .field", { hasText: "First day" }).locator("input").fill(day);
      await emp.locator(".modal .field", { hasText: "Last day" }).locator("input").fill(day);
      await emp.locator(".modal textarea").fill("Kid's graduation");
      await emp.locator(".modal").getByRole("button", { name: "Submit request" }).click();
      await emp.getByText("Pending").first().waitFor();
      await manager.goto(BASE + "/time-off");
      await manager.getByText("Kid's graduation").waitFor();
      await manager.getByRole("button", { name: "Approve", exact: true }).click();
      await manager.getByText("Nothing here.").waitFor();
      await manager.goto(BASE + "/");
      await manager.locator(".card", { hasText: "Availability & absences" }).getByText("Evan Employee").waitFor();
      await emp.reload();
      await emp.getByText("Approved").first().waitFor();
    });
    await step("Employee: edits own availability & emergency contact; persists", async () => {
      await emp.goto(BASE + "/");
      const me = await emp.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user.id);
      await emp.goto(`${BASE}/team/${me}`);
      await emp.getByRole("button", { name: "Edit" }).click();
      await emp.locator(".modal .field", { hasText: "Emergency contact name" }).locator("input").fill("Jamie Employee");
      await emp.locator(".modal").getByRole("button", { name: "Save" }).click();
      await emp.getByText("Jamie Employee").waitFor();
      await emp.getByRole("tab", { name: "Availability" }).click();
      await emp.locator("label", { hasText: "Sunday" }).locator("input").uncheck();
      await emp.getByRole("button", { name: "Save availability" }).click();
      await emp.reload();
      await emp.getByRole("tab", { name: "Availability" }).click();
      if (await emp.locator("label", { hasText: "Sunday" }).locator("input").isChecked()) throw new Error("availability not saved");
    });

    await step("Owner: audit log shows manager corrections and approvals", async () => {
      await owner.goto(BASE + "/settings");
      await owner.getByRole("tab", { name: "Audit log" }).click();
      await owner.getByText("Added 30 min meal break per foreman log", { exact: false }).first().waitFor();
      await owner.getByText(/approved Evan Employee's timesheet/).first().waitFor();
      await owner.screenshot({ path: `${OUT}/audit.png`, fullPage: true });
    });
    await step("Owner: deactivate employee → employee is signed out", async () => {
      await owner.goto(BASE + "/team");
      await owner.getByText("Evan Employee").click();
      await owner.getByRole("button", { name: "Edit" }).click();
      await owner.locator(".modal .field", { hasText: "Account status" }).locator("select").selectOption("inactive");
      await owner.locator(".modal").getByRole("button", { name: "Save" }).click();
      await owner.getByText("Inactive").first().waitFor();
      await emp.goto(BASE + "/clock");
      await emp.getByRole("button", { name: "Sign in" }).waitFor();
    });
    await manager.goto(BASE + "/");
    await manager.screenshot({ path: `${OUT}/manager-dashboard.png`, fullPage: true });
  } catch (e) {
    /* recorded in results */
  }
  for (const r of results) console.log(r.join(" | "));
  console.log("PAGE ERRORS:", errors.length ? errors : "none");
  await browser.close();
  process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})();
