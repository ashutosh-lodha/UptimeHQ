import type { CheckOutcome } from '@prisma/client';
import { assertSafeUrl, DnsResolutionError, SsrfError, systemLookup, type LookupFn } from './ssrf';

export interface CheckTarget {
  url: string;
  method: 'GET' | 'HEAD';
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  /** Authentication headers from the AuthService. Never sent to another origin. */
  headers?: Record<string, string>;
  /** When credentials are attached, 401/403 always count as failures. */
  authenticated?: boolean;
}

export interface CheckResult {
  success: boolean;
  outcome: CheckOutcome;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
}

export interface HttpCheckDeps {
  fetch?: typeof fetch;
  lookup?: LookupFn;
  now?: () => number;
}

export const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 1024 * 1024;
/**
 * What fetch reports when the connection ends before the body does. Deliberately a short list:
 * other read errors (e.g. a wrongly labelled gzip body) are about content, which checks don't judge.
 */
const CUT_OFF_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET']);

function statusOutcome(status: number, ok: boolean): CheckOutcome {
  if (ok) return 'SUCCESS';
  if (status === 401) return 'AUTHENTICATION_FAILED';
  if (status === 403) return 'AUTHORIZATION_FAILED';
  return 'HTTP_STATUS_FAILURE';
}

/**
 * Performs one HTTP check using native fetch. Redirects are followed manually so
 * that every hop is revalidated against the SSRF rules, and authentication
 * headers are dropped as soon as a redirect leaves the original origin.
 * Never throws: every failure mode is converted into an unsuccessful CheckResult.
 */
export async function performHttpCheck(target: CheckTarget, deps: HttpCheckDeps = {}): Promise<CheckResult> {
  const doFetch = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? systemLookup;
  const now = deps.now ?? (() => performance.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);
  const started = now();
  const elapsed = () => Math.max(0, Math.round(now() - started));

  let currentUrl = target.url;
  let method: 'GET' | 'HEAD' = target.method;
  let authHeaders: Record<string, string> = target.headers ?? {};
  let originalOrigin: string | null = null;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safeUrl = await assertSafeUrl(currentUrl, lookup);
      originalOrigin ??= safeUrl.origin;
      if (safeUrl.origin !== originalOrigin) authHeaders = {}; // never leak credentials cross-origin

      const headers = new Headers({ 'User-Agent': 'UptimeHQ-Monitor/1.0', Accept: '*/*' });
      for (const [k, v] of Object.entries(authHeaders)) headers.set(k, v);

      const response = await doFetch(safeUrl, { method, redirect: 'manual', signal: controller.signal, headers });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await discardBody(response);
        if (hop === MAX_REDIRECTS) {
          return {
            success: false,
            outcome: 'HTTP_STATUS_FAILURE',
            statusCode: response.status,
            responseTimeMs: elapsed(),
            error: `Too many redirects (>${MAX_REDIRECTS})`,
          };
        }
        currentUrl = new URL(location, safeUrl).toString();
        // 303 switches to GET; HEAD stays HEAD.
        if (response.status === 303 && method !== 'HEAD') method = 'GET';
        continue;
      }

      const bodyError = await discardBody(response);
      const responseTimeMs = elapsed();
      const inRange = response.status >= target.expectedStatusMin && response.status <= target.expectedStatusMax;
      // A server answering 401/403 to a request carrying credentials is never healthy.
      const authRejected = Boolean(target.authenticated) && (response.status === 401 || response.status === 403);
      const ok = inRange && !authRejected;
      // A healthy status is not enough if the body then fails. A failing status keeps its own, clearer error.
      if (ok && bodyError) {
        const failed = classifyBodyError(bodyError, controller.signal.aborted, target.timeoutMs, response.status);
        if (failed) return { success: false, ...failed, statusCode: response.status, responseTimeMs };
      }
      let error: string | null = null;
      if (!ok) {
        if (response.status === 401) error = 'Authentication failed (HTTP 401)';
        else if (response.status === 403) error = 'Authorization failed (HTTP 403)';
        else error = `Unexpected status code ${response.status} (expected ${target.expectedStatusMin}-${target.expectedStatusMax})`;
      }
      return { success: ok, outcome: statusOutcome(response.status, ok), statusCode: response.status, responseTimeMs, error };
    }
    return { success: false, outcome: 'HTTP_STATUS_FAILURE', statusCode: null, responseTimeMs: elapsed(), error: 'Too many redirects' };
  } catch (err) {
    const { error, outcome } = classifyError(err, controller.signal.aborted, target.timeoutMs);
    return { success: false, outcome, statusCode: null, responseTimeMs: null, error };
  } finally {
    clearTimeout(timer);
  }
}

/** Decides whether an error while reading the body fails the check; null means it does not. */
function classifyBodyError(err: unknown, aborted: boolean, timeoutMs: number, status: number): { error: string; outcome: CheckOutcome } | null {
  if (aborted) return { outcome: 'TIMEOUT', error: `Response body timed out after ${timeoutMs} ms (HTTP ${status})` };
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  if (code && CUT_OFF_CODES.has(code)) {
    return { outcome: 'NETWORK_ERROR', error: `Response body was cut off before it finished (HTTP ${status})` };
  }
  return null;
}

/** Reads and drops the body. Resolves with the error that interrupted reading, or null. */
async function discardBody(response: Response): Promise<unknown> {
  if (!response.body) return null;
  try {
    // Event streams never end by design: receiving the headers is the whole check.
    if (response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      await response.body.cancel();
      return null;
    }
    // Read at most MAX_BODY_BYTES so the timing covers the response, then cancel.
    const reader = response.body.getReader();
    let total = 0;
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) return null;
      total += value?.byteLength ?? 0;
    }
    await reader.cancel();
    return null;
  } catch (err) {
    return err;
  }
}

export function classifyError(err: unknown, aborted: boolean, timeoutMs: number): { error: string; outcome: CheckOutcome } {
  const timeout = (error: string) => ({ error, outcome: 'TIMEOUT' as const });
  const network = (error: string) => ({ error, outcome: 'NETWORK_ERROR' as const });

  if (aborted) return timeout(`Request timed out after ${timeoutMs} ms`);
  if (err instanceof SsrfError) return network(`Blocked destination: ${err.message}`);
  if (err instanceof DnsResolutionError) return network(err.message);
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return timeout(`Request timed out after ${timeoutMs} ms`);
  const code = e?.cause?.code;
  switch (code) {
    case 'ECONNREFUSED':
      return network('Connection refused');
    case 'ECONNRESET':
      return network('Connection reset by peer');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return network('DNS lookup failed');
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return timeout('Connection timed out');
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return network('Host unreachable');
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return network(`TLS error: ${code}`);
  }
  const msg = e?.cause?.message ?? e?.message ?? 'Unknown network error';
  return network(code ? `Network error (${code}): ${msg}` : `Network error: ${msg}`);
}
