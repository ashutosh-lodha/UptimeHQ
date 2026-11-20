/**
 * Every API request carries the user's Clerk session JWT. Clerk issues
 * short-lived tokens and refreshes them; getToken() always returns a valid one.
 */
let getSessionToken: (() => Promise<string | null>) | null = null;
export function setTokenGetter(fn: (() => Promise<string | null>) | null) {
  getSessionToken = fn;
}

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: FieldIssue[] = [],
  ) {
    super(message);
  }

  /** Maps validation issues to a { field: message } object for forms. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) if (d.path && !out[d.path]) out[d.path] = d.message;
    return out;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth !== false) {
    const token = await getSessionToken?.().catch(() => null);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Unable to reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(data?.details) ? (data.details as FieldIssue[]) : [];
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, details);
  }
  return data as T;
}
