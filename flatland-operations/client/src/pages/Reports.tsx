import { Download } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, qs } from "../api";
import { Alert, Card, Empty, Field, Input, PageHeader, PageState, StatusBadge, Tabs, useAsync } from "../components/ui";
import { addDaysStr, fmtHours, fmtMoney, titleCase, todayLocal } from "../format";

type D = Record<string, any>;

function csvDownload(name: string, rows: D[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const ESTIMATE_NOTE = (
  <Alert kind="warn">
    <strong>Operational estimates — not accounting figures.</strong> Costs are built from time-clock hours × pay rates, inventory unit costs and equipment operating rates; "quoted" is the job quote, not invoiced revenue. Use your accounting system (e.g. QuickBooks) for actual profit.
  </Alert>
);

export function ReportsPage() {
  const [tab, setTab] = useState<"jobs" | "labor" | "inventory" | "maintenance">("jobs");
  const [from, setFrom] = useState(addDaysStr(todayLocal(), -29));
  const [to, setTo] = useState(todayLocal());
  const { data, loading, error } = useAsync(() => api.get<D>(`/reports/${tab}${qs({ from, to })}`), [tab, from, to]);
  const rows = (data?.rows as D[]) ?? [];
  const fin = Boolean(data?.financial);
  const sum = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Operational reporting from field records"
        actions={<button className="btn" onClick={() => csvDownload(`${tab}-${from}-to-${to}.csv`, rows)} disabled={!rows.length}><Download size={17} /> Export CSV</button>}
      />
      <Tabs tabs={[{ id: "jobs", label: "Job cost summary" }, { id: "labor", label: "Labor hours" }, { id: "inventory", label: "Inventory usage" }, { id: "maintenance", label: "Maintenance" }]} value={tab} onChange={setTab} />
      <div className="toolbar">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {fin && (tab === "jobs" || tab === "labor") && <div style={{ marginBottom: 14 }}>{ESTIMATE_NOTE}</div>}
      <PageState loading={loading && !data} error={error}>
        {() => (
          <div className="card">
            {!rows.length ? <Empty>No data for this period.</Empty> : (
              <div className="table-wrap">
                {tab === "jobs" && (
                  <table className="table responsive">
                    <thead><tr><th>Job</th><th>Status</th><th className="right">Est. hrs</th><th className="right">Actual hrs</th><th className="right">Variance</th>
                      {fin && <><th className="right">Labor</th><th className="right">Materials</th><th className="right">Equipment</th><th className="right">Total cost</th><th className="right">Quoted</th><th className="right">Est. margin</th></>}</tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td className="primary" data-label="Job"><Link to={`/jobs/${r.id}`}>#{r.job_number} {r.name}</Link><div className="muted small">{r.customer_name ?? ""} · {titleCase(r.job_type)}</div></td>
                          <td data-label="Status"><StatusBadge status={r.status} /></td>
                          <td data-label="Est. hrs" className="right">{fmtHours(r.estimated_hours)}</td>
                          <td data-label="Actual hrs" className="right">{fmtHours(r.actual_hours)}</td>
                          <td data-label="Variance" className="right" style={{ color: r.hours_variance > 0 ? "var(--amber)" : undefined }}>{r.hours_variance === null ? "—" : `${r.hours_variance > 0 ? "+" : ""}${r.hours_variance.toFixed(1)}`}</td>
                          {fin && (
                            <>
                              <td data-label="Labor" className="right">{fmtMoney(r.labor_cost_cents)}</td>
                              <td data-label="Materials" className="right">{fmtMoney(r.materials_cost_cents)}</td>
                              <td data-label="Equipment" className="right">{fmtMoney(r.equipment_cost_cents)}{r.equipment_missing_rates ? <span title="Some equipment has no operating rate" className="badge amber" style={{ marginLeft: 4 }}>!</span> : null}</td>
                              <td data-label="Total cost" className="right">{fmtMoney(r.total_cost_cents)}</td>
                              <td data-label="Quoted" className="right">{fmtMoney(r.quoted_cents)}</td>
                              <td data-label="Est. margin" className="right" style={{ fontWeight: 700, color: r.est_margin_cents < 0 ? "var(--red)" : "var(--green-700)" }}>{fmtMoney(r.est_margin_cents)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>Total</td><td /><td className="right">{fmtHours(sum("estimated_hours"))}</td><td className="right">{fmtHours(sum("actual_hours"))}</td><td />
                      {fin && <><td className="right">{fmtMoney(sum("labor_cost_cents"))}</td><td className="right">{fmtMoney(sum("materials_cost_cents"))}</td><td className="right">{fmtMoney(sum("equipment_cost_cents"))}</td><td className="right">{fmtMoney(sum("total_cost_cents"))}</td><td className="right">{fmtMoney(sum("quoted_cents"))}</td><td className="right">{fmtMoney(sum("est_margin_cents"))}</td></>}</tr></tfoot>
                  </table>
                )}
                {tab === "labor" && (
                  <table className="table responsive">
                    <thead><tr><th>Person</th><th>Role</th><th className="right">Shifts</th><th className="right">Hours</th><th className="right">Jobs</th><th className="right">% on jobs</th>{fin && <th className="right">Est. labor cost</th>}</tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td className="primary" data-label="Person"><Link to={`/team/${r.id}`}>{r.name}</Link></td>
                          <td data-label="Role">{titleCase(r.role)}</td>
                          <td data-label="Shifts" className="right">{r.shifts}</td>
                          <td data-label="Hours" className="right">{fmtHours(r.hours)}</td>
                          <td data-label="Jobs" className="right">{r.jobs}</td>
                          <td data-label="% on jobs" className="right">{r.pct_on_jobs}%</td>
                          {fin && <td data-label="Labor cost" className="right">{fmtMoney(r.labor_cost_cents)}{r.shifts_without_rate ? <span className="badge amber" title="Some shifts have no pay rate set" style={{ marginLeft: 4 }}>!</span> : null}</td>}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>Total</td><td /><td className="right">{sum("shifts")}</td><td className="right">{fmtHours(sum("hours"))}</td><td /><td />{fin && <td className="right">{fmtMoney(sum("labor_cost_cents"))}</td>}</tr></tfoot>
                  </table>
                )}
                {tab === "inventory" && (
                  <table className="table responsive">
                    <thead><tr><th>Item</th><th>Movement</th><th className="right">Quantity</th><th className="right">Entries</th>{fin && <th className="right">Value</th>}</tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td className="primary" data-label="Item"><Link to={`/inventory/${r.id}`}>{r.name}</Link></td>
                          <td data-label="Movement">{titleCase(r.type)}</td>
                          <td data-label="Quantity" className="right">{r.quantity} {r.unit}</td>
                          <td data-label="Entries" className="right">{r.movements}</td>
                          {fin && <td data-label="Value" className="right">{fmtMoney(r.value_cents)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {tab === "maintenance" && (
                  <table className="table responsive">
                    <thead><tr><th>Equipment</th><th className="right">Records</th><th className="right">Completed</th><th className="right">Labor hrs</th><th className="right">Downtime hrs</th>{fin && <><th className="right">Parts</th><th className="right">Outside</th></>}</tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td className="primary" data-label="Equipment"><Link to={`/inventory/${r.id}`}>{r.name}</Link></td>
                          <td data-label="Records" className="right">{r.records}</td>
                          <td data-label="Completed" className="right">{r.completed}</td>
                          <td data-label="Labor" className="right">{fmtHours(r.labor_hours)}</td>
                          <td data-label="Downtime" className="right">{fmtHours(r.downtime_hours)}</td>
                          {fin && <><td data-label="Parts" className="right">{fmtMoney(r.parts_cost_cents)}</td><td data-label="Outside" className="right">{fmtMoney(r.outside_cost_cents)}</td></>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </PageState>
      {tab === "jobs" && fin && <p className="muted small" style={{ marginTop: 10 }}>Equipment cost = sum of assigned equipment operating rates × the longest single crew member's hours on the job (an approximation of machine run time).</p>}
    </>
  );
}
