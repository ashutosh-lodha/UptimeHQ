import { useState } from 'react';
import { api } from '../api/client';
import type { Incident, Monitor, MonitorStats, Range } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { Link, useRouter } from '../lib/router';
import { useMonitorActions } from '../lib/useMonitorActions';
import { AUTH_LABEL, formatDateTime, formatInterval, formatMs, formatPercent, formatRelative } from '../lib/format';
import { EmptyState, ErrorState, MetricCard, PageHeader, RangeFilter, Spinner, StatusBadge } from '../components/ui';
import { ResponseChart } from '../components/ResponseChart';
import { IncidentTable } from '../components/IncidentTable';
import { RecentChecks } from '../components/RecentChecks';

interface DetailData {
  monitor: Monitor;
  stats: MonitorStats;
  incidents: Incident[];
}

export function MonitorDetailPage({ id }: { id: string }) {
  const { navigate } = useRouter();
  const [range, setRange] = useState<Range>('24h');
  const { data, error, loading, reload } = useAsync<DetailData>(
    async () => {
      const [m, stats, incidents] = await Promise.all([
        api<{ monitor: Monitor }>(`/monitors/${id}`),
        api<MonitorStats>(`/monitors/${id}/stats?range=${range}`),
        api<{ incidents: Incident[] }>(`/incidents?monitorId=${id}&range=${range}`),
      ]);
      return { monitor: m.monitor, stats, incidents: incidents.incidents };
    },
    [id, range],
    30_000,
  );
  const actions = useMonitorActions({
    onChanged: (m) => (m ? void reload() : navigate('/monitors', { replace: true })),
  });

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const { monitor, stats, incidents } = data;

  return (
    <>
      <div className="breadcrumb">
        <Link to="/monitors">Monitors</Link> <span aria-hidden="true">/</span> <span>{monitor.name}</span>
      </div>
      <PageHeader
        title={monitor.name}
        subtitle={
          <span className="url-line">
            <StatusBadge status={monitor.status} />
            <span className="method">{monitor.method}</span>
            <a href={monitor.url} target="_blank" rel="noreferrer noopener" className="link truncate">
              {monitor.url}
            </a>
          </span>
        }
        actions={
          <>
            <Link to={`/monitors/${monitor.id}/edit`} className="btn btn-secondary">
              Edit
            </Link>
            {monitor.enabled ? (
              <button className="btn btn-secondary" onClick={() => actions.askPause(monitor)}>
                Pause
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => actions.resume(monitor)}>
                Resume
              </button>
            )}
            <button className="btn btn-danger-outline" onClick={() => actions.askDelete(monitor)}>
              Delete
            </button>
          </>
        }
      />

      {monitor.status === 'DOWN' && monitor.lastError && (
        <div className="alert alert-error" role="alert">
          <strong>Currently down:</strong> {monitor.lastError}
        </div>
      )}
      {monitor.status === 'PENDING' && (
        <div className="alert alert-info">The first check has been queued. Results appear here once the worker has run it.</div>
      )}

      <div className="metric-grid">
        <MetricCard
          label="Current status"
          value={<StatusBadge status={monitor.status} />}
          hint={monitor.lastStatusCode ? `HTTP ${monitor.lastStatusCode}` : undefined}
        />
        <MetricCard label="Response time" value={formatMs(monitor.lastResponseTimeMs)} hint={`Avg ${formatMs(stats.avgResponseMs)} in period`} />
        <MetricCard label="Last checked" value={formatRelative(monitor.lastCheckedAt)} hint={`Every ${formatInterval(monitor.intervalSeconds)}`} />
        <MetricCard
          label="Uptime"
          value={formatPercent(stats.uptime)}
          tone={stats.uptime != null && stats.uptime < 99 ? 'down' : undefined}
          hint={`${stats.total} checks · ${stats.incidentCount} incidents`}
        />
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Response time</h2>
          <RangeFilter value={range} onChange={setRange} />
        </div>
        <ResponseChart series={stats.series} range={range} />
      </section>

      <div className="two-col">
        <RecentChecks monitorId={monitor.id} range={range} />
        <section className="card card-flush">
          <div className="card-header padded">
            <h2>Incidents</h2>
          </div>
          {incidents.length === 0 ? (
            <EmptyState title="No incidents in this period" />
          ) : (
            <IncidentTable incidents={incidents} showMonitor={false} />
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Configuration</h2>
        </div>
        <dl className="config-list">
          <div>
            <dt>Method</dt>
            <dd>{monitor.method}</dd>
          </div>
          <div>
            <dt>Interval</dt>
            <dd>Every {formatInterval(monitor.intervalSeconds)}</dd>
          </div>
          <div>
            <dt>Timeout</dt>
            <dd>{monitor.timeoutMs} ms</dd>
          </div>
          <div>
            <dt>Expected status</dt>
            <dd>
              {monitor.expectedStatusMin}–{monitor.expectedStatusMax}
            </dd>
          </div>
          <div>
            <dt>Authentication</dt>
            <dd>
              {AUTH_LABEL[monitor.authType]}
              {monitor.hasCredentials && <span className="muted small"> · credentials configured</span>}
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDateTime(monitor.createdAt)}</dd>
          </div>
        </dl>
      </section>
      {actions.dialog}
    </>
  );
}
