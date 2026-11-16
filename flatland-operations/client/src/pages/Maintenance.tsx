import { AlertTriangle, CalendarClock, Package, PlusCircle, Wrench } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Attachments } from "../components/Attachments";
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, Select, StatusBadge, Textarea, useAsync, useForm, useToast } from "../components/ui";
import { centsToInput, fmtDate, fmtDateTime, fmtMoney2, relative, titleCase } from "../format";

type D = Record<string, any>;
const STATUSES = ["open", "in_progress", "waiting_parts", "completed", "cancelled"];

export function MaintenancePage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("");
  const itemId = params.get("item_id");
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/maintenance${qs({ status, kind, item_id: itemId })}`), [status, kind, itemId]);
  const [schedule, setSchedule] = useState(false);
  const manage = can("maintenance.manage");
  return (
    <>
      <PageHeader
        title="Shop & Maintenance"
        subtitle="Equipment issues, repairs, preventative maintenance and shop projects"
        actions={
          <>
            {manage && <Button icon={CalendarClock} onClick={() => setSchedule(true)}>Recurring maintenance</Button>}
            {manage && <Button icon={PlusCircle} onClick={() => setParams({ report: "1", kind: "repair" })}>New work order</Button>}
            <Button variant="primary" icon={AlertTriangle} onClick={() => setParams({ report: "1" })}>Report issue</Button>
          </>
        }
      />
      {manage && data?.due?.length > 0 && (
        <Card title="Preventative maintenance due" icon={CalendarClock} flush className="" >
          <ul className="list">
            {(data!.due as D[]).map((s) => (
              <li key={s.id}>
                <div className="grow">
                  <div className="title">{s.item_name}: {s.title}</div>
                  <div className="muted small">
                    {s.next_due_date && `Due ${fmtDate(s.next_due_date)}`}{s.next_due_date && s.next_due_hours ? " or " : ""}{s.next_due_hours && `at ${s.next_due_hours} h (now ${s.meter_hours ?? "?"} h)`}
                  </div>
                </div>
                <StatusBadge status={s.due_state === "overdue" ? "fail" : "pending"} label={s.due_state === "overdue" ? "Overdue" : "Due soon"} />
                <Button size="sm" onClick={async () => {
                  try { const r = await api.post<D>(`/maintenance/schedules/${s.id}/work-order`); nav(`/maintenance/${r.id}`); }
                  catch (e) { toast((e as Error).message, "error"); }
                }}>Create work order</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="toolbar" style={{ marginTop: 16 }}>
        <div className="chips">
          {[["active", "Open"], ...STATUSES.map((s) => [s, titleCase(s)]), ["all", "All"]].map(([v, l]) => (
            <button key={v} className={`chip ${status === v ? "active" : ""}`} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 180 }}>
          <option value="">All types</option>
          {["issue", "repair", "preventative", "shop_project"].map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}
        </Select>
        {itemId && <Button size="sm" variant="ghost" onClick={() => setParams({})}>Clear equipment filter</Button>}
      </div>
      <PageState loading={loading && !data} error={error}>
        {() => (
          <div className="card">
            {data!.records.length ? (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Problem</th><th>Equipment</th><th>Type</th><th>Priority</th><th>Assigned</th><th>Reported</th><th>Status</th></tr></thead>
                  <tbody>
                    {(data!.records as D[]).map((m) => (
                      <tr key={m.id} className="clickable" onClick={() => nav(`/maintenance/${m.id}`)}>
                        <td className="primary" data-label="Problem">{m.title} {m.equipment_down ? <span className="badge red">Down</span> : null}</td>
                        <td data-label="Equipment">{m.item_name ?? "General"}</td>
                        <td data-label="Type">{titleCase(m.kind)}</td>
                        <td data-label="Priority"><StatusBadge status={m.priority} /></td>
                        <td data-label="Assigned">{m.assigned_to_name ?? "—"}</td>
                        <td data-label="Reported">{relative(m.reported_at)} · {m.reported_by_name}</td>
                        <td data-label="Status"><StatusBadge status={m.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty icon={Wrench}>No maintenance records here.</Empty>}
          </div>
        )}
      </PageState>
      {params.get("report") === "1" && (
        <ReportIssueModal
          kind={params.get("kind") ?? "issue"}
          itemId={params.get("item")}
          onClose={() => setParams({})}
          onSaved={(id) => { setParams({}); reload(); nav(`/maintenance/${id}`); }}
        />
      )}
      {schedule && <ScheduleModal onClose={() => setSchedule(false)} onSaved={() => { setSchedule(false); reload(); }} />}
    </>
  );
}

function ReportIssueModal({ kind, itemId, onClose, onSaved }: { kind: string; itemId: string | null; onClose: () => void; onSaved: (id: number) => void }) {
  const { can } = useAuth();
  const items = useAsync(() => api.get<D>("/inventory?kind=equipment"), []);
  const people = useAsync(() => (can("maintenance.manage") ? api.get<D>("/users/directory") : Promise.resolve({ users: [] })), []);
  const f = useForm({ item_id: itemId ?? "", kind, title: "", description: "", priority: "normal", equipment_down: false as boolean, assigned_to: "" });
  const manage = can("maintenance.manage");
  return (
    <Modal title={kind === "issue" ? "Report equipment problem" : "New work order"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => {
        const r = await api.post<D>("/maintenance", { ...f.values, item_id: f.values.item_id || null, assigned_to: f.values.assigned_to || null });
        onSaved(r.id);
      })}>Submit</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Field label="Equipment">
          <Select {...f.bind("item_id")} style={{ height: 48 }}>
            <option value="">{kind === "shop_project" ? "General shop project" : "— Choose equipment —"}</option>
            {(items.data?.items as D[] | undefined)?.map((i) => <option key={i.id} value={i.id}>{i.name}{i.asset_number ? ` (${i.asset_number})` : ""}</option>)}
          </Select>
        </Field>
        {manage && (
          <Field label="Type">
            <Select {...f.bind("kind")}>{["issue", "repair", "preventative", "shop_project"].map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}</Select>
          </Field>
        )}
        <Field label="What's wrong?" error={f.errors.title}><Input {...f.bind("title")} placeholder="e.g. Hydraulic leak at header lift cylinder" style={{ height: 48 }} /></Field>
        <Field label="Details"><Textarea {...f.bind("description")} placeholder="When did it start, what were you doing, any noises or warning lights…" /></Field>
        <Field label="How urgent?">
          <div className="chips">
            {["low", "normal", "high", "critical"].map((p) => <button key={p} className={`chip ${f.values.priority === p ? "active" : ""}`} onClick={() => f.set("priority", p)}>{titleCase(p)}</button>)}
          </div>
        </Field>
        <label className="checkbox" style={{ fontSize: 16 }}><input type="checkbox" checked={f.values.equipment_down} onChange={(e) => f.set("equipment_down", e.target.checked)} /> Machine is down / unsafe to run</label>
        {manage && (
          <Field label="Assign to">
            <Select {...f.bind("assigned_to")}>
              <option value="">— Unassigned —</option>
              {(people.data?.users as D[] | undefined)?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        )}
        <p className="muted small">You can add photos after submitting.</p>
      </div>
    </Modal>
  );
}

function ScheduleModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const items = useAsync(() => api.get<D>("/inventory?kind=equipment"), []);
  const f = useForm({ item_id: "", title: "", interval_days: "", interval_hours: "", last_done_at: "", last_done_hours: "" });
  return (
    <Modal title="Add recurring maintenance" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.post("/maintenance/schedules", { ...f.values, item_id: Number(f.values.item_id) }); onSaved(); })}>Save</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Field label="Equipment">
          <Select {...f.bind("item_id")}>
            <option value="">— Choose —</option>
            {(items.data?.items as D[] | undefined)?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </Field>
        <Field label="Task" error={f.errors.title}><Input {...f.bind("title")} placeholder="e.g. Engine oil & filter change" /></Field>
        <div className="form-grid">
          <Field label="Every N days"><Input type="number" min="1" {...f.bind("interval_days")} /></Field>
          <Field label="Every N engine hours"><Input type="number" min="1" {...f.bind("interval_hours")} /></Field>
          <Field label="Last done on"><Input type="date" {...f.bind("last_done_at")} /></Field>
          <Field label="Last done at (hours)"><Input type="number" {...f.bind("last_done_hours")} /></Field>
        </div>
        <p className="muted small">Hour-based reminders use the equipment's hour meter, which is updated from inspections and the item record.</p>
      </div>
    </Modal>
  );
}

export function MaintenanceDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/maintenance/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState(false);
  const manage = can("maintenance.manage");
  return (
    <PageState loading={loading && !data} error={error}>
      {() => {
        const { record: m, parts: used, attachments, activity } = data!;
        return (
          <>
            <PageHeader
              crumbs={<><Link to="/maintenance">Shop & Maintenance</Link> / #{m.id}</>}
              title={m.title}
              subtitle={<span className="row wrap"><StatusBadge status={m.status} /> <StatusBadge status={m.priority} /> {titleCase(m.kind)} {m.equipment_down ? <span className="badge red">Equipment down</span> : null}</span>}
              actions={manage && <><Button icon={Package} onClick={() => setParts(true)}>Use parts</Button><Button variant="primary" onClick={() => setEditing(true)}>Update</Button></>}
            />
            <div className="grid cols-3">
              <div className="stack span-2">
                <Card title="Details">
                  <dl className="kv">
                    <dt>Equipment</dt><dd>{m.item_id ? <Link to={`/inventory/${m.item_id}`}>{m.item_name}</Link> : "General shop"}</dd>
                    <dt>Reported</dt><dd>{fmtDateTime(m.reported_at)} by {m.reported_by_name}</dd>
                    <dt>Assigned to</dt><dd>{m.assigned_to_name ?? "—"}</dd>
                    <dt>Description</dt><dd style={{ whiteSpace: "pre-wrap" }}>{m.description ?? "—"}</dd>
                    <dt>Labor hours</dt><dd>{m.labor_hours}</dd>
                    {m.outside_cost_cents !== undefined && <><dt>Outside cost</dt><dd>{fmtMoney2(m.outside_cost_cents)}</dd></>}
                    <dt>Downtime</dt><dd>{m.downtime_start ? `${fmtDateTime(m.downtime_start)} → ${m.downtime_end ? fmtDateTime(m.downtime_end) : "ongoing"}` : "—"}</dd>
                    <dt>Repair notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{m.repair_notes ?? "—"}</dd>
                    {m.completed_at && <><dt>Completed</dt><dd>{fmtDateTime(m.completed_at)}</dd></>}
                    {m.inspection_id && <><dt>From inspection</dt><dd><Link to={`/inspections/${m.inspection_id}`}>View inspection</Link></dd></>}
                  </dl>
                </Card>
                <Card title="Parts used" icon={Package} flush>
                  {used.length ? <ul className="list">{used.map((p: D) => <li key={p.id}><span className="grow">{p.name}</span><span className="mono">{-p.quantity_change} {p.unit}</span></li>)}</ul> : <Empty>No parts recorded.</Empty>}
                </Card>
                <Attachments entityType="maintenance" entityId={id} items={attachments} canAdd onChange={reload} />
              </div>
              <Card title="Activity" flush>
                <div className="card-body"><ul className="timeline">{activity.map((a: D, i: number) => <li key={i}><strong>{a.actor}</strong> {a.summary}<div className="muted small">{fmtDateTime(a.created_at)}</div></li>)}</ul></div>
              </Card>
            </div>
            {editing && <UpdateModal m={m} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast("Updated"); reload(); }} />}
            {parts && <PartsModal id={id} onClose={() => setParts(false)} onSaved={() => { setParts(false); reload(); }} />}
          </>
        );
      }}
    </PageState>
  );
}

function UpdateModal({ m, onClose, onSaved }: { m: D; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const people = useAsync(() => api.get<D>("/users/directory"), []);
  const f = useForm({
    title: m.title, description: m.description ?? "", priority: m.priority, status: m.status, assigned_to: m.assigned_to ? String(m.assigned_to) : "",
    labor_hours: m.labor_hours ?? 0, outside_cost: centsToInput(m.outside_cost_cents), repair_notes: m.repair_notes ?? "", equipment_down: Boolean(m.equipment_down),
  });
  return (
    <Modal wide title="Update work order" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.put(`/maintenance/${m.id}`, { ...f.values, assigned_to: f.values.assigned_to || null }); onSaved(); })}>Save</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="form-grid">
          <Field label="Title" className="full"><Input {...f.bind("title")} /></Field>
          <Field label="Status"><Select {...f.bind("status")}>{STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <Field label="Priority"><Select {...f.bind("priority")}>{["low", "normal", "high", "critical"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <Field label="Assigned to">
            <Select {...f.bind("assigned_to")}>
              <option value="">— Unassigned —</option>
              {(people.data?.users as D[] | undefined)?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Labor hours"><Input type="number" step="0.25" min="0" {...f.bind("labor_hours")} /></Field>
          {can("financials.view") && <Field label="Outside / vendor cost ($)"><Input type="number" step="0.01" min="0" {...f.bind("outside_cost")} /></Field>}
          <label className="checkbox"><input type="checkbox" checked={f.values.equipment_down} onChange={(e) => f.set("equipment_down", e.target.checked)} /> Equipment is down</label>
          <Field label="Description" className="full"><Textarea {...f.bind("description")} /></Field>
          <Field label="Repair notes" className="full"><Textarea {...f.bind("repair_notes")} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function PartsModal({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const items = useAsync(() => api.get<D>("/inventory?kind=consumable"), []);
  const f = useForm({ item_id: "", quantity: "1" });
  const sel = (items.data?.items as D[] | undefined)?.find((i) => String(i.id) === f.values.item_id);
  return (
    <Modal title="Use parts from inventory" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.post(`/maintenance/${id}/parts`, { item_id: Number(f.values.item_id), quantity: Number(f.values.quantity) }); onSaved(); })}>Record</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Field label="Part / supply">
          <Select {...f.bind("item_id")}>
            <option value="">— Choose —</option>
            {(items.data?.items as D[] | undefined)?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit} on hand)</option>)}
          </Select>
        </Field>
        <Field label={`Quantity${sel ? ` (${sel.unit})` : ""}`}><Input type="number" step="any" min="0" {...f.bind("quantity")} /></Field>
      </div>
    </Modal>
  );
}
