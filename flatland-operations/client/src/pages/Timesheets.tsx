import { ChevronLeft, ChevronRight, Download, History, Lock, PlusCircle, Trash2, Unlock, CheckCircle2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import {
  Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, Select, StatusBadge, Tabs, Textarea, useAsync, useForm, useToast,
} from "../components/ui";
import { addDaysStr, fmtDate, fmtDateShort, fmtDateTime, fmtDay, fmtHours, fmtMinutes, fmtTime, mondayOf, timeZone, toLocalInput, todayLocal } from "../format";

type D = Record<string, any>;

function WeekPicker({ week, onChange }: { week: string; onChange: (w: string) => void }) {
  return (
    <div className="row">
      <Button className="icon" onClick={() => onChange(addDaysStr(week, -7))} aria-label="Previous week"><ChevronLeft size={18} /></Button>
      <div style={{ fontWeight: 600, minWidth: 190, textAlign: "center" }}>{fmtDateShort(week)} – {fmtDateShort(addDaysStr(week, 6))}</div>
      <Button className="icon" onClick={() => onChange(addDaysStr(week, 7))} aria-label="Next week"><ChevronRight size={18} /></Button>
      <Button size="sm" variant="ghost" onClick={() => onChange(mondayOf(todayLocal()))}>This week</Button>
    </div>
  );
}

export function TimesheetsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [week, setWeek] = useState(() => mondayOf(todayLocal()));
  const [tab, setTab] = useState<"people" | "jobs">("people");
  const { data, loading, error } = useAsync(() => api.get<D>(`/time/timesheets${qs({ week_start: week })}`), [week]);
  const byJob = useAsync(() => (tab === "jobs" ? api.get<D>(`/time/by-job${qs({ from: week, to: addDaysStr(week, 6) })}`) : Promise.resolve(null)), [week, tab]);

  const rows = (data?.rows as D[] | undefined) ?? [];
  const approved = rows.filter((r) => r.status === "approved").length;
  const total = rows.reduce((s, r) => s + r.minutes, 0);

  return (
    <>
      <PageHeader
        title="Timesheets"
        subtitle={`Review, correct and approve weekly hours · ${timeZone()}`}
        actions={
          can("payroll.export") && (
            <a className="btn" href={`/api/time/payroll-export?week_start=${week}`} onClick={(e) => { if (!approved) { e.preventDefault(); alert("No approved timesheets for this week yet."); } }}>
              <Download size={17} /> Export approved hours (CSV)
            </a>
          )
        }
      />
      <div className="toolbar"><WeekPicker week={week} onChange={setWeek} /></div>
      <Tabs tabs={[{ id: "people", label: "By employee" }, { id: "jobs", label: "By job" }]} value={tab} onChange={setTab} />
      {tab === "people" && (
        <PageState loading={loading && !data} error={error}>
          {() => (
            <>
              <div className="grid cols-3" style={{ marginBottom: 16 }}>
                <div className="card stat"><div className="stat-label">Total hours</div><div className="stat-value">{fmtHours(total / 60)}</div></div>
                <div className="card stat"><div className="stat-label">Approved</div><div className="stat-value">{approved} / {rows.filter((r) => r.entry_count).length}</div></div>
                <div className="card stat"><div className="stat-label">Need attention</div><div className="stat-value">{rows.filter((r) => r.flag_count || r.open_count).length}</div><div className="stat-note">open shifts or flagged entries</div></div>
              </div>
              <div className="card">
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Person</th><th>Shifts</th><th className="right">Hours</th><th className="right">Overtime</th><th>Flags</th><th>Status</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="clickable" onClick={() => nav(`/timesheets/${r.id}/${week}`)}>
                          <td className="primary" data-label="Person">{r.name}{r.status !== "active" && r.status !== "open" && r.status !== "submitted" && r.status !== "approved" ? "" : ""}</td>
                          <td data-label="Shifts">{r.entry_count}</td>
                          <td data-label="Hours" className="right mono">{fmtMinutes(r.minutes)}</td>
                          <td data-label="Overtime" className="right mono">{r.overtime_minutes ? fmtMinutes(r.overtime_minutes) : "—"}</td>
                          <td data-label="Flags">
                            <div className="row wrap" style={{ gap: 4 }}>
                              {r.open_count > 0 && <span className="badge green">Clocked in</span>}
                              {r.flag_count > 0 && <span className="badge red"><AlertTriangle size={12} /> {r.flag_count}</span>}
                              {r.edited_count > 0 && <span className="badge amber">{r.edited_count} edited</span>}
                              {!r.open_count && !r.flag_count && !r.edited_count && <span className="muted">—</span>}
                            </div>
                          </td>
                          <td data-label="Status">
                            <StatusBadge status={r.status} />
                            {r.approved_by_name && <div className="muted small hide-mobile">by {r.approved_by_name}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length && <Empty>No one to show.</Empty>}
              </div>
              <p className="muted small" style={{ marginTop: 10 }}>Overtime is calculated over {data!.overtimeThresholdHours} hours per week (Settings). Payroll export includes approved timesheets only.</p>
            </>
          )}
        </PageState>
      )}
      {tab === "jobs" && (
        <PageState loading={byJob.loading && !byJob.data} error={byJob.error}>
          {() => (
            <div className="card">
              <table className="table responsive">
                <thead><tr><th>Job</th><th>People</th><th className="right">Hours this week</th><th className="right">Estimate (total)</th></tr></thead>
                <tbody>
                  {(byJob.data?.rows as D[] ?? []).map((j) => (
                    <tr key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                      <td className="primary" data-label="Job">#{j.job_number} {j.name}</td>
                      <td data-label="People">{j.people}</td>
                      <td data-label="Hours" className="right mono">{fmtHours(j.hours)}</td>
                      <td data-label="Estimate" className="right mono">{fmtHours(j.estimated_hours)}</td>
                    </tr>
                  ))}
                  <tr><td className="primary" data-label="">No job selected (shop / general)</td><td /><td className="right mono" data-label="Hours">{fmtHours(byJob.data?.unassigned?.hours)}</td><td /></tr>
                </tbody>
              </table>
            </div>
          )}
        </PageState>
      )}
    </>
  );
}

export function TimesheetDetailPage() {
  const { userId, week } = useParams() as { userId: string; week: string };
  const { can, me } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/time/timesheets/${userId}/${week}`), [userId, week]);
  const [edit, setEdit] = useState<D | null>(null);
  const [adding, setAdding] = useState(false);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [reopen, setReopen] = useState(false);
  const [busy, setBusy] = useState(false);
  const editable = can("time.edit");
  const selfOk = Number(userId) !== me!.user.id || me!.user.role === "owner";

  return (
    <PageState loading={loading && !data} error={error}>
      {() => {
        const { person, entries, timesheet, history } = data!;
        const live = (entries as D[]).filter((e) => e.status !== "void");
        const total = live.reduce((s, e) => s + e.worked_minutes, 0);
        const locked = timesheet.status === "approved";
        const days: Record<string, D[]> = {};
        for (const e of entries as D[]) (days[fmtDay(e.clock_in_at)] ??= []).push(e);
        return (
          <>
            <PageHeader
              crumbs={can("time.view_all") ? <><Link to="/timesheets">Timesheets</Link> / {person.name}</> : undefined}
              title={`${person.name}`}
              subtitle={<span className="row wrap">Week of {fmtDate(week)} · <strong>{fmtMinutes(total)}</strong> <StatusBadge status={timesheet.status} />{timesheet.approved_by_name && <span className="muted small">Approved by {timesheet.approved_by_name} {fmtDateTime(timesheet.approved_at)}</span>}</span>}
              actions={
                <>
                  <Button className="icon" onClick={() => nav(`/timesheets/${userId}/${data!.prevWeek}`)}><ChevronLeft size={18} /></Button>
                  <Button className="icon" onClick={() => nav(`/timesheets/${userId}/${data!.nextWeek}`)}><ChevronRight size={18} /></Button>
                  {editable && !locked && selfOk && <Button icon={PlusCircle} onClick={() => setAdding(true)}>Add missing shift</Button>}
                  {can("timesheets.approve") && !locked && addDaysStr(week, 7) <= todayLocal() && (Number(userId) !== me!.user.id || me!.user.role === "owner") && (
                    <Button variant="primary" icon={CheckCircle2} busy={busy} onClick={async () => {
                      setBusy(true);
                      try { await api.post(`/time/timesheets/${userId}/${week}/approve`); toast("Timesheet approved"); reload(); }
                      catch (e) { toast((e as Error).message, "error"); }
                      finally { setBusy(false); }
                    }}>Approve week</Button>
                  )}
                  {can("timesheets.approve") && locked && <Button icon={Unlock} onClick={() => setReopen(true)}>Reopen</Button>}
                </>
              }
            />
            {locked && <div style={{ marginBottom: 14 }}><Alert kind="success"><Lock size={14} /> This week is approved and locked. Reopen it to make corrections.</Alert></div>}
            {!locked && addDaysStr(week, 7) > todayLocal() && can("timesheets.approve") && <div style={{ marginBottom: 14 }}><Alert kind="info">This week is still in progress. It can be approved after {fmtDateShort(addDaysStr(week, 6))}.</Alert></div>}
            {timesheet.status === "submitted" && <div style={{ marginBottom: 14 }}><Alert kind="info">Submitted by the employee {fmtDateTime(timesheet.submitted_at)}{timesheet.employee_note ? ` — "${timesheet.employee_note}"` : ""}</Alert></div>}
            <div className="card">
              {(entries as D[]).length ? (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead><tr><th>Day</th><th>In</th><th>Out</th><th>Breaks</th><th>Job</th><th className="right">Worked</th><th>Notes</th><th /></tr></thead>
                    <tbody>
                      {Object.entries(days).flatMap(([, list]) =>
                        list.map((e) => (
                          <tr key={e.id} style={e.status === "void" ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                            <td className="primary" data-label="Day">{fmtDay(e.clock_in_at)}</td>
                            <td data-label="In">{fmtTime(e.clock_in_at)}{e.source === "manual" && <span className="badge blue" style={{ marginLeft: 6 }}>manual</span>}</td>
                            <td data-label="Out">
                              {e.clock_out_at ? <>{fmtTime(e.clock_out_at)}{fmtDay(e.clock_out_at) !== fmtDay(e.clock_in_at) && <span className="muted small"> +1d</span>}</> : <span className="badge green">Open</span>}
                            </td>
                            <td data-label="Breaks">{e.break_minutes ? fmtMinutes(e.break_minutes) : "—"}</td>
                            <td data-label="Job">{e.job_number ? <Link to={`/jobs/${e.job_id}`}>#{e.job_number}</Link> : "—"}</td>
                            <td data-label="Worked" className="right mono">{e.status === "void" ? "void" : fmtMinutes(e.worked_minutes)}</td>
                            <td data-label="Notes">
                              <div className="row wrap" style={{ gap: 4 }}>
                                {e.flags.includes("missed_punch") && <span className="badge red">Missed punch?</span>}
                                {e.flags.includes("long_shift") && <span className="badge amber">Long shift</span>}
                                {e.flags.includes("open_break") && <span className="badge red">Open break</span>}
                                {e.notes && <span className="small muted">{e.notes}</span>}
                              </div>
                            </td>
                            <td className="right nowrap">
                              {e.revision_count > 0 && <Button size="sm" variant="ghost" icon={History} onClick={() => setHistoryFor(e.id)}>{e.revision_count}</Button>}
                              {editable && !locked && selfOk && e.status !== "void" && <Button size="sm" onClick={() => setEdit(e)}>Correct</Button>}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                    <tfoot><tr><td colSpan={5}>Total</td><td className="right mono">{fmtMinutes(total)}</td><td colSpan={2} /></tr></tfoot>
                  </table>
                </div>
              ) : <Empty>No shifts recorded this week.</Empty>}
            </div>
            {history.length > 0 && (
              <Card title="Timesheet history" icon={History} className="" >
                <ul className="timeline">{history.map((h: D, i: number) => <li key={i}><strong>{h.actor}</strong> {h.summary}<div className="muted small">{fmtDateTime(h.created_at)}</div></li>)}</ul>
              </Card>
            )}
            {edit && <EditEntryModal entry={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
            {adding && <AddShiftModal userId={Number(userId)} week={week} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
            {historyFor && <RevisionsModal entryId={historyFor} onClose={() => setHistoryFor(null)} />}
            {reopen && <ReopenModal userId={userId} week={week} onClose={() => setReopen(false)} onSaved={() => { setReopen(false); reload(); }} />}
          </>
        );
      }}
    </PageState>
  );
}

function useJobOptions() {
  return useAsync(() => api.get<D>("/jobs?status=all"), []);
}

type BreakRow = { start_at: string; end_at: string };

function BreaksEditor({ rows, onChange }: { rows: BreakRow[]; onChange: (r: BreakRow[]) => void }) {
  return (
    <div className="stack tight">
      {rows.map((b, i) => (
        <div key={i} className="row wrap">
          <Input type="datetime-local" value={b.start_at} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, start_at: e.target.value } : x)))} style={{ flex: 1, minWidth: 180 }} />
          <span className="muted">to</span>
          <Input type="datetime-local" value={b.end_at} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, end_at: e.target.value } : x)))} style={{ flex: 1, minWidth: 180 }} />
          <Button className="icon" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove break"><Trash2 size={16} /></Button>
        </div>
      ))}
      <div><Button size="sm" icon={PlusCircle} onClick={() => onChange([...rows, { start_at: rows.at(-1)?.end_at ?? "", end_at: "" }])}>Add break</Button></div>
    </div>
  );
}

function EditEntryModal({ entry, onClose, onSaved }: { entry: D; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const jobs = useJobOptions();
  const f = useForm({
    clock_in_at: toLocalInput(entry.clock_in_at),
    clock_out_at: toLocalInput(entry.clock_out_at),
    job_id: entry.job_id ? String(entry.job_id) : "",
    notes: entry.notes ?? "",
    reason: "",
  });
  const [breaks, setBreaks] = useState<BreakRow[]>((entry.breaks as D[]).map((b) => ({ start_at: toLocalInput(b.start_at), end_at: toLocalInput(b.end_at) })));
  const [voiding, setVoiding] = useState(false);
  return (
    <Modal
      wide
      title={`Correct shift — ${fmtDay(entry.clock_in_at)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="danger-outline" icon={Trash2} onClick={() => setVoiding(true)} style={{ marginRight: "auto" }}>Void shift</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => {
            await api.put(`/time/entries/${entry.id}`, {
              clock_in_at: f.values.clock_in_at,
              clock_out_at: f.values.clock_out_at || null,
              job_id: f.values.job_id || null,
              notes: f.values.notes,
              breaks: breaks.filter((b) => b.start_at).map((b) => ({ start_at: b.start_at, end_at: b.end_at || null })),
              reason: f.values.reason,
            });
            toast("Correction saved");
            onSaved();
          })}>Save correction</Button>
        </>
      }
    >
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Alert kind="info">Original values are preserved. Your name, the time, and the reason are recorded with this change. Times are in {timeZone()}.</Alert>
        <div className="form-grid">
          <Field label="Clock in" error={f.errors.clock_in_at}><Input type="datetime-local" {...f.bind("clock_in_at")} /></Field>
          <Field label="Clock out" error={f.errors.clock_out_at} hint={entry.status === "open" ? "Set a clock-out to close a missed punch." : undefined}><Input type="datetime-local" {...f.bind("clock_out_at")} /></Field>
          <Field label="Job" className="full">
            <Select {...f.bind("job_id")}>
              <option value="">No job (shop / general)</option>
              {(jobs.data?.jobs as D[] | undefined)?.map((j) => <option key={j.id} value={j.id}>#{j.job_number} — {j.name}</option>)}
            </Select>
          </Field>
          <Field label="Breaks" className="full"><BreaksEditor rows={breaks} onChange={setBreaks} /></Field>
          <Field label="Shift notes" className="full"><Input {...f.bind("notes")} /></Field>
          <Field label="Reason for correction (required)" error={f.errors.reason} className="full">
            <Textarea {...f.bind("reason")} placeholder="e.g. Employee forgot to clock out; confirmed end time with foreman" style={{ minHeight: 70 }} />
          </Field>
        </div>
      </div>
      {voiding && <VoidModal entryId={entry.id} onClose={() => setVoiding(false)} onDone={onSaved} />}
    </Modal>
  );
}

function VoidModal({ entryId, onClose, onDone }: { entryId: number; onClose: () => void; onDone: () => void }) {
  const f = useForm({ reason: "" });
  return (
    <Modal title="Void this shift?" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" busy={f.busy} onClick={() => f.submit(async () => { await api.post(`/time/entries/${entryId}/void`, f.values); onDone(); })}>Void shift</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <p>The shift stays in the history but no longer counts toward hours.</p>
        <Field label="Reason (required)" error={f.errors.reason}><Textarea {...f.bind("reason")} placeholder="e.g. Duplicate entry — employee clocked in twice on two phones" /></Field>
      </div>
    </Modal>
  );
}

function AddShiftModal({ userId, week, onClose, onSaved }: { userId: number; week: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const jobs = useJobOptions();
  const day = week <= todayLocal() && todayLocal() <= addDaysStr(week, 6) ? todayLocal() : week;
  const f = useForm({ clock_in_at: `${day}T07:00`, clock_out_at: `${day}T17:00`, job_id: "", notes: "", reason: "" });
  const [breaks, setBreaks] = useState<BreakRow[]>([]);
  return (
    <Modal
      wide
      title="Add missing shift"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => {
        await api.post("/time/entries", { user_id: userId, ...f.values, job_id: f.values.job_id || null, breaks: breaks.filter((b) => b.start_at && b.end_at) });
        toast("Shift added");
        onSaved();
      })}>Add shift</Button></>}
    >
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="form-grid">
          <Field label={`Clock in (${timeZone()})`} error={f.errors.clock_in_at}><Input type="datetime-local" {...f.bind("clock_in_at")} /></Field>
          <Field label="Clock out" error={f.errors.clock_out_at} hint="Overnight shifts: set the next day's date."><Input type="datetime-local" {...f.bind("clock_out_at")} /></Field>
          <Field label="Job" className="full">
            <Select {...f.bind("job_id")}>
              <option value="">No job (shop / general)</option>
              {(jobs.data?.jobs as D[] | undefined)?.map((j) => <option key={j.id} value={j.id}>#{j.job_number} — {j.name}</option>)}
            </Select>
          </Field>
          <Field label="Breaks" className="full"><BreaksEditor rows={breaks} onChange={setBreaks} /></Field>
          <Field label="Notes" className="full"><Input {...f.bind("notes")} /></Field>
          <Field label="Reason (required)" error={f.errors.reason} className="full"><Textarea {...f.bind("reason")} placeholder="e.g. Phone died — hours confirmed by foreman" style={{ minHeight: 70 }} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function RevisionsModal({ entryId, onClose }: { entryId: number; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => api.get<D>(`/time/entries/${entryId}`), [entryId]);
  const show = (field: string, v: string | null) => {
    if (v === null) return "—";
    if (field === "clock_in_at" || field === "clock_out_at") return fmtDateTime(v);
    if (field === "breaks") {
      try { return (JSON.parse(v) as D[]).map((b) => `${fmtTime(b.start_at)}–${fmtTime(b.end_at)}`).join(", ") || "none"; } catch { return v; }
    }
    if (field === "created") return "Manual entry created";
    return v;
  };
  return (
    <Modal wide title="Correction history" onClose={onClose}>
      <PageState loading={loading} error={error}>
        {() => (
          <table className="table responsive">
            <thead><tr><th>When</th><th>By</th><th>Field</th><th>Original</th><th>New</th><th>Reason</th></tr></thead>
            <tbody>
              {(data!.revisions as D[]).map((r) => (
                <tr key={r.id}>
                  <td data-label="When" className="nowrap">{fmtDateTime(r.changed_at)}</td>
                  <td data-label="By">{r.changed_by_name}</td>
                  <td data-label="Field">{r.field.replace(/_/g, " ")}</td>
                  <td data-label="Original">{show(r.field, r.old_value)}</td>
                  <td data-label="New">{r.field === "created" ? "" : show(r.field, r.new_value)}</td>
                  <td data-label="Reason">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageState>
    </Modal>
  );
}

function ReopenModal({ userId, week, onClose, onSaved }: { userId: string; week: string; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ reason: "" });
  return (
    <Modal title="Reopen approved timesheet" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.post(`/time/timesheets/${userId}/${week}/reopen`, f.values); onSaved(); })}>Reopen</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Alert kind="warn">If this week was already exported to payroll, make sure payroll is corrected too.</Alert>
        <Field label="Reason (required)" error={f.errors.reason}><Textarea {...f.bind("reason")} /></Field>
      </div>
    </Modal>
  );
}
