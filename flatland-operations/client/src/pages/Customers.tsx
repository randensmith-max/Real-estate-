import { Contact, Mail, Pencil, Phone, PlusCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, qs } from "../api";
import { useAuth } from "../auth";
import { Attachments } from "../components/Attachments";
import { Alert, Button, Card, Empty, Field, Input, Modal, PageHeader, PageState, SearchBox, StatusBadge, Textarea, useAsync, useDebounced, useForm, useToast } from "../components/ui";
import { fmtDateTime, fmtMoney, titleCase } from "../format";
import { JobFormModal } from "./Jobs";

type D = Record<string, any>;

export function CustomersPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const dq = useDebounced(q);
  const { data, loading, error } = useAsync(() => api.get<D>(`/customers${qs({ q: dq, status: archived ? "archived" : "" })}`), [dq, archived]);
  return (
    <>
      <PageHeader
        title="Customers"
        actions={can("customers.manage") && <Button variant="primary" icon={PlusCircle} onClick={() => setParams({ new: "1" })}>Add customer</Button>}
      />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, contact, phone, email…" />
        <label className="checkbox"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
      </div>
      <PageState loading={loading && !data} error={error}>
        {() => (
          <div className="card">
            {data!.customers.length ? (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Customer</th><th>Contact</th><th>Phone</th><th>Jobs</th><th>Active</th><th>Last job</th></tr></thead>
                  <tbody>
                    {(data!.customers as D[]).map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => nav(`/customers/${c.id}`)}>
                        <td className="primary" data-label="Customer">{c.name}</td>
                        <td data-label="Contact">{c.contact_name ?? "—"}</td>
                        <td data-label="Phone">{c.phone ?? "—"}</td>
                        <td data-label="Jobs">{c.job_count}</td>
                        <td data-label="Active">{c.active_jobs || "—"}</td>
                        <td data-label="Last job">{fmtDateTime(c.last_job_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={Contact}>{q ? "No customers match." : "No customers yet."}</Empty>
            )}
          </div>
        )}
      </PageState>
      {params.get("new") === "1" && <CustomerFormModal onClose={() => setParams({})} onSaved={(id) => nav(`/customers/${id}`)} />}
    </>
  );
}

function CustomerFormModal({ customer, onClose, onSaved }: { customer?: D; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const f = useForm({
    name: customer?.name ?? "", contact_name: customer?.contact_name ?? "", email: customer?.email ?? "", phone: customer?.phone ?? "",
    billing_address: customer?.billing_address ?? "", notes: customer?.notes ?? "", status: customer?.status ?? "active",
  });
  return (
    <Modal
      title={customer ? "Edit customer" : "Add customer"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={f.busy} onClick={() => f.submit(async () => {
            const res = customer ? await api.put(`/customers/${customer.id}`, f.values) : await api.post<D>("/customers", f.values);
            toast("Customer saved");
            onSaved(customer?.id ?? res.id);
          })}>Save</Button>
        </>
      }
    >
      <div className="form">
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <div className="form-grid">
          <Field label="Customer / farm name" error={f.errors.name} className="full"><Input autoFocus {...f.bind("name")} /></Field>
          <Field label="Contact person"><Input {...f.bind("contact_name")} /></Field>
          <Field label="Phone"><Input type="tel" {...f.bind("phone")} /></Field>
          <Field label="Email" error={f.errors.email} className="full"><Input type="email" {...f.bind("email")} /></Field>
          <Field label="Billing address" className="full"><Textarea {...f.bind("billing_address")} style={{ minHeight: 60 }} /></Field>
          <Field label="Notes" className="full"><Textarea {...f.bind("notes")} /></Field>
          {customer && (
            <label className="checkbox full">
              <input type="checkbox" checked={f.values.status === "archived"} onChange={(e) => f.set("status", e.target.checked ? "archived" : "active")} /> Archived (hidden from lists)
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function CustomerDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.get<D>(`/customers/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [newJob, setNewJob] = useState(false);
  return (
    <PageState loading={loading && !data} error={error}>
      {() => {
        const { customer: c, jobs, attachments } = data!;
        return (
          <>
            <PageHeader
              crumbs={<><Link to="/customers">Customers</Link> / {c.name}</>}
              title={c.name}
              subtitle={c.status === "archived" ? <StatusBadge status="archived" /> : undefined}
              actions={can("customers.manage") && (
                <>
                  <Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
                  {can("jobs.manage") && <Button variant="primary" icon={PlusCircle} onClick={() => setNewJob(true)}>New job</Button>}
                </>
              )}
            />
            <div className="grid cols-3">
              <div className="stack">
                <Card title="Contact" icon={Contact}>
                  <div className="stack tight">
                    {c.contact_name && <strong>{c.contact_name}</strong>}
                    {c.phone && <a href={`tel:${c.phone}`}><Phone size={14} /> {c.phone}</a>}
                    {c.email && <a href={`mailto:${c.email}`}><Mail size={14} /> {c.email}</a>}
                    {c.billing_address && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{c.billing_address}</div>}
                    {c.notes && <><div className="divider" /><div style={{ whiteSpace: "pre-wrap" }}>{c.notes}</div></>}
                  </div>
                </Card>
              </div>
              <div className="stack span-2">
                <Card title={`Jobs (${jobs.length})`} flush>
                  {jobs.length ? (
                    <ul className="list">
                      {jobs.map((j: D) => (
                        <li key={j.id} className="clickable" onClick={() => nav(`/jobs/${j.id}`)}>
                          <div className="grow">
                            <div className="title">{j.name}</div>
                            <div className="muted small">#{j.job_number} · {titleCase(j.job_type)} · {fmtDateTime(j.scheduled_start)}</div>
                          </div>
                          {j.quoted_amount_cents !== undefined && <span className="small">{fmtMoney(j.quoted_amount_cents)}</span>}
                          <StatusBadge status={j.status} />
                        </li>
                      ))}
                    </ul>
                  ) : <Empty>No jobs for this customer yet.</Empty>}
                </Card>
                <Attachments entityType="customer" entityId={id} items={attachments} canAdd={can("customers.manage")} onChange={reload} />
              </div>
            </div>
            {editing && <CustomerFormModal customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
            {newJob && <JobFormModal defaults={{ customer_id: c.id, job_type: "chopping" }} onClose={() => setNewJob(false)} onSaved={(jid) => nav(`/jobs/${jid}`)} />}
          </>
        );
      }}
    </PageState>
  );
}
