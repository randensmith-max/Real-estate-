import { Router } from "express";
import type { DB } from "../db/db.js";
import { requirePerm } from "../lib/auth.js";
import { can } from "../lib/permissions.js";
import { addDays, companyTz, dayRange, nowIso, todayIn } from "../lib/time.js";
import { isoDate } from "../lib/validate.js";

/**
 * Operational reporting. These numbers are ESTIMATES built from field records
 * (time clock, quotes, inventory costs). They are not accounting figures and are
 * labelled as such in the UI. Official financials belong in the accounting system.
 */
export function reportRoutes(db: DB) {
  const r = Router();

  function range(q: Record<string, unknown>) {
    const tz = companyTz(db);
    const to = q.to ? isoDate.parse(q.to) : todayIn(tz);
    const from = q.from ? isoDate.parse(q.from) : addDays(to, -29);
    return { from, to, start: dayRange(from, tz).start, end: dayRange(to, tz).end };
  }

  // Pay rate in effect on the shift date.
  const RATE = `(SELECT p.hourly_cents FROM pay_rates p WHERE p.user_id = w.user_id AND p.effective_from <= substr(w.clock_in_at, 1, 10)
                 ORDER BY p.effective_from DESC LIMIT 1)`;

  r.get("/labor", requirePerm("reports.operational"), (req, res) => {
    const { from, to, start, end } = range(req.query);
    const fin = can(req.user!, "financials.view");
    const rows = db
      .prepare(
        `SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.role,
                ROUND(SUM(w.worked_minutes)/60.0, 2) AS hours,
                COUNT(DISTINCT w.job_id) AS jobs,
                COUNT(*) AS shifts,
                ROUND(SUM(CASE WHEN w.job_id IS NOT NULL THEN w.worked_minutes ELSE 0 END) * 100.0 / MAX(SUM(w.worked_minutes), 1), 1) AS pct_on_jobs
                ${fin ? `, ROUND(SUM(w.worked_minutes / 60.0 * COALESCE(${RATE}, 0))) AS labor_cost_cents,
                           SUM(CASE WHEN ${RATE} IS NULL THEN 1 ELSE 0 END) AS shifts_without_rate` : ""}
         FROM v_time_worked w JOIN users u ON u.id = w.user_id
         WHERE w.clock_in_at >= ? AND w.clock_in_at < ?
         GROUP BY u.id ORDER BY hours DESC`,
      )
      .all(start, end);
    res.json({ from, to, rows, financial: fin });
  });

  r.get("/jobs", requirePerm("reports.operational"), (req, res) => {
    const { from, to, start, end } = range(req.query);
    const fin = can(req.user!, "financials.view");
    // Jobs with activity or completion in range.
    const jobs = db
      .prepare(
        `SELECT j.id, j.job_number, j.name, j.status, j.job_type, j.estimated_hours, j.quoted_amount_cents, j.completed_at, j.acres,
                c.name AS customer_name
         FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
         WHERE j.status <> 'cancelled' AND (
           j.id IN (SELECT job_id FROM v_time_worked WHERE clock_in_at >= ? AND clock_in_at < ? AND job_id IS NOT NULL)
           OR (j.completed_at >= ? AND j.completed_at < ?)
           OR (j.scheduled_start >= ? AND j.scheduled_start < ?))
         ORDER BY j.scheduled_start DESC`,
      )
      .all(start, end, start, end, start, end) as {
      id: number; job_number: string; name: string; status: string; job_type: string; estimated_hours: number | null;
      quoted_amount_cents: number | null; completed_at: string | null; customer_name: string | null; acres: number | null;
    }[];

    const laborStmt = db.prepare(
      `SELECT ROUND(COALESCE(SUM(w.worked_minutes),0)/60.0, 2) AS hours,
              ROUND(COALESCE(SUM(w.worked_minutes / 60.0 * COALESCE(${RATE}, 0)), 0)) AS cost,
              COALESCE(MAX(per_user.h), 0) AS longest
       FROM v_time_worked w,
            (SELECT MAX(s) AS h FROM (SELECT SUM(worked_minutes)/60.0 AS s FROM v_time_worked WHERE job_id = @id GROUP BY user_id)) per_user
       WHERE w.job_id = @id`,
    );
    const materialsStmt = db.prepare(
      `SELECT ROUND(COALESCE(SUM(-m.quantity_change * COALESCE(m.unit_cost_cents, 0)), 0)) AS cost
       FROM inventory_movements m WHERE m.job_id = ? AND m.type = 'usage'`,
    );
    const equipStmt = db.prepare(
      `SELECT COALESCE(SUM(COALESCE(i.hourly_cost_cents, 0)), 0) AS rate, COUNT(*) AS n,
              SUM(CASE WHEN i.hourly_cost_cents IS NULL THEN 1 ELSE 0 END) AS missing
       FROM job_equipment e JOIN inventory_items i ON i.id = e.item_id WHERE e.job_id = ?`,
    );

    const rows = jobs.map((j) => {
      const labor = laborStmt.get({ id: j.id }) as { hours: number; cost: number; longest: number };
      const base = {
        id: j.id, job_number: j.job_number, name: j.name, status: j.status, job_type: j.job_type, customer_name: j.customer_name,
        estimated_hours: j.estimated_hours, actual_hours: labor.hours,
        hours_variance: j.estimated_hours !== null ? Math.round((labor.hours - j.estimated_hours) * 100) / 100 : null,
        completed_at: j.completed_at, acres: j.acres,
      };
      if (!fin) return base;
      const materials = (materialsStmt.get(j.id) as { cost: number }).cost;
      const eq = equipStmt.get(j.id) as { rate: number; n: number; missing: number };
      // Equipment hours are estimated as the longest single crew member's hours on the job.
      const equipment = Math.round(eq.rate * labor.longest);
      const cost = labor.cost + materials + equipment;
      return {
        ...base,
        quoted_cents: j.quoted_amount_cents,
        labor_cost_cents: labor.cost,
        materials_cost_cents: materials,
        equipment_cost_cents: equipment,
        total_cost_cents: cost,
        est_margin_cents: j.quoted_amount_cents !== null ? j.quoted_amount_cents - cost : null,
        equipment_missing_rates: eq.missing,
      };
    });
    res.json({ from, to, rows, financial: fin });
  });

  r.get("/inventory", requirePerm("reports.operational"), (req, res) => {
    const { from, to, start, end } = range(req.query);
    const fin = can(req.user!, "financials.view");
    const rows = db
      .prepare(
        `SELECT i.id, i.name, i.kind, i.category, i.unit, m.type,
                ROUND(SUM(ABS(m.quantity_change)), 3) AS quantity, COUNT(*) AS movements
                ${fin ? ", ROUND(SUM(ABS(m.quantity_change) * COALESCE(m.unit_cost_cents, 0))) AS value_cents" : ""}
         FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
         WHERE m.created_at >= ? AND m.created_at < ? AND m.type <> 'transfer'
         GROUP BY i.id, m.type ORDER BY i.name, m.type`,
      )
      .all(start, end);
    res.json({ from, to, rows, financial: fin });
  });

  r.get("/maintenance", requirePerm("reports.operational"), (req, res) => {
    const { from, to, start, end } = range(req.query);
    const fin = can(req.user!, "financials.view");
    const now = nowIso();
    const rows = db
      .prepare(
        `SELECT i.id, i.name, i.category, COUNT(m.id) AS records,
                SUM(CASE WHEN m.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                ROUND(SUM(m.labor_hours), 2) AS labor_hours,
                ROUND(SUM(CASE WHEN m.downtime_start IS NOT NULL THEN
                  (julianday(MIN(COALESCE(m.downtime_end, @now), @end)) - julianday(MAX(m.downtime_start, @start))) * 24 ELSE 0 END), 1) AS downtime_hours
                ${fin ? `, SUM(m.outside_cost_cents) AS outside_cost_cents,
                  (SELECT ROUND(COALESCE(SUM(-mv.quantity_change * COALESCE(mv.unit_cost_cents,0)),0)) FROM inventory_movements mv
                    JOIN maintenance_records mm ON mm.id = mv.maintenance_id WHERE mm.item_id = i.id AND mv.created_at >= @start AND mv.created_at < @end) AS parts_cost_cents` : ""}
         FROM maintenance_records m JOIN inventory_items i ON i.id = m.item_id
         WHERE m.reported_at < @end AND COALESCE(m.completed_at, @now) >= @start
         GROUP BY i.id ORDER BY records DESC`,
      )
      .all({ start, end, now });
    res.json({ from, to, rows, financial: fin });
  });

  return r;
}
