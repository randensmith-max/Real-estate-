import { Database, Download, History, Link2, Save, Shield } from "lucide-react";
import { useState } from "react";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Card, Field, Input, PageHeader, PageState, Select, Tabs, useAsync, useForm, useToast } from "../components/ui";
import { fmtDateTime, titleCase } from "../format";

type D = Record<string, any>;

export function SettingsPage() {
  const { can } = useAuth();
  const tabs = [
    ...(can("settings.manage") ? [{ id: "company" as const, label: "Company" }] : []),
    ...(can("audit.view") ? [{ id: "audit" as const, label: "Audit log" }] : []),
    ...(can("data.export") ? [{ id: "data" as const, label: "Backup & export" }] : []),
    ...(can("settings.manage") ? [{ id: "integrations" as const, label: "Integrations" }, { id: "roles" as const, label: "Roles & permissions" }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.id ?? "audit");
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "company" && <CompanySettings />}
      {tab === "audit" && <AuditLog />}
      {tab === "data" && <DataExport />}
      {tab === "integrations" && <Integrations />}
      {tab === "roles" && <RolesInfo />}
    </>
  );
}

function CompanySettings() {
  const toast = useToast();
  const { refresh } = useAuth();
  const { data, loading, error } = useAsync(() => api.get<D>("/admin/settings"), []);
  return (
    <PageState loading={loading} error={error}>
      {() => <CompanyForm initial={data!.settings} onSaved={() => { toast("Settings saved"); refresh(); }} />}
    </PageState>
  );
}

function CompanyForm({ initial, onSaved }: { initial: D; onSaved: () => void }) {
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone").filter((z) => z.startsWith("America/")) ?? ["America/Chicago"];
  const f = useForm({ company_name: initial.company_name ?? "", timezone: initial.timezone ?? "America/Chicago", overtime_weekly_hours: initial.overtime_weekly_hours ?? "40" });
  return (
    <Card title="Company" footer={<Button variant="primary" icon={Save} busy={f.busy} onClick={() => f.submit(async () => { await api.put("/admin/settings", f.values); onSaved(); })}>Save</Button>}>
      <div className="form" style={{ maxWidth: 560 }}>
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Field label="Company name" error={f.errors.company_name}><Input {...f.bind("company_name")} /></Field>
        <Field label="Time zone" hint="Defines days, payroll weeks (Monday–Sunday) and how times are displayed to everyone. Changing it does not alter stored punches.">
          <Select {...f.bind("timezone")}>{[...new Set([f.values.timezone, ...zones])].map((z) => <option key={z} value={z}>{z}</option>)}</Select>
        </Field>
        <Field label="Weekly overtime threshold (hours)" error={f.errors.overtime_weekly_hours}><Input type="number" min="1" max="168" {...f.bind("overtime_weekly_hours")} /></Field>
      </div>
    </Card>
  );
}

function AuditLog() {
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, loading, error } = useAsync(() => api.get<D>(`/admin/audit${qs({ action, offset, limit: 100 })}`), [action, offset]);
  return (
    <div className="stack">
      <div className="toolbar">
        <Select value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} style={{ width: 240 }}>
          <option value="">All activity</option>
          {["time.", "timesheet.", "job.", "user.", "auth.", "inventory.", "maintenance.", "document.", "inspection.", "timeoff.", "payroll.", "settings.", "data."].map((a) => <option key={a} value={a}>{titleCase(a.replace(".", ""))}</option>)}
        </Select>
      </div>
      <PageState loading={loading && !data} error={error}>
        {() => (
          <Card title={`Audit log (${data!.total})`} icon={History} flush footer={
            <div className="row between">
              <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Newer</Button>
              <span className="muted small">{offset + 1}–{Math.min(offset + 100, data!.total)} of {data!.total}</span>
              <Button size="sm" disabled={offset + 100 >= data!.total} onClick={() => setOffset(offset + 100)}>Older</Button>
            </div>
          }>
            <div className="table-wrap">
              <table className="table responsive">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Summary</th><th>Changes</th></tr></thead>
                <tbody>
                  {(data!.rows as D[]).map((r) => (
                    <tr key={r.id}>
                      <td data-label="When" className="nowrap">{fmtDateTime(r.created_at)}</td>
                      <td data-label="Who">{r.actor ?? "System"}</td>
                      <td data-label="Action" className="mono">{r.action}</td>
                      <td data-label="Summary">{r.summary}</td>
                      <td data-label="Changes" className="small mono" style={{ maxWidth: 320, wordBreak: "break-all" }}>
                        {r.changes ? Object.entries(JSON.parse(r.changes) as Record<string, unknown>).map(([k, v]) => <div key={k}>{k}: {Array.isArray(v) ? `${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}` : JSON.stringify(v)}</div>) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </PageState>
    </div>
  );
}

function DataExport() {
  const toast = useToast();
  const tables = useAsync(() => api.get<D>("/admin/export-tables"), []);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid cols-2">
      <Card title="Database backup" icon={Database}>
        <div className="stack">
          <p>The server writes an automatic backup every 24 hours. You can also create one now. Backups are consistent snapshots of the database file stored on the server.</p>
          <Alert kind="warn">Backups live on the same server as the app. Copy the backups and uploads folders to off-site storage (see docs/OPERATIONS.md).</Alert>
          <div>
            <Button variant="primary" busy={busy} onClick={async () => {
              setBusy(true);
              try { const r = await api.post<D>("/admin/backup"); toast(`Backup created: ${r.file}`); }
              catch (e) { toast((e as Error).message, "error"); }
              finally { setBusy(false); }
            }}>Back up now</Button>
          </div>
        </div>
      </Card>
      <Card title="Export data" icon={Download}>
        <div className="stack">
          <p>Download your records. Passwords and session tokens are never exported.</p>
          <a className="btn primary" href="/api/admin/export.json"><Download size={17} /> Full export (JSON)</a>
          <div className="row wrap" style={{ gap: 6 }}>
            {(tables.data?.tables as string[] | undefined)?.map((t) => <a key={t} className="btn sm" href={`/api/admin/export/${t}.csv`}>{t}.csv</a>)}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Integrations() {
  const { data, loading, error } = useAsync(() => api.get<D>("/admin/settings"), []);
  return (
    <PageState loading={loading} error={error}>
      {() => (
        <div className="grid cols-2">
          <Card title="Electronic signatures" icon={Link2}>
            <div className="stack">
              <span className={`badge ${data!.integrations.esign.configured ? "green" : "amber"}`} style={{ alignSelf: "flex-start" }}>{data!.integrations.esign.configured ? "Configured" : "Not configured"}</span>
              <p>Legally binding signatures with audit certificates require a provider such as <strong>Dropbox Sign</strong> or <strong>DocuSign</strong>. The database, document versions and signer tracking are ready; the provider adapter is Phase 3 work and needs an API account.</p>
            </div>
          </Card>
          <Card title="QuickBooks Online" icon={Link2}>
            <div className="stack">
              <span className="badge amber" style={{ alignSelf: "flex-start" }}>Not connected</span>
              <p>Phase 4. Customers, jobs (as invoices), inventory items and approved hours are structured to sync via the <code>external_refs</code> mapping table. Requires an Intuit developer app (client ID/secret) and OAuth connection by the owner.</p>
            </div>
          </Card>
        </div>
      )}
    </PageState>
  );
}

function RolesInfo() {
  const rows: [string, string, string, string, string][] = [
    ["Clock in/out, breaks", "✓", "✓", "✓", "If authorised"],
    ["View jobs", "All", "All", "Assigned", "Assigned"],
    ["Create/edit jobs, customers", "✓", "✓", "—", "—"],
    ["Correct time & approve timesheets", "✓", "✓", "—", "—"],
    ["Export payroll hours", "✓", "✓", "—", "—"],
    ["Add employees & subcontractors", "✓", "✓", "—", "—"],
    ["Add owners/managers, change roles", "✓", "—", "—", "—"],
    ["Pay rates, costs, margins", "✓", "—", "—", "—"],
    ["Inventory: view / record usage", "✓", "✓", "✓", "—"],
    ["Inventory: manage", "✓", "✓", "—", "—"],
    ["Report equipment issues", "✓", "✓", "✓", "—"],
    ["Inspections", "✓", "✓", "✓", "✓"],
    ["Documents", "All", "All", "Shared/assigned", "Shared/assigned"],
    ["Operational reports", "✓", "✓", "—", "—"],
    ["Settings, audit log, backups", "✓", "—", "—", "—"],
  ];
  return (
    <Card title="Roles & permissions" icon={Shield} flush>
      <div className="card-body"><Alert kind="info">Permissions are enforced by the server on every request — hiding a button is never the only protection.</Alert></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Capability</th><th>Owner</th><th>Manager</th><th>Employee</th><th>Subcontractor</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} style={i === 0 ? { fontWeight: 600 } : undefined}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}
