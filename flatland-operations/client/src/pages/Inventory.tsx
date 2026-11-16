import { AlertTriangle, ArrowLeftRight, Boxes, Camera, ClipboardCheck, Minus, PackagePlus, Pencil, Plus, Printer, ScanLine, Tractor, Wrench } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Attachments } from "../components/Attachments";
import { ScannerModal } from "../components/Scanner";
import {
  Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, SearchBox, Select, StatusBadge, Tabs, Textarea,
  useAsync, useDebounced, useForm, useToast,
} from "../components/ui";
import { centsToInput, fmtDate, fmtDateTime, fmtMoney2, titleCase } from "../format";

type D = Record<string, any>;
const EQUIPMENT = ["chopper", "tractor", "truck", "trailer", "implement", "tool", "other"];
const CONSUMABLE = ["fuel", "fluids", "parts", "filters", "supplies", "components", "other"];
const CONDITIONS = ["new", "good", "fair", "poor", "out_of_service"];

export function InventoryPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState<"equipment" | "consumable" | "">((params.get("kind") as "equipment") ?? "");
  const [q, setQ] = useState("");
  const [low, setLow] = useState(params.get("low") === "1");
  const [category, setCategory] = useState("");
  const [scan, setScan] = useState(false);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/inventory${qs({ kind, q: dq, low: low ? 1 : null, category })}`), [kind, dq, low, category]);

  const onCode = useCallback(async (code: string) => {
    setScan(false);
    try {
      const r = await api.get<D>(`/inventory/lookup${qs({ code })}`);
      nav(`/inventory/${r.id}`);
    } catch {
      toast(`No item found for code ${code}`, "error");
    }
  }, [nav, toast]);

  const cats = kind === "equipment" ? EQUIPMENT : kind === "consumable" ? CONSUMABLE : [...new Set([...EQUIPMENT, ...CONSUMABLE])];
  return (
    <>
      <PageHeader
        title="Inventory & Equipment"
        actions={
          <>
            <Button icon={ScanLine} onClick={() => setScan(true)}>Scan</Button>
            {can("inventory.manage") && <Button variant="primary" icon={PackagePlus} onClick={() => setParams({ new: "1" })}>Add item</Button>}
          </>
        }
      />
      <Tabs tabs={[{ id: "", label: "All" }, { id: "equipment", label: "Equipment" }, { id: "consumable", label: "Consumables" }]} value={kind} onChange={(k) => { setKind(k); setCategory(""); }} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Name, asset #, serial, location…" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 170 }}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
        </Select>
        <label className="checkbox"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
      </div>
      <PageState loading={loading && !data} error={error}>
        {() => (
          <div className="card">
            {data!.items.length ? (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Item</th><th>Category</th><th>Asset #</th><th className="right">On hand</th><th>Location</th><th>Assigned</th><th>Status</th></tr></thead>
                  <tbody>
                    {(data!.items as D[]).map((i) => (
                      <tr key={i.id} className="clickable" onClick={() => nav(`/inventory/${i.id}`)}>
                        <td className="primary" data-label="Item">
                          <div className="row">
                            {i.kind === "equipment" ? <Tractor size={16} color="var(--green-600)" /> : <Boxes size={16} color="var(--muted)" />}
                            <span style={{ fontWeight: 600 }}>{i.name}</span>
                          </div>
                          {(i.make || i.model) && <div className="muted small">{[i.make, i.model].filter(Boolean).join(" ")}</div>}
                        </td>
                        <td data-label="Category">{titleCase(i.category)}</td>
                        <td data-label="Asset #" className="mono">{i.asset_number ?? "—"}</td>
                        <td data-label="On hand" className="right">
                          <span className={i.low_stock ? "badge red" : ""}>{i.quantity} {i.unit}</span>
                        </td>
                        <td data-label="Location">{i.storage_location ?? "—"}</td>
                        <td data-label="Assigned">{i.assigned_to ?? (i.assigned_job ? `#${i.assigned_job}` : "—")}</td>
                        <td data-label="Status">
                          <div className="row wrap" style={{ gap: 4 }}>
                            {i.down ? <span className="badge red">Down</span> : i.in_use ? <span className="badge green">In use</span> : null}
                            {i.open_issues && !i.down ? <span className="badge amber">Issue</span> : null}
                            {i.kind === "equipment" && <StatusBadge status={i.condition} />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty icon={Boxes}>{q || low || category ? "No items match." : "No inventory yet. Add your machines and supplies to start tracking."}</Empty>}
          </div>
        )}
      </PageState>
      {scan && <ScannerModal onClose={() => setScan(false)} onCode={onCode} />}
      {params.get("new") === "1" && <ItemFormModal defaultsKind={kind || "equipment"} onClose={() => setParams({})} onSaved={(id) => { setParams({}); reload(); nav(`/inventory/${id}`); }} />}
    </>
  );
}

function ItemFormModal({ item, defaultsKind, onClose, onSaved }: { item?: D; defaultsKind?: string; onClose: () => void; onSaved: (id: number) => void }) {
  const { can } = useAuth();
  const fin = can("financials.view");
  const toast = useToast();
  const people = useAsync(() => api.get<D>("/users/directory"), []);
  const s = item ?? {};
  const f = useForm({
    kind: s.kind ?? defaultsKind ?? "equipment", category: s.category ?? "", name: s.name ?? "", description: s.description ?? "",
    asset_number: s.asset_number ?? "", serial_number: s.serial_number ?? "", barcode: s.barcode ?? "", make: s.make ?? "", model: s.model ?? "",
    year: s.year ?? "", unit: s.unit ?? "each", low_stock_threshold: s.low_stock_threshold ?? "", storage_location: s.storage_location ?? "",
    assigned_user_id: s.assigned_user_id ? String(s.assigned_user_id) : "", supplier: s.supplier ?? "", purchase_date: s.purchase_date ?? "",
    meter_hours: s.meter_hours ?? "", condition: s.condition ?? "good", notes: s.notes ?? "", initial_quantity: "",
    purchase_price: centsToInput(s.purchase_price_cents), unit_cost: centsToInput(s.unit_cost_cents), hourly_cost: centsToInput(s.hourly_cost_cents),
    status: s.status ?? "active",
  });
  const eq = f.values.kind === "equipment";
  const cats = eq ? EQUIPMENT : CONSUMABLE;
  return (
    <Modal wide title={item ? `Edit ${item.name}` : "Add inventory item"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => {
        const body = { ...f.values, assigned_user_id: f.values.assigned_user_id || null, category: f.values.category || cats[0] };
        const res = item ? await api.put(`/inventory/${item.id}`, body) : await api.post<D>("/inventory", body);
        toast("Item saved");
        onSaved(item?.id ?? res.id);
      })}>Save</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="form-grid">
          {!item && (
            <Field label="Type" className="full">
              <div className="chips">
                {["equipment", "consumable"].map((k) => <button key={k} className={`chip ${f.values.kind === k ? "active" : ""}`} onClick={() => { f.set("kind", k); f.set("category", ""); f.set("unit", k === "equipment" ? "each" : "each"); }}>{titleCase(k)}</button>)}
              </div>
            </Field>
          )}
          <Field label="Name" error={f.errors.name}><Input autoFocus {...f.bind("name")} placeholder={eq ? "e.g. Chopper #2" : "e.g. 15W-40 engine oil"} /></Field>
          <Field label="Category">
            <Select {...f.bind("category")}>{cats.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
          </Field>
          {eq && (
            <>
              <Field label="Make"><Input {...f.bind("make")} /></Field>
              <Field label="Model"><Input {...f.bind("model")} /></Field>
              <Field label="Year" error={f.errors.year}><Input type="number" {...f.bind("year")} /></Field>
              <Field label="Hour meter" error={f.errors.meter_hours}><Input type="number" step="0.1" {...f.bind("meter_hours")} /></Field>
              <Field label="Condition">
                <Select {...f.bind("condition")}>{CONDITIONS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>
              </Field>
              <Field label="Assigned to">
                <Select {...f.bind("assigned_user_id")}>
                  <option value="">— Nobody —</option>
                  {(people.data?.users as D[] | undefined)?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </Field>
            </>
          )}
          <Field label="Asset number" error={f.errors.asset_number}><Input {...f.bind("asset_number")} /></Field>
          <Field label="Serial number"><Input {...f.bind("serial_number")} /></Field>
          <Field label="QR / barcode value" hint="Leave blank to auto-generate a printable code. Or scan the manufacturer's barcode into this field.">
            <Input {...f.bind("barcode")} />
          </Field>
          {!item && <Field label={eq ? "Quantity" : "Starting quantity"} error={f.errors.initial_quantity}><Input type="number" step="any" min="0" {...f.bind("initial_quantity")} placeholder={eq ? "1" : "0"} /></Field>}
          <Field label="Unit"><Input {...f.bind("unit")} placeholder="each, gal, qt, lb, box…" /></Field>
          {!eq && <Field label="Low-stock alert at" hint="Alert when on-hand quantity is at or below this." error={f.errors.low_stock_threshold}><Input type="number" step="any" min="0" {...f.bind("low_stock_threshold")} /></Field>}
          <Field label="Storage location"><Input {...f.bind("storage_location")} placeholder="Shop shelf B2, fuel tank 1…" /></Field>
          <Field label="Supplier"><Input {...f.bind("supplier")} /></Field>
          <Field label="Purchase date"><Input type="date" {...f.bind("purchase_date")} /></Field>
          {fin && (
            <>
              <Field label="Purchase price ($)"><Input type="number" step="0.01" min="0" {...f.bind("purchase_price")} /></Field>
              {eq ? (
                <Field label="Operating cost per hour ($)" hint="Used for estimated job costing."><Input type="number" step="0.01" min="0" {...f.bind("hourly_cost")} /></Field>
              ) : (
                <Field label="Unit cost ($)"><Input type="number" step="0.01" min="0" {...f.bind("unit_cost")} /></Field>
              )}
            </>
          )}
          <Field label="Description" className="full"><Textarea {...f.bind("description")} style={{ minHeight: 60 }} /></Field>
          <Field label="Notes / maintenance info" className="full"><Textarea {...f.bind("notes")} style={{ minHeight: 60 }} /></Field>
          {item && <label className="checkbox full"><input type="checkbox" checked={f.values.status === "retired"} onChange={(e) => f.set("status", e.target.checked ? "retired" : "active")} /> Retired (sold, scrapped or no longer used)</label>}
        </div>
      </div>
    </Modal>
  );
}

const MOVES: Record<string, { label: string; icon: typeof Plus; help: string }> = {
  purchase: { label: "Purchase / receive", icon: Plus, help: "Adds stock" },
  usage: { label: "Use", icon: Minus, help: "Removes stock (e.g. used on a job)" },
  return: { label: "Return to stock", icon: Plus, help: "Adds stock" },
  transfer: { label: "Move location", icon: ArrowLeftRight, help: "Changes storage location" },
  adjustment: { label: "Count adjustment", icon: Pencil, help: "Set the counted quantity" },
  damaged: { label: "Damaged", icon: AlertTriangle, help: "Removes stock" },
  missing: { label: "Missing", icon: AlertTriangle, help: "Removes stock" },
};

function MovementModal({ item, type, onClose, onSaved }: { item: D; type: string; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const jobs = useAsync(() => api.get<D>("/jobs"), []);
  const f = useForm({ type, quantity: "", counted_quantity: String(item.quantity), unit_cost: "", job_id: "", to_location: "", reason: "" });
  return (
    <Modal title={`${MOVES[type].label} — ${item.name}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => { await api.post(`/inventory/${item.id}/movements`, { ...f.values, job_id: f.values.job_id || null }); onSaved(); })}>Save</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <p className="muted">Currently on hand: <strong>{item.quantity} {item.unit}</strong></p>
        {type === "adjustment" ? (
          <Field label={`Counted quantity (${item.unit})`}><Input type="number" step="any" min="0" {...f.bind("counted_quantity")} /></Field>
        ) : type === "transfer" ? (
          <Field label="New location"><Input {...f.bind("to_location")} placeholder={item.storage_location ?? ""} /></Field>
        ) : (
          <Field label={`Quantity (${item.unit})`}><Input type="number" step="any" min="0" autoFocus {...f.bind("quantity")} /></Field>
        )}
        {type === "purchase" && can("financials.view") && <Field label="Unit cost ($)"><Input type="number" step="0.01" min="0" {...f.bind("unit_cost")} /></Field>}
        {(type === "usage" || type === "return") && (
          <Field label="Job (optional)" hint="Usage on a job feeds the job cost report.">
            <Select {...f.bind("job_id")}>
              <option value="">— None —</option>
              {(jobs.data?.jobs as D[] | undefined)?.map((j) => <option key={j.id} value={j.id}>#{j.job_number} — {j.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label={type === "adjustment" ? "Reason (required)" : "Reason / note"}><Textarea {...f.bind("reason")} style={{ minHeight: 60 }} /></Field>
      </div>
    </Modal>
  );
}

function QrLabel({ item }: { item: D }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(String(item.barcode), { margin: 1, width: 220, errorCorrectionLevel: "M" }).then(setSrc).catch(() => setSrc(null));
  }, [item.barcode]);
  return (
    <div className="row top wrap">
      {src && <img src={src} alt={`QR code ${item.barcode}`} width={120} height={120} style={{ border: "1px solid var(--line)", borderRadius: 6 }} />}
      <div className="stack tight">
        <strong>{item.name}</strong>
        {item.asset_number && <span className="mono">{item.asset_number}</span>}
        <span className="mono" style={{ fontWeight: 700 }}>{item.barcode}</span>
        <span className="muted small">Scan to open this item.</span>
      </div>
    </div>
  );
}

export function ItemDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/inventory/${id}`), [id]);
  const [move, setMove] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const manage = can("inventory.manage");

  return (
    <PageState loading={loading && !data} error={error}>
      {() => {
        const { item, movements, maintenance, schedules, jobs, attachments, inspections } = data!;
        const eq = item.kind === "equipment";
        const moveTypes = manage ? Object.keys(MOVES) : can("inventory.use") ? ["usage"] : [];
        return (
          <>
            <PageHeader
              crumbs={<><Link to="/inventory">Inventory</Link> / {item.name}</>}
              title={item.name}
              subtitle={<span className="row wrap">{titleCase(item.kind)} · {titleCase(item.category)} {eq && <StatusBadge status={item.condition} />} {item.status === "retired" && <StatusBadge status="archived" label="Retired" />}</span>}
              actions={
                <>
                  {can("maintenance.report") && eq && <Button icon={Wrench} onClick={() => nav(`/maintenance?report=1&item=${id}`)}>Report issue</Button>}
                  {can("inspections.perform") && eq && <Button icon={ClipboardCheck} onClick={() => nav(`/inspections/new?item=${id}`)}>Inspect</Button>}
                  {manage && <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
                </>
              }
            />
            <div className="grid cols-3">
              <div className="stack">
                <Card>
                  <div className="stack">
                    {item.photo_file_id ? <img src={`/api/files/${item.photo_file_id}`} alt={item.name} style={{ width: "100%", borderRadius: 8, maxHeight: 240, objectFit: "cover" }} /> : <div className="empty" style={{ background: "var(--gray-bg)", borderRadius: 8 }}>{eq ? <Tractor size={42} /> : <Boxes size={42} />}</div>}
                    {manage && (
                      <>
                        <input ref={photo} type="file" accept="image/*" hidden onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const fd = new FormData();
                          fd.set("file", file);
                          try { await api.post(`/inventory-photo/${id}`, fd); reload(); } catch (err) { toast((err as Error).message, "error"); }
                        }} />
                        <Button size="sm" icon={Camera} onClick={() => photo.current?.click()}>{item.photo_file_id ? "Change photo" : "Add photo"}</Button>
                      </>
                    )}
                    <div style={{ fontSize: 30, fontWeight: 700 }}>{item.quantity} <span style={{ fontSize: 16 }} className="muted">{item.unit}</span></div>
                    {item.low_stock_threshold !== null && item.quantity <= item.low_stock_threshold && <Alert kind="warn">Low stock — alert level is {item.low_stock_threshold} {item.unit}.</Alert>}
                    {moveTypes.length > 0 && (
                      <div className="row wrap" style={{ gap: 6 }}>
                        {moveTypes.map((t) => { const M = MOVES[t]; return <Button key={t} size="sm" icon={M.icon} onClick={() => setMove(t)}>{M.label}</Button>; })}
                      </div>
                    )}
                  </div>
                </Card>
                <Card title="Label" icon={Printer} actions={<Button size="sm" variant="ghost" onClick={() => window.print()}>Print</Button>}>
                  <QrLabel item={item} />
                </Card>
              </div>
              <div className="stack span-2">
                <Card title="Details">
                  <dl className="kv">
                    {eq && <><dt>Make / model</dt><dd>{[item.make, item.model, item.year].filter(Boolean).join(" ") || "—"}</dd></>}
                    <dt>Asset #</dt><dd className="mono">{item.asset_number ?? "—"}</dd>
                    <dt>Serial #</dt><dd className="mono">{item.serial_number ?? "—"}</dd>
                    {eq && <><dt>Hour meter</dt><dd>{item.meter_hours ?? "—"}</dd></>}
                    <dt>Location</dt><dd>{item.storage_location ?? "—"}</dd>
                    <dt>Assigned to</dt><dd>{item.assigned_to ?? "—"}{item.assigned_job ? ` · job #${item.assigned_job}` : ""}</dd>
                    <dt>Supplier</dt><dd>{item.supplier ?? "—"}</dd>
                    <dt>Purchased</dt><dd>{fmtDate(item.purchase_date)}{item.purchase_price_cents !== undefined && item.purchase_price_cents !== null ? ` · ${fmtMoney2(item.purchase_price_cents)}` : ""}</dd>
                    {item.unit_cost_cents !== undefined && !eq && <><dt>Avg. unit cost</dt><dd>{fmtMoney2(item.unit_cost_cents)}</dd></>}
                    {item.hourly_cost_cents !== undefined && eq && <><dt>Operating cost</dt><dd>{item.hourly_cost_cents !== null ? `${fmtMoney2(item.hourly_cost_cents)} / hour` : "—"}</dd></>}
                    {item.description && <><dt>Description</dt><dd style={{ whiteSpace: "pre-wrap" }}>{item.description}</dd></>}
                    {item.notes && <><dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{item.notes}</dd></>}
                  </dl>
                </Card>
                {eq && (
                  <Card title="Maintenance & issues" icon={Wrench} flush actions={<Link to={`/maintenance?item_id=${id}`}>All</Link>}>
                    {schedules.length > 0 && (
                      <div className="card-body small">
                        <strong>Recurring:</strong> {schedules.map((s: D) => `${s.title} (every ${[s.interval_days && `${s.interval_days} days`, s.interval_hours && `${s.interval_hours} hours`].filter(Boolean).join(" or ")})`).join("; ")}
                      </div>
                    )}
                    {maintenance.length ? (
                      <ul className="list">
                        {maintenance.map((m: D) => (
                          <li key={m.id} className="clickable" onClick={() => nav(`/maintenance/${m.id}`)}>
                            <div className="grow"><div className="title">{m.title}</div><div className="muted small">{titleCase(m.kind)} · {fmtDateTime(m.reported_at)}</div></div>
                            {m.equipment_down ? <span className="badge red">Down</span> : null}
                            <StatusBadge status={m.status} />
                          </li>
                        ))}
                      </ul>
                    ) : <Empty>No maintenance records.</Empty>}
                  </Card>
                )}
                {eq && inspections.length > 0 && (
                  <Card title="Recent inspections" icon={ClipboardCheck} flush>
                    <ul className="list">
                      {inspections.map((s: D) => (
                        <li key={s.id} className="clickable" onClick={() => nav(`/inspections/${s.id}`)}>
                          <div className="grow"><div className="title">{s.template_name}</div><div className="muted small">{s.performed_by_name} · {fmtDateTime(s.performed_at)}</div></div>
                          <StatusBadge status={s.overall_result} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
                {eq && jobs.length > 0 && (
                  <Card title="Jobs" flush>
                    <ul className="list">{jobs.map((j: D) => <li key={j.id}><Link className="grow" to={`/jobs/${j.id}`}>#{j.job_number} {j.name}</Link><StatusBadge status={j.status} /></li>)}</ul>
                  </Card>
                )}
                <Card title="Quantity history" flush>
                  {movements.length ? (
                    <div className="table-wrap">
                      <table className="table responsive">
                        <thead><tr><th>When</th><th>Type</th><th className="right">Change</th><th className="right">After</th><th>By</th><th>Details</th></tr></thead>
                        <tbody>
                          {movements.map((m: D) => (
                            <tr key={m.id}>
                              <td data-label="When" className="nowrap">{fmtDateTime(m.created_at)}</td>
                              <td data-label="Type">{titleCase(m.type)}</td>
                              <td data-label="Change" className="right mono" style={{ color: m.quantity_change < 0 ? "var(--red)" : "var(--green-700)" }}>{m.quantity_change > 0 ? "+" : ""}{m.quantity_change}</td>
                              <td data-label="After" className="right mono">{m.quantity_after}</td>
                              <td data-label="By">{m.user_name}</td>
                              <td data-label="Details" className="small">{[m.job_number && `Job #${m.job_number}`, m.to_location && `→ ${m.to_location}`, m.reason].filter(Boolean).join(" · ") || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <Empty>No quantity changes recorded.</Empty>}
                </Card>
                <Attachments entityType="item" entityId={id} items={attachments} canAdd={manage} onChange={reload} title="Manuals, receipts & photos" />
              </div>
            </div>
            {move && <MovementModal item={item} type={move} onClose={() => setMove(null)} onSaved={() => { setMove(null); toast("Recorded"); reload(); }} />}
            {editing && <ItemFormModal item={item} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
          </>
        );
      }}
    </PageState>
  );
}
