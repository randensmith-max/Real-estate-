import { z } from "zod";
import { badRequest } from "./errors.js";

/** Trimmed optional text: "" becomes null. */
export const optText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const reqText = (max = 200) => z.string().trim().min(1, "Required").max(max);

export const optEmail = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address");

export const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")).pipe(z.string().max(200));

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const optDate = isoDate.nullish().or(z.literal("")).transform((v) => (v ? v : null));

/** Local wall-clock "YYYY-MM-DDTHH:mm" (interpreted in the company zone) or full ISO. */
export const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Enter a date and time");
export const optDateTime = dateTime.nullish().or(z.literal("")).transform((v) => (v ? v : null));

export const optNumber = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Enter a number" });
      return z.NEVER;
    }
    return n;
  });

export const optId = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
  .nullish()
  .or(z.literal(""))
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)));

/** Money entered in dollars → integer cents. */
export const optMoney = optNumber.transform((v, ctx) => {
  if (v === null) return null;
  if (v < 0) {
    ctx.addIssue({ code: "custom", message: "Must be zero or more" });
    return z.NEVER;
  }
  return Math.round(v * 100);
});

export function parseId(value: unknown, what = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${what}.`);
  return n;
}

export function pageParams(q: Record<string, unknown>, defaultLimit = 50) {
  const limit = Math.min(500, Math.max(1, Number(q.limit) || defaultLimit));
  const offset = Math.max(0, Number(q.offset) || 0);
  return { limit, offset };
}

/** Escape LIKE wildcards for safe "contains" search. */
export const likeContains = (s: string) => `%${s.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
