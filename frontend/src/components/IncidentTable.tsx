import type { Incident } from '../api/types';
import { Link } from '../lib/router';
import { formatDateTime, formatDuration, incidentDuration } from '../lib/format';

export function IncidentTable({ incidents, showMonitor = true }: { incidents: Incident[]; showMonitor?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table table-stack">
        <thead>
          <tr>
            <th>Status</th>
            {showMonitor && <th>Monitor</th>}
            <th>Cause</th>
            <th>Started</th>
            <th>Resolved</th>
            <th className="num">Duration</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => (
            <tr key={i.id}>
              <td data-label="Status">
                <span className={`badge ${i.open ? 'badge-down' : 'badge-up'}`}>
                  <span className="dot" aria-hidden="true" />
                  {i.open ? 'Ongoing' : 'Resolved'}
                </span>
              </td>
              {showMonitor && (
                <td data-label="Monitor">
                  <Link to={`/monitors/${i.monitorId}`} className="link-strong">
                    {i.monitorName}
                  </Link>
                </td>
              )}
              <td className="cell-wrap muted" data-label="Cause">{i.cause}</td>
              <td className="nowrap" data-label="Started">{formatDateTime(i.startedAt)}</td>
              <td className="nowrap" data-label="Resolved">{i.resolvedAt ? formatDateTime(i.resolvedAt) : '—'}</td>
              <td className="num nowrap" data-label="Duration">{formatDuration(incidentDuration(i))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
