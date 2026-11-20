import { useState } from 'react';
import { api } from '../api/client';
import type { DashboardData, Range } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { Link } from '../lib/router';
import { formatMs, formatPercent } from '../lib/format';
import { EmptyState, ErrorState, MetricCard, PageHeader, RangeFilter, Spinner } from '../components/ui';
import { ResponseChart } from '../components/ResponseChart';
import { IncidentTable } from '../components/IncidentTable';

export function DashboardPage() {
  const [range, setRange] = useState<Range>('24h');
  const { data, error, loading, reload } = useAsync(() => api<DashboardData>(`/dashboard?range=${range}`), [range], 60_000);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of all your monitors" actions={<RangeFilter value={range} onChange={setRange} />} />
      {loading && !data ? (
        <Spinner />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data ? (
        data.monitors.total === 0 ? (
          <div className="card">
            <EmptyState
              title="No monitors yet"
              message="Add your first website or API endpoint to start collecting uptime and response-time data."
              action={
                <Link to="/monitors/new" className="btn btn-primary">
                  Add monitor
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <div className="metric-grid">
              <MetricCard label="Total monitors" value={data.monitors.total} hint={data.monitors.pending ? `${data.monitors.pending} awaiting first check` : undefined} />
              <MetricCard label="Operational" value={data.monitors.up} tone="up" />
              <MetricCard label="Down" value={data.monitors.down} tone={data.monitors.down ? 'down' : undefined} />
              <MetricCard label="Paused" value={data.monitors.paused} tone="muted" />
              <MetricCard
                label="Overall uptime"
                value={formatPercent(data.uptime)}
                hint={`${data.totalChecks.toLocaleString()} checks · avg ${formatMs(data.avgResponseMs)}`}
              />
            </div>
            <section className="card">
              <div className="card-header">
                <h2>Average response time</h2>
                <span className="muted small">Across all monitors</span>
              </div>
              <ResponseChart series={data.series} range={range} />
            </section>
            <section className="card">
              <div className="card-header">
                <h2>Recent incidents</h2>
                <Link to="/incidents" className="link">
                  View all
                </Link>
              </div>
              {data.recentIncidents.length === 0 ? (
                <EmptyState title="No incidents in this period" message="All monitored services stayed within their expected status range." />
              ) : (
                <IncidentTable incidents={data.recentIncidents} />
              )}
            </section>
          </>
        )
      ) : null}
    </>
  );
}
