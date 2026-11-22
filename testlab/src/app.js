// UptimeHQ Test Lab: endpoints that fail on demand. No dependencies.
//
// It shares the main site's origin under /testlab, so:
//   - NGINX strips cookies before requests get here,
//   - simulated responses are never HTML and are sandboxed by CSP,
//   - redirects only go to the fixed targets in config.js (no open redirect),
//   - changing anything needs the password in a custom header (which also rules out CSRF).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { BASE, ENDPOINTS, MODES, TOKEN_MODES, credentials } from './catalogue.js';
import { InputError, createState } from './state.js';

const HANG_MS = 35_000; // longer than UptimeHQ's 30 s maximum timeout
const MAX_PENDING = 300; // cap on deliberately held-open requests
const MAX_INPUT = 16 * 1024;
const TOKEN_TTL_S = 300;

const PAGE_CSP = "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const SIM_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

const ASSETS = Object.fromEntries(
  [
    ['/', 'index.html', 'text/html'],
    ['/panel.js', 'panel.js', 'text/javascript'],
    ['/panel.css', 'panel.css', 'text/css'],
  ].map(([path, file, type]) => [path, { type, body: readFileSync(new URL(`../public/${file}`, import.meta.url)) }]),
);

const digest = (v) => createHash('sha256').update(String(v)).digest();
/** Constant-time comparison for strings of any length. */
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_INPUT) throw new InputError('Request is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createLab(config, { now = Date.now } = {}) {
  const state = createState(config.dataDir);
  const creds = credentials(config.password);
  const recent = [];
  let pending = 0;

  function send(res, status, body, { type = 'application/json', csp = SIM_CSP, headers = {} } = {}) {
    if (res.destroyed || res.headersSent) return;
    const empty = status === 204 || status === 205 || status === 304;
    const payload = empty ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': `${type}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': csp,
      ...headers,
    });
    res.end(payload);
  }

  /** Runs `done` after `ms`, unless the client goes away first. */
  function later(res, ms, done) {
    if (!ms) return done();
    if (pending >= MAX_PENDING) return send(res, 503, { error: 'Test lab is busy' });
    pending++;
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      pending--;
      return true;
    };
    const timer = setTimeout(() => finish() && done(), ms);
    res.on('close', () => {
      clearTimeout(timer);
      finish();
    });
  }

  function issueToken() {
    const payload = `${state.generation}.${now() + TOKEN_TTL_S * 1000}`;
    return `${payload}.${createHmac('sha256', config.password).update(payload).digest('hex')}`;
  }

  function validToken(token) {
    const [gen, expires, signature] = token.split('.');
    if (!signature || Number(gen) !== state.generation || !(Number(expires) > now())) return false;
    return same(signature, createHmac('sha256', config.password).update(`${gen}.${expires}`).digest('hex'));
  }

  function authorised(type, req) {
    const authorization = req.headers.authorization ?? '';
    const header = (name) => req.headers[name.toLowerCase()] ?? '';
    switch (type) {
      case 'NONE':
        return true;
      case 'BEARER':
        return same(authorization, `Bearer ${creds.BEARER.token}`);
      case 'BASIC':
        return same(authorization, `Basic ${Buffer.from(`${creds.BASIC.username}:${creds.BASIC.password}`).toString('base64')}`);
      case 'API_KEY':
        return same(header(creds.API_KEY.headerName), creds.API_KEY.value);
      case 'CUSTOM_HEADERS':
        return creds.CUSTOM_HEADERS.headers.every((h) => same(header(h.name), h.value));
      case 'OAUTH2_CLIENT_CREDENTIALS':
        return authorization.startsWith('Bearer ') && validToken(authorization.slice(7));
      default:
        return false;
    }
  }

  function simulate(res, modeId, { format = 'json', custom, hop = 0 } = {}) {
    let mode = MODES[modeId];
    if (mode.action === 'flap') mode = MODES[Math.floor(now() / 60_000) % 2 ? '503' : 'healthy'];

    if (mode.to) {
      const location =
        mode.to === 'healthy'
          ? `${BASE}/s/healthy`
          : mode.to === 'loop'
            ? `${BASE}/s/redirect-loop?hop=${(hop + 1) % 100}`
            : config.targets[mode.to];
      return send(res, 302, '', { type: 'text/plain', headers: { Location: location } });
    }
    if (mode.action === 'hang') return later(res, HANG_MS, () => send(res, 504, { error: 'Held open on purpose' }));
    if (mode.action === 'drop') {
      // NGINX intercepts this header and resets the connection (see @testlab_drop).
      return send(res, 200, '', { type: 'text/plain', headers: { 'X-Accel-Redirect': '@testlab_drop' } });
    }
    if (mode.action === 'stall') {
      if (pending >= MAX_PENDING) return send(res, 503, { error: 'Test lab is busy' });
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Security-Policy': SIM_CSP, 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      res.write('started\n');
      return later(res, HANG_MS, () => res.end('finished\n'));
    }
    if (mode.action === 'custom') {
      const { status, delayMs, body } = custom;
      return later(res, delayMs, () => send(res, status, body, { type: format === 'json' ? 'application/json' : 'text/plain' }));
    }
    return later(res, mode.delayMs, () =>
      send(
        res,
        mode.status,
        format === 'json' ? { status: mode.status, simulated: mode.label } : `${mode.status} ${mode.label}\n`,
        { type: format === 'json' ? 'application/json' : 'text/plain' },
      ),
    );
  }

  async function tokenEndpoint(req, res, modeId) {
    const mode = TOKEN_MODES[modeId];
    if (req.method !== 'POST') return send(res, 405, { error: 'invalid_request' });
    const form = new URLSearchParams(await readBody(req));
    if (mode.action === 'hang') return later(res, HANG_MS, () => send(res, 504, { error: 'temporarily_unavailable' }));
    if (!mode.action) {
      return send(res, mode.status, mode.body, { headers: mode.status === 302 ? { Location: `${BASE}/s/healthy` } : {} });
    }
    if (form.get('grant_type') !== 'client_credentials') return send(res, 400, { error: 'unsupported_grant_type' });

    let id = form.get('client_id') ?? '';
    let secret = form.get('client_secret') ?? '';
    const authorization = req.headers.authorization ?? '';
    if (authorization.startsWith('Basic ')) {
      // RFC 6749 section 2.3.1: both parts are form-encoded inside the Basic header.
      [id = '', secret = ''] = Buffer.from(authorization.slice(6), 'base64')
        .toString()
        .split(':')
        .map((part) => new URLSearchParams(`v=${part}`).get('v'));
    }
    const client = creds.OAUTH2_CLIENT_CREDENTIALS;
    if (!same(id, client.clientId) || !same(secret, client.clientSecret)) return send(res, 401, { error: 'invalid_client' });
    return send(res, 200, { access_token: issueToken(), token_type: 'Bearer', expires_in: TOKEN_TTL_S });
  }

  /** Never records header values, query strings, bodies or client addresses. */
  function record(req, res, path, note) {
    const entry = { at: now(), method: req.method, path: path.slice(0, 80), note, status: null };
    recent.unshift(entry);
    recent.length = Math.min(recent.length, 30);
    res.on('close', () => {
      entry.status = res.getHeader('x-accel-redirect') ? 'reset' : res.writableFinished ? res.statusCode : 'no response';
    });
  }

  async function control(req, res, path) {
    const reply = (status, body) => send(res, status, body, { csp: PAGE_CSP });
    if (!same(req.headers['x-lab-password'] ?? '', config.password)) return reply(401, { error: 'Wrong password' });

    if (req.method === 'GET' && path === '/control/state') {
      return reply(200, {
        publicUrl: config.publicUrl,
        endpoints: ENDPOINTS,
        modes: MODES,
        tokenModes: TOKEN_MODES,
        current: state.endpoints,
        credentials: creds,
        recent,
      });
    }
    if (req.method !== 'POST') return reply(404, { error: 'Not found' });

    let input;
    try {
      input = JSON.parse((await readBody(req)) || '{}');
    } catch (err) {
      if (err instanceof InputError) throw err;
      throw new InputError('Invalid JSON');
    }
    if (path === '/control/set') state.set(input?.id, input ?? {});
    else if (path === '/control/all' && typeof input?.healthy === 'boolean') state.setAll(input.healthy);
    else if (path === '/control/revoke') state.revokeTokens();
    else return reply(404, { error: 'Not found' });
    return reply(200, { ok: true });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://testlab');
    if (url.pathname === '/healthz') return send(res, 200, { status: 'ok' });
    if (url.pathname === BASE) return send(res, 308, '', { type: 'text/plain', headers: { Location: `${BASE}/` } });
    if (!url.pathname.startsWith(`${BASE}/`)) return send(res, 404, { error: 'Not found' });

    const path = url.pathname.slice(BASE.length);
    const readOnly = req.method === 'GET' || req.method === 'HEAD';

    if (readOnly && Object.hasOwn(ASSETS, path)) {
      return send(res, 200, ASSETS[path].body, { type: ASSETS[path].type, csp: PAGE_CSP });
    }
    if (path.startsWith('/control/')) return control(req, res, path);

    const [, kind, id, ...rest] = path.split('/');
    if (rest.length) return send(res, 404, { error: 'Not found' });

    if (kind === 'e' && Object.hasOwn(ENDPOINTS, id)) {
      const { mode, custom } = state.endpoints[id];
      if (id === 'token') {
        record(req, res, path, mode);
        return tokenEndpoint(req, res, mode);
      }
      if (!readOnly) return send(res, 405, { error: 'Use GET or HEAD' });
      const { auth, format } = ENDPOINTS[id];
      // A server that is down fails before it looks at credentials.
      if (mode === 'healthy' && !authorised(auth, req)) {
        record(req, res, path, 'credentials rejected');
        return send(res, 401, { error: 'Missing or wrong test credentials' });
      }
      record(req, res, path, mode);
      return simulate(res, mode, { format, custom });
    }
    if (kind === 's' && readOnly && Object.hasOwn(MODES, id) && MODES[id].action !== 'custom') {
      record(req, res, path, id);
      return simulate(res, id, { hop: Number.parseInt(url.searchParams.get('hop') ?? '0', 10) || 0 });
    }
    if (kind === 't' && Object.hasOwn(TOKEN_MODES, id) && !TOKEN_MODES[id].action) {
      record(req, res, path, id);
      return tokenEndpoint(req, res, id);
    }
    return send(res, 404, { error: 'Not found' });
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof InputError) return send(res, 400, { error: err.message });
      console.error('Request failed:', err.message);
      send(res, 500, { error: 'Internal error' });
    });
  });
}
