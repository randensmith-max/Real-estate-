import {
  Activity,
  AlertTriangle,
  Boxes,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FilePlus2,
  FileSignature,
  PackagePlus,
  PlusCircle,
  Tractor,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Card, Empty, PageHeader, PageState, Progress, StatusBadge, useAsync } from "../components/ui";
import { fmtDate, fmtDateShort, fmtHours, fmtMinutes, fmtTime, relative, titleCase } from "../format";
import { ClockWidget } from "./TimeClock";

type D = Record<string, any>;

export function QuickActions() {
  const { can } = useAuth();
  const nav = useNavigate();
  const actions = [
    { label: "Create Job", icon: PlusCircle, to: "/jobs?new=1", show: can("jobs.manage") },
    { label: "Clock In", icon: Clock, to: "/clock", show: can("time.clock") },
    { label: "Add Employee", icon: UserPlus, to: "/team?new=1", show: can("users.manage") },
    { label: "Add Inventory", icon: PackagePlus, to: "/inventory?new=1", show: can("inventory.manage") },
    { label: "Upload Document", icon: FilePlus2, to: "/documents?new=1", show: can("documents.manage") },
    { label: "Create Inspection", icon: ClipboardCheck, to: "/inspections/new", show: can("inspections.perform") },
    { label: "Report Equipment Issue", icon: AlertTriangle, to: "/maintenance?report=1", show: can("maintenance.report") },
  ].filter((a) => a.show);
  return (
    <div className="quick-actions">
      {actions.map((a) => (
        <button key={a.label} className="quick-action" onClick={() => nav(a.to)}>
          <a.icon size={22} />
          {a.label}
        </button>
      ))}
    </div>
  );
}

function JobRow({ j }: { j: D }) {
  const nav = useNavigate();
  return (
    <li className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
      <div className="grow">
        <div className="title">{j.name}</div>
        <div className="muted small">
          #{j.job_number} · {j.customer_name ?? "No customer"} {j.scheduled_start ? `· ${fmtTime(j.scheduled_start)}` : ""}
          {j.crew ? ` · ${j.crew}` : ""}
        </div>
      </div>
      <StatusBadge status={j.status} />
    </li>
  );
}

export function DashboardPage() {
  const { me, can } = useAuth();
  const { data, loading, error } = useAsync(() => api.get<D>("/dashboard"), []);
  const first = me!.user.first_name;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader title={`${greet}, ${first}`} subtitle={data ? fmtDate(data.today) : undefined} />
      <PageState loading={loading} error={error}>
        {() =>
          data!.scope === "company" ? <CompanyDashboard d={data!} canClock={can("time.clock")} /> : <PersonalDashboard d={data!} canClock={can("time.clock")} />
        }
      </PageState>
    </>
  );
}

function PersonalDashboard({ d, canClock }: { d: D; canClock: boolean }) {
  return (
    <div className="stack">
      {canClock && <ClockWidget compact />}
      <QuickActions />
      <div className="grid cols-2">
        <Card title="My jobs today" icon={Briefcase} flush>
          {d.todaysJobs.length ? <ul className="list">{d.todaysJobs.map((j: D) => <JobRow key={j.id} j={j} />)}</ul> : <Empty icon={Briefcase}>No jobs scheduled for you today.</Empty>}
        </Card>
        <Card title="Coming up" icon={CalendarDays} flush>
          {d.upcomingJobs.length ? (
            <ul className="list">
              {d.upcomingJobs.map((j: D) => (
                <JobRow key={j.id} j={{ ...j, scheduled_start: null, crew: j.scheduled_start ? fmtDateShort(j.scheduled_start) : "Not scheduled" }} />
              ))}
            </ul>
          ) : (
            <Empty>Nothing else assigned yet.</Empty>
          )}
        </Card>
        {d.myPendingSignatures.length > 0 && (
          <Card title="Waiting for your signature" icon={FileSignature} flush>
            <ul className="list">
              {d.myPendingSignatures.map((s: D) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="My time off" icon={CalendarDays} flush actions={<Link to="/time-off">Request</Link>}>
          {d.myTimeOff.length ? (
            <ul className="list">
              {d.myTimeOff.map((t: D) => (
                <li key={t.id}>
                  <div className="grow">
                    {titleCase(t.type)} · {fmtDate(t.start_date)}
                    {t.end_date !== t.start_date ? ` – ${fmtDate(t.end_date)}` : ""}
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No upcoming time off.</Empty>
          )}
        </Card>
        {d.myIssues?.length > 0 && (
          <Card title="Equipment issues I reported" icon={Wrench} flush>
            <ul className="list">
              {d.myIssues.map((m: D) => (
                <li key={m.id}>
                  <Link className="grow" to={`/maintenance/${m.id}`}>{m.title}</Link>
                  <StatusBadge status={m.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {d.documents?.length > 0 && (
          <Card title="My documents" icon={FileSignature} flush>
            <ul className="list">
              {d.documents.map((doc: D) => (
                <li key={doc.id}>
                  <Link to={`/documents/${doc.id}`}>{doc.title}</Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function CompanyDashboard({ d, canClock }: { d: D; canClock: boolean }) {
  const nav = useNavigate();
  const c = d.counts;
  return (
    <div className="stack">
      <QuickActions />
      <div className="grid cols-4">
        <div className="card stat">
          <div className="stat-label">Clocked in now</div>
          <div className="stat-value">{d.clockedIn.length}</div>
          <div className="stat-note">of {c.employees + c.subcontractors} active people</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Jobs in progress</div>
          <div className="stat-value">{c.in_progress}</div>
          <div className="stat-note">{c.scheduled} scheduled · {c.pipeline} new/quoted</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Open maintenance</div>
          <div className="stat-value">{d.maintenanceOpenCount}</div>
          <div className="stat-note">{d.maintenance.filter((m: D) => m.equipment_down).length} machine(s) down</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Needs approval</div>
          <div className="stat-value">{d.timesheetsSubmitted + d.pendingTimeOffCount}</div>
          <div className="stat-note">{d.timesheetsSubmitted} timesheets · {d.pendingTimeOffCount} time off</div>
        </div>
      </div>

      {canClock && <ClockWidget compact />}

      <div className="grid cols-2">
        <Card title="Clocked in now" icon={Users} flush actions={<Link to="/timesheets">Timesheets</Link>}>
          {d.clockedIn.length ? (
            <ul className="list">
              {d.clockedIn.map((e: D) => (
                <li key={e.id}>
                  <span className="live-dot" />
                  <div className="grow">
                    <div className="title">{e.user_name}</div>
                    <div className="muted small">
                      since {fmtTime(e.clock_in_at)} · {e.job_number ? `#${e.job_number} ${e.job_name}` : "No job selected"}
                    </div>
                  </div>
                  {e.flags.includes("missed_punch") && <StatusBadge status="fail" label="Missed punch?" />}
                  {e.on_break && <StatusBadge status="pending" label="On break" />}
                  <span className="mono">{fmtMinutes(e.worked_minutes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Clock}>Nobody is clocked in.</Empty>
          )}
        </Card>

        <Card title="Today's jobs" icon={CalendarDays} flush actions={<Link to="/jobs">All jobs</Link>}>
          {d.todaysJobs.length ? <ul className="list">{d.todaysJobs.map((j: D) => <JobRow key={j.id} j={j} />)}</ul> : <Empty icon={Briefcase}>No jobs scheduled today.</Empty>}
        </Card>

        <Card title="Active jobs" icon={Briefcase} flush>
          {d.activeJobs.length ? (
            <ul className="list">
              {d.activeJobs.map((j: D) => (
                <li key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                  <div className="grow stack tight">
                    <div className="row between">
                      <span className="title">{j.name}</span>
                      <StatusBadge status={j.status} />
                    </div>
                    <Progress value={j.actual_hours} max={j.estimated_hours} />
                    <div className="muted small">
                      {fmtHours(j.actual_hours)} worked{j.estimated_hours ? ` of ${fmtHours(j.estimated_hours)} estimated` : ""}
                      {j.on_site ? ` · ${j.on_site} on site` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No jobs in progress.</Empty>
          )}
        </Card>

        <Card title="Equipment in use" icon={Tractor} flush actions={<Link to="/inventory?kind=equipment">Equipment</Link>}>
          {d.equipmentInUse.length ? (
            <ul className="list">
              {d.equipmentInUse.map((i: D) => (
                <li key={`${i.id}-${i.job_id}`}>
                  <Link className="grow title" to={`/inventory/${i.id}`}>{i.name}</Link>
                  <Link className="muted small" to={`/jobs/${i.job_id}`}>#{i.job_number}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Tractor}>No equipment on active jobs.</Empty>
          )}
        </Card>

        <Card title="Maintenance needed" icon={Wrench} flush actions={<Link to="/maintenance">Shop</Link>}>
          {d.maintenance.length ? (
            <ul className="list">
              {d.maintenance.map((m: D) => (
                <li key={m.id} className="clickable" onClick={() => nav(`/maintenance/${m.id}`)}>
                  <div className="grow">
                    <div className="title">{m.title}</div>
                    <div className="muted small">{m.item_name ?? "General"} · reported {relative(m.reported_at)}</div>
                  </div>
                  {m.equipment_down ? <StatusBadge status="fail" label="Down" /> : null}
                  <StatusBadge status={m.priority} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Wrench}>No open maintenance.</Empty>
          )}
        </Card>

        <Card title="Inventory alerts" icon={Boxes} flush actions={<Link to="/inventory?low=1">Low stock</Link>}>
          {d.lowStock.length ? (
            <ul className="list">
              {d.lowStock.map((i: D) => (
                <li key={i.id} className="clickable" onClick={() => nav(`/inventory/${i.id}`)}>
                  <div className="grow">
                    <div className="title">{i.name}</div>
                    <div className="muted small">{i.storage_location ?? "No location"}</div>
                  </div>
                  <StatusBadge status="fail" label={`${i.quantity} ${i.unit} (min ${i.low_stock_threshold})`} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Boxes}>Stock levels are fine.</Empty>
          )}
        </Card>

        <Card title="Availability & absences (next 7 days)" icon={CalendarDays} flush actions={<Link to="/time-off">Calendar</Link>}>
          {d.absences.length || d.unavailableToday.length ? (
            <ul className="list">
              {d.absences.map((a: D) => (
                <li key={a.id}>
                  <div className="grow">
                    <div className="title">{a.user_name}</div>
                    <div className="muted small">
                      {titleCase(a.type)} · {fmtDateShort(a.start_date)}
                      {a.end_date !== a.start_date ? ` – ${fmtDateShort(a.end_date)}` : ""}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
              {d.unavailableToday.map((u: D, i: number) => (
                <li key={`u${i}`}>
                  <div className="grow">
                    <div className="title">{u.user_name}</div>
                    <div className="muted small">Not available on this weekday{u.note ? ` · ${u.note}` : ""}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Everyone is available.</Empty>
          )}
        </Card>

        <Card title="Pending signatures" icon={FileSignature} flush actions={<Link to="/documents">Documents</Link>}>
          {d.pendingSignatures.length ? (
            <ul className="list">
              {d.pendingSignatures.map((s: D) => (
                <li key={s.id}>
                  <Link className="grow" to={`/documents/${s.document_id}`}>{s.title}</Link>
                  <span className="muted small">{s.awaiting} awaiting</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={FileSignature}>No signatures outstanding.</Empty>
          )}
        </Card>

        <Card title="Recent activity" icon={Activity} flush className="span-2">
          {d.activity.length ? (
            <ul className="list">
              {d.activity.map((a: D) => (
                <li key={a.id}>
                  <div className="grow">
                    <strong>{a.actor ?? "System"}</strong> {a.summary}
                  </div>
                  <span className="muted small nowrap">{relative(a.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No activity yet.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
