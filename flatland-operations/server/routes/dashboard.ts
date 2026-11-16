import { Router } from "express";
import type { DB } from "../db/db.js";
import { canViewDocument } from "../lib/access.js";
import { can } from "../lib/permissions.js";
import { addDays, companyTz, dayRange, todayIn } from "../lib/time.js";
import { loadEntries } from "../lib/timeService.js";

export function dashboardRoutes(db: DB) {
  const r = Router();

  r.get("/", (req, res) => {
    const user = req.user!;
    const tz = companyTz(db);
    const today = todayIn(tz);
    const { start, end } = dayRange(today, tz);
    const company = can(user, "dashboard.company");

    const jobScope = company ? "1=1" : "j.id IN (SELECT job_id FROM job_assignments WHERE user_id = @uid)";
    const todaysJobs = db
      .prepare(
        `SELECT j.id, j.job_number, j.name, j.status, j.job_type, j.scheduled_start, j.scheduled_end, j.site_address, c.name AS customer_name,
                (SELECT GROUP_CONCAT(u.first_name || ' ' || u.last_name, ', ') FROM job_assignments a JOIN users u ON u.id = a.user_id WHERE a.job_id = j.id) AS crew
         FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
         WHERE ${jobScope} AND j.status NOT IN ('cancelled','invoiced')
           AND ((j.scheduled_start >= @start AND j.scheduled_start < @end)
             OR (j.scheduled_start < @end AND COALESCE(j.scheduled_end, j.scheduled_start) >= @start AND j.status IN ('scheduled','in_progress')))
         ORDER BY j.scheduled_start`,
      )
      .all({ uid: user.id, start, end });

    const upcomingJobs = company
      ? []
      : db
          .prepare(
            `SELECT j.id, j.job_number, j.name, j.status, j.scheduled_start, j.site_address FROM jobs j
             WHERE j.id IN (SELECT job_id FROM job_assignments WHERE user_id = ?) AND j.status IN ('scheduled','in_progress','on_hold')
               AND (j.scheduled_start IS NULL OR j.scheduled_start >= ?)
             ORDER BY j.scheduled_start LIMIT 10`,
          )
          .all(user.id, end);

    const activeJobs = db
      .prepare(
        `SELECT j.id, j.job_number, j.name, j.status, j.estimated_hours,
                ROUND(COALESCE((SELECT SUM(worked_minutes) FROM v_time_worked w WHERE w.job_id = j.id),0)/60.0, 1) AS actual_hours,
                (SELECT COUNT(*) FROM time_entries t WHERE t.job_id = j.id AND t.status = 'open') AS on_site
         FROM jobs j WHERE ${jobScope} AND j.status IN ('in_progress','on_hold') ORDER BY j.status, j.scheduled_start`,
      )
      .all({ uid: user.id });

    let documentsToReview: unknown[] = [];
    const myPendingSignatures = db
      .prepare(
        `SELECT s.id, r.subject, d.title, r.created_at FROM signature_signers s JOIN signature_requests r ON r.id = s.request_id
         JOIN documents d ON d.id = r.document_id WHERE s.user_id = ? AND s.status IN ('pending','viewed') AND r.status IN ('sent','partially_signed')`,
      )
      .all(user.id);

    const out: Record<string, unknown> = {
      today,
      timezone: tz,
      scope: company ? "company" : "personal",
      todaysJobs,
      upcomingJobs,
      activeJobs,
      myPendingSignatures,
      myTimeOff: db
        .prepare("SELECT * FROM time_off_requests WHERE user_id = ? AND status IN ('pending','approved') AND end_date >= ? ORDER BY start_date LIMIT 5")
        .all(user.id, today),
    };

    if (!company) {
      documentsToReview = (
        db.prepare("SELECT id, title, updated_at FROM documents WHERE status = 'active' ORDER BY updated_at DESC LIMIT 50").all() as { id: number }[]
      )
        .filter((d) => canViewDocument(db, user, d.id))
        .slice(0, 5);
      out.documents = documentsToReview;
      out.myIssues = db
        .prepare("SELECT id, title, status, priority FROM maintenance_records WHERE (reported_by = ? OR assigned_to = ?) AND status NOT IN ('completed','cancelled') ORDER BY reported_at DESC LIMIT 5")
        .all(user.id, user.id);
      return res.json(out);
    }

    // ── Company-wide panels ──
    out.clockedIn = loadEntries(db, "t.status = 'open'", []).map((e) => ({
      id: e.id, user_id: e.user_id, user_name: e.user_name, job_number: e.job_number, job_name: e.job_name, job_id: e.job_id,
      clock_in_at: e.clock_in_at, worked_minutes: e.worked_minutes, on_break: e.breaks.some((b) => !b.end_at), flags: e.flags,
    }));

    out.equipmentInUse = db
      .prepare(
        `SELECT DISTINCT i.id, i.name, i.category, i.asset_number, j.id AS job_id, j.job_number, j.name AS job_name
         FROM job_equipment e JOIN inventory_items i ON i.id = e.item_id JOIN jobs j ON j.id = e.job_id
         WHERE j.status = 'in_progress' ORDER BY i.name`,
      )
      .all();

    out.maintenance = db
      .prepare(
        `SELECT m.id, m.title, m.priority, m.status, m.equipment_down, m.reported_at, i.name AS item_name
         FROM maintenance_records m LEFT JOIN inventory_items i ON i.id = m.item_id
         WHERE m.status NOT IN ('completed','cancelled')
         ORDER BY m.equipment_down DESC, CASE m.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, m.reported_at
         LIMIT 8`,
      )
      .all();
    out.maintenanceOpenCount = (db.prepare("SELECT COUNT(*) n FROM maintenance_records WHERE status NOT IN ('completed','cancelled')").get() as { n: number }).n;

    out.pendingSignatures = db
      .prepare(
        `SELECT r.id, d.id AS document_id, d.title, r.status, r.created_at,
                (SELECT COUNT(*) FROM signature_signers s WHERE s.request_id = r.id AND s.status <> 'signed') AS awaiting
         FROM signature_requests r JOIN documents d ON d.id = r.document_id WHERE r.status IN ('sent','partially_signed') ORDER BY r.created_at LIMIT 8`,
      )
      .all();

    out.absences = db
      .prepare(
        `SELECT t.id, t.type, t.start_date, t.end_date, t.status, u.first_name || ' ' || u.last_name AS user_name
         FROM time_off_requests t JOIN users u ON u.id = t.user_id
         WHERE t.status IN ('approved','pending') AND t.end_date >= ? AND t.start_date <= ? ORDER BY t.start_date LIMIT 12`,
      )
      .all(today, addDays(today, 7));
    out.pendingTimeOffCount = (db.prepare("SELECT COUNT(*) n FROM time_off_requests WHERE status = 'pending'").get() as { n: number }).n;
    out.unavailableToday = db
      .prepare(
        `SELECT u.first_name || ' ' || u.last_name AS user_name, a.note FROM availability a JOIN users u ON u.id = a.user_id
         WHERE u.status = 'active' AND a.available = 0 AND a.weekday = ?`,
      )
      .all((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7);

    out.lowStock = db
      .prepare(
        `SELECT id, name, quantity, unit, low_stock_threshold, storage_location FROM inventory_items
         WHERE status = 'active' AND low_stock_threshold IS NOT NULL AND quantity <= low_stock_threshold ORDER BY quantity / MAX(low_stock_threshold, 0.0001) LIMIT 10`,
      )
      .all();

    out.timesheetsSubmitted = (db.prepare("SELECT COUNT(*) n FROM timesheets WHERE status = 'submitted'").get() as { n: number }).n;
    out.inspectionsToReview = (db.prepare("SELECT COUNT(*) n FROM inspections WHERE status = 'submitted' AND overall_result <> 'pass'").get() as { n: number }).n;

    out.activity = db
      .prepare(
        `SELECT a.id, a.action, a.summary, a.entity_type, a.entity_id, a.created_at, u.first_name || ' ' || u.last_name AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.action NOT LIKE 'auth.%' ${can(user, "financials.view") ? "" : "AND a.action NOT IN ('user.pay_rate','payroll.export')"}
         ORDER BY a.id DESC LIMIT 15`,
      )
      .all();

    out.counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE status = 'active' AND role IN ('employee','manager')) AS employees,
           (SELECT COUNT(*) FROM users WHERE status = 'active' AND role = 'subcontractor') AS subcontractors,
           (SELECT COUNT(*) FROM jobs WHERE status IN ('new','quoted')) AS pipeline,
           (SELECT COUNT(*) FROM jobs WHERE status = 'scheduled') AS scheduled,
           (SELECT COUNT(*) FROM jobs WHERE status = 'in_progress') AS in_progress,
           (SELECT COUNT(*) FROM jobs WHERE status = 'completed') AS awaiting_invoice`,
      )
      .get();

    res.json(out);
  });

  return r;
}
