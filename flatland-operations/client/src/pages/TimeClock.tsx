import { Coffee, LogIn, LogOut, Play, Repeat, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Card, Empty, Field, Modal, PageHeader, PageState, Select, StatusBadge, Textarea, useAsync, useToast } from "../components/ui";
import { fmtDateShort, fmtDay, fmtMinutes, fmtTime, timeZone } from "../format";

type D = Record<string, any>;

function useTick(ms = 30_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Live minutes for an open shift, computed client-side so the counter ticks without polling. */
function liveMinutes(cur: D | null) {
  if (!cur) return 0;
  const now = Date.now();
  const gross = (now - Date.parse(cur.clock_in_at)) / 60000;
  const br = (cur.breaks as D[]).reduce((s, b) => s + ((b.end_at ? Date.parse(b.end_at) : now) - Date.parse(b.start_at)) / 60000, 0);
  return Math.max(0, gross - br);
}

export function ClockWidget({ compact }: { compact?: boolean }) {
  useTick();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get<D>("/time/me"), []);
  const [jobId, setJobId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outOpen, setOutOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  useEffect(() => {
    if (data && !jobId) {
      const inProgress = (data.jobs as D[]).find((j) => j.status === "in_progress") ?? (data.jobs as D[])[0];
      if (inProgress && !data.current) setJobId(String(inProgress.id));
    }
  }, [data, jobId]);

  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      toast(msg);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert kind="error">{error}</Alert>;
  if (loading && !data) return <Card><div className="loading"><div className="spinner" /></div></Card>;
  const cur = data!.current as D | null;
  const live = liveMinutes(cur);
  const closedToday = (data!.todayMinutes as number) - (cur ? cur.worked_minutes : 0);
  const closedWeek = (data!.weekMinutes as number) - (cur ? cur.worked_minutes : 0);
  const jobs = data!.jobs as D[];

  return (
    <Card>
      <div className="stack">
        <div className="row between wrap">
          <div className="row">
            {cur ? <span className="live-dot" /> : <span className="dot" style={{ color: "#b6bfba" }} />}
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>
                {cur ? (cur.on_break ? "On break" : "Clocked in") : "Not clocked in"}
              </div>
              <div className="muted small">
                {cur ? `Since ${fmtTime(cur.clock_in_at)}${cur.job ? ` · #${cur.job.job_number} ${cur.job.name}` : " · No job selected"}` : `Times shown in ${timeZone()}`}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 22 }}>
            <div>
              <div className="stat-label">Today</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtMinutes(closedToday + live)}</div>
            </div>
            <div>
              <div className="stat-label">This week</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtMinutes(closedWeek + live)}</div>
            </div>
          </div>
        </div>

        {err && <Alert kind="error">{err}</Alert>}

        {!cur ? (
          <>
            <Field label="Job" hint={jobs.length ? undefined : "You have no assigned jobs right now — you can still clock in for shop or general work."}>
              <Select value={jobId} onChange={(e) => setJobId(e.target.value)} style={{ height: 50, fontSize: 16 }}>
                <option value="">No job (shop / general work)</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    #{j.job_number} — {j.name}
                    {j.customer_name ? ` (${j.customer_name})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <button
              className="clock-btn in"
              disabled={busy}
              onClick={() =>
                act(
                  () => api.post("/time/clock-in", { job_id: jobId || null, device_tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
                  "Clocked in",
                )
              }
            >
              <LogIn size={34} /> CLOCK IN
            </button>
          </>
        ) : (
          <>
            <button className="clock-btn out" disabled={busy} onClick={() => setOutOpen(true)}>
              <LogOut size={34} /> CLOCK OUT
            </button>
            <div className="grid cols-2">
              {cur.on_break ? (
                <Button size="lg" icon={Play} busy={busy} onClick={() => act(() => api.post("/time/break/end"), "Break ended")}>
                  End break
                </Button>
              ) : (
                <Button size="lg" icon={Coffee} busy={busy} onClick={() => act(() => api.post("/time/break/start"), "Break started")}>
                  Start break
                </Button>
              )}
              <Button size="lg" icon={Repeat} onClick={() => setSwitchOpen(true)}>
                Change job
              </Button>
            </div>
          </>
        )}
        {compact && (
          <Link to="/clock" className="small">
            View my hours this week →
          </Link>
        )}
      </div>

      {outOpen && <ClockOutModal onClose={() => setOutOpen(false)} onDone={() => act(async () => undefined, "Clocked out")} minutes={live} />}
      {switchOpen && (
        <Modal
          title="Change job"
          onClose={() => setSwitchOpen(false)}
          footer={
            <Button
              variant="primary"
              onClick={() => {
                setSwitchOpen(false);
                act(() => api.post("/time/switch-job", { job_id: jobId || null }), "Job updated");
              }}
            >
              Save
            </Button>
          }
        >
          <Field label="Job for this shift" hint="If you moved to a different job, a manager may split the shift for accurate job costing.">
            <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">No job (shop / general work)</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>#{j.job_number} — {j.name}</option>
              ))}
            </Select>
          </Field>
        </Modal>
      )}
    </Card>
  );
}

function ClockOutModal({ onClose, onDone, minutes }: { onClose: () => void; onDone: () => void; minutes: number }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      title="Clock out?"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            size="lg"
            icon={LogOut}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post("/time/clock-out", { notes: notes || null });
                onClose();
                onDone();
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Clock out
          </Button>
        </>
      }
    >
      <div className="stack">
        {err && <Alert kind="error">{err}</Alert>}
        <p>
          You've worked <strong>{fmtMinutes(minutes)}</strong> this shift.
        </p>
        <Field label="Notes (optional)" hint="Anything your manager should know — acres finished, problems, etc.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function TimeClockPage() {
  const { me } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<D>("/time/me"), []);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeader title="Time Clock" subtitle={`All times in ${timeZone()}`} />
      <div className="stack">
        <ClockWidget />
        <PageState loading={loading} error={error}>
          {() => (
            <Card
              title={`This week (from ${fmtDateShort(data!.weekStart)})`}
              flush
              actions={
                <>
                  <StatusBadge status={data!.timesheetStatus} />
                  {data!.timesheetStatus === "open" && data!.weekEntries.length > 0 && (
                    <Button
                      size="sm"
                      icon={Send}
                      busy={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.post(`/time/timesheets/${me!.user.id}/${data!.weekStart}/submit`, {});
                          toast("Timesheet submitted for approval");
                          reload();
                        } catch (e) {
                          toast((e as Error).message, "error");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Submit hours
                    </Button>
                  )}
                </>
              }
            >
              {data!.weekEntries.length ? (
                <div className="table-wrap">
                  <table className="table responsive">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>In</th>
                        <th>Out</th>
                        <th>Job</th>
                        <th>Breaks</th>
                        <th className="right">Worked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data!.weekEntries as D[]).map((e) => (
                        <tr key={e.id}>
                          <td className="primary" data-label="Day">{fmtDay(e.clock_in_at)}</td>
                          <td data-label="In">{fmtTime(e.clock_in_at)}</td>
                          <td data-label="Out">
                            {e.clock_out_at ? fmtTime(e.clock_out_at) : <StatusBadge status="in_progress" label="Working" />}
                            {e.clock_out_at && fmtDay(e.clock_out_at) !== fmtDay(e.clock_in_at) ? " (+1 day)" : ""}
                          </td>
                          <td data-label="Job">{e.job_number ? `#${e.job_number}` : "—"}</td>
                          <td data-label="Breaks">{e.break_minutes ? fmtMinutes(e.break_minutes) : "—"}</td>
                          <td data-label="Worked" className="right mono">
                            {fmtMinutes(e.worked_minutes)}
                            {e.revision_count > 0 && <span className="badge amber" style={{ marginLeft: 6 }}>edited</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No hours recorded this week yet.</Empty>
              )}
            </Card>
          )}
        </PageState>
        <p className="muted small">
          Something wrong with your hours? Ask a manager to correct it — every correction is recorded with a reason and visible on your timesheet.
        </p>
      </div>
    </>
  );
}
