import { DateTime } from "luxon";
import type { DB } from "../db/db.js";

export const DEFAULT_TZ = "America/Chicago";

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function companyTz(db: DB): string {
  return getSetting(db, "timezone") || DEFAULT_TZ;
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.now().setZone(tz).isValid;
}

/** Monday (YYYY-MM-DD) of the week containing the given instant, in the company zone. */
export function weekStartOf(iso: string, tz: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).startOf("week").toISODate()!;
}

/** UTC ISO range [start, end) for the week beginning on the given Monday in the company zone. */
export function weekRange(weekStart: string, tz: string): { start: string; end: string } {
  const s = DateTime.fromISO(weekStart, { zone: tz }).startOf("day");
  return { start: s.toUTC().toISO()!, end: s.plus({ weeks: 1 }).toUTC().toISO()! };
}

export function dayRange(date: string, tz: string): { start: string; end: string } {
  const s = DateTime.fromISO(date, { zone: tz }).startOf("day");
  return { start: s.toUTC().toISO()!, end: s.plus({ days: 1 }).toUTC().toISO()! };
}

export function todayIn(tz: string): string {
  return DateTime.now().setZone(tz).toISODate()!;
}

export function isWeekStart(date: string, tz: string): boolean {
  const d = DateTime.fromISO(date, { zone: tz });
  return d.isValid && d.weekday === 1 && d.toISODate() === date;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

/**
 * Converts a wall-clock "YYYY-MM-DDTHH:mm" in the company zone to a UTC ISO string.
 * Full ISO strings carrying an offset or Z are accepted as-is.
 * Rejects wall-clock times that don't exist (spring-forward DST gap) instead of silently shifting them.
 */
export function localToUtc(value: string, tz: string): string {
  if (/[zZ]$|[+-]\d\d:\d\d$/.test(value)) {
    const dt = DateTime.fromISO(value, { setZone: true });
    if (!dt.isValid) throw new Error("Invalid date/time.");
    return dt.toUTC().toISO()!;
  }
  const dt = DateTime.fromISO(value, { zone: tz });
  if (!dt.isValid) throw new Error("Invalid date/time.");
  if (dt.toFormat("yyyy-MM-dd'T'HH:mm") !== value.slice(0, 16)) {
    throw new Error("That time does not exist in the company time zone (daylight-saving change).");
  }
  return dt.toUTC().toISO()!;
}

export function minutesBetween(a: string, b: string): number {
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / 60000);
}

export const nowIso = () => new Date().toISOString();
