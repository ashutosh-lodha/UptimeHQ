import type { CheckOutcome, Range } from '../api/types';

/** Supported check intervals, in seconds. */
export const INTERVAL_OPTIONS = [
  { value: 5, label: 'Every 5 seconds' },
  { value: 10, label: 'Every 10 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every 1 minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 600, label: 'Every 10 minutes' },
];

export function formatInterval(seconds: number): string {
  return seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`;
}

export const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  SUCCESS: 'OK',
  AUTHENTICATION_FAILED: 'Auth failed',
  AUTHORIZATION_FAILED: 'Forbidden',
  TOKEN_ACQUISITION_FAILED: 'Token error',
  NETWORK_ERROR: 'Network error',
  TIMEOUT: 'Timeout',
  HTTP_STATUS_FAILURE: 'Bad status',
};

export const AUTH_LABEL = {
  NONE: 'None',
  BEARER: 'Bearer Token',
  BASIC: 'Basic Authentication',
  API_KEY: 'API Key',
  CUSTOM_HEADERS: 'Custom Headers',
  OAUTH2_CLIENT_CREDENTIALS: 'OAuth2 Client Credentials',
} as const;

export function formatPercent(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(v === 100 ? 0 : 2)}%`;
}

export function formatMs(v: number | null | undefined): string {
  if (v == null) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 0) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function chartTick(iso: string, range: Range): string {
  const d = new Date(iso);
  if (range === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function incidentDuration(i: { startedAt: string; resolvedAt: string | null; durationMs: number | null }): number {
  return i.durationMs ?? Date.now() - new Date(i.startedAt).getTime();
}
