/**
 * Structured, secret-safe SERVER-SIDE (terminal) logging for every upstream
 * call the scene-generation pipeline makes — to Higgsfield's own API, and
 * to whatever storage backend Higgsfield's presigned upload URLs point at.
 *
 * Why this exists: before this module, a failure here only ever produced a
 * bare `POST .../generate 502` line in the dev server terminal — nothing
 * about *why*. The actual detail (HTTP status, response body, which step
 * failed) was being computed (see `wrapHiggsfieldError`) but only ever
 * turned into a message string sent to the browser, never printed
 * server-side.
 *
 * Hard rule: never log an API key, secret, Authorization header, or the
 * VALUE of any query parameter on a presigned/signed URL — only its NAME.
 * An upstream response BODY (e.g. an S3 XML error) is logged in full,
 * since that's the entire point here and it contains the *upstream's*
 * diagnostic text about our request, not our credentials.
 */

const PREFIX = "[higgsfield]";

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Logs the start (or successful completion) of an upstream step — never sensitive data. */
export function logStep(step: string, detail?: Record<string, unknown>): void {
  console.log(`${PREFIX} ${step}`, detail ? safeJson(detail) : "");
}

/**
 * Reports on the *shape* of a credential string without ever printing the
 * key/secret material itself — catches the "accidental whitespace or
 * quotes pasted into .env.local" class of bug the format-check alone can't
 * distinguish from "wrong key entirely".
 */
export function describeCredentialShape(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return { set: false };
  if (raw.length === 0) return { set: true, empty: true };

  const trimmed = raw.trim();
  const [keyPart, secretPart] = raw.split(":");

  return {
    set: true,
    totalLength: raw.length,
    hasSurroundingWhitespace: trimmed !== raw,
    hasSurroundingQuotes: /^["'].*["']$/.test(raw),
    colonCount: (raw.match(/:/g) ?? []).length,
    keyIdLength: keyPart?.length ?? 0,
    secretLength: secretPart?.length ?? 0,
  };
}

/** Host + path + query PARAM NAMES ONLY — never a value, since presigned-URL values carry signatures. */
export function describeUrlForLogging(url: string | undefined): Record<string, unknown> | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      path: parsed.pathname,
      queryParamNames: Array.from(parsed.searchParams.keys()),
    };
  } catch {
    return { unparsable: true };
  }
}

/** Narrow shape of an axios-style error, without depending on axios's types here. */
export interface AxiosLikeError {
  response?: { status?: number; statusText?: string; data?: unknown };
  config?: { url?: string; method?: string; headers?: Record<string, unknown> };
  message: string;
}

export function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === "object" && error !== null && "response" in error && "message" in error;
}

/**
 * The core diagnostic dump. Call this at the exact point an upstream call
 * is caught (so it's working with the real error object, not a message
 * string that's already lost detail) and it prints everything needed to
 * root-cause the failure server-side: which step, HTTP status + status
 * text, full response body, request URL (secrets redacted), request
 * method, request Content-Type, and a stack trace.
 */
export function logUpstreamFailure(step: string, error: unknown): void {
  const summary: Record<string, unknown> = { step };

  if (isAxiosLikeError(error)) {
    const requestHeaders = error.config?.headers ?? {};
    summary.errorKind = "http";
    summary.httpStatus = error.response?.status;
    summary.httpStatusText = error.response?.statusText;
    summary.requestMethod = error.config?.method;
    summary.requestUrl = describeUrlForLogging(error.config?.url);
    summary.requestContentType = requestHeaders["Content-Type"] ?? requestHeaders["content-type"];
    summary.responseBody = error.response?.data;
    summary.message = error.message;
  } else if (error instanceof Error) {
    summary.errorKind = error.name;
    summary.message = error.message;
  } else {
    summary.errorKind = "unknown";
    summary.value = String(error);
  }

  console.error(`${PREFIX} UPSTREAM FAILURE`, safeJson(summary));
  if (error instanceof Error && error.stack) {
    console.error(`${PREFIX} stack trace:`, error.stack);
  }
}
