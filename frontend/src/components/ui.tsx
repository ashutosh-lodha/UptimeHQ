import type { ReactNode } from 'react';
import type { MonitorStatus, Range } from '../api/types';

const STATUS_LABEL: Record<MonitorStatus, string> = {
  UP: 'Operational',
  DOWN: 'Down',
  PAUSED: 'Paused',
  PENDING: 'Pending',
};

export function StatusBadge({ status }: { status: MonitorStatus }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      <span className="dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusDot({ status }: { status: MonitorStatus }) {
  return <span className={`status-dot status-dot-${status.toLowerCase()}`} title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]} />;
}

export function MetricCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'up' | 'down' | 'muted' }) {
  return (
    <div className={`card metric ${tone ? `metric-${tone}` : ''}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint && <div className="metric-hint">{hint}</div>}
    </div>
  );
}

const RANGES: { value: Range; label: string }[] = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export function RangeFilter({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Date range">
      {RANGES.map((r) => (
        <button key={r.value} className={value === r.value ? 'active' : ''} aria-pressed={value === r.value} onClick={() => onChange(r.value)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="state state-empty">
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <h3>Something went wrong</h3>
      <p>{error.message}</p>
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={`field ${error ? 'field-invalid' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <div className="field-error" id={`${htmlFor}-error`}>
          {error}
        </div>
      ) : (
        hint && <div className="field-hint">{hint}</div>
      )}
    </div>
  );
}
