import { ClipboardCheck, ListChecks, Pencil, PlusCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Attachments } from "../components/Attachments";
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, Select, StatusBadge, Tabs, Textarea, useAsync, useForm, useToast } from "../components/ui";
import { fmtDateTime, titleCase } from "../format";

type D = Record<string, any>;

export function InspectionsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const manage = can("inspections.manage");
  const [tab, setTab] = useState<"recent" | "templates">("recent");
  const [filter, setFilter] = useState("");
  const list = useAsync(() => api.get<D>(`/inspections${qs({ result: filter === "unreviewed" ? null : filter, unreviewed: filter === "unreviewed" ? 1 : null })}`), [filter]);
  return (
    <>
      <PageHeader title="Inspections & Checklists" actions={<Button variant="primary" size="lg" icon={ClipboardCheck} onClick={() => nav("/inspections/new")}>Start inspection</Button>} />
      {manage && <Tabs tabs={[{ id: "recent", label: "Completed inspections" }, { id: "templates", label: "Checklist templates" }]} value={tab} onChange={setTab} />}
      {tab === "recent" && (
        <>
          <div className="chips" style={{ marginBottom: 14 }}>
            {[["", "All"], ["fail", "Failed"], ["attention", "Needs attention"], ["pass", "Passed"], ...(manage ? [["unreviewed", "Not reviewed"]] : [])].map(([v, l]) => (
              <button key={v} className={`chip ${filter === v ? "active" : ""}`} onClick={() => setFilter(v)}>{l}</button>
            ))}
          </div>
          <PageState loading={list.loading && !list.data} error={list.error}>
            {() => (
              <div className="card">
                {list.data!.inspections.length ? (
                  <ul className="list">
                    {(list.data!.inspections as D[]).map((s) => (
                      <li key={s.id} className="clickable" onClick={() => nav(`/inspections/${s.id}`)}>
                        <div className="grow">
                          <div className="title">{s.template_name}{s.item_name ? ` — ${s.item_name}` : ""}</div>
                          <div className="muted small">{s.performed_by_name} · {fmtDateTime(s.performed_at)}{s.job_number ? ` · job #${s.job_number}` : ""}</div>
                        </div>
                        {s.fail_count > 0 && <span className="badge red">{s.fail_count} fail</span>}
                        {s.attention_count > 0 && <span className="badge amber">{s.attention_count} attention</span>}
                        <StatusBadge status={s.overall_result} />
                        {s.status === "reviewed" && <span className="badge green hide-mobile">Reviewed</span>}
                      </li>
                    ))}
                  </ul>
                ) : <Empty icon={ClipboardCheck}>No inspections yet.</Empty>}
              </div>
            )}
          </PageState>
        </>
      )}
      {tab === "templates" && <Templates />}
    </>
  );
}

function Templates() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<D>("/inspections/templates?all=1"), []);
  const [edit, setEdit] = useState<D | null>(null);
  return (
    <PageState loading={loading && !data} error={error}>
      {() => (
        <div className="stack">
          <div className="row">
            <Button variant="primary" icon={PlusCircle} onClick={() => setEdit({})}>New checklist</Button>
            <Button onClick={async () => { const r = await api.post<D>("/inspections/templates/install-starters"); toast(r.added ? `Added ${r.added} starter checklists` : "Starter checklists already installed"); reload(); }}>Add starter checklists</Button>
          </div>
          <div className="card">
            {data!.templates.length ? (
              <ul className="list">
                {(data!.templates as D[]).map((t) => (
                  <li key={t.id}>
                    <ListChecks size={18} color="var(--green-600)" />
                    <div className="grow">
                      <div className="title">{t.name} {!t.active && <span className="badge">Inactive</span>}</div>
                      <div className="muted small">{t.items.length} items{t.applies_to ? ` · ${titleCase(t.applies_to)}` : ""}{t.description ? ` · ${t.description}` : ""}</div>
                    </div>
                    <Button size="sm" icon={Pencil} onClick={() => setEdit(t)}>Edit</Button>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={ListChecks}>No checklists yet. Add the starter checklists or build your own.</Empty>}
          </div>
          {edit && <TemplateModal t={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
        </div>
      )}
    </PageState>
  );
}

function TemplateModal({ t, onClose, onSaved }: { t: D; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ name: t.name ?? "", description: t.description ?? "", applies_to: t.applies_to ?? "", active: t.active === undefined ? true : Boolean(t.active), requires_signature: Boolean(t.requires_signature) });
  const [items, setItems] = useState<{ label: string; create_issue_on_fail: boolean }[]>(
    (t.items as D[] | undefined)?.map((i) => ({ label: i.label, create_issue_on_fail: Boolean(i.create_issue_on_fail) })) ?? [{ label: "", create_issue_on_fail: true }],
  );
  return (
    <Modal wide title={t.id ? "Edit checklist" : "New checklist"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => {
        const body = { ...f.values, items: items.filter((i) => i.label.trim()) };
        if (t.id) await api.put(`/inspections/templates/${t.id}`, body); else await api.post("/inspections/templates", body);
        onSaved();
      })}>Save</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="form-grid">
          <Field label="Name" error={f.errors.name}><Input {...f.bind("name")} /></Field>
          <Field label="Applies to equipment category (optional)"><Input {...f.bind("applies_to")} placeholder="chopper, truck, trailer…" /></Field>
          <Field label="Description" className="full"><Input {...f.bind("description")} /></Field>
          <label className="checkbox"><input type="checkbox" checked={f.values.active} onChange={(e) => f.set("active", e.target.checked)} /> Active</label>
        </div>
        <Field label="Checklist items" error={f.errors.items}>
          <div className="stack tight">
            {items.map((it, i) => (
              <div key={i} className="row">
                <span className="muted small" style={{ width: 22 }}>{i + 1}.</span>
                <Input value={it.label} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ flex: 1 }} />
                <label className="checkbox small nowrap" title="Automatically open an equipment issue when this item fails"><input type="checkbox" checked={it.create_issue_on_fail} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, create_issue_on_fail: e.target.checked } : x)))} /> Issue on fail</label>
                <Button className="icon" variant="ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>
              </div>
            ))}
            <div><Button size="sm" icon={PlusCircle} onClick={() => setItems([...items, { label: "", create_issue_on_fail: true }])}>Add item</Button></div>
          </div>
        </Field>
        <p className="muted small">Editing a checklist never changes inspections already completed — they keep their own copy.</p>
      </div>
    </Modal>
  );
}

export function PerformInspectionPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const templates = useAsync(() => api.get<D>("/inspections/templates"), []);
  const items = useAsync(() => api.get<D>("/inventory?kind=equipment").catch(() => ({ items: [] })), []);
  const jobs = useAsync(() => api.get<D>("/jobs"), []);
  const [templateId, setTemplateId] = useState("");
  const [itemId, setItemId] = useState(params.get("item") ?? "");
  const [jobId, setJobId] = useState("");
  const [meter, setMeter] = useState("");
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<Record<number, { result: string; note: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const template = (templates.data?.templates as D[] | undefined)?.find((t) => String(t.id) === templateId);
  useEffect(() => setAnswers({}), [templateId]);

  const answered = template ? (template.items as D[]).filter((i) => answers[i.id]?.result).length : 0;
  return (
    <>
      <PageHeader crumbs={<><Link to="/inspections">Inspections</Link> / New</>} title="Start inspection" />
      <div className="stack" style={{ maxWidth: 760 }}>
        <Card>
          <div className="form">
            <Field label="Checklist">
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ height: 50, fontSize: 16 }}>
                <option value="">— Choose a checklist —</option>
                {(templates.data?.templates as D[] | undefined)?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            {templates.data && !templates.data.templates.length && <Alert kind="info">No checklists exist yet. A manager can add them under Inspections → Checklist templates.</Alert>}
            <div className="form-grid">
              <Field label="Equipment (if applicable)">
                <Select value={itemId} onChange={(e) => setItemId(e.target.value)} style={{ height: 48 }}>
                  <option value="">— None —</option>
                  {(items.data?.items as D[] | undefined)?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </Select>
              </Field>
              <Field label="Job (if applicable)">
                <Select value={jobId} onChange={(e) => setJobId(e.target.value)} style={{ height: 48 }}>
                  <option value="">— None —</option>
                  {(jobs.data?.jobs as D[] | undefined)?.map((j) => <option key={j.id} value={j.id}>#{j.job_number} {j.name}</option>)}
                </Select>
              </Field>
              {itemId && <Field label="Hour meter reading"><Input type="number" step="0.1" inputMode="decimal" value={meter} onChange={(e) => setMeter(e.target.value)} /></Field>}
            </div>
          </div>
        </Card>
        {template && (
          <Card title={`${template.name} — ${answered}/${template.items.length}`} flush>
            <ul className="list">
              {(template.items as D[]).map((it, idx) => {
                const a = answers[it.id] ?? { result: "", note: "" };
                const set = (patch: Partial<typeof a>) => setAnswers((s) => ({ ...s, [it.id]: { ...a, ...patch } }));
                return (
                  <li key={it.id} style={{ display: "block" }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>{idx + 1}. {it.label}</div>
                    <div className="result-toggle">
                      {[["pass", "Pass"], ["attention", "Attention"], ["fail", "Fail"], ["na", "N/A"]].map(([v, l]) => (
                        <button key={v} className={`${v} ${a.result === v ? "on" : ""}`} onClick={() => set({ result: v })}>{l}</button>
                      ))}
                    </div>
                    {(a.result === "fail" || a.result === "attention") && (
                      <Input style={{ marginTop: 8 }} placeholder="What did you find? (required)" value={a.note} onChange={(e) => set({ note: e.target.value })} />
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="card-body stack">
              <Field label="Overall notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              {err && <Alert kind="error">{err}</Alert>}
              <Button variant="primary" size="lg" className="block" busy={busy} disabled={answered < template.items.length} onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  const r = await api.post<D>("/inspections", {
                    template_id: template.id, item_id: itemId || null, job_id: jobId || null, meter_hours: meter || null, notes: notes || null,
                    responses: (template.items as D[]).map((i) => ({ template_item_id: i.id, result: answers[i.id].result, note: answers[i.id].note || null })),
                  });
                  toast(r.issueIds.length ? "Inspection saved — an equipment issue was opened for the failed items" : "Inspection saved");
                  nav(`/inspections/${r.id}`);
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>
                {answered < template.items.length ? `Answer all items (${template.items.length - answered} left)` : "Submit inspection"}
              </Button>
              {template.items.some((i: D) => answers[i.id]?.result === "fail") && !itemId && <Alert kind="warn">Select the equipment so a repair issue can be opened automatically for failed items.</Alert>}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

export function InspectionDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/inspections/${id}`), [id]);
  const f = useForm({ notes: "" });
  return (
    <PageState loading={loading && !data} error={error}>
      {() => {
        const { inspection: s, responses, issues, attachments } = data!;
        return (
          <>
            <PageHeader
              crumbs={<><Link to="/inspections">Inspections</Link> / #{s.id}</>}
              title={s.template_name}
              subtitle={<span className="row wrap"><StatusBadge status={s.overall_result} /> {s.performed_by_name} · {fmtDateTime(s.performed_at)} {s.item_name && <>· <Link to={`/inventory/${s.item_id}`}>{s.item_name}</Link></>}</span>}
            />
            <div className="grid cols-3">
              <div className="stack span-2">
                <Card title="Results" flush>
                  <ul className="list">
                    {(responses as D[]).map((r) => (
                      <li key={r.id}>
                        <div className="grow"><div>{r.label}</div>{r.note && <div className="small" style={{ color: r.result === "fail" ? "var(--red)" : "var(--amber)" }}>{r.note}</div>}</div>
                        <StatusBadge status={r.result === "na" ? "draft" : r.result} label={r.result === "na" ? "N/A" : undefined} />
                      </li>
                    ))}
                  </ul>
                </Card>
                {s.notes && <Card title="Notes"><div style={{ whiteSpace: "pre-wrap" }}>{s.notes}</div></Card>}
                <Attachments entityType="inspection" entityId={id} items={attachments} canAdd onChange={reload} title="Photos" />
              </div>
              <div className="stack">
                {issues.length > 0 && (
                  <Card title="Issues opened" flush>
                    <ul className="list">{issues.map((m: D) => <li key={m.id}><Link className="grow" to={`/maintenance/${m.id}`}>{m.title}</Link><StatusBadge status={m.status} /></li>)}</ul>
                  </Card>
                )}
                <Card title="Manager review">
                  {s.status === "reviewed" ? (
                    <div className="stack tight"><span>Reviewed by <strong>{s.reviewed_by_name}</strong></span><span className="muted small">{fmtDateTime(s.reviewed_at)}</span>{s.review_notes && <p>{s.review_notes}</p>}</div>
                  ) : can("inspections.manage") ? (
                    <div className="form">
                      {f.formError && <Alert kind="error">{f.formError}</Alert>}
                      <Textarea placeholder="Review notes (optional)" {...f.bind("notes")} />
                      <Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.post(`/inspections/${id}/review`, f.values); reload(); })}>Mark reviewed</Button>
                    </div>
                  ) : <span className="muted">Waiting for manager review.</span>}
                </Card>
                {s.meter_hours !== null && <Card title="Hour meter"><div style={{ fontSize: 22, fontWeight: 700 }}>{s.meter_hours}</div></Card>}
              </div>
            </div>
          </>
        );
      }}
    </PageState>
  );
}
