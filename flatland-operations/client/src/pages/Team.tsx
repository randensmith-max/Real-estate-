import { Award, KeyRound, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Attachments } from "../components/Attachments";
import {
  Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, SearchBox, Select, StatusBadge, Tabs, Textarea,
  useAsync, useDebounced, useForm, useToast,
} from "../components/ui";
import { fmtDate, fmtDateTime, fmtHours, fmtMoney2, fmtTime, initials, relative, titleCase, todayLocal } from "../format";

type D = Record<string, any>;
const EMPLOYMENT = ["full_time", "part_time", "seasonal", "contract", "on_leave", "terminated"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function TeamPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("active");
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/users${qs({ q: dq, role, status })}`), [dq, role, status]);
  const [created, setCreated] = useState<{ id: number; temporaryPassword: string; email: string } | null>(null);

  return (
    <>
      <PageHeader title="Team" subtitle="Employees, managers and subcontractors" actions={can("users.manage") && <Button variant="primary" icon={UserPlus} onClick={() => setParams({ new: "1" })}>Add person</Button>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name, email or title…" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 170 }}>
          <option value="">All roles</option>
          {["owner", "manager", "employee", "subcontractor"].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </Select>
      </div>
      <PageState loading={loading && !data} error={error}>
        {() => (
          <div className="card">
            {data!.users.length ? (
              <ul className="list">
                {(data!.users as D[]).map((u) => (
                  <li key={u.id} className="clickable" onClick={() => nav(`/team/${u.id}`)}>
                    <div className="avatar">{initials(`${u.first_name} ${u.last_name}`)}</div>
                    <div className="grow">
                      <div className="title">{u.first_name} {u.last_name}</div>
                      <div className="muted small">
                        {u.job_title ?? titleCase(u.role)}{u.company_name ? ` · ${u.company_name}` : ""} · {u.phone ?? u.email}
                      </div>
                    </div>
                    {u.clocked_in_at && <span className="badge green hide-mobile"><span className="live-dot" /> In since {fmtTime(u.clocked_in_at)}</span>}
                    <span className="badge hide-mobile">{titleCase(u.role)}</span>
                    {u.status !== "active" && <StatusBadge status={u.status} />}
                  </li>
                ))}
              </ul>
            ) : <Empty icon={Users}>No people match.</Empty>}
          </div>
        )}
      </PageState>
      {params.get("new") === "1" && (
        <PersonFormModal
          onClose={() => setParams({})}
          onSaved={(res) => {
            setParams({});
            setCreated(res);
            reload();
          }}
        />
      )}
      {created && <TempPasswordModal info={created} onClose={() => { nav(`/team/${created.id}`); setCreated(null); }} />}
    </>
  );
}

function TempPasswordModal({ info, onClose }: { info: { temporaryPassword: string; email: string }; onClose: () => void }) {
  return (
    <Modal title="Account ready" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="stack">
        <p>Give these sign-in details to the person in person or by phone. They will be asked to choose their own password the first time they sign in.</p>
        <dl className="kv">
          <dt>Email</dt><dd className="mono">{info.email}</dd>
          <dt>Temporary password</dt><dd className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{info.temporaryPassword}</dd>
        </dl>
        <Alert kind="warn">This password is shown only once. Email delivery of invitations is not configured.</Alert>
      </div>
    </Modal>
  );
}

function PersonFormModal({ person, onClose, onSaved }: { person?: D; onClose: () => void; onSaved: (res: any) => void }) {
  const { can, me } = useAuth();
  const toast = useToast();
  const self = person && person.id === me!.user.id && !can("users.manage_privileged");
  const f = useForm({
    first_name: person?.first_name ?? "", last_name: person?.last_name ?? "", email: person?.email ?? "", phone: person?.phone ?? "",
    role: person?.role ?? "employee", job_title: person?.job_title ?? "", employment_status: person?.employment_status ?? "full_time",
    hire_date: person?.hire_date ?? "", termination_date: person?.termination_date ?? "", company_name: person?.company_name ?? "", address: person?.address ?? "",
    emergency_contact_name: person?.emergency_contact_name ?? "", emergency_contact_phone: person?.emergency_contact_phone ?? "",
    emergency_contact_relation: person?.emergency_contact_relation ?? "", responsibilities: person?.responsibilities ?? "", notes: person?.notes ?? "",
    status: person?.status ?? "active", can_record_time: person ? Boolean(person.can_record_time) : true,
  });
  const roles = can("users.manage_privileged") ? ["employee", "subcontractor", "manager", "owner"] : ["employee", "subcontractor"];
  const save = () =>
    f.submit(async () => {
      const v = f.values;
      const body = self
        ? { phone: v.phone, address: v.address, emergency_contact_name: v.emergency_contact_name, emergency_contact_phone: v.emergency_contact_phone, emergency_contact_relation: v.emergency_contact_relation }
        : { ...v, can_record_time: v.role === "subcontractor" ? v.can_record_time : true };
      if (person) {
        await api.put(`/users/${person.id}`, body);
        toast("Profile saved");
        onSaved(null);
      } else {
        const res = await api.post<D>("/users", body);
        onSaved({ ...res, email: v.email });
      }
    });
  return (
    <Modal wide title={person ? "Edit profile" : "Add person"} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={save}>Save</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="form-grid">
          {!self && (
            <>
              <Field label="First name" error={f.errors.first_name}><Input {...f.bind("first_name")} /></Field>
              <Field label="Last name" error={f.errors.last_name}><Input {...f.bind("last_name")} /></Field>
              <Field label="Email (used to sign in)" error={f.errors.email}><Input type="email" {...f.bind("email")} /></Field>
            </>
          )}
          <Field label="Phone"><Input type="tel" {...f.bind("phone")} /></Field>
          {!self && (
            <>
              <Field label="Role" hint="Controls what this person can see and do.">
                <Select {...f.bind("role")}>{roles.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select>
              </Field>
              <Field label="Job title"><Input {...f.bind("job_title")} placeholder="e.g. Chopper operator" /></Field>
              <Field label="Employment status">
                <Select {...f.bind("employment_status")}>{EMPLOYMENT.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
              </Field>
              <Field label="Hire / start date"><Input type="date" {...f.bind("hire_date")} /></Field>
              {f.values.role === "subcontractor" && (
                <>
                  <Field label="Subcontractor business name"><Input {...f.bind("company_name")} /></Field>
                  <label className="checkbox"><input type="checkbox" checked={Boolean(f.values.can_record_time)} onChange={(e) => f.set("can_record_time", e.target.checked)} /> Authorised to record time</label>
                </>
              )}
              {person && (
                <Field label="Account status" hint="Inactive people cannot sign in. Their history is kept.">
                  <Select {...f.bind("status")}><option value="active">Active</option><option value="inactive">Inactive</option></Select>
                </Field>
              )}
            </>
          )}
          <Field label="Home address" className="full"><Input {...f.bind("address")} /></Field>
          <Field label="Emergency contact name"><Input {...f.bind("emergency_contact_name")} /></Field>
          <Field label="Emergency contact phone"><Input type="tel" {...f.bind("emergency_contact_phone")} /></Field>
          <Field label="Relationship"><Input {...f.bind("emergency_contact_relation")} /></Field>
          {!self && (
            <>
              <Field label="Responsibilities" className="full"><Textarea {...f.bind("responsibilities")} style={{ minHeight: 60 }} /></Field>
              <Field label="Manager notes" className="full"><Textarea {...f.bind("notes")} style={{ minHeight: 60 }} /></Field>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function PersonPage() {
  const id = Number(useParams().id);
  const { me, can } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/users/${id}`), [id]);
  const [tab, setTab] = useState<"profile" | "availability" | "training" | "timeoff" | "history" | "files" | "pay">("profile");
  const [editing, setEditing] = useState(false);
  const [reset, setReset] = useState<{ temporaryPassword: string; email: string } | null>(null);
  const isSelf = me!.user.id === id;
  const manage = can("users.manage");

  return (
    <PageState loading={loading && !data} error={error}>
      {() => {
        const { user: u, certifications, availability, timeOff, equipment, recentJobs, attachments, payRates } = data!;
        const name = `${u.first_name} ${u.last_name}`;
        const tabs = [
          { id: "profile" as const, label: "Profile" },
          { id: "availability" as const, label: "Availability" },
          { id: "training" as const, label: "Training" },
          { id: "timeoff" as const, label: "Time off" },
          { id: "history" as const, label: "Work history" },
          { id: "files" as const, label: "Documents" },
          ...(payRates ? [{ id: "pay" as const, label: "Pay" }] : []),
        ];
        return (
          <>
            <PageHeader
              crumbs={can("users.view") ? <><Link to="/team">Team</Link> / {name}</> : undefined}
              title={<span className="row"><span className="avatar lg">{initials(name)}</span> {name}</span>}
              subtitle={<span className="row wrap">{u.job_title ?? titleCase(u.role)} <span className="badge">{titleCase(u.role)}</span> <StatusBadge status={u.status} /> {u.employment_status && <span className="badge">{titleCase(u.employment_status)}</span>}</span>}
              actions={
                <>
                  {isSelf && <Link className="btn" to="/account/password"><KeyRound size={17} /> Change password</Link>}
                  {manage && !isSelf && (
                    <Button icon={KeyRound} onClick={async () => {
                      if (!confirm(`Reset ${name}'s password? They will be signed out everywhere.`)) return;
                      try {
                        const r = await api.post<D>(`/users/${id}/reset-password`);
                        setReset({ temporaryPassword: r.temporaryPassword, email: u.email });
                      } catch (e) { toast((e as Error).message, "error"); }
                    }}>Reset password</Button>
                  )}
                  {(manage || isSelf) && <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
                </>
              }
            />
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            {tab === "profile" && (
              <div className="grid cols-2">
                <Card title="Contact">
                  <dl className="kv">
                    <dt>Email</dt><dd><a href={`mailto:${u.email}`}>{u.email}</a></dd>
                    <dt>Phone</dt><dd>{u.phone ? <a href={`tel:${u.phone}`}>{u.phone}</a> : "—"}</dd>
                    <dt>Address</dt><dd>{u.address ?? "—"}</dd>
                    {u.company_name && (<><dt>Business</dt><dd>{u.company_name}</dd></>)}
                    <dt>Hire date</dt><dd>{fmtDate(u.hire_date)}</dd>
                    <dt>Last sign-in</dt><dd>{u.last_login_at ? relative(u.last_login_at) : "Never"}</dd>
                    {u.role === "subcontractor" && (<><dt>Records time</dt><dd>{u.can_record_time ? "Yes" : "No"}</dd></>)}
                  </dl>
                </Card>
                <Card title="Emergency contact">
                  <dl className="kv">
                    <dt>Name</dt><dd>{u.emergency_contact_name ?? "—"}</dd>
                    <dt>Phone</dt><dd>{u.emergency_contact_phone ? <a href={`tel:${u.emergency_contact_phone}`}>{u.emergency_contact_phone}</a> : "—"}</dd>
                    <dt>Relationship</dt><dd>{u.emergency_contact_relation ?? "—"}</dd>
                  </dl>
                </Card>
                <Card title="Responsibilities & equipment">
                  <div className="stack tight">
                    <div style={{ whiteSpace: "pre-wrap" }}>{u.responsibilities ?? <span className="muted">No responsibilities listed.</span>}</div>
                    {equipment.length > 0 && <div className="row wrap">{equipment.map((e: D) => <Link key={e.id} className="badge green" to={`/inventory/${e.id}`}>{e.name}</Link>)}</div>}
                  </div>
                </Card>
                {u.notes !== undefined && u.notes && manage && <Card title="Manager notes"><div style={{ whiteSpace: "pre-wrap" }}>{u.notes}</div></Card>}
              </div>
            )}
            {tab === "availability" && <AvailabilityEditor userId={id} rows={availability} canEdit={isSelf || manage} onSaved={reload} />}
            {tab === "training" && <Certifications userId={id} rows={certifications} canEdit={manage} onChange={reload} />}
            {tab === "timeoff" && (
              <Card title="Time-off requests" flush actions={isSelf && <Link to="/time-off">New request</Link>}>
                {timeOff.length ? (
                  <ul className="list">
                    {timeOff.map((t: D) => (
                      <li key={t.id}>
                        <div className="grow">
                          <div className="title">{titleCase(t.type)} · {fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` – ${fmtDate(t.end_date)}` : ""}</div>
                          <div className="muted small">{t.reason ?? ""}{t.reviewed_by_name ? ` · reviewed by ${t.reviewed_by_name}` : ""}</div>
                        </div>
                        <StatusBadge status={t.status} />
                      </li>
                    ))}
                  </ul>
                ) : <Empty>No time-off requests.</Empty>}
              </Card>
            )}
            {tab === "history" && (
              <Card title="Jobs worked or assigned" flush>
                {recentJobs.length ? (
                  <ul className="list">
                    {recentJobs.map((j: D) => (
                      <li key={j.id}>
                        <Link className="grow" to={`/jobs/${j.id}`}>#{j.job_number} {j.name}</Link>
                        <span className="muted small">{fmtDateTime(j.scheduled_start)}</span>
                        <span className="mono small">{fmtHours(j.gross_hours)}</span>
                        <StatusBadge status={j.status} />
                      </li>
                    ))}
                  </ul>
                ) : <Empty>No work history yet.</Empty>}
              </Card>
            )}
            {tab === "files" && <Attachments title="Employee documents" entityType="user" entityId={id} items={attachments} canAdd={manage} onChange={reload} />}
            {tab === "pay" && payRates && <PayRates userId={id} rows={payRates} onChange={reload} />}
            {editing && <PersonFormModal person={{ ...u, id }} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
            {reset && <TempPasswordModal info={reset} onClose={() => setReset(null)} />}
          </>
        );
      }}
    </PageState>
  );
}

function AvailabilityEditor({ userId, rows, canEdit, onSaved }: { userId: number; rows: D[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const init = WEEKDAYS.map((_, i) => {
    const r = rows.find((x) => x.weekday === i);
    return { weekday: i, available: r ? Boolean(r.available) : true, start_time: r?.start_time ?? "", end_time: r?.end_time ?? "", note: r?.note ?? "" };
  });
  const [days, setDays] = useState(init);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, k: string, v: unknown) => setDays((d) => d.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card
      title="Weekly availability"
      footer={canEdit && (
        <Button variant="primary" busy={busy} onClick={async () => {
          setBusy(true);
          try { await api.put(`/users/${userId}/availability`, { days }); toast("Availability saved"); onSaved(); }
          catch (e) { toast((e as Error).message, "error"); }
          finally { setBusy(false); }
        }}>Save availability</Button>
      )}
    >
      <div className="stack">
        {days.map((d, i) => (
          <div key={i} className="row wrap" style={{ gap: 12 }}>
            <label className="checkbox" style={{ width: 150 }}>
              <input type="checkbox" disabled={!canEdit} checked={d.available} onChange={(e) => upd(i, "available", e.target.checked)} />
              {WEEKDAYS[i]}
            </label>
            {d.available ? (
              <>
                <Input type="time" disabled={!canEdit} value={d.start_time} onChange={(e) => upd(i, "start_time", e.target.value)} style={{ width: 130 }} />
                <span className="muted">to</span>
                <Input type="time" disabled={!canEdit} value={d.end_time} onChange={(e) => upd(i, "end_time", e.target.value)} style={{ width: 130 }} />
              </>
            ) : <span className="badge red">Unavailable</span>}
            <Input disabled={!canEdit} placeholder="Note" value={d.note} onChange={(e) => upd(i, "note", e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          </div>
        ))}
        <p className="muted small">Leave times blank for "any time". Dates off are requested under Time Off.</p>
      </div>
    </Card>
  );
}

function Certifications({ userId, rows, canEdit, onChange }: { userId: number; rows: D[]; canEdit: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const f = useForm({ name: "", issuer: "", issued_on: "", expires_on: "", notes: "" });
  const today = todayLocal();
  return (
    <Card title="Training & certifications" icon={Award} flush actions={canEdit && <Button size="sm" onClick={() => setAdding(true)}>Add</Button>}>
      {rows.length ? (
        <ul className="list">
          {rows.map((c) => {
            const expired = c.expires_on && c.expires_on < today;
            return (
              <li key={c.id}>
                <div className="grow">
                  <div className="title">{c.name}</div>
                  <div className="muted small">{c.issuer ?? ""}{c.issued_on ? ` · issued ${fmtDate(c.issued_on)}` : ""}</div>
                </div>
                {c.expires_on && <span className={`badge ${expired ? "red" : "green"}`}>{expired ? "Expired" : "Expires"} {fmtDate(c.expires_on)}</span>}
                {canEdit && (
                  <button className="btn ghost sm icon" title="Remove" onClick={async () => {
                    if (!confirm(`Remove ${c.name}?`)) return;
                    await api.del(`/users/${userId}/certifications/${c.id}`).catch((e) => toast(e.message, "error"));
                    onChange();
                  }}><Trash2 size={14} /></button>
                )}
              </li>
            );
          })}
        </ul>
      ) : <Empty icon={Award}>No training or certifications recorded.</Empty>}
      {adding && (
        <Modal title="Add certification" onClose={() => setAdding(false)} footer={<Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.post(`/users/${userId}/certifications`, f.values); setAdding(false); onChange(); })}>Save</Button>}>
          <div className="form">
            {f.formError && <Alert kind="error">{f.formError}</Alert>}
            <Field label="Name" error={f.errors.name}><Input {...f.bind("name")} placeholder="e.g. CDL Class A, First Aid, Pesticide applicator" /></Field>
            <Field label="Issued by"><Input {...f.bind("issuer")} /></Field>
            <div className="form-grid">
              <Field label="Issued on"><Input type="date" {...f.bind("issued_on")} /></Field>
              <Field label="Expires on"><Input type="date" {...f.bind("expires_on")} /></Field>
            </div>
            <Field label="Notes"><Textarea {...f.bind("notes")} /></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function PayRates({ userId, rows, onChange }: { userId: number; rows: D[]; onChange: () => void }) {
  const f = useForm({ hourly: "", effective_from: todayLocal() });
  return (
    <Card title="Hourly pay rate (owner only)">
      <div className="stack">
        <Alert kind="info">Rates are versioned by effective date so past labor-cost reports stay accurate. Used only for estimated labor costs — payroll itself happens in your payroll system.</Alert>
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="row wrap">
          <Field label="Hourly rate ($)"><Input type="number" step="0.01" min="0" {...f.bind("hourly")} style={{ width: 140 }} /></Field>
          <Field label="Effective from"><Input type="date" {...f.bind("effective_from")} /></Field>
          <Button variant="primary" busy={f.busy} style={{ alignSelf: "flex-end" }} onClick={() => f.submit(async () => { await api.post(`/users/${userId}/pay-rates`, f.values); f.set("hourly", ""); onChange(); })}>Set rate</Button>
        </div>
        {rows.length > 0 && (
          <table className="table">
            <thead><tr><th>Effective from</th><th className="right">Hourly</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDate(r.effective_from)}</td><td className="right">{fmtMoney2(r.hourly_cents)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
