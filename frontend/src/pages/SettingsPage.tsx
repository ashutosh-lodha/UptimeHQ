import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { Delivery, NotificationSettings } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { formatDateTime } from '../lib/format';
import { useToast } from '../components/Toast';
import { ErrorState, Field, PageHeader, Spinner } from '../components/ui';

interface NotificationsResponse {
  settings: NotificationSettings;
  smtpConfigured: boolean;
  deliveries: Delivery[];
}

function NotificationsCard() {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api<NotificationsResponse>('/settings/notifications'), []);
  const [form, setForm] = useState<NotificationSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const errs: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = 'Enter a valid email address';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api('/settings/notifications', { method: 'PUT', body: { ...form, email: form.email.trim() } });
      toast.success('Notification settings saved');
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setErrors(err.fieldErrors());
      else toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>Email notifications</h2>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data && form ? (
        <>
          {data.smtpConfigured ? (
            <div className="alert alert-success">SMTP is configured. Alerts are delivered by the background worker.</div>
          ) : (
            <div className="alert alert-warning" role="status">
              <strong>Email notifications are unavailable.</strong> SMTP has not been configured on the server. Monitoring continues normally;
              alerts are recorded as skipped until an administrator sets <code>SMTP_HOST</code> and <code>SMTP_FROM</code> (see README).
            </div>
          )}
          <form className="form" onSubmit={submit} noValidate>
            <label className="toggle">
              <input type="checkbox" checked={form.emailEnabled} onChange={(e) => setForm({ ...form, emailEnabled: e.target.checked })} />
              <span>Send email alerts</span>
            </label>
            <Field label="Alert recipient" htmlFor="alert-email" error={errors.email}>
              <input
                id="alert-email"
                type="email"
                value={form.email}
                disabled={!form.emailEnabled}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                aria-invalid={!!errors.email}
              />
            </Field>
            <fieldset className="checks" disabled={!form.emailEnabled}>
              <legend>Notify me when</legend>
              <label className="check">
                <input type="checkbox" checked={form.notifyOnDown} onChange={(e) => setForm({ ...form, notifyOnDown: e.target.checked })} />
                A monitor goes down
              </label>
              <label className="check">
                <input type="checkbox" checked={form.notifyOnRecovery} onChange={(e) => setForm({ ...form, notifyOnRecovery: e.target.checked })} />
                A monitor recovers
              </label>
            </fieldset>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save notification settings'}
              </button>
            </div>
          </form>
          <h3 className="section-title">Recent alert deliveries</h3>
          {data.deliveries.length === 0 ? (
            <p className="muted">No alerts have been triggered yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Monitor</th>
                    <th>Alert</th>
                    <th>Delivery</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="nowrap" data-label="Time">{formatDateTime(d.createdAt)}</td>
                      <td data-label="Monitor">{d.monitorName}</td>
                      <td data-label="Alert">
                        <span className={`pill ${d.type === 'DOWN' ? 'pill-down' : 'pill-up'}`}>{d.type === 'DOWN' ? 'Down' : 'Recovery'}</span>
                      </td>
                      <td data-label="Delivery">
                        <span className={`pill pill-${d.status.toLowerCase()}`}>{d.status.toLowerCase()}</span>
                      </td>
                      <td className="muted small cell-wrap" data-label="Details">{d.error ?? (d.recipient ? `to ${d.recipient}` : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Email alerts for incidents" />
      <div className="settings-grid">
        <NotificationsCard />
      </div>
    </>
  );
}
