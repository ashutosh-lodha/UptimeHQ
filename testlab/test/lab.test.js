import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createLab } from '../src/app.js';
import { MODES, TOKEN_MODES, credentials, monitorList } from '../src/catalogue.js';
import { loadConfig } from '../src/config.js';

const PASSWORD = 'unit-test-password-1234';
const creds = credentials(PASSWORD);
let server;
let base;
let dataDir;
let config;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'testlab-'));
  config = loadConfig({ DATA_DIR: dataDir, TESTLAB_PASSWORD: PASSWORD, APP_URL: 'https://uptime.example.com' });
  server = createLab(config).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/testlab`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

const get = (path, opts) => fetch(base + path, { redirect: 'manual', ...opts });
const control = (path, body, password = PASSWORD) =>
  get(`/control/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Lab-Password': password },
    body: body && JSON.stringify(body),
  });
const oauth = (secret = creds.OAUTH2_CLIENT_CREDENTIALS.clientSecret) =>
  get('/e/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`lab-client:${secret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

describe('fixed scenarios', () => {
  for (const [id, mode] of Object.entries(MODES)) {
    if (mode.status) {
      it(`${id} answers ${mode.status}`, async () => assert.equal((await get(`/s/${id}`)).status, mode.status));
    } else if (mode.to) {
      it(`${id} redirects to its fixed target`, async () => {
        const location = (await get(`/s/${id}`)).headers.get('location');
        if (mode.to === 'healthy' || mode.to === 'loop') assert.match(location, /^\/testlab\/s\//);
        else assert.equal(location, config.targets[mode.to]);
      });
    }
  }

  it('drop hands the connection to NGINX to reset', async () => {
    assert.equal((await get('/s/drop')).headers.get('x-accel-redirect'), '@testlab_drop');
  });

  it('timeout does not answer', async () => {
    await assert.rejects(get('/s/timeout', { signal: AbortSignal.timeout(300) }));
  });

  for (const [id, mode] of Object.entries(TOKEN_MODES)) {
    if (mode.action) continue;
    it(`token failure ${id}`, async () => assert.equal((await get(`/t/${id}`, { method: 'POST' })).status, mode.status));
  }
});

describe('protected endpoints', () => {
  const valid = {
    bearer: { Authorization: `Bearer ${creds.BEARER.token}` },
    basic: { Authorization: `Basic ${Buffer.from(`lab-user:${creds.BASIC.password}`).toString('base64')}` },
    'api-key': { 'X-API-Key': creds.API_KEY.value },
    headers: Object.fromEntries(creds.CUSTOM_HEADERS.headers.map((h) => [h.name, h.value])),
  };
  for (const [id, headers] of Object.entries(valid)) {
    it(`${id} requires its credentials`, async () => {
      assert.equal((await get(`/e/${id}`)).status, 401);
      assert.equal((await get(`/e/${id}`, { headers })).status, 200);
    });
  }

  it('OAuth2 issues tokens, rejects bad clients and honours revocation', async () => {
    assert.equal((await oauth('wrong')).status, 401);
    const { access_token: token } = await (await oauth()).json();
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await get('/e/oauth', { headers })).status, 200);
    await control('revoke', {});
    assert.equal((await get('/e/oauth', { headers })).status, 401);
  });
});

describe('control', () => {
  it('needs the password to read or change anything', async () => {
    assert.equal((await control('state', undefined, 'wrong')).status, 401);
    assert.equal((await control('all', { healthy: false }, 'wrong')).status, 401);
    assert.equal((await get('/e/website')).status, 200);
  });

  it('switches one endpoint, all endpoints and custom responses', async () => {
    await control('set', { id: 'api', mode: '404' });
    assert.equal((await get('/e/api')).status, 404);
    await control('set', { id: 'api', mode: 'custom', custom: { status: 418, delayMs: 0, body: '{"tea":true}' } });
    const custom = await get('/e/api');
    assert.equal(custom.status, 418);
    assert.deepEqual(await custom.json(), { tea: true });
    await control('all', { healthy: false });
    assert.equal((await get('/e/website')).status, 503);
    assert.equal((await oauth()).status, 503);
    await control('all', { healthy: true });
    assert.equal((await get('/e/website')).status, 200);
  });

  it('rejects invalid input', async () => {
    const invalid = [
      null,
      { id: '__proto__', mode: '503' },
      { id: 'api', mode: 'constructor' },
      { id: 'api', mode: 'custom', custom: { status: 999, delayMs: 0, body: '' } },
      { id: 'api', mode: 'custom', custom: { status: 200, delayMs: 99999, body: '' } },
    ];
    for (const body of invalid) {
      const res = await get('/control/set', { method: 'POST', headers: { 'X-Lab-Password': PASSWORD }, body: JSON.stringify(body) });
      assert.equal(res.status, 400);
    }
  });

  it('never serves a custom body as executable HTML', async () => {
    await control('set', { id: 'website', mode: 'custom', custom: { status: 200, delayMs: 0, body: '<script>alert(1)</script>' } });
    const res = await get('/e/website');
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /sandbox/);
  });

  it('cannot be used as an open redirect', async () => {
    const res = await get('/s/redirect-loop?hop=//evil.example');
    assert.match(res.headers.get('location'), /^\/testlab\/s\/redirect-loop\?hop=\d+$/);
  });

  it('does not record header values', async () => {
    await get('/e/bearer', { headers: { Authorization: 'Bearer sensitive-value', Cookie: '__session=sensitive-cookie' } });
    const { recent } = await (await control('state')).json();
    assert.equal(recent.length, 1);
    assert.doesNotMatch(JSON.stringify(recent), /sensitive/);
  });
});

it('the monitor list covers every failure and auth type with unique names', () => {
  const list = monitorList('https://uptime.example.com/testlab', PASSWORD);
  assert.equal(new Set(list.map((m) => m.name)).size, list.length);
  for (const [id, m] of Object.entries(MODES)) {
    if (m.expect && m.expect !== 'SUCCESS') assert.ok(list.some((x) => x.url.endsWith(`/s/${id}`)), id);
  }
  assert.equal(new Set(list.map((m) => m.auth.type)).size, 6);
});
