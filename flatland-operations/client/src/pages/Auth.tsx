import { KeyRound, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Field, Input, Select, useForm } from "../components/ui";

function AuthShell({ title, subtitle, children, inline }: { title: string; subtitle?: string; children: React.ReactNode; inline?: boolean }) {
  if (inline)
    return (
      <div className="card" style={{ maxWidth: 460 }}>
        <div className="card-body stack">
          <h1 style={{ fontSize: 22 }}>{title}</h1>
          {children}
        </div>
      </div>
    );
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="card-body stack">
          <div className="row" style={{ marginBottom: 6 }}>
            <div className="brand-mark">FO</div>
            <div>
              <div style={{ fontWeight: 700 }}>Flatland Operations</div>
              <div className="muted small">Flatland Custom Forage</div>
            </div>
          </div>
          <div>
            <h1 style={{ fontSize: 22 }}>{title}</h1>
            {subtitle && <p className="muted" style={{ marginTop: 4 }}>{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { refresh } = useAuth();
  const f = useForm({ email: "", password: "" });
  return (
    <AuthShell title="Sign in" subtitle="Use the email and password your manager gave you.">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          f.submit(async () => {
            await api.post("/auth/login", f.values);
            await refresh();
          });
        }}
      >
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Field label="Email">
          <Input type="email" autoComplete="username" required {...f.bind("email")} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required {...f.bind("password")} />
        </Field>
        <Button type="submit" variant="primary" size="lg" icon={LogIn} busy={f.busy} className="block">
          Sign in
        </Button>
        <p className="muted small">Forgot your password? Ask a manager to reset it for you.</p>
      </form>
    </AuthShell>
  );
}

const ZONES = ["America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/New_York", "America/Boise", "America/Regina", "America/Winnipeg", "America/Edmonton"];

export function SetupPage() {
  const { refresh } = useAuth();
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const f = useForm({ company_name: "Flatland Custom Forage", timezone: ZONES.includes(browserTz) ? browserTz : "America/Chicago", first_name: "", last_name: "", email: "", password: "", confirm: "" });
  return (
    <AuthShell title="Set up your company" subtitle="Create the owner account. You can add employees after signing in.">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          f.submit(async () => {
            if (f.values.password !== f.values.confirm) throw new Error("Passwords do not match.");
            await api.post("/auth/setup", f.values);
            await refresh();
          });
        }}
      >
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Field label="Company name" error={f.errors.company_name}>
          <Input required {...f.bind("company_name")} />
        </Field>
        <Field label="Company time zone" hint="All clock times, timesheet weeks and reports use this zone.">
          <Select {...f.bind("timezone")}>
            {[...new Set([...ZONES, browserTz])].map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </Select>
        </Field>
        <div className="form-grid">
          <Field label="First name" error={f.errors.first_name}>
            <Input required {...f.bind("first_name")} />
          </Field>
          <Field label="Last name" error={f.errors.last_name}>
            <Input required {...f.bind("last_name")} />
          </Field>
        </div>
        <Field label="Email" error={f.errors.email}>
          <Input type="email" required autoComplete="username" {...f.bind("email")} />
        </Field>
        <Field label="Password" error={f.errors.password} hint="At least 10 characters with letters and numbers.">
          <Input type="password" required autoComplete="new-password" {...f.bind("password")} />
        </Field>
        <Field label="Confirm password">
          <Input type="password" required autoComplete="new-password" {...f.bind("confirm")} />
        </Field>
        <Button type="submit" variant="primary" size="lg" busy={f.busy} className="block">
          Create owner account
        </Button>
      </form>
    </AuthShell>
  );
}

export function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const { refresh, logout } = useAuth();
  const [done, setDone] = useState(false);
  const f = useForm({ current_password: "", new_password: "", confirm: "" });
  useEffect(() => {
    if (done) refresh();
  }, [done, refresh]);
  return (
    <AuthShell inline={!forced} title={forced ? "Choose your password" : "Change password"} subtitle={forced ? "You signed in with a temporary password. Set your own password to continue." : undefined}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          f.submit(async () => {
            if (f.values.new_password !== f.values.confirm) throw new Error("New passwords do not match.");
            await api.post("/auth/change-password", { current_password: f.values.current_password, new_password: f.values.new_password });
            setDone(true);
          });
        }}
      >
        {f.formError && <Alert kind="error">{f.formError}</Alert>}
        <Field label={forced ? "Temporary password" : "Current password"} error={f.errors.current_password}>
          <Input type="password" required autoComplete="current-password" {...f.bind("current_password")} />
        </Field>
        <Field label="New password" error={f.errors.new_password} hint="At least 10 characters with letters and numbers.">
          <Input type="password" required autoComplete="new-password" {...f.bind("new_password")} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" required autoComplete="new-password" {...f.bind("confirm")} />
        </Field>
        <Button type="submit" variant="primary" size="lg" icon={KeyRound} busy={f.busy} className="block">
          Save password
        </Button>
        {forced && (
          <Button variant="ghost" onClick={logout}>
            Sign out
          </Button>
        )}
      </form>
    </AuthShell>
  );
}
