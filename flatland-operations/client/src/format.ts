/** Formatting helpers. All times display in the COMPANY time zone so everyone sees the same clock. */
let TZ = "America/Chicago";
export const setTimeZone = (tz: string) => {
  TZ = tz;
};
export const timeZone = () => TZ;

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts });

export function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  return fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return fmt({ hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDay(iso?: string | null) {
  if (!iso) return "—";
  return fmt({ weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}
/** For YYYY-MM-DD calendar dates (no zone conversion). */
export function fmtDate(date?: string | null) {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}
export function fmtDateShort(date?: string | null) {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

export function fmtMinutes(min?: number | null) {
  if (min === null || min === undefined) return "—";
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
export const fmtHours = (h?: number | null) => (h === null || h === undefined ? "—" : `${Number(h).toFixed(1)} h`);

export function fmtMoney(cents?: number | null) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}
export function fmtMoney2(cents?: number | null) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
export const centsToInput = (c?: number | null) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));

export function relative(iso: string) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return fmtDateTime(iso);
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" wall clock in the company zone (for datetime-local inputs). */
export function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const parts = Object.fromEntries(
    fmt({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Today (YYYY-MM-DD) in the company zone. */
export function todayLocal() {
  return toLocalInput(new Date().toISOString()).slice(0, 10);
}

export function addDaysStr(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function mondayOf(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDaysStr(date, -dow);
}

export const titleCase = (s?: string | null) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");
export const initials = (name?: string | null) =>
  (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
export const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${Math.ceil(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
