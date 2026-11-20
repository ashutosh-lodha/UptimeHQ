import type { AuthInput, AuthType } from '../api/types';
import { AUTH_LABEL } from '../lib/format';
import { Field } from './ui';

export interface AuthDraft {
  type: AuthType;
  token: string;
  username: string;
  password: string;
  headerName: string;
  apiKey: string;
  headers: { name: string; value: string }[];
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

export const emptyAuthDraft = (type: AuthType = 'NONE'): AuthDraft => ({
  type,
  token: '',
  username: '',
  password: '',
  headerName: 'X-API-Key',
  apiKey: '',
  headers: [{ name: '', value: '' }],
  tokenUrl: '',
  clientId: '',
  clientSecret: '',
});

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESTRICTED = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'expect',
  'proxy-authorization',
  'proxy-connection',
  'authorization',
]);

function headerNameError(name: string): string | undefined {
  const n = name.trim();
  if (!n) return 'Header name is required';
  if (!HEADER_NAME_RE.test(n)) return 'Invalid characters in header name';
  const l = n.toLowerCase();
  if (RESTRICTED.has(l) || l.startsWith('proxy-') || l.startsWith('sec-')) return `"${n}" cannot be set`;
  return undefined;
}

const hasLineBreak = (v: string) => /[\r\n]/.test(v);

/** Client-side validation; keys match the API's error paths (auth.*). */
export function validateAuth(d: AuthDraft): Record<string, string> {
  const e: Record<string, string> = {};
  const req = (key: string, v: string, label: string) => {
    if (!v.trim()) e[key] = `${label} is required`;
    else if (hasLineBreak(v)) e[key] = `${label} cannot contain line breaks`;
  };
  switch (d.type) {
    case 'BEARER':
      req('auth.token', d.token, 'Token');
      break;
    case 'BASIC':
      req('auth.username', d.username, 'Username');
      if (d.username.includes(':')) e['auth.username'] = 'Username cannot contain ":"';
      req('auth.password', d.password, 'Password');
      break;
    case 'API_KEY': {
      const err = headerNameError(d.headerName);
      if (err) e['auth.headerName'] = err;
      req('auth.value', d.apiKey, 'API key');
      break;
    }
    case 'CUSTOM_HEADERS': {
      const seen = new Set<string>();
      d.headers.forEach((h, i) => {
        const err = headerNameError(h.name);
        if (err) e[`auth.headers.${i}.name`] = err;
        else if (seen.has(h.name.trim().toLowerCase())) e[`auth.headers.${i}.name`] = 'Duplicate header';
        seen.add(h.name.trim().toLowerCase());
        req(`auth.headers.${i}.value`, h.value, 'Value');
      });
      if (d.headers.length === 0) e['auth.headers'] = 'Add at least one header';
      break;
    }
    case 'OAUTH2_CLIENT_CREDENTIALS':
      try {
        if (new URL(d.tokenUrl.trim()).protocol !== 'https:') e['auth.tokenUrl'] = 'Token URL must use HTTPS';
      } catch {
        e['auth.tokenUrl'] = 'Enter a full URL, e.g. https://auth.example.com/oauth/token';
      }
      req('auth.clientId', d.clientId, 'Client ID');
      req('auth.clientSecret', d.clientSecret, 'Client secret');
      break;
  }
  return e;
}

export function buildAuthInput(d: AuthDraft): AuthInput {
  switch (d.type) {
    case 'NONE':
      return { type: 'NONE' };
    case 'BEARER':
      return { type: 'BEARER', token: d.token.trim() };
    case 'BASIC':
      return { type: 'BASIC', username: d.username.trim(), password: d.password };
    case 'API_KEY':
      return { type: 'API_KEY', headerName: d.headerName.trim(), value: d.apiKey };
    case 'CUSTOM_HEADERS':
      return { type: 'CUSTOM_HEADERS', headers: d.headers.map((h) => ({ name: h.name.trim(), value: h.value })) };
    case 'OAUTH2_CLIENT_CREDENTIALS':
      // Standard client credentials grant; client ID/secret are sent with HTTP Basic.
      return {
        type: 'OAUTH2_CLIENT_CREDENTIALS',
        clientId: d.clientId.trim(),
        clientSecret: d.clientSecret,
        tokenUrl: d.tokenUrl.trim(),
      };
  }
}

interface Props {
  draft: AuthDraft;
  onChange: (d: AuthDraft) => void;
  errors: Record<string, string>;
  /** Set when editing a monitor that already has stored credentials and they are being kept. */
  keepingExisting: { type: AuthType } | null;
  onReplace: () => void;
  onRemove: () => void;
  encryptionAvailable: boolean | null;
}

export function AuthFields({ draft, onChange, errors, keepingExisting, onReplace, onRemove, encryptionAvailable }: Props) {
  const set = <K extends keyof AuthDraft>(k: K, v: AuthDraft[K]) => onChange({ ...draft, [k]: v });
  const setHeader = (i: number, k: 'name' | 'value', v: string) =>
    set(
      'headers',
      draft.headers.map((h, j) => (j === i ? { ...h, [k]: v } : h)),
    );

  return (
    <fieldset className="auth-section">
      <legend>Authentication</legend>
      <div className="form-grid">
        <Field label="Method" htmlFor="auth-type" hint={draft.type === 'NONE' ? 'For public endpoints.' : 'Credentials are encrypted at rest and never shown again.'}>
          <select id="auth-type" value={draft.type} onChange={(e) => onChange(emptyAuthDraft(e.target.value as AuthType))}>
            {(Object.keys(AUTH_LABEL) as AuthType[]).map((t) => (
              <option key={t} value={t}>
                {AUTH_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {draft.type !== 'NONE' && encryptionAvailable === false && (
        <div className="alert alert-warning" role="status">
          The server cannot store credentials yet: <code>MONITOR_CREDENTIAL_ENCRYPTION_KEY</code> is not configured. See README.
        </div>
      )}

      {keepingExisting ? (
        <div className="credentials-box">
          <div>
            <strong>Credentials configured</strong>
            <div className="muted small">{AUTH_LABEL[keepingExisting.type]} · saved secrets are never displayed</div>
          </div>
          <div className="credentials-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onReplace}>
              Replace credentials
            </button>
            <button type="button" className="btn btn-danger-outline btn-sm" onClick={onRemove}>
              Remove credentials
            </button>
          </div>
        </div>
      ) : (
        <>
          {draft.type === 'BEARER' && (
            <Field label="Token" htmlFor="auth-token" error={errors['auth.token']} hint="Your existing JWT or access token, sent as Authorization: Bearer <token>">
              <input id="auth-token" type="password" autoComplete="off" value={draft.token} onChange={(e) => set('token', e.target.value)} placeholder="eyJhbGciOi…" />
            </Field>
          )}

          {draft.type === 'BASIC' && (
            <div className="form-grid">
              <Field label="Username" htmlFor="auth-user" error={errors['auth.username']}>
                <input id="auth-user" autoComplete="off" value={draft.username} onChange={(e) => set('username', e.target.value)} placeholder="monitor" />
              </Field>
              <Field label="Password" htmlFor="auth-pass" error={errors['auth.password']}>
                <input id="auth-pass" type="password" autoComplete="new-password" value={draft.password} onChange={(e) => set('password', e.target.value)} />
              </Field>
            </div>
          )}

          {draft.type === 'API_KEY' && (
            <div className="form-grid">
              <Field label="Header name" htmlFor="auth-hname" error={errors['auth.headerName']}>
                <input id="auth-hname" value={draft.headerName} onChange={(e) => set('headerName', e.target.value)} placeholder="X-API-Key" />
              </Field>
              <Field label="API key" htmlFor="auth-key" error={errors['auth.value']}>
                <input id="auth-key" type="password" autoComplete="off" value={draft.apiKey} onChange={(e) => set('apiKey', e.target.value)} />
              </Field>
            </div>
          )}

          {draft.type === 'CUSTOM_HEADERS' && (
            <div className="header-list">
              {draft.headers.map((h, i) => (
                <div className="header-row" key={i}>
                  <Field label={i === 0 ? 'Header name' : ''} htmlFor={`h-name-${i}`} error={errors[`auth.headers.${i}.name`]}>
                    <input id={`h-name-${i}`} value={h.name} onChange={(e) => setHeader(i, 'name', e.target.value)} placeholder="X-Client-ID" aria-label={`Header ${i + 1} name`} />
                  </Field>
                  <Field label={i === 0 ? 'Value' : ''} htmlFor={`h-val-${i}`} error={errors[`auth.headers.${i}.value`]}>
                    <input id={`h-val-${i}`} type="password" autoComplete="off" value={h.value} onChange={(e) => setHeader(i, 'value', e.target.value)} aria-label={`Header ${i + 1} value`} />
                  </Field>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm header-remove"
                    onClick={() => set('headers', draft.headers.filter((_, j) => j !== i))}
                    disabled={draft.headers.length === 1}
                    aria-label={`Remove header ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {errors['auth.headers'] && <div className="field-error">{errors['auth.headers']}</div>}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => set('headers', [...draft.headers, { name: '', value: '' }])}
                disabled={draft.headers.length >= 20}
              >
                + Add header
              </button>
              <p className="field-hint">Host, Content-Length, Connection, Authorization and similar headers cannot be set.</p>
            </div>
          )}

          {draft.type === 'OAUTH2_CLIENT_CREDENTIALS' && (
            <div className="form-grid">
              <Field label="Client ID" htmlFor="auth-cid" error={errors['auth.clientId']}>
                <input id="auth-cid" autoComplete="off" value={draft.clientId} onChange={(e) => set('clientId', e.target.value)} />
              </Field>
              <Field label="Client secret" htmlFor="auth-csec" error={errors['auth.clientSecret']}>
                <input id="auth-csec" type="password" autoComplete="off" value={draft.clientSecret} onChange={(e) => set('clientSecret', e.target.value)} />
              </Field>
              <Field label="Token URL" htmlFor="auth-turl" error={errors['auth.tokenUrl']} hint="HTTPS. A token is requested with the client credentials grant and reused until it expires.">
                <input id="auth-turl" type="url" value={draft.tokenUrl} onChange={(e) => set('tokenUrl', e.target.value)} placeholder="https://auth.example.com/oauth/token" />
              </Field>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
