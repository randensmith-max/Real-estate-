/** Thin fetch wrapper: JSON in/out, CSRF header, consistent errors. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
    public details?: { code?: string; fields?: Record<string, string> } & Record<string, unknown>,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[] | undefined;

async function request<T>(method: string, url: string, body?: Json | FormData): Promise<T> {
  const headers: Record<string, string> = { "X-Flatland-Request": "1" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const details = data.details as ApiError["details"];
    const err = new ApiError(res.status, (data.error as string) || `Request failed (${res.status})`, (data.fields as Record<string, string>) || details?.fields, details);
    if (res.status === 401 && !url.startsWith("/auth/")) window.dispatchEvent(new Event("flatland:unauthorized"));
    if (details?.code === "PASSWORD_CHANGE_REQUIRED") window.dispatchEvent(new Event("flatland:password-change"));
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T = Record<string, any>>(url: string) => request<T>("GET", url),
  post: <T = Record<string, any>>(url: string, body?: Json | FormData) => request<T>("POST", url, body ?? {}),
  put: <T = Record<string, any>>(url: string, body?: Json) => request<T>("PUT", url, body ?? {}),
  del: <T = Record<string, any>>(url: string) => request<T>("DELETE", url),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
