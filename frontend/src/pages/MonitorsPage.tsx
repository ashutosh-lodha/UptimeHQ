import { useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Monitor } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { Link, useRouter } from '../lib/router';
import { useMonitorActions } from '../lib/useMonitorActions';
import { formatInterval, formatMs, formatPercent, formatRelative } from '../lib/format';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../components/ui';

type Filter = 'all' | 'UP' | 'DOWN' | 'PAUSED';

export function MonitorsPage() {
  const { navigate } = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useAsync(() => api<{ monitors: Monitor[] }>('/monitors'), [], 30_000);
  const actions = useMonitorActions({ onChanged: () => void reload() });

  const monitors = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.monitors ?? []).filter(
      (m) => (filter === 'all' || m.status === filter) && (!q || m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q)),
    );
  }, [data, filter, query]);

  const counts = useMemo(() => {
    const c = { all: 0, UP: 0, DOWN: 0, PAUSED: 0 };
    for (const m of data?.monitors ?? []) {
      c.all++;
      if (m.status in c) c[m.status as keyof typeof c]++;
    }
    return c;
  }, [data]);

  return (
    <>
      <PageHeader
        title="Monitors"
        subtitle="Websites and API endpoints checked on a schedule"
        actions={
          <Link to="/monitors/new" className="btn btn-primary">
            + Add monitor
          </Link>
        }
      />
      {loading && !data ? (
        <Spinner />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data && data.monitors.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No monitors yet"
            message="Create a monitor to check a URL every 5 or 10 minutes."
            action={
              <Link to="/monitors/new" className="btn btn-primary">
                Add monitor
              </Link>
            }
          />
        </div>
      ) : (
        <section className="card card-flush">
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Filter by status">
              {(['all', 'UP', 'DOWN', 'PAUSED'] as Filter[]).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f === 'UP' ? 'Operational' : f === 'DOWN' ? 'Down' : 'Paused'}
                  <span className="count">{counts[f]}</span>
                </button>
              ))}
            </div>
            <input className="search" type="search" placeholder="Search name or URL" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search monitors" />
          </div>
          {monitors.length === 0 ? (
            <EmptyState title="No matching monitors" message="Try a different filter or search term." />
          ) : (
            <div className="table-wrap">
              <table className="table table-hover table-stack">
                <thead>
                  <tr>
                    <th>Monitor</th>
                    <th>Status</th>
                    <th className="num">Uptime (24h)</th>
                    <th className="num">Response</th>
                    <th className="hide-md">Interval</th>
                    <th>Last check</th>
                    <th className="actions-col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {monitors.map((m) => (
                    <tr key={m.id} onClick={() => navigate(`/monitors/${m.id}`)} className="clickable">
                      <td className="cell-primary">
                        <Link to={`/monitors/${m.id}`} className="link-strong" onClick={(e) => e.stopPropagation()}>
                          {m.name}
                        </Link>
                        <div className="muted small truncate">
                          <span className="method">{m.method}</span> {m.url}
                        </div>
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="num" data-label="Uptime (24h)">{formatPercent(m.uptime24h)}</td>
                      <td className="num" data-label="Response">{formatMs(m.lastResponseTimeMs)}</td>
                      <td className="hide-md" data-label="Interval">{formatInterval(m.intervalSeconds)}</td>
                      <td className="nowrap muted" data-label="Last check">{formatRelative(m.lastCheckedAt)}</td>
                      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <Link to={`/monitors/${m.id}/edit`} className="btn btn-sm btn-ghost">
                            Edit
                          </Link>
                          {m.enabled ? (
                            <button className="btn btn-sm btn-ghost" onClick={() => actions.askPause(m)}>
                              Pause
                            </button>
                          ) : (
                            <button className="btn btn-sm btn-ghost" onClick={() => actions.resume(m)}>
                              Resume
                            </button>
                          )}
                          <button className="btn btn-sm btn-ghost btn-ghost-danger" onClick={() => actions.askDelete(m)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {actions.dialog}
    </>
  );
}
