import request from 'supertest';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMonitorCheck } from '../src/monitoring/runCheck';
import { performHttpCheck } from '../src/monitoring/httpCheck';
import { AuthService } from '../src/monitoring/auth/auth.service';
import { OAuth2Provider, TokenAcquisitionError } from '../src/monitoring/auth/providers/oauth2.provider';
import { createRedisTokenCache } from '../src/monitoring/auth/tokenCache';
import {
  CredentialDecryptError,
  CredentialKeyError,
  decryptAuthConfig,
  encryptAuthConfig,
  parseEncryptionKey,
} from '../src/monitoring/auth/auth.crypto';
import type { OAuth2Config } from '../src/monitoring/auth/auth.types';
import {
  createMemoryLock,
  createTestApp,
  createTestAuthService,
  fakeLookup,
  jsonResponse,
  mockResponse,
  prisma,
  registerUser,
  resetDb,
  validMonitor,
} from './helpers';

// Fictional endpoints and credentials only.
const TARGET = 'https://api.example.com/health';
const TOKEN_URL = 'https://auth.example.com/oauth/token';
const OAUTH: OAuth2Config = {
  type: 'OAUTH2_CLIENT_CREDENTIALS',
  tokenUrl: TOKEN_URL,
  clientId: 'uptime-client',
  clientSecret: 'client-secret-value-123',
  scope: 'health:read',
  clientAuthMethod: 'client_secret_basic',
};

type FetchCall = { url: string; init: RequestInit; headers: Headers; body: string };

/** A fake network: routes token requests and target requests to handlers and records calls. */
function fakeNetwork(handlers: { token?: (n: number) => Response | Promise<Response>; target?: (n: number) => Response | Promise<Response> }) {
  const tokenCalls: FetchCall[] = [];
  const targetCalls: FetchCall[] = [];
  const fetchFn = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = String(input);
    const call = { url, init, headers: new Headers(init.headers), body: init.body ? String(init.body) : '' };
    if (url.startsWith(TOKEN_URL)) {
      tokenCalls.push(call);
      return (handlers.token ?? (() => jsonResponse(200, { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 })))(tokenCalls.length);
    }
    targetCalls.push(call);
    return (handlers.target ?? (() => mockResponse(200)))(targetCalls.length);
  });
  return { fetch: fetchFn as unknown as typeof fetch, tokenCalls, targetCalls };
}

async function setupUser() {
  await resetDb();
  const ctx = createTestApp();
  const user = await registerUser(ctx.app);
  return { ...ctx, ...user, auth: { Authorization: `Bearer ${user.token}` } };
}

function createMonitor(app: Parameters<typeof request>[0], headers: Record<string, string>, body: Record<string, unknown>) {
  return request(app).post('/api/monitors').set(headers).send({ ...validMonitor, url: TARGET, ...body });
}

function runWith(net: ReturnType<typeof fakeNetwork>, monitorId: string, auth: AuthService = createTestAuthService({ fetch: net.fetch })) {
  return runMonitorCheck(
    { db: prisma, lock: createMemoryLock(), auth, enqueueNotification: async () => undefined, http: { fetch: net.fetch, lookup: fakeLookup } },
    monitorId,
  );
}

const latestCheck = (monitorId: string) => prisma.monitorCheck.findFirstOrThrow({ where: { monitorId }, orderBy: { checkedAt: 'desc' } });

describe('authenticated monitors: request headers', () => {
  it('unauthenticated monitors still work and send no credentials', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, {}).expect(201);
    expect(res.body.monitor).toMatchObject({ authType: 'NONE', hasCredentials: false });
    const net = fakeNetwork({});
    const r = await runWith(net, res.body.monitor.id);
    expect(r).toMatchObject({ status: 'checked' });
    expect(net.targetCalls[0].headers.get('authorization')).toBeNull();
    expect((await latestCheck(res.body.monitor.id)).outcome).toBe('SUCCESS');
  });

  it('attaches a Bearer token', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: { type: 'BEARER', token: 'bearer-secret-abc' } }).expect(201);
    const net = fakeNetwork({});
    await runWith(net, res.body.monitor.id);
    expect(net.targetCalls[0].headers.get('authorization')).toBe('Bearer bearer-secret-abc');
  });

  it('constructs HTTP Basic authentication', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: { type: 'BASIC', username: 'alice', password: 'p@ss:word' } }).expect(201);
    const net = fakeNetwork({});
    await runWith(net, res.body.monitor.id);
    expect(net.targetCalls[0].headers.get('authorization')).toBe(`Basic ${Buffer.from('alice:p@ss:word').toString('base64')}`);
  });

  it('attaches an API key using the configured header', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: { type: 'API_KEY', headerName: 'X-API-Key', value: 'key-123' } }).expect(201);
    const net = fakeNetwork({});
    await runWith(net, res.body.monitor.id);
    expect(net.targetCalls[0].headers.get('x-api-key')).toBe('key-123');
    expect(net.targetCalls[0].headers.get('authorization')).toBeNull();
  });

  it('attaches multiple custom headers', async () => {
    const { app, auth } = await setupUser();
    const headers = [
      { name: 'X-Client-ID', value: 'abc123' },
      { name: 'X-API-Secret', value: 'secret-value' },
      { name: 'Accept', value: 'application/json' },
    ];
    const res = await createMonitor(app, auth, { auth: { type: 'CUSTOM_HEADERS', headers } }).expect(201);
    const net = fakeNetwork({});
    await runWith(net, res.body.monitor.id);
    const sent = net.targetCalls[0].headers;
    expect(sent.get('x-client-id')).toBe('abc123');
    expect(sent.get('x-api-secret')).toBe('secret-value');
    expect(sent.get('accept')).toBe('application/json');
  });

  it('rejects restricted and malformed headers', async () => {
    const { app, auth } = await setupUser();
    for (const name of ['Host', 'Content-Length', 'Connection', 'Authorization', 'Transfer-Encoding', 'Proxy-Authorization', 'Bad Header', 'X-Ü']) {
      const r = await createMonitor(app, auth, { auth: { type: 'CUSTOM_HEADERS', headers: [{ name, value: 'x' }] } });
      expect(r.status, name).toBe(400);
    }
    const injection = await createMonitor(app, auth, { auth: { type: 'CUSTOM_HEADERS', headers: [{ name: 'X-A', value: 'ok\r\nHost: evil' }] } });
    expect(injection.status).toBe(400);
    const apiKeyAuthz = await createMonitor(app, auth, { auth: { type: 'API_KEY', headerName: 'Authorization', value: 'x' } });
    expect(apiKeyAuthz.status).toBe(400);
    const dup = await createMonitor(app, auth, {
      auth: { type: 'CUSTOM_HEADERS', headers: [{ name: 'X-A', value: '1' }, { name: 'x-a', value: '2' }] },
    });
    expect(dup.status).toBe(400);
    expect(await prisma.monitor.count()).toBe(0);
  });

  it('requires HTTPS when credentials are attached', async () => {
    const { app, auth } = await setupUser();
    const r = await createMonitor(app, auth, { url: 'http://api.example.com/health', auth: { type: 'BEARER', token: 't0ken' } }).expect(400);
    expect(r.body.details[0]).toMatchObject({ path: 'url' });
    // Switching an authenticated monitor to http is also rejected.
    const ok = await createMonitor(app, auth, { auth: { type: 'BEARER', token: 't0ken' } }).expect(201);
    await request(app).patch(`/api/monitors/${ok.body.monitor.id}`).set(auth).send({ url: 'http://api.example.com/' }).expect(400);
  });

  it('never forwards credentials across redirects to another origin', async () => {
    const calls: Headers[] = [];
    const fetchFn = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
      calls.push(new Headers(init.headers));
      const url = String(input);
      if (url === 'https://api.example.com/a') return mockResponse(302, { location: 'https://api.example.com/b' });
      if (url === 'https://api.example.com/b') return mockResponse(302, { location: 'https://other.example.net/c' });
      if (url === 'https://other.example.net/c') return mockResponse(302, { location: 'https://api.example.com/d' });
      return mockResponse(200);
    }) as unknown as typeof fetch;
    const result = await performHttpCheck(
      {
        url: 'https://api.example.com/a',
        method: 'GET',
        timeoutMs: 2000,
        expectedStatusMin: 200,
        expectedStatusMax: 299,
        authenticated: true,
        headers: { Authorization: 'Bearer secret', 'X-API-Key': 'k' },
      },
      { fetch: fetchFn, lookup: fakeLookup },
    );
    expect(result.success).toBe(true);
    expect(calls.map((h) => h.get('authorization'))).toEqual(['Bearer secret', 'Bearer secret', null, null]);
    expect(calls.map((h) => h.get('x-api-key'))).toEqual(['k', 'k', null, null]);
  });

  it('classifies 401 and 403 as failures even when inside the expected range', async () => {
    const base = { url: TARGET, method: 'GET' as const, timeoutMs: 2000, expectedStatusMin: 200, expectedStatusMax: 499, authenticated: true };
    const r401 = await performHttpCheck(base, { fetch: (async () => mockResponse(401)) as unknown as typeof fetch, lookup: fakeLookup });
    const r403 = await performHttpCheck(base, { fetch: (async () => mockResponse(403)) as unknown as typeof fetch, lookup: fakeLookup });
    expect(r401).toMatchObject({ success: false, outcome: 'AUTHENTICATION_FAILED' });
    expect(r403).toMatchObject({ success: false, outcome: 'AUTHORIZATION_FAILED' });
  });
});

describe('credential storage', () => {
  it('encrypts credentials before storing them', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: { type: 'BEARER', token: 'plaintext-should-not-appear' } }).expect(201);
    const row = await prisma.monitor.findUniqueOrThrow({ where: { id: res.body.monitor.id } });
    expect(row.authType).toBe('BEARER');
    expect(row.encryptedAuthConfig).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(row.encryptedAuthConfig).not.toContain('plaintext-should-not-appear');
    expect(decryptAuthConfig(row.encryptedAuthConfig!, row.id)).toEqual({ type: 'BEARER', token: 'plaintext-should-not-appear' });
    // Raw table contents contain no plaintext secret anywhere.
    const raw = await prisma.$queryRawUnsafe<unknown[]>('SELECT * FROM "Monitor"');
    expect(JSON.stringify(raw)).not.toContain('plaintext-should-not-appear');
  });

  it('never returns credentials in API responses', async () => {
    const { app, auth } = await setupUser();
    const secret = 'super-secret-oauth-value';
    const created = await createMonitor(app, auth, { auth: { ...OAUTH, clientSecret: secret } }).expect(201);
    const id = created.body.monitor.id;
    const responses = [
      created.body,
      (await request(app).get(`/api/monitors/${id}`).set(auth).expect(200)).body,
      (await request(app).get('/api/monitors').set(auth).expect(200)).body,
      (await request(app).patch(`/api/monitors/${id}`).set(auth).send({ name: 'Renamed' }).expect(200)).body,
      (await request(app).get('/api/dashboard').set(auth).expect(200)).body,
    ];
    for (const body of responses) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(secret);
      expect(text).not.toContain('encryptedAuthConfig');
      expect(text).not.toContain('uptime-client');
    }
    expect(created.body.monitor).toMatchObject({ authType: 'OAUTH2_CLIENT_CREDENTIALS', hasCredentials: true });
  });

  it('keeps, replaces and removes credentials on edit', async () => {
    const { app, auth } = await setupUser();
    const created = await createMonitor(app, auth, { auth: { type: 'BEARER', token: 'first-token' } }).expect(201);
    const id = created.body.monitor.id;
    const v1 = await prisma.monitor.findUniqueOrThrow({ where: { id } });

    await request(app).patch(`/api/monitors/${id}`).set(auth).send({ name: 'Keep creds' }).expect(200);
    const kept = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    expect(kept.encryptedAuthConfig).toBe(v1.encryptedAuthConfig);
    expect(kept.authConfigVersion).toBe(v1.authConfigVersion);

    await request(app).patch(`/api/monitors/${id}`).set(auth).send({ auth: { type: 'BEARER', token: 'second-token' } }).expect(200);
    const replaced = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    expect(decryptAuthConfig(replaced.encryptedAuthConfig!, id)).toEqual({ type: 'BEARER', token: 'second-token' });
    expect(replaced.authConfigVersion).toBe(v1.authConfigVersion + 1);

    const removed = await request(app).patch(`/api/monitors/${id}`).set(auth).send({ auth: { type: 'NONE' } }).expect(200);
    expect(removed.body.monitor).toMatchObject({ authType: 'NONE', hasCredentials: false });
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id } })).encryptedAuthConfig).toBeNull();
  });

  it('prevents another user from changing credentials', async () => {
    const { app, auth } = await setupUser();
    const bob = await registerUser(app);
    const created = await createMonitor(app, auth, { auth: { type: 'BEARER', token: 'alice-token' } }).expect(201);
    const id = created.body.monitor.id;
    const before = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    await request(app)
      .patch(`/api/monitors/${id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ auth: { type: 'BEARER', token: 'bob-token' } })
      .expect(404);
    await request(app).patch(`/api/monitors/${id}`).set('Authorization', `Bearer ${bob.token}`).send({ auth: { type: 'NONE' } }).expect(404);
    const after = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    expect(after.encryptedAuthConfig).toBe(before.encryptedAuthConfig);
    expect(after.authConfigVersion).toBe(before.authConfigVersion);
  });
});

describe('encryption key handling', () => {
  const ENV = 'MONITOR_CREDENTIAL_ENCRYPTION_KEY';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV];
  });
  afterAll(() => {
    process.env[ENV] = saved;
  });

  it('accepts only 32-byte keys', () => {
    expect(parseEncryptionKey('ab'.repeat(32))).toHaveLength(32);
    expect(parseEncryptionKey(Buffer.alloc(32, 7).toString('base64'))).toHaveLength(32);
    for (const bad of [undefined, '', 'short', 'ab'.repeat(31), Buffer.alloc(16).toString('base64'), 'zz'.repeat(32)]) {
      expect(() => parseEncryptionKey(bad)).toThrow(CredentialKeyError);
    }
  });

  it('rejects decryption with the wrong key, a tampered payload or another monitor id', () => {
    const key = parseEncryptionKey('11'.repeat(32));
    const payload = encryptAuthConfig({ type: 'BEARER', token: 't' }, 'monitor-a', key);
    expect(encryptAuthConfig({ type: 'BEARER', token: 't' }, 'monitor-a', key)).not.toBe(payload); // unique IV
    expect(() => decryptAuthConfig(payload, 'monitor-a', parseEncryptionKey('22'.repeat(32)))).toThrow(CredentialDecryptError);
    expect(() => decryptAuthConfig(payload, 'monitor-b', key)).toThrow(CredentialDecryptError);
    const parts = payload.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptAuthConfig(parts.join(':'), 'monitor-a', key)).toThrow(CredentialDecryptError);
  });

  it('refuses to store credentials without a valid key, but unauthenticated monitors still work', async () => {
    const { app, auth } = await setupUser();
    for (const value of [undefined, 'not-a-valid-key']) {
      if (value === undefined) delete process.env[ENV];
      else process.env[ENV] = value;
      const r = await createMonitor(app, auth, { auth: { type: 'BEARER', token: 'abcd' } }).expect(503);
      expect(r.body.error).toMatch(/MONITOR_CREDENTIAL_ENCRYPTION_KEY/);
      const caps = await request(app).get('/api/monitors/capabilities').set(auth).expect(200);
      expect(caps.body.credentialEncryption).toBe(false);
    }
    expect(await prisma.monitor.count()).toBe(0);
    await createMonitor(app, auth, {}).expect(201);
    process.env[ENV] = saved;
  });

  it('records a failed check (without crashing) when stored credentials cannot be decrypted', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: { type: 'BEARER', token: 'abcd' } }).expect(201);
    process.env[ENV] = '33'.repeat(32); // a different key than the one used to encrypt
    const net = fakeNetwork({});
    const r = await runWith(net, res.body.monitor.id);
    process.env[ENV] = saved;
    expect(r).toMatchObject({ status: 'checked', transition: 'DOWN' });
    expect(net.targetCalls).toHaveLength(0);
    const check = await latestCheck(res.body.monitor.id);
    expect(check.outcome).toBe('AUTHENTICATION_FAILED');
    expect(check.error).toMatch(/Credentials unavailable/);
  });
});

describe('OAuth2 client credentials', () => {
  it('acquires a token (client_secret_basic) and attaches it as Bearer', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: OAUTH }).expect(201);
    const net = fakeNetwork({});
    const r = await runWith(net, res.body.monitor.id);
    expect(r).toMatchObject({ status: 'checked' });
    expect(net.tokenCalls).toHaveLength(1);
    const tokenReq = net.tokenCalls[0];
    expect(tokenReq.init.method).toBe('POST');
    expect(tokenReq.init.redirect).toBe('manual');
    expect(tokenReq.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(tokenReq.headers.get('authorization')).toBe(`Basic ${Buffer.from('uptime-client:client-secret-value-123').toString('base64')}`);
    const form = new URLSearchParams(tokenReq.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('health:read');
    expect(form.get('client_secret')).toBeNull();
    expect(net.targetCalls[0].headers.get('authorization')).toBe('Bearer tok-1');
    expect((await latestCheck(res.body.monitor.id)).outcome).toBe('SUCCESS');
  });

  it('supports client_secret_post', async () => {
    const net = fakeNetwork({});
    const provider = new OAuth2Provider({ cache: createTestAuthServiceCache(), fetch: net.fetch, lookup: fakeLookup });
    await provider.getToken('m1', 1, { ...OAUTH, clientAuthMethod: 'client_secret_post' });
    const form = new URLSearchParams(net.tokenCalls[0].body);
    expect(form.get('client_id')).toBe('uptime-client');
    expect(form.get('client_secret')).toBe('client-secret-value-123');
    expect(net.tokenCalls[0].headers.get('authorization')).toBeNull();
  });

  it('replaces expired tokens', async () => {
    let now = 1_000_000;
    let n = 0;
    const net = fakeNetwork({ token: () => jsonResponse(200, { access_token: `tok-${++n}`, expires_in: 120 }) });
    const provider = new OAuth2Provider({ cache: createTestAuthServiceCache(), fetch: net.fetch, lookup: fakeLookup, now: () => now });
    expect(await provider.getToken('m1', 1, OAUTH)).toBe('tok-1');
    now += 60_000;
    expect(await provider.getToken('m1', 1, OAUTH)).toBe('tok-1'); // still fresh
    now += 55_000; // within the refresh window before expiry
    expect(await provider.getToken('m1', 1, OAUTH)).toBe('tok-2');
    expect(net.tokenCalls).toHaveLength(2);
  });

  it('handles missing or invalid expires_in safely', async () => {
    const now = 5_000_000;
    for (const expires_in of [undefined, 'soon', -5, 0]) {
      const net = fakeNetwork({ token: () => jsonResponse(200, { access_token: 'tok', expires_in }) });
      const provider = new OAuth2Provider({ cache: createTestAuthServiceCache(), fetch: net.fetch, lookup: fakeLookup, now: () => now });
      const t = await provider.requestToken(OAUTH);
      expect(t.expiresAt - now).toBe(300_000);
    }
  });

  it('on 401 refreshes the token once and retries once', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: OAUTH }).expect(201);
    let n = 0;
    const net = fakeNetwork({
      token: () => jsonResponse(200, { access_token: `tok-${++n}`, expires_in: 3600 }),
      target: () => mockResponse(401),
    });
    const r = await runWith(net, res.body.monitor.id);
    expect(r).toMatchObject({ status: 'checked', transition: 'DOWN' });
    expect(net.tokenCalls).toHaveLength(2);
    expect(net.targetCalls.map((c) => c.headers.get('authorization'))).toEqual(['Bearer tok-1', 'Bearer tok-2']);
    expect((await latestCheck(res.body.monitor.id)).outcome).toBe('AUTHENTICATION_FAILED');
  });

  it('recovers when the retried request succeeds after a 401', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: OAUTH }).expect(201);
    let n = 0;
    const net = fakeNetwork({
      token: () => jsonResponse(200, { access_token: `tok-${++n}`, expires_in: 3600 }),
      target: (i) => mockResponse(i === 1 ? 401 : 200),
    });
    await runWith(net, res.body.monitor.id);
    expect(net.targetCalls).toHaveLength(2);
    expect((await latestCheck(res.body.monitor.id)).outcome).toBe('SUCCESS');
  });

  it('does not retry on 403', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: OAUTH }).expect(201);
    const net = fakeNetwork({ target: () => mockResponse(403) });
    await runWith(net, res.body.monitor.id);
    expect(net.tokenCalls).toHaveLength(1);
    expect(net.targetCalls).toHaveLength(1);
    expect((await latestCheck(res.body.monitor.id)).outcome).toBe('AUTHORIZATION_FAILED');
  });

  it('handles invalid client credentials without leaking response details', async () => {
    const { app, auth } = await setupUser();
    const res = await createMonitor(app, auth, { auth: OAUTH }).expect(201);
    const net = fakeNetwork({
      token: () => jsonResponse(401, { error: 'invalid_client', error_description: 'secret client-secret-value-123 is wrong' }),
    });
    const r = await runWith(net, res.body.monitor.id);
    expect(r).toMatchObject({ status: 'checked', transition: 'DOWN' });
    expect(net.targetCalls).toHaveLength(0);
    const check = await latestCheck(res.body.monitor.id);
    expect(check.outcome).toBe('TOKEN_ACQUISITION_FAILED');
    expect(check.error).toBe('OAuth2 token request failed: Token endpoint returned HTTP 401 (invalid_client)');
    expect(check.error).not.toContain('client-secret-value-123');
    expect(await prisma.incident.count({ where: { monitorId: res.body.monitor.id, resolvedAt: null } })).toBe(1);
  });

  it('handles a token endpoint timeout', async () => {
    const hang = (_: URL | string, init: RequestInit = {}) =>
      new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const provider = new OAuth2Provider({ cache: createTestAuthServiceCache(), fetch: hang as unknown as typeof fetch, lookup: fakeLookup, timeoutMs: 50 });
    await expect(provider.getToken('m1', 1, OAUTH)).rejects.toThrow(/Token request timed out after 50 ms/);
  });

  it('applies SSRF restrictions and HTTPS to token URLs', async () => {
    const { app, auth } = await setupUser();
    for (const tokenUrl of [
      'https://169.254.169.254/token',
      'https://localhost/token',
      'https://10.0.0.1/token',
      'https://private.example.com/token',
      'http://auth.example.com/token',
      'not-a-url',
    ]) {
      const r = await createMonitor(app, auth, { auth: { ...OAUTH, tokenUrl } });
      expect(r.status, tokenUrl).toBe(400);
      expect(r.body.details[0].path, tokenUrl).toBe('auth.tokenUrl');
    }
    // Also enforced by the worker at request time (e.g. DNS changed after saving).
    const net = fakeNetwork({});
    const provider = new OAuth2Provider({ cache: createTestAuthServiceCache(), fetch: net.fetch, lookup: fakeLookup });
    await expect(provider.requestToken({ ...OAUTH, tokenUrl: 'https://private.example.com/token' })).rejects.toThrow(TokenAcquisitionError);
    expect(net.tokenCalls).toHaveLength(0);
  });

  it('does not follow token endpoint redirects', async () => {
    const net = fakeNetwork({ token: () => mockResponse(302, { location: 'https://169.254.169.254/' }) });
    const provider = new OAuth2Provider({ cache: createTestAuthServiceCache(), fetch: net.fetch, lookup: fakeLookup });
    await expect(provider.requestToken(OAUTH)).rejects.toThrow(/redirects are not followed/);
    expect(net.tokenCalls).toHaveLength(1);
  });
});

describe('OAuth2 token cache in Redis', () => {
  let redis: IORedis;
  const clean = async () => {
    const keys = await redis.keys('uptimehq:oauth:token:test-*');
    if (keys.length) await redis.del(...keys);
  };
  beforeAll(async () => {
    redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    await redis.ping();
  });
  beforeEach(async () => clean());
  afterAll(async () => {
    await clean();
    redis.disconnect();
  });

  it('reuses tokens cached in Redis across workers and never stores the client secret', async () => {
    const net = fakeNetwork({});
    const workerA = new OAuth2Provider({ cache: createRedisTokenCache(redis), fetch: net.fetch, lookup: fakeLookup });
    const workerB = new OAuth2Provider({ cache: createRedisTokenCache(redis), fetch: net.fetch, lookup: fakeLookup });
    expect(await workerA.getToken('test-m1', 1, OAUTH)).toBe('tok-1');
    expect(await workerB.getToken('test-m1', 1, OAUTH)).toBe('tok-1');
    expect(net.tokenCalls).toHaveLength(1);

    const stored = await redis.get(OAuth2Provider.cacheKey('test-m1', 1));
    expect(stored).toContain('tok-1');
    expect(stored).not.toContain(OAUTH.clientSecret);
    const ttl = await redis.pttl(OAuth2Provider.cacheKey('test-m1', 1));
    expect(ttl).toBeGreaterThan(3_500_000);

    // A new credential version never reuses the old token.
    await workerA.getToken('test-m1', 2, OAUTH);
    expect(net.tokenCalls).toHaveLength(2);
  });

  it('concurrent checks across workers trigger a single token request', async () => {
    const net = fakeNetwork({
      token: async () => {
        await new Promise((r) => setTimeout(r, 150));
        return jsonResponse(200, { access_token: 'shared-token', expires_in: 3600 });
      },
    });
    const workers = [0, 1, 2].map(() => new OAuth2Provider({ cache: createRedisTokenCache(redis), fetch: net.fetch, lookup: fakeLookup }));
    const tokens = await Promise.all(Array.from({ length: 12 }, (_, i) => workers[i % 3].getToken('test-m2', 1, OAUTH)));
    expect(new Set(tokens)).toEqual(new Set(['shared-token']));
    expect(net.tokenCalls).toHaveLength(1);
  });

  it('falls back to requesting a token when Redis is unavailable', async () => {
    const broken = createRedisTokenCache(redis);
    const failing = { ...broken, get: async () => Promise.reject(new Error('redis down')), tryLock: async () => Promise.reject(new Error('redis down')) };
    const net = fakeNetwork({});
    const provider = new OAuth2Provider({ cache: failing, fetch: net.fetch, lookup: fakeLookup, lockWaitMs: 0 });
    expect(await provider.getToken('test-m3', 1, OAUTH)).toBe('tok-1');
  });
});

describe('check intervals', () => {
  it('accepts 5s, 10s, 30s, 1m, 5m and 10m intervals and caps the timeout', async () => {
    const { app, auth } = await setupUser();
    for (const intervalSeconds of [5, 10, 30, 60, 300, 600]) {
      const r = await request(app)
        .post('/api/monitors')
        .set(auth)
        .send({ name: `every ${intervalSeconds}`, url: TARGET, intervalSeconds })
        .expect(201);
      expect(r.body.monitor.intervalSeconds).toBe(intervalSeconds);
      expect(r.body.monitor.timeoutMs).toBe(Math.min(10_000, intervalSeconds * 1000));
    }
    await request(app).post('/api/monitors').set(auth).send({ name: 'x', url: TARGET, intervalSeconds: 45 }).expect(400);
    const tooLong = await request(app).post('/api/monitors').set(auth).send({ name: 'x', url: TARGET, intervalSeconds: 5, timeoutMs: 8000 }).expect(400);
    expect(tooLong.body.details[0].path).toBe('timeoutMs');
  });
});

function createTestAuthServiceCache() {
  // Separate in-memory cache per provider in unit tests.
  const store = new Map<string, { accessToken: string; obtainedAt: number; expiresAt: number }>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: { accessToken: string; obtainedAt: number; expiresAt: number }) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
    tryLock: async () => 'owner',
    unlock: async () => undefined,
  };
}

describe('supported authentication methods', () => {
  it('rejects the removed signed-JWT method (an existing JWT is configured as a Bearer token)', async () => {
    const { app, auth } = await setupUser();
    const r = await createMonitor(app, auth, { auth: { type: 'JWT', algorithm: 'HS256', secret: 'x'.repeat(40) } });
    expect(r.status).toBe(400);
    const bearer = await createMonitor(app, auth, { auth: { type: 'BEARER', token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtb25pdG9yIn0.sig' } }).expect(201);
    expect(bearer.body.monitor.authType).toBe('BEARER');
  });
});
