import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = "You do not have permission to do that.") => new HttpError(403, msg);
export const notFound = (what = "Record") => new HttpError(404, `${what} not found.`);
export const conflict = (msg: string) => new HttpError(409, msg);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join(".") || "_"] = issue.message;
    return res.status(400).json({ error: "Please correct the highlighted fields.", fields });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  const e = err as { code?: string; message?: string; status?: number; type?: string };
  if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON body." });
  if (e?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File is too large (25 MB max)." });
  if (e?.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ error: "A record with the same unique value already exists." });
  }
  if (e?.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return res.status(400).json({ error: "A referenced record does not exist." });
  }
  console.error("[error]", err);
  res.status(500).json({ error: "Something went wrong on the server. The error has been logged." });
}
