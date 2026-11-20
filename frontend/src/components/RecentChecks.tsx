import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CheckPage, Range } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { OUTCOME_LABEL, formatDateTime, formatMs } from '../lib/format';
import { EmptyState, ErrorState } from './ui';

const PAGE_SIZE = 10;
type Filter = 'all' | 'failed';

/**
 * Paginated check history for one monitor. Only the first page auto-refreshes,
 * so rows don't shift under you while you browse older checks.
 */
export function RecentChecks({ monitorId, range }: { monitorId: string; range: Range }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('all');

  // Back to the newest checks whenever the period or filter changes.
  useEffect(() => setPage(1), [monitorId, range, filter]);

  const { data, error, loading, reload } = useAsync<CheckPage>(
    () => api<CheckPage>(`/monitors/${monitorId}/checks?range=${range}&limit=${PAGE_SIZE}&page=${page}&result=${filter}`),
    [monitorId, range, filter, page],
    page === 1 ? 30_000 : undefined,
  );

  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  // If the data shrank (e.g. retention pruning), don't strand the user past the last page.
  useEffect(() => {
    if (data && page > data.pageCount) setPage(data.pageCount);
  }, [data, page]);

  return (
    <section className="card card-flush">
      <div className="card-header padded">
        <h2>Recent checks</h2>
        <div className="segmented" role="tablist" aria-label="Filter checks">
          {(['all', 'failed'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : 'Failed'}
            </button>
          ))}
        </div>
      </div>

      {error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data && data.checks.length === 0 ? (
        <EmptyState title={filter === 'failed' ? 'No failed checks in this period' : 'No checks in this period'} />
      ) : (
        <div className={`table-wrap ${loading && data ? 'is-refreshing' : ''}`} aria-busy={loading}>
          <table className="table table-stack">
            <thead>
              <tr>
                <th>Time</th>
                <th>Result</th>
                <th className="num">Status</th>
                <th className="num">Response</th>
              </tr>
            </thead>
            <tbody>
              {(data?.checks ?? []).map((c) => (
                <tr key={c.id} title={c.error ?? undefined}>
                  <td className="nowrap" data-label="Time">
                    {formatDateTime(c.checkedAt)}
                  </td>
                  <td data-label="Result">
                    <span className={`pill ${c.success ? 'pill-up' : 'pill-down'}`}>{OUTCOME_LABEL[c.outcome] ?? (c.success ? 'OK' : 'Failed')}</span>
                    {c.error && <div className="muted small cell-wrap">{c.error}</div>}
                  </td>
                  <td className="num" data-label="Status">
                    {c.statusCode ?? '—'}
                  </td>
                  <td className="num" data-label="Response">
                    {formatMs(c.responseTimeMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="pager">
          <span className="muted small">
            {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="pager-buttons">
            <button className="btn btn-secondary btn-sm" onClick={() => setPage(1)} disabled={page <= 1 || loading} aria-label="Newest checks">
              «
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
              Newer
            </button>
            <span className="small pager-page">
              Page {page.toLocaleString()} of {pageCount.toLocaleString()}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount || loading}>
              Older
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
