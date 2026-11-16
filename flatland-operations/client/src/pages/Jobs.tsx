import { AlertTriangle, Briefcase, CalendarDays, MapPin, Pencil, Phone, PlusCircle, Tractor, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Attachments } from "../components/Attachments";
import {
  Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, Progress, SearchBox, Select, StatusBadge, Textarea,
  useAsync, useDebounced, useForm, useToast,
} from "../components/ui";
import { centsToInput, fmtDateTime, fmtHours, fmtMoney, relative, titleCase, toLocalInput, timeZone } from "../format";

type D = Record<string, any>;
export const JOB_STATUSES = ["new", "quoted", "scheduled", "in_progress", "on_hold", "completed", "invoiced", "cancelled"];
export const JOB_TYPES = ["chopping", "farming", "hauling", "custom", "other"];

export function JobsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [type, setType] = useState("");
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/jobs${qs({ q: dq, status, type })}`), [dq, status, type]);
  const creating = params.get("new") === "1";
  const fin = can("financials.view");

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle={can("jobs.view_all") ? "All company jobs" : "Jobs assigned to you"}
        actions={can("jobs.manage") && <Button variant="primary" icon={PlusCircle} onClick={() => setParams({ new: "1" })}>Create job</Button>}
      />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search jobs, customers, addresses…" />
        <Select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 160 }}>
          <option value="">All types</option>
          {JOB_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </Select>
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {["", ...JOB_STATUSES].map((s) => (
          <button key={s || "all"} className={`chip ${status === s ? "active" : ""}`} onClick={() => setStatus(s)}>
            {s ? titleCase(s) : "All open"}
          </button>
        ))}
      </div>
      <PageState loading={loading && !data} error={error}>
        {() => (
          <div className="card">
            {data!.jobs.length ? (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Customer</th>
                      <th>Type</th>
                      <th>Scheduled</th>
                      <th>Crew</th>
                      <th>Hours</th>
                      {fin && <th className="right">Quoted</th>}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data!.jobs as D[]).map((j) => (
                      <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                        <td className="primary" data-label="Job">
                          <div style={{ fontWeight: 600 }}>{j.name}</div>
                          <div className="muted small">#{j.job_number}</div>
                        </td>
                        <td data-label="Customer">{j.customer_name ?? "—"}</td>
                        <td data-label="Type">{titleCase(j.job_type)}</td>
                        <td data-label="Scheduled" className="nowrap">{fmtDateTime(j.scheduled_start)}</td>
                        <td data-label="Crew">{j.crew ?? <span className="muted">Unassigned</span>}</td>
                        <td data-label="Hours" style={{ minWidth: 120 }}>
                          <div className="small">{fmtHours(j.actual_hours)}{j.estimated_hours ? ` / ${fmtHours(j.estimated_hours)}` : ""}</div>
                          <Progress value={j.actual_hours} max={j.estimated_hours} />
                        </td>
                        {fin && <td data-label="Quoted" className="right">{fmtMoney(j.quoted_amount_cents)}</td>}
                        <td data-label="Status"><StatusBadge status={j.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={Briefcase}>{q || status || type ? "No jobs match these filters." : "No jobs yet."}</Empty>
            )}
          </div>
        )}
      </PageState>
      {creating && (
        <JobFormModal
          onClose={() => setParams({})}
          onSaved={(id) => {
            setParams({});
            reload();
            nav(`/jobs/${id}`);
          }}
        />
      )}
    </>
  );
}

export function JobFormModal({ job, defaults, crew, equipment, onClose, onSaved }: { job?: D; defaults?: D; crew?: D[]; equipment?: D[]; onClose: () => void; onSaved: (id: number) => void }) {
  const src: D = job ?? defaults ?? {};
  const { can } = useAuth();
  const toast = useToast();
  const customers = useAsync(() => api.get<D>("/customers"), []);
  const people = useAsync(() => api.get<D>("/users/directory"), []);
  const machines = useAsync(() => (can("inventory.view") ? api.get<D>("/inventory?kind=equipment") : Promise.resolve({ items: [] })), []);
  const f = useForm({
    name: src.name ?? "",
    customer_id: src.customer_id ? String(src.customer_id) : "",
    job_type: src.job_type ?? "chopping",
    description: src.description ?? "",
    instructions: src.instructions ?? "",
    site_address: src.site_address ?? "",
    site_directions: src.site_directions ?? "",
    site_lat: src.site_lat ?? "",
    site_lng: src.site_lng ?? "",
    scheduled_start: toLocalInput(src.scheduled_start),
    scheduled_end: toLocalInput(src.scheduled_end),
    estimated_hours: src.estimated_hours ?? "",
    acres: src.acres ?? "",
    quoted_amount: centsToInput(src.quoted_amount_cents),
  });
  const [crewIds, setCrewIds] = useState<number[]>(crew?.map((c) => c.id) ?? []);
  const [equipIds, setEquipIds] = useState<number[]>(equipment?.map((e) => e.id) ?? []);
  const toggle = (list: number[], set: (v: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = () =>
    f.submit(async () => {
      const body = { ...f.values, customer_id: f.values.customer_id || null, assigned_user_ids: crewIds, equipment_ids: equipIds };
      const res = job ? await api.put<D>(`/jobs/${job.id}`, body) : await api.post<D>("/jobs", body);
      (res.warnings as string[] | undefined)?.forEach((w) => toast(w, "error"));
      toast(job ? "Job updated" : "Job created");
      onSaved(job?.id ?? res.id);
    });

  return (
    <Modal
      wide
      title={job ? `Edit job #${job.job_number}` : "Create job"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={f.busy} onClick={save}>{job ? "Save changes" : "Create job"}</Button>
        </>
      }
    >
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="form-grid">
          <Field label="Job name" error={f.errors.name} className="full">
            <Input {...f.bind("name")} placeholder="e.g. North quarter corn silage" autoFocus />
          </Field>
          <Field label="Customer" hint={<Link to="/customers?new=1" target="_blank">Add a new customer</Link>}>
            <Select {...f.bind("customer_id")}>
              <option value="">— None —</option>
              {(customers.data?.customers as D[] | undefined)?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Job type">
            <Select {...f.bind("job_type")}>
              {JOB_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label={`Scheduled start (${timeZone()})`} error={f.errors.scheduled_start}>
            <Input type="datetime-local" {...f.bind("scheduled_start")} />
          </Field>
          <Field label="Scheduled end" error={f.errors.scheduled_end}>
            <Input type="datetime-local" {...f.bind("scheduled_end")} />
          </Field>
          <Field label="Estimated hours" error={f.errors.estimated_hours}>
            <Input type="number" min="0" step="0.5" {...f.bind("estimated_hours")} />
          </Field>
          <Field label="Acres" error={f.errors.acres}>
            <Input type="number" min="0" step="0.1" {...f.bind("acres")} />
          </Field>
          {can("financials.view") && (
            <Field label="Quoted amount ($)" hint="Operational estimate only — invoices belong in accounting." error={f.errors.quoted_amount}>
              <Input type="number" min="0" step="0.01" {...f.bind("quoted_amount")} />
            </Field>
          )}
          <Field label="Job-site address" className="full">
            <Input {...f.bind("site_address")} placeholder="Road, section, or farm address" />
          </Field>
          <Field label="Latitude">
            <Input inputMode="decimal" {...f.bind("site_lat")} />
          </Field>
          <Field label="Longitude">
            <Input inputMode="decimal" {...f.bind("site_lng")} />
          </Field>
          <Field label="Directions / field location" className="full">
            <Textarea {...f.bind("site_directions")} placeholder="Gate code, which field, where to park…" />
          </Field>
          <Field label="Description" className="full">
            <Textarea {...f.bind("description")} />
          </Field>
          <Field label="Instructions for the crew" className="full">
            <Textarea {...f.bind("instructions")} placeholder="Cut height, kernel processor setting, haul destination…" />
          </Field>
        </div>
        <div className="grid cols-2">
          <Field label="Crew (employees & subcontractors)">
            <div className="card" style={{ maxHeight: 210, overflowY: "auto", padding: 8 }}>
              {(people.data?.users as D[] | undefined)?.filter((u) => u.role !== "owner" || crewIds.includes(u.id)).map((u) => (
                <label key={u.id} className="checkbox" style={{ padding: "5px 4px" }}>
                  <input type="checkbox" checked={crewIds.includes(u.id)} onChange={() => toggle(crewIds, setCrewIds, u.id)} />
                  {u.name} <span className="muted small">({titleCase(u.role)})</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Equipment">
            <div className="card" style={{ maxHeight: 210, overflowY: "auto", padding: 8 }}>
              {(machines.data?.items as D[] | undefined)?.length ? (
                (machines.data!.items as D[]).map((i) => (
                  <label key={i.id} className="checkbox" style={{ padding: "5px 4px" }}>
                    <input type="checkbox" checked={equipIds.includes(i.id)} onChange={() => toggle(equipIds, setEquipIds, i.id)} />
                    {i.name} {i.down ? <span className="badge red">down</span> : null}
                  </label>
                ))
              ) : (
                <span className="muted small">No equipment records yet. Add machines under Inventory.</span>
              )}
            </div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function JobDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/jobs/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <PageState loading={loading && !data} error={error}>
      {() => {
        const { job, crew, equipment, notes, attachments, activity, totals, warnings, documents } = data!;
        const manage = can("jobs.manage");
        const mapUrl = job.site_lat && job.site_lng
          ? `https://www.google.com/maps/search/?api=1&query=${job.site_lat},${job.site_lng}`
          : job.site_address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.site_address)}` : null;
        return (
          <>
            <PageHeader
              crumbs={<><Link to="/jobs">Jobs</Link> / #{job.job_number}</>}
              title={job.name}
              subtitle={<span className="row wrap"><StatusBadge status={job.status} /> {titleCase(job.job_type)} {job.customer_name ? `· ${job.customer_name}` : ""}</span>}
              actions={
                manage && (
                  <>
                    <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
                    <Button variant="primary" onClick={() => setStatusOpen(true)}>Change status</Button>
                  </>
                )
              }
            />
            {warnings?.length > 0 && (
              <div className="stack" style={{ marginBottom: 16 }}>
                {warnings.map((w: string, i: number) => <Alert key={i} kind="warn">{w}</Alert>)}
              </div>
            )}
            <div className="grid cols-3">
              <div className="stack span-2">
                <Card title="Details" icon={Briefcase}>
                  <dl className="kv">
                    <dt>Scheduled</dt>
                    <dd>{job.scheduled_start ? `${fmtDateTime(job.scheduled_start)}${job.scheduled_end ? ` → ${fmtDateTime(job.scheduled_end)}` : ""}` : "Not scheduled"}</dd>
                    <dt>Site</dt>
                    <dd>
                      {job.site_address ?? "—"}
                      {mapUrl && <> · <a href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={13} /> Map</a></>}
                    </dd>
                    {job.site_directions && (<><dt>Directions</dt><dd style={{ whiteSpace: "pre-wrap" }}>{job.site_directions}</dd></>)}
                    {job.acres && (<><dt>Acres</dt><dd>{job.acres}</dd></>)}
                    <dt>Description</dt>
                    <dd style={{ whiteSpace: "pre-wrap" }}>{job.description ?? "—"}</dd>
                    <dt>Crew instructions</dt>
                    <dd style={{ whiteSpace: "pre-wrap" }}>{job.instructions ?? "—"}</dd>
                    {job.quoted_amount_cents !== undefined && (<><dt>Quoted</dt><dd>{fmtMoney(job.quoted_amount_cents)} <span className="muted small">(estimate)</span></dd></>)}
                    <dt>Created</dt>
                    <dd>{fmtDateTime(job.created_at)} by {job.created_by_name ?? "—"}</dd>
                  </dl>
                </Card>
                <Card title="Hours" icon={CalendarDays}>
                  <div className="stack tight">
                    <div className="row between">
                      <span>{fmtHours(totals.actual_hours)} worked</span>
                      <span className="muted">{job.estimated_hours ? `${fmtHours(job.estimated_hours)} estimated` : "No estimate"}</span>
                    </div>
                    <Progress value={totals.actual_hours} max={job.estimated_hours} />
                  </div>
                </Card>
                <Card title="Notes" flush>
                  <div className="card-body stack">
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team…" style={{ minHeight: 60 }} />
                    <div>
                      <Button
                        size="sm"
                        variant="primary"
                        busy={saving}
                        disabled={!note.trim()}
                        onClick={async () => {
                          setSaving(true);
                          try {
                            await api.post(`/jobs/${id}/notes`, { body: note });
                            setNote("");
                            reload();
                          } catch (e) {
                            toast((e as Error).message, "error");
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        Add note
                      </Button>
                    </div>
                  </div>
                  {notes.length > 0 && (
                    <ul className="list">
                      {notes.map((n: D) => (
                        <li key={n.id} className="top" style={{ alignItems: "flex-start" }}>
                          <div className="grow">
                            <div className="small"><strong>{n.author}</strong> <span className="muted">· {relative(n.created_at)}</span></div>
                            <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Attachments entityType="job" entityId={id} items={attachments} canAdd onChange={reload} />
              </div>
              <div className="stack">
                {(job.customer_name || job.customer_phone) && (
                  <Card title="Customer" icon={Phone}>
                    <div className="stack tight">
                      {can("customers.view") ? <Link to={`/customers/${job.customer_id}`} className="title">{job.customer_name}</Link> : <strong>{job.customer_name}</strong>}
                      {job.customer_contact && <span>{job.customer_contact}</span>}
                      {job.customer_phone && <a href={`tel:${job.customer_phone}`}>{job.customer_phone}</a>}
                      {job.customer_email && <a href={`mailto:${job.customer_email}`}>{job.customer_email}</a>}
                    </div>
                  </Card>
                )}
                <Card title="Crew" icon={Users} flush>
                  {crew.length ? (
                    <ul className="list">
                      {crew.map((c: D) => (
                        <li key={c.id}>
                          {c.on_site ? <span className="live-dot" title="Clocked in on this job" /> : null}
                          <div className="grow">
                            {can("users.view") ? <Link to={`/team/${c.id}`}>{c.name}</Link> : c.name}
                            <div className="muted small">{titleCase(c.role)}</div>
                          </div>
                          <span className="mono small">{fmtHours(c.hours)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No one assigned.</Empty>
                  )}
                </Card>
                <Card title="Equipment" icon={Tractor} flush>
                  {equipment.length ? (
                    <ul className="list">
                      {equipment.map((e: D) => (
                        <li key={e.id}>
                          <div className="grow">
                            {can("inventory.view") ? <Link to={`/inventory/${e.id}`}>{e.name}</Link> : e.name}
                            <div className="muted small">{titleCase(e.category)}{e.asset_number ? ` · ${e.asset_number}` : ""}</div>
                          </div>
                          {e.down ? <span className="badge red"><AlertTriangle size={12} /> Down</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No equipment assigned.</Empty>
                  )}
                </Card>
                {documents.length > 0 && (
                  <Card title="Documents" flush>
                    <ul className="list">
                      {documents.map((d: D) => <li key={d.id}><Link to={`/documents/${d.id}`}>{d.title}</Link></li>)}
                    </ul>
                  </Card>
                )}
                <Card title="Activity" flush>
                  <div className="card-body">
                    <ul className="timeline">
                      {activity.map((a: D) => (
                        <li key={a.id}>
                          <div><strong>{a.actor ?? "System"}</strong> {a.summary}</div>
                          <div className="muted small">{fmtDateTime(a.created_at)}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
              </div>
            </div>
            {editing && <JobFormModal job={job} crew={crew} equipment={equipment} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
            {statusOpen && <StatusModal job={job} onClose={() => setStatusOpen(false)} onSaved={() => { setStatusOpen(false); reload(); }} />}
          </>
        );
      }}
    </PageState>
  );
}

function StatusModal({ job, onClose, onSaved }: { job: D; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ status: job.status as string, note: "" });
  return (
    <Modal
      title="Change job status"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.post(`/jobs/${job.id}/status`, f.values); onSaved(); })}>Save</Button></>}
    >
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="chips">
          {JOB_STATUSES.map((s) => (
            <button key={s} className={`chip ${f.values.status === s ? "active" : ""}`} onClick={() => f.set("status", s)}>{titleCase(s)}</button>
          ))}
        </div>
        <Field label="Note (optional)">
          <Textarea {...f.bind("note")} placeholder="Why the change? e.g. waiting on rain to clear" />
        </Field>
      </div>
    </Modal>
  );
}
