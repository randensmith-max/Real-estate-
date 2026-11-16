import { AlertTriangle, CheckCircle2, Info, Search, X, XCircle, type LucideIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ApiError } from "../api";
import { titleCase } from "../format";

// ── Data loading ──
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fn();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

// ── Toasts ──
type Toast = { id: number; text: string; kind: "ok" | "error" };
const ToastCtx = createContext<(text: string, kind?: "ok" | "error") => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ── Layout primitives ──
export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {crumbs && <div className="breadcrumb">{crumbs}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}

export function Card({ title, icon: Icon, actions, children, flush, footer, className = "" }: {
  title?: ReactNode; icon?: LucideIcon; actions?: ReactNode; children: ReactNode; flush?: boolean; footer?: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          <h2>
            {Icon && <Icon size={17} color="var(--green-600)" />}
            {title}
          </h2>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? "flush" : ""}`}>{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </section>
  );
}

export function Empty({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="empty">
      {Icon && <Icon size={30} />}
      <div>{children}</div>
    </div>
  );
}

export const Loading = () => (
  <div className="loading">
    <div className="spinner" />
  </div>
);

export function Alert({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const Icon = kind === "error" ? XCircle : kind === "warn" ? AlertTriangle : kind === "success" ? CheckCircle2 : Info;
  return (
    <div className={`alert ${kind}`}>
      <Icon size={18} />
      <div>{children}</div>
    </div>
  );
}

export function PageState({ loading, error, children }: { loading: boolean; error: string | null; children: () => ReactNode }) {
  if (error) return <Alert kind="error">{error}</Alert>;
  if (loading) return <Loading />;
  return <>{children()}</>;
}

// ── Buttons ──
export function Button({ variant, size, icon: Icon, children, busy, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "danger" | "danger-outline" | "ghost"; size?: "sm" | "lg"; icon?: LucideIcon; busy?: boolean;
}) {
  return (
    <button type="button" className={`btn ${variant ?? ""} ${size ?? ""} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {Icon && <Icon size={size === "sm" ? 15 : 17} />}
      {children}
    </button>
  );
}

// ── Status badges ──
const STATUS_COLORS: Record<string, string> = {
  new: "blue", quoted: "blue", scheduled: "", in_progress: "green", on_hold: "amber", completed: "dark", invoiced: "", cancelled: "red",
  open: "amber", submitted: "blue", approved: "green", pending: "amber", denied: "red",
  waiting_parts: "amber", closed: "", void: "red", active: "green", inactive: "red", archived: "",
  pass: "green", attention: "amber", fail: "red", reviewed: "green", sent: "blue", partially_signed: "amber", draft: "",
  low: "", normal: "blue", high: "amber", critical: "red",
  good: "green", fair: "amber", poor: "red", out_of_service: "red",
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const map: Record<string, string> = { in_progress: "In progress", on_hold: "On hold", out_of_service: "Out of service", waiting_parts: "Waiting on parts" };
  return <span className={`badge ${STATUS_COLORS[status] ?? ""}`}>{label ?? map[status] ?? titleCase(status)}</span>;
}

// ── Form controls ──
export function Field({ label, error, hint, children, className = "" }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) => {
  const { invalid, className = "", ...rest } = p;
  return <input className={`input ${invalid ? "invalid" : ""} ${className}`} {...rest} />;
};
export const Select = ({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={`input ${className}`} {...rest}>
    {children}
  </select>
);
export const Textarea = ({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={`input ${className}`} {...rest} />;

export function SearchBox({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <Search size={16} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" />
    </div>
  );
}

/** Debounced value for search boxes. */
export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ── Forms with server-side validation feedback ──
export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof T>(k: K, v: T[K]) => setValues((s) => ({ ...s, [k]: v }));
  const bind = (k: keyof T & string) => ({
    value: (values[k] ?? "") as string,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as T[typeof k]),
    invalid: Boolean(errors[k]),
  });
  async function submit(fn: () => Promise<void>) {
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields ?? {});
        setFormError(e.message);
      } else setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { values, setValues, set, bind, errors, formError, busy, submit, setFormError };
}

// ── Modal ──
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" className={`tab ${t.id === value ? "active" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number | null }) {
  if (!max) return null;
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className={`progress ${value > max ? "over" : ""}`} title={`${value} of ${max}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
