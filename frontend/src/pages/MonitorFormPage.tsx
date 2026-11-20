import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { AuthType, Monitor, MonitorInput } from '../api/types';
import { Link, useRouter } from '../lib/router';
import { INTERVAL_OPTIONS } from '../lib/format';
import { useToast } from '../components/Toast';
import { ErrorState, Field, PageHeader, Spinner } from '../components/ui';
import { AuthFields, buildAuthInput, emptyAuthDraft, validateAuth, type AuthDraft } from '../components/AuthFields';

type BaseValues = Omit<MonitorInput, 'auth'>;

const DEFAULTS: BaseValues = {
  name: '',
  url: 'https://',
  method: 'GET',
  intervalSeconds: 300,
  timeoutMs: 10000,
  expectedStatusMin: 200,
  expectedStatusMax: 399,
};

function validate(v: BaseValues, authType: AuthType): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.name.trim()) e.name = 'Name is required';
  else if (v.name.length > 100) e.name = 'Name is too long';
  try {
    const u = new URL(v.url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') e.url = 'Only http and https URLs are allowed';
    else if (!u.hostname) e.url = 'URL must include a host';
    else if (authType !== 'NONE' && u.protocol !== 'https:') e.url = 'HTTPS is required when credentials are attached';
  } catch {
    e.url = 'Enter a full URL, e.g. https://example.com/health';
  }
  const maxTimeout = Math.min(30000, v.intervalSeconds * 1000);
  if (!Number.isInteger(v.timeoutMs) || v.timeoutMs < 1000 || v.timeoutMs > maxTimeout) {
    e.timeoutMs = `Timeout must be between 1000 and ${maxTimeout} ms`;
  }
  const okCode = (n: number) => Number.isInteger(n) && n >= 100 && n <= 599;
  if (!okCode(v.expectedStatusMin)) e.expectedStatusMin = 'Status must be 100–599';
  if (!okCode(v.expectedStatusMax)) e.expectedStatusMax = 'Status must be 100–599';
  else if (okCode(v.expectedStatusMin) && v.expectedStatusMin > v.expectedStatusMax) e.expectedStatusMax = 'Must be ≥ minimum';
  return e;
}

export function MonitorFormPage({ id }: { id?: string }) {
  const editing = Boolean(id);
  const { navigate } = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<BaseValues>(DEFAULTS);
  const [authDraft, setAuthDraft] = useState<AuthDraft>(emptyAuthDraft());
  /** When editing a monitor with stored credentials: keep them unless the user replaces/removes. */
  const [existingAuth, setExistingAuth] = useState<{ type: AuthType } | null>(null);
  const [keepExisting, setKeepExisting] = useState(false);
  const [encryptionAvailable, setEncryptionAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ credentialEncryption: boolean }>('/monitors/capabilities')
      .then((r) => setEncryptionAvailable(r.credentialEncryption))
      .catch(() => setEncryptionAvailable(null));
  }, []);

  const load = () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    api<{ monitor: Monitor }>(`/monitors/${id}`)
      .then(({ monitor: m }) => {
        setValues({
          name: m.name,
          url: m.url,
          method: m.method,
          intervalSeconds: m.intervalSeconds,
          timeoutMs: m.timeoutMs,
          expectedStatusMin: m.expectedStatusMin,
          expectedStatusMax: m.expectedStatusMax,
        });
        setAuthDraft(emptyAuthDraft(m.authType));
        if (m.hasCredentials) {
          setExistingAuth({ type: m.authType });
          setKeepExisting(true);
        }
      })
      .catch((err) => setLoadError(err))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  const set = <K extends keyof BaseValues>(k: K, v: BaseValues[K]) => setValues((s) => ({ ...s, [k]: v }));
  const num = (k: 'timeoutMs' | 'expectedStatusMin' | 'expectedStatusMax') => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, e.target.value === '' ? NaN : Number(e.target.value));

  const changeInterval = (seconds: number) =>
    setValues((s) => ({
      ...s,
      intervalSeconds: seconds,
      // Keep the timeout inside the new interval.
      timeoutMs: Number.isFinite(s.timeoutMs) ? Math.min(s.timeoutMs, seconds * 1000) : s.timeoutMs,
    }));

  const changeAuth = (d: AuthDraft) => {
    setAuthDraft(d);
    setKeepExisting(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: MonitorInput = { ...values, name: values.name.trim(), url: values.url.trim() };
    const effectiveType = keepExisting && existingAuth ? existingAuth.type : authDraft.type;
    const errs = { ...validate(payload, effectiveType), ...(keepExisting ? {} : validateAuth(authDraft)) };
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    // Omit `auth` to keep stored credentials; a new monitor without auth stays unchanged.
    if (!keepExisting && (authDraft.type !== 'NONE' || existingAuth)) payload.auth = buildAuthInput(authDraft);

    setBusy(true);
    try {
      const r = editing
        ? await api<{ monitor: Monitor }>(`/monitors/${id}`, { method: 'PATCH', body: payload })
        : await api<{ monitor: Monitor }>('/monitors', { method: 'POST', body: payload });
      toast.success(editing ? 'Monitor updated' : 'Monitor created — first check queued');
      navigate(`/monitors/${r.monitor.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details.length) {
        setErrors(err.fieldErrors());
        toast.error('Please fix the highlighted fields');
      } else toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  if (loadError) return <ErrorState error={loadError} onRetry={load} />;

  const maxTimeout = Math.min(30000, values.intervalSeconds * 1000);

  return (
    <>
      <PageHeader
        title={editing ? 'Edit monitor' : 'Add monitor'}
        subtitle={editing ? values.name : 'Check a website or API endpoint on a schedule'}
      />
      <form className="card form form-wide" onSubmit={submit} noValidate>
        <h2 className="form-section-title">Endpoint</h2>
        <div className="form-grid">
          <Field label="Name" htmlFor="name" error={errors.name}>
            <input id="name" value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="Production API" aria-invalid={!!errors.name} />
          </Field>
          <Field label="URL" htmlFor="url" error={errors.url} hint="Public http(s) address. Private and internal addresses are blocked.">
            <input id="url" type="url" value={values.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com/health" aria-invalid={!!errors.url} />
          </Field>
          <Field label="HTTP method" htmlFor="method">
            <select id="method" value={values.method} onChange={(e) => set('method', e.target.value as 'GET' | 'HEAD')}>
              <option value="GET">GET</option>
              <option value="HEAD">HEAD</option>
            </select>
          </Field>
          <Field label="Check interval" htmlFor="interval" error={errors.intervalSeconds}>
            <select id="interval" value={values.intervalSeconds} onChange={(e) => changeInterval(Number(e.target.value))}>
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timeout (ms)" htmlFor="timeout" error={errors.timeoutMs} hint={`1000–${maxTimeout} ms (cannot exceed the interval)`}>
            <input id="timeout" type="number" min={1000} max={maxTimeout} step={500} value={Number.isNaN(values.timeoutMs) ? '' : values.timeoutMs} onChange={num('timeoutMs')} aria-invalid={!!errors.timeoutMs} />
          </Field>
          <div className="field-pair">
            <Field label="Expected status from" htmlFor="smin" error={errors.expectedStatusMin}>
              <input id="smin" type="number" min={100} max={599} value={Number.isNaN(values.expectedStatusMin) ? '' : values.expectedStatusMin} onChange={num('expectedStatusMin')} aria-invalid={!!errors.expectedStatusMin} />
            </Field>
            <Field label="to" htmlFor="smax" error={errors.expectedStatusMax}>
              <input id="smax" type="number" min={100} max={599} value={Number.isNaN(values.expectedStatusMax) ? '' : values.expectedStatusMax} onChange={num('expectedStatusMax')} aria-invalid={!!errors.expectedStatusMax} />
            </Field>
          </div>
        </div>

        <AuthFields
          draft={authDraft}
          onChange={changeAuth}
          errors={errors}
          keepingExisting={keepExisting ? existingAuth : null}
          onReplace={() => changeAuth(emptyAuthDraft(existingAuth?.type ?? 'NONE'))}
          onRemove={() => changeAuth(emptyAuthDraft('NONE'))}
          encryptionAvailable={encryptionAvailable}
        />
        {existingAuth && !keepExisting && authDraft.type === 'NONE' && (
          <div className="alert alert-info">Saved credentials will be removed when you save.</div>
        )}

        <div className="form-actions">
          <Link to={editing ? `/monitors/${id}` : '/monitors'} className="btn btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create monitor'}
          </button>
        </div>
      </form>
    </>
  );
}
