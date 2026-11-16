import { Download, FilePlus2, FileSignature, FileText, FolderPlus, Pencil, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, SearchBox, Select, StatusBadge, Textarea, useAsync, useDebounced, useForm, useToast } from "../components/ui";
import { fmtBytes, fmtDateTime, relative, titleCase } from "../format";

type D = Record<string, any>;

export function DocumentsPage() {
  const { can, me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [templates, setTemplates] = useState(false);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/documents${qs({ q: dq, folder_id: folder, templates: templates ? 1 : null })}`), [dq, folder, templates]);
  const manage = can("documents.manage");
  return (
    <>
      <PageHeader
        title="Documents"
        subtitle={manage ? "Company files, templates, forms and signed records" : "Documents shared with you"}
        actions={manage && (
          <>
            <Button icon={FolderPlus} onClick={async () => {
              const name = prompt("Folder name");
              if (!name) return;
              try { await api.post("/documents/folders", { name }); reload(); } catch (e) { toast((e as Error).message, "error"); }
            }}>New folder</Button>
            <Button variant="primary" icon={FilePlus2} onClick={() => setParams({ new: "1" })}>Upload document</Button>
          </>
        )}
      />
      {!me!.integrations.esign && manage && (
        <div style={{ marginBottom: 14 }}>
          <Alert kind="info">
            <strong>Electronic signatures are not connected yet.</strong> Documents can be uploaded, organized, versioned and shared now. Sending documents for legally binding e-signature requires connecting a provider such as Dropbox Sign or DocuSign (Phase 3) — this app does not create its own signatures.
          </Alert>
        </div>
      )}
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search documents…" />
        <Select value={folder} onChange={(e) => setFolder(e.target.value)} style={{ width: 200 }}>
          <option value="">All folders</option>
          {(data?.folders as D[] | undefined)?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <label className="checkbox"><input type="checkbox" checked={templates} onChange={(e) => setTemplates(e.target.checked)} /> Templates & forms only</label>
      </div>
      <PageState loading={loading && !data} error={error}>
        {() => (
          <div className="card">
            {data!.documents.length ? (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Document</th><th>Folder</th><th>Category</th><th>Version</th><th>Updated</th><th /></tr></thead>
                  <tbody>
                    {(data!.documents as D[]).map((d) => (
                      <tr key={d.id} className="clickable" onClick={() => nav(`/documents/${d.id}`)}>
                        <td className="primary" data-label="Document">
                          <div className="row"><FileText size={16} color="var(--green-600)" /> <span style={{ fontWeight: 600 }}>{d.title}</span> {d.is_template ? <span className="badge blue">Template</span> : null}</div>
                          <div className="muted small">{d.original_name} · {d.size_bytes ? fmtBytes(d.size_bytes) : ""}</div>
                        </td>
                        <td data-label="Folder">{d.folder_name ?? "—"}</td>
                        <td data-label="Category">{d.category ?? "—"}</td>
                        <td data-label="Version">v{d.version_no}</td>
                        <td data-label="Updated">{relative(d.updated_at)}</td>
                        <td>{d.pending_signatures > 0 && <span className="badge amber"><FileSignature size={12} /> {d.pending_signatures} pending</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty icon={FileText}>{q ? "No documents match." : "No documents yet."}</Empty>}
          </div>
        )}
      </PageState>
      {params.get("new") === "1" && <DocumentFormModal folders={data?.folders ?? []} onClose={() => setParams({})} onSaved={(id) => nav(`/documents/${id}`)} />}
    </>
  );
}

function LinkPicker({ label, options, value, onChange }: { label: string; options: { id: number; label: string }[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <Field label={label}>
      <div className="card" style={{ maxHeight: 150, overflowY: "auto", padding: 8 }}>
        {options.length ? options.map((o) => (
          <label key={o.id} className="checkbox" style={{ padding: "3px 2px" }}>
            <input type="checkbox" checked={value.includes(o.id)} onChange={() => onChange(value.includes(o.id) ? value.filter((x) => x !== o.id) : [...value, o.id])} /> {o.label}
          </label>
        )) : <span className="muted small">None available</span>}
      </div>
    </Field>
  );
}

function DocumentFormModal({ doc, links, access, folders, onClose, onSaved }: { doc?: D; links?: D[]; access?: D[]; folders: D[]; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const jobs = useAsync(() => api.get<D>("/jobs?status=all"), []);
  const people = useAsync(() => api.get<D>("/users/directory"), []);
  const customers = useAsync(() => api.get<D>("/customers"), []);
  const items = useAsync(() => api.get<D>("/inventory"), []);
  const pick = (t: string) => (links ?? []).filter((l) => l.entity_type === t).map((l) => l.entity_id as number);
  const f = useForm({ title: doc?.title ?? "", folder_id: doc?.folder_id ? String(doc.folder_id) : "", category: doc?.category ?? "", description: doc?.description ?? "", visibility: doc?.visibility ?? "managers", is_template: Boolean(doc?.is_template), status: doc?.status ?? "active" });
  const [jobIds, setJobIds] = useState<number[]>(pick("job"));
  const [userIds, setUserIds] = useState<number[]>(pick("user"));
  const [customerIds, setCustomerIds] = useState<number[]>(pick("customer"));
  const [itemIds, setItemIds] = useState<number[]>(pick("item"));
  const [accessIds, setAccessIds] = useState<number[]>((access ?? []).map((a) => a.user_id));
  const [fileName, setFileName] = useState<string | null>(null);
  const save = () => f.submit(async () => {
    const meta = { ...f.values, job_ids: jobIds, user_ids: userIds, customer_ids: customerIds, item_ids: itemIds, access_user_ids: accessIds };
    if (doc) {
      await api.put(`/documents/${doc.id}`, meta);
      toast("Document updated");
      onSaved(doc.id);
    } else {
      const fl = file.current?.files?.[0];
      if (!fl) throw new Error("Choose a file to upload.");
      const fd = new FormData();
      fd.set("file", fl);
      for (const [k, v] of Object.entries(meta)) fd.set(k, Array.isArray(v) ? v.join(",") : String(v));
      const r = await api.post<D>("/documents", fd);
      toast("Document uploaded");
      onSaved(r.id);
    }
  });
  return (
    <Modal wide title={doc ? "Edit document" : "Upload document"} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={f.busy} onClick={save}>Save</Button></>}>
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        {!doc && (
          <Field label="File" hint="PDF, images, Word or Excel up to 25 MB.">
            <input ref={file} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(e) => { const n = e.target.files?.[0]?.name; setFileName(n ?? null); if (n && !f.values.title) f.set("title", n.replace(/\.[^.]+$/, "")); }} />
            {fileName && <span className="small muted">{fileName}</span>}
          </Field>
        )}
        <div className="form-grid">
          <Field label="Title" error={f.errors.title}><Input {...f.bind("title")} /></Field>
          <Field label="Folder"><Select {...f.bind("folder_id")}><option value="">— None —</option>{folders.map((x: D) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Category"><Input {...f.bind("category")} placeholder="Work order, Safety, Contract, Manual…" /></Field>
          <Field label="Who can see it">
            <Select {...f.bind("visibility")}>
              <option value="managers">Managers & owners only</option>
              <option value="assigned">Selected people + crews of linked jobs</option>
              <option value="company">All employees</option>
            </Select>
          </Field>
          <Field label="Description" className="full"><Textarea {...f.bind("description")} style={{ minHeight: 60 }} /></Field>
          <label className="checkbox"><input type="checkbox" checked={f.values.is_template} onChange={(e) => f.set("is_template", e.target.checked)} /> Reusable template / blank form</label>
          {doc && <label className="checkbox"><input type="checkbox" checked={f.values.status === "archived"} onChange={(e) => f.set("status", e.target.checked ? "archived" : "active")} /> Archived</label>}
        </div>
        <div className="grid cols-2">
          <LinkPicker label="Linked jobs" options={((jobs.data?.jobs as D[]) ?? []).map((j) => ({ id: j.id, label: `#${j.job_number} ${j.name}` }))} value={jobIds} onChange={setJobIds} />
          <LinkPicker label="Linked customers" options={((customers.data?.customers as D[]) ?? []).map((c) => ({ id: c.id, label: c.name }))} value={customerIds} onChange={setCustomerIds} />
          <LinkPicker label="Linked employees (personnel file)" options={((people.data?.users as D[]) ?? []).map((u) => ({ id: u.id, label: u.name }))} value={userIds} onChange={setUserIds} />
          <LinkPicker label="Linked equipment" options={((items.data?.items as D[]) ?? []).map((i) => ({ id: i.id, label: i.name }))} value={itemIds} onChange={setItemIds} />
          {f.values.visibility === "assigned" && <LinkPicker label="Share with these people" options={((people.data?.users as D[]) ?? []).map((u) => ({ id: u.id, label: u.name }))} value={accessIds} onChange={setAccessIds} />}
        </div>
      </div>
    </Modal>
  );
}

export function DocumentDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/documents/${id}`), [id]);
  const folders = useAsync(() => (can("documents.manage") ? api.get<D>("/documents") : Promise.resolve({ folders: [] })), []);
  const [editing, setEditing] = useState(false);
  const version = useRef<HTMLInputElement>(null);
  const manage = can("documents.manage");
  return (
    <PageState loading={loading && !data} error={error}>
      {() => {
        const { document: d, versions, links, access, signatures, esignConfigured } = data!;
        const latest = versions[0];
        const hrefFor = (l: D) => ({ job: `/jobs/${l.entity_id}`, user: `/team/${l.entity_id}`, customer: `/customers/${l.entity_id}`, item: `/inventory/${l.entity_id}` }[l.entity_type as string]);
        return (
          <>
            <PageHeader
              crumbs={<><Link to="/documents">Documents</Link> / {d.title}</>}
              title={d.title}
              subtitle={<span className="row wrap">{d.category && <span className="badge">{d.category}</span>} {d.is_template ? <span className="badge blue">Template</span> : null} {d.status === "archived" && <StatusBadge status="archived" />} {d.folder_name && <span className="muted">in {d.folder_name}</span>}</span>}
              actions={
                <>
                  {latest && <a className="btn" href={`/api/files/${latest.file_id}`} target="_blank" rel="noreferrer"><FileText size={17} /> Open</a>}
                  {latest && <a className="btn" href={`/api/files/${latest.file_id}?download=1`}><Download size={17} /> Download</a>}
                  {manage && <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
                </>
              }
            />
            <div className="grid cols-3">
              <div className="stack span-2">
                {latest?.mime_type === "application/pdf" && (
                  <div className="card" style={{ overflow: "hidden" }}>
                    <iframe title={d.title} src={`/api/files/${latest.file_id}`} style={{ width: "100%", height: 560, border: 0 }} />
                  </div>
                )}
                {latest?.mime_type?.startsWith("image/") && <img src={`/api/files/${latest.file_id}`} alt={d.title} style={{ maxWidth: "100%", borderRadius: 10 }} />}
                {d.description && <Card title="Description"><div style={{ whiteSpace: "pre-wrap" }}>{d.description}</div></Card>}
                <Card title="Versions" flush actions={manage && (
                  <>
                    <input ref={version} type="file" hidden onChange={async (e) => {
                      const fl = e.target.files?.[0];
                      if (!fl) return;
                      const note = prompt("What changed in this version? (optional)") ?? "";
                      const fd = new FormData();
                      fd.set("file", fl);
                      fd.set("note", note);
                      try { await api.post(`/documents/${id}/versions`, fd); toast("New version uploaded"); reload(); } catch (err) { toast((err as Error).message, "error"); }
                      e.target.value = "";
                    }} />
                    <Button size="sm" icon={Upload} onClick={() => version.current?.click()}>New version</Button>
                  </>
                )}>
                  <ul className="list">
                    {versions.map((v: D) => (
                      <li key={v.id}>
                        <span className="badge">v{v.version_no}</span>
                        <div className="grow">
                          <a href={`/api/files/${v.file_id}`} target="_blank" rel="noreferrer">{v.original_name}</a>
                          <div className="muted small">{v.uploaded_by_name} · {fmtDateTime(v.created_at)} · {fmtBytes(v.size_bytes)}{v.note ? ` · ${v.note}` : ""}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
              <div className="stack">
                <Card title="Signatures" icon={FileSignature}>
                  {signatures.length ? (
                    <ul className="timeline">{signatures.map((s: D) => <li key={s.id}>{titleCase(s.status)} · {s.signers.length} signer(s)<div className="muted small">{fmtDateTime(s.created_at)}</div></li>)}</ul>
                  ) : esignConfigured ? (
                    <span className="muted">No signature requests.</span>
                  ) : (
                    <div className="stack tight">
                      <span className="muted small">E-signature provider not connected. Signature requests, signer status, completion certificates and signed final copies will appear here once a provider is configured (Phase 3).</span>
                    </div>
                  )}
                </Card>
                <Card title="Linked to">
                  {links.length ? <div className="stack tight">{links.map((l: D, i: number) => <Link key={i} to={hrefFor(l)!}>{titleCase(l.entity_type)}: {l.label}</Link>)}</div> : <span className="muted">Not linked to any record.</span>}
                </Card>
                <Card title="Visibility">
                  <div className="stack tight">
                    <span>{d.visibility === "company" ? "All employees" : d.visibility === "assigned" ? "Selected people & crews of linked jobs" : "Managers & owners only"}</span>
                    {access.length > 0 && <span className="muted small">Shared with {access.map((a: D) => a.name).join(", ")}</span>}
                  </div>
                </Card>
              </div>
            </div>
            {editing && <DocumentFormModal doc={d} links={links} access={access} folders={folders.data?.folders ?? []} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
          </>
        );
      }}
    </PageState>
  );
}
