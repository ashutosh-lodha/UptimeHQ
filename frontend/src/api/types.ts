export type Range = '24h' | '7d' | '30d';
export type AuthType = 'NONE' | 'BEARER' | 'BASIC' | 'API_KEY' | 'CUSTOM_HEADERS' | 'OAUTH2_CLIENT_CREDENTIALS';
export type CheckOutcome =
  | 'SUCCESS'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_FAILED'
  | 'TOKEN_ACQUISITION_FAILED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'HTTP_STATUS_FAILURE';
export type MonitorStatus = 'PENDING' | 'UP' | 'DOWN' | 'PAUSED';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Monitor {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  enabled: boolean;
  status: MonitorStatus;
  authType: AuthType;
  hasCredentials: boolean;
  lastCheckedAt: string | null;
  lastResponseTimeMs: number | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  uptime24h?: number | null;
}

export interface MonitorInput {
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  auth?: AuthInput;
}

export type AuthInput =
  | { type: 'NONE' }
  | { type: 'BEARER'; token: string }
  | { type: 'BASIC'; username: string; password: string }
  | { type: 'API_KEY'; headerName: string; value: string }
  | { type: 'CUSTOM_HEADERS'; headers: { name: string; value: string }[] }
  | {
      type: 'OAUTH2_CLIENT_CREDENTIALS';
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope?: string;
      clientAuthMethod?: 'client_secret_basic' | 'client_secret_post';
    };

export interface SeriesPoint {
  timestamp: string;
  avgResponseMs: number | null;
  uptime: number | null;
  total: number;
}

export interface Incident {
  id: string;
  monitorId: string;
  monitorName: string;
  startedAt: string;
  resolvedAt: string | null;
  durationMs: number | null;
  cause: string;
  open: boolean;
}

export interface MonitorCheck {
  id: string;
  checkedAt: string;
  success: boolean;
  outcome: CheckOutcome;
  statusCode: number | null;
  responseTimeMs: number | null;
  error: string | null;
}

export interface CheckPage {
  checks: MonitorCheck[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface DashboardData {
  range: Range;
  monitors: { total: number; up: number; down: number; paused: number; pending: number };
  uptime: number | null;
  avgResponseMs: number | null;
  totalChecks: number;
  series: SeriesPoint[];
  recentIncidents: Incident[];
}

export interface MonitorStats {
  range: Range;
  uptime: number | null;
  avgResponseMs: number | null;
  total: number;
  incidentCount: number;
  series: SeriesPoint[];
}

export interface NotificationSettings {
  emailEnabled: boolean;
  email: string;
  notifyOnDown: boolean;
  notifyOnRecovery: boolean;
}

export interface Delivery {
  id: string;
  type: 'DOWN' | 'RECOVERY';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  recipient: string | null;
  error: string | null;
  monitorName: string;
  createdAt: string;
  sentAt: string | null;
}
