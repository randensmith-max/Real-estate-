import { CalendarDays, Check, ChevronLeft, ChevronRight, PlusCircle, X } from "lucide-react";
import { useState } from "react";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, Select, StatusBadge, Tabs, Textarea, useAsync, useForm, useToast } from "../components/ui";
import { addDaysStr, fmtDate, fmtDateShort, titleCase, todayLocal } from "../format";

type D = Record<string, any>;

export function TimeOffPage() {
  const { can } = useAuth();
  const review = can("timeoff.review");
  const [tab, setTab] = useState<"mine" | "approvals" | "calendar">(review ? "approvals" : "mine");
  const tabs = [
    ...(can("timeoff.request") ? [{ id: "mine" as const, label: "My requests" }] : []),
    ...(review ? [{ id: "approvals" as const, label: "Approvals" }, { id: "calendar" as const, label: "Team calendar" }] : []),
  ];
  return (
    <>
      <PageHeader title="Time Off & Availability" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "mine" && <MyRequests />}
      {tab === "approvals" && <Approvals />}
      {tab === "calendar" && <TeamCalendar />}
    </>
  );
}

function MyRequests() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<D>("/time-off"), []);
  const [open, setOpen] = useState(false);
  const f = useForm({ type: "vacation", start_date: todayLocal(), end_date: todayLocal(), partial_day: false as boolean, reason: "" });
  return (
    <>
      <Card title="My requests" icon={CalendarDays} flush actions={<Button variant="primary" size="sm" icon={PlusCircle} onClick={() => setOpen(true)}>Request time off</Button>}>
        <PageState loading={loading && !data} error={error}>
          {() =>
            data!.requests.length ? (
              <ul className="list">
                {(data!.requests as D[]).map((t) => (
                  <li key={t.id}>
                    <div className="grow">
                      <div className="title">{titleCase(t.type)} · {fmtDate(t.start_date)}{t.end_date !== t.start_date ? ` – ${fmtDate(t.end_date)}` : ""}{t.partial_day ? " (partial day)" : ""}</div>
                      <div className="muted small">{t.reason ?? ""}{t.review_note ? ` · Manager: ${t.review_note}` : ""}</div>
                    </div>
                    <StatusBadge status={t.status} />
                    {["pending", "approved"].includes(t.status) && t.end_date >= todayLocal() && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        if (!confirm("Cancel this request?")) return;
                        await api.post(`/time-off/${t.id}/cancel`).catch((e) => toast(e.message, "error"));
                        reload();
                      }}>Cancel</Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : <Empty icon={CalendarDays}>You have no time-off requests.</Empty>
          }
        </PageState>
      </Card>
      {open && (
        <Modal title="Request time off" onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.post("/time-off", f.values); toast("Request sent to your manager"); setOpen(false); reload(); })}>Submit request</Button></>}>
          <div className="form">
            {f.formError && <Alert kind="error">{f.formError}</Alert>}
            <Field label="Type">
              <Select {...f.bind("type")}>{["vacation", "sick", "personal", "unpaid", "other"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>
            </Field>
            <div className="form-grid">
              <Field label="First day" error={f.errors.start_date}><Input type="date" {...f.bind("start_date")} /></Field>
              <Field label="Last day" error={f.errors.end_date}><Input type="date" {...f.bind("end_date")} /></Field>
            </div>
            <label className="checkbox"><input type="checkbox" checked={f.values.partial_day} onChange={(e) => f.set("partial_day", e.target.checked)} /> Partial day</label>
            <Field label="Reason / details"><Textarea {...f.bind("reason")} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function Approvals() {
  const toast = useToast();
  const [status, setStatus] = useState("pending");
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/time-off${qs({ scope: "all", status })}`), [status]);
  const decide = async (id: number, decision: "approved" | "denied") => {
    const note = decision === "denied" ? prompt("Reason for denying (optional):") ?? undefined : undefined;
    try {
      await api.post(`/time-off/${id}/review`, { decision, note: note || null });
      toast(decision === "approved" ? "Approved" : "Denied");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <>
      <div className="chips" style={{ marginBottom: 14 }}>
        {["pending", "approved", "denied", ""].map((s) => <button key={s || "all"} className={`chip ${status === s ? "active" : ""}`} onClick={() => setStatus(s)}>{s ? titleCase(s) : "All"}</button>)}
      </div>
      <div className="card">
        <PageState loading={loading && !data} error={error}>
          {() =>
            data!.requests.length ? (
              <ul className="list">
                {(data!.requests as D[]).map((t) => (
                  <li key={t.id}>
                    <div className="grow">
                      <div className="title">{t.user_name}</div>
                      <div className="small">{titleCase(t.type)} · {fmtDateShort(t.start_date)}{t.end_date !== t.start_date ? ` – ${fmtDateShort(t.end_date)}` : ""}{t.partial_day ? " (partial)" : ""}</div>
                      {t.reason && <div className="muted small">"{t.reason}"</div>}
                      {t.reviewed_by_name && <div className="muted small">{titleCase(t.status)} by {t.reviewed_by_name}{t.review_note ? ` — ${t.review_note}` : ""}</div>}
                    </div>
                    {t.status === "pending" ? (
                      <div className="row">
                        <Button size="sm" variant="primary" icon={Check} onClick={() => decide(t.id, "approved")}>Approve</Button>
                        <Button size="sm" variant="danger-outline" icon={X} onClick={() => decide(t.id, "denied")}>Deny</Button>
                      </div>
                    ) : <StatusBadge status={t.status} />}
                  </li>
                ))}
              </ul>
            ) : <Empty icon={CalendarDays}>Nothing here.</Empty>
          }
        </PageState>
      </div>
    </>
  );
}

function TeamCalendar() {
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const first = `${month}-01`;
  const startDow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const gridStart = addDaysStr(first, -startDow);
  const gridEnd = addDaysStr(gridStart, 41);
  const { data, loading, error } = useAsync(() => api.get<D>(`/time-off/calendar${qs({ from: gridStart, to: gridEnd })}`), [gridStart]);
  const today = todayLocal();
  const shift = (n: number) => {
    const d = new Date(`${first}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`));
  return (
    <div className="stack">
      <div className="row">
        <Button className="icon" onClick={() => shift(-1)}><ChevronLeft size={18} /></Button>
        <h2 style={{ minWidth: 170, textAlign: "center" }}>{label}</h2>
        <Button className="icon" onClick={() => shift(1)}><ChevronRight size={18} /></Button>
        <span className="badge blue">Approved</span><span className="badge amber">Pending</span>
      </div>
      <PageState loading={loading && !data} error={error}>
        {() => (
          <>
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="calendar">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cal-head">{d}</div>)}
                {Array.from({ length: 42 }, (_, i) => {
                  const day = addDaysStr(gridStart, i);
                  const evs = (data!.absences as D[]).filter((a) => a.start_date <= day && a.end_date >= day);
                  return (
                    <div key={day} className={`cal-day ${day.slice(0, 7) !== month ? "other" : ""} ${day === today ? "today" : ""}`}>
                      <span className="num">{Number(day.slice(8))}</span>
                      {evs.map((e) => <div key={e.id} className={`cal-ev ${e.status === "pending" ? "pending" : ""}`} title={`${e.user_name} — ${titleCase(e.type)} (${e.status})`}>{e.user_name}</div>)}
                    </div>
                  );
                })}
              </div>
            </div>
            <Card title="Weekly availability" flush>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Person</th>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <th key={d}>{d}</th>)}</tr></thead>
                  <tbody>
                    {(data!.people as D[]).map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>{p.name}</td>
                        {Array.from({ length: 7 }, (_, wd) => {
                          const a = (data!.availability as D[]).find((x) => x.user_id === p.id && x.weekday === wd);
                          if (!a) return <td key={wd} className="muted small">—</td>;
                          return <td key={wd} className="small">{a.available ? (a.start_time ? `${a.start_time}–${a.end_time ?? ""}` : <span className="badge green">Yes</span>) : <span className="badge red">Off</span>}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </PageState>
    </div>
  );
}
