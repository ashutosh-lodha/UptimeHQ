import { useState } from 'react';
import { api } from '../api/client';
import type { Incident, Range } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { EmptyState, ErrorState, PageHeader, RangeFilter, Spinner } from '../components/ui';
import { IncidentTable } from '../components/IncidentTable';

type Tab = 'open' | 'resolved';

export function IncidentsPage() {
  const [tab, setTab] = useState<Tab>('open');
  const [range, setRange] = useState<Range>('7d');
  const open = useAsync(() => api<{ incidents: Incident[] }>('/incidents?status=open'), [], 30_000);
  const resolved = useAsync(() => api<{ incidents: Incident[] }>(`/incidents?status=resolved&range=${range}`), [range], 60_000);
  const current = tab === 'open' ? open : resolved;

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Automatically opened when a monitor goes down, resolved when it recovers"
        actions={tab === 'resolved' ? <RangeFilter value={range} onChange={setRange} /> : undefined}
      />
      <section className="card card-flush">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Incident status">
            <button role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
              Open <span className="count">{open.data?.incidents.length ?? '…'}</span>
            </button>
            <button role="tab" aria-selected={tab === 'resolved'} className={tab === 'resolved' ? 'active' : ''} onClick={() => setTab('resolved')}>
              Resolved <span className="count">{resolved.data?.incidents.length ?? '…'}</span>
            </button>
          </div>
        </div>
        {current.loading && !current.data ? (
          <Spinner />
        ) : current.error && !current.data ? (
          <ErrorState error={current.error} onRetry={current.reload} />
        ) : current.data && current.data.incidents.length === 0 ? (
          <EmptyState
            title={tab === 'open' ? 'No open incidents' : 'No resolved incidents in this period'}
            message={tab === 'open' ? 'All active monitors are operational.' : 'Try a longer date range.'}
          />
        ) : current.data ? (
          <IncidentTable incidents={current.data.incidents} />
        ) : null}
      </section>
    </>
  );
}
