// Everything the test lab can simulate. The server, the page, the monitor list and the tests
// all read this file, so a scenario only has to be described once.
import { createHmac } from 'node:crypto';

export const BASE = '/testlab';

/**
 * Ways an endpoint can behave. `expect` is the outcome UptimeHQ records.
 * `status` answers with that code; `action` is handled by the server; `to` redirects the
 * checker, which is how failures below the HTTP layer (DNS, TLS, TCP) are produced for real.
 */
export const MODES = {
  healthy: { group: 'Up', label: 'Healthy (200)', status: 200, expect: 'SUCCESS' },
  'no-content': { group: 'Up', label: 'No content (204)', status: 204, expect: 'SUCCESS' },
  slow: { group: 'Up', label: 'Slow but healthy (2.5 s)', status: 200, delayMs: 2500, expect: 'SUCCESS' },
  redirect: { group: 'Up', label: 'Redirect to a healthy page', to: 'healthy', expect: 'SUCCESS' },

  500: { group: 'Server errors', label: 'Internal server error (500)', status: 500, expect: 'HTTP_STATUS_FAILURE' },
  502: { group: 'Server errors', label: 'Bad gateway (502)', status: 502, expect: 'HTTP_STATUS_FAILURE' },
  503: { group: 'Server errors', label: 'Service unavailable (503)', status: 503, expect: 'HTTP_STATUS_FAILURE' },
  504: { group: 'Server errors', label: 'Gateway timeout (504)', status: 504, expect: 'HTTP_STATUS_FAILURE' },

  400: { group: 'Unexpected status', label: 'Bad request (400)', status: 400, expect: 'HTTP_STATUS_FAILURE' },
  404: { group: 'Unexpected status', label: 'Not found (404)', status: 404, expect: 'HTTP_STATUS_FAILURE' },
  405: { group: 'Unexpected status', label: 'Method not allowed (405)', status: 405, expect: 'HTTP_STATUS_FAILURE' },
  410: { group: 'Unexpected status', label: 'Gone (410)', status: 410, expect: 'HTTP_STATUS_FAILURE' },
  429: { group: 'Unexpected status', label: 'Too many requests (429)', status: 429, expect: 'HTTP_STATUS_FAILURE' },
  'redirect-loop': { group: 'Unexpected status', label: 'Redirect loop', to: 'loop', expect: 'HTTP_STATUS_FAILURE' },

  401: { group: 'Access', label: 'Rejected credentials (401)', status: 401, expect: 'AUTHENTICATION_FAILED' },
  403: { group: 'Access', label: 'Access denied (403)', status: 403, expect: 'AUTHORIZATION_FAILED' },

  timeout: { group: 'Timeout', label: 'No response (timeout)', action: 'hang', expect: 'TIMEOUT' },
  blackhole: { group: 'Timeout', label: 'Connection never completes', to: 'blackhole', expect: 'TIMEOUT' },

  drop: { group: 'Network', label: 'Connection reset', action: 'drop', expect: 'NETWORK_ERROR' },
  refused: { group: 'Network', label: 'Connection refused', to: 'refused', expect: 'NETWORK_ERROR' },
  dns: { group: 'Network', label: 'DNS failure', to: 'dns', expect: 'NETWORK_ERROR' },
  unreachable: { group: 'Network', label: 'Host unreachable', to: 'unreachable', expect: 'NETWORK_ERROR' },
  tls: { group: 'Network', label: 'TLS certificate problem', to: 'tls', expect: 'NETWORK_ERROR' },
  blocked: { group: 'Network', label: 'Unsafe (private) destination', to: 'blocked', expect: 'NETWORK_ERROR' },

  flapping: { group: 'Advanced', label: 'Flapping (up 1 min, down 1 min)', action: 'flap', expect: null },
  stall: { group: 'Advanced', label: 'Headers sent, body hangs', action: 'stall', expect: null },
  custom: { group: 'Advanced', label: 'Custom response…', action: 'custom', expect: null },
};

/** Failures that only make sense on an OAuth2 token endpoint. */
export const TOKEN_MODES = {
  healthy: { group: 'Up', label: 'Issue tokens normally', action: 'issue' },
  'invalid-client': { group: 'Token failures', label: 'Reject the client (invalid_client)', status: 401, body: { error: 'invalid_client' } },
  unavailable: { group: 'Token failures', label: 'Token server down (503)', status: 503, body: { error: 'temporarily_unavailable' } },
  'no-token': { group: 'Token failures', label: 'Response without a token', status: 200, body: { message: 'no token here' } },
  'wrong-type': { group: 'Token failures', label: 'Wrong token type', status: 200, body: { access_token: 'unused', token_type: 'mac' } },
  'token-redirect': { group: 'Token failures', label: 'Redirect (not followed)', status: 302, body: {} },
  'token-timeout': { group: 'Token failures', label: 'No response (timeout)', action: 'hang' },
};

/** Endpoints whose behaviour is switched from the page. */
export const ENDPOINTS = {
  website: { name: 'Website', auth: 'NONE', method: 'GET', format: 'text' },
  api: { name: 'JSON API', auth: 'NONE', method: 'GET', format: 'json' },
  head: { name: 'HEAD health check', auth: 'NONE', method: 'HEAD', format: 'text' },
  bearer: { name: 'Bearer token API', auth: 'BEARER', method: 'GET', format: 'json' },
  basic: { name: 'Basic auth API', auth: 'BASIC', method: 'GET', format: 'json' },
  'api-key': { name: 'API key API', auth: 'API_KEY', method: 'GET', format: 'json' },
  headers: { name: 'Custom headers API', auth: 'CUSTOM_HEADERS', method: 'GET', format: 'json' },
  oauth: { name: 'OAuth2 API', auth: 'OAUTH2_CLIENT_CREDENTIALS', method: 'GET', format: 'json' },
  token: { name: 'OAuth2 token server', auth: 'TOKEN', method: 'POST', format: 'json' },
};

export const modesFor = (id) => (id === 'token' ? TOKEN_MODES : MODES);

/** Test-only credentials, different on every installation because they derive from its password. */
export function credentials(password) {
  const derive = (label) => createHmac('sha256', password).update(`testlab:${label}`).digest('hex').slice(0, 32);
  return {
    BEARER: { type: 'BEARER', token: derive('bearer') },
    BASIC: { type: 'BASIC', username: 'lab-user', password: derive('basic') },
    API_KEY: { type: 'API_KEY', headerName: 'X-API-Key', value: derive('api-key') },
    CUSTOM_HEADERS: {
      type: 'CUSTOM_HEADERS',
      headers: [
        { name: 'X-Lab-Client', value: derive('client') },
        { name: 'X-Lab-Secret', value: derive('secret') },
      ],
    },
    OAUTH2_CLIENT_CREDENTIALS: { type: 'OAUTH2_CLIENT_CREDENTIALS', clientId: 'lab-client', clientSecret: derive('oauth') },
  };
}

/**
 * Monitor definitions covering every endpoint type and every kind of downtime.
 * Flapping and the stalled body are left out: one floods the inbox, the other is not a failure.
 */
export function monitorList(publicUrl, password) {
  const creds = credentials(password);
  const common = { expectedStatusMin: 200, expectedStatusMax: 399, timeoutMs: 8000 };
  const list = [];

  for (const [id, e] of Object.entries(ENDPOINTS)) {
    if (id === 'token') continue;
    const auth = e.auth === 'NONE' ? { type: 'NONE' } : { ...creds[e.auth] };
    if (id === 'oauth') auth.tokenUrl = `${publicUrl}/e/token`;
    list.push({ ...common, name: `Lab: ${e.name}`, url: `${publicUrl}/e/${id}`, method: e.method, intervalSeconds: 30, auth });
  }
  for (const [id, m] of Object.entries(MODES)) {
    if (!m.expect || m.expect === 'SUCCESS') continue;
    list.push({ ...common, name: `Sim: ${m.label}`, url: `${publicUrl}/s/${id}`, method: 'GET', intervalSeconds: 300, auth: { type: 'NONE' } });
  }
  for (const id of ['invalid-client', 'unavailable']) {
    list.push({
      ...common,
      name: `Sim: OAuth2 ${TOKEN_MODES[id].label}`,
      url: `${publicUrl}/s/healthy`,
      method: 'GET',
      intervalSeconds: 300,
      auth: { type: 'OAUTH2_CLIENT_CREDENTIALS', clientId: 'simulated-client', clientSecret: 'simulated-not-a-secret', tokenUrl: `${publicUrl}/t/${id}` },
    });
  }
  return list;
}
