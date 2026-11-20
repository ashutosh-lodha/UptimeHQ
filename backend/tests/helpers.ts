import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import type { ClerkClient, ClerkProfile } from '../src/lib/clerk';
import { prisma } from '../src/db';
import type { ScheduleSync } from '../src/queue/scheduleSync';
import type { LookupFn } from '../src/monitoring/ssrf';
import type { MonitorLock } from '../src/monitoring/runCheck';
import { AuthService } from '../src/monitoring/auth/auth.service';
import { OAuth2Provider, type OAuth2Deps } from '../src/monitoring/auth/providers/oauth2.provider';
import type { CachedToken, TokenCache } from '../src/monitoring/auth/tokenCache';

export { prisma };

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "NotificationDelivery", "Incident", "MonitorCheck", "Monitor", "NotificationSetting", "User" CASCADE',
  );
}

/** Public-IP DNS for any hostname, except names containing "private" or "nxdomain". */
export const fakeLookup: LookupFn = async (hostname) => {
  if (hostname.includes('nxdomain')) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  if (hostname.includes('private')) return [{ address: '10.0.0.5', family: 4 }];
  if (hostname.includes('rebind')) return [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
  return [{ address: '93.184.216.34', family: 4 }];
};

export function createFakeScheduleSync() {
  const calls: { monitorId: string; checkNow: boolean }[] = [];
  const sync: ScheduleSync = {
    async syncMonitor(monitorId, opts) {
      calls.push({ monitorId, checkNow: opts?.checkNow ?? false });
    },
  };
  return { sync, calls };
}

/** In-memory stand-in for the Clerk Backend API. */
export const fakeClerk = {
  users: new Map<string, ClerkProfile>(),
  failing: false,
  calls: 0,
};
export const fakeClerkClient: ClerkClient = {
  async getUser(id) {
    fakeClerk.calls++;
    if (fakeClerk.failing) throw new Error('Clerk API returned HTTP 500');
    return fakeClerk.users.get(id) ?? null;
  },
};

/** Signs a token shaped like a Clerk session JWT with the test key pair. */
export function signClerkToken(
  sub: string,
  opts: { azp?: string; expiresIn?: number; sts?: string; key?: string; algorithm?: jwt.Algorithm; extra?: Record<string, unknown> } = {},
) {
  return jwt.sign(
    { azp: opts.azp ?? 'http://localhost:8080', sid: `sess_${sub}`, ...(opts.sts ? { sts: opts.sts } : {}), ...opts.extra },
    opts.key ?? process.env.TEST_CLERK_PRIVATE_KEY!,
    { algorithm: opts.algorithm ?? 'RS256', subject: sub, expiresIn: opts.expiresIn ?? 60, issuer: 'https://test.clerk.accounts.dev' },
  );
}

export function createTestApp() {
  const { sync, calls } = createFakeScheduleSync();
  const app = createApp({ scheduleSync: sync, lookup: fakeLookup, clerk: fakeClerkClient });
  return { app, syncCalls: calls };
}

let counter = 0;
/** Simulates a Clerk sign-up: registers the user with the fake Clerk API, then makes the first API call. */
export async function registerUser(app: ReturnType<typeof createApp>, overrides: Partial<{ email: string; name: string }> = {}) {
  counter++;
  const clerkUserId = `user_test_${counter}_${Date.now()}`;
  const email = overrides.email ?? `user${counter}-${Date.now()}@example.com`;
  fakeClerk.users.set(clerkUserId, { id: clerkUserId, verifiedEmail: email, name: overrides.name ?? `User ${counter}` });
  const token = signClerkToken(clerkUserId);
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  return { token, clerkUserId, user: res.body.user as { id: string; email: string; name: string } };
}

export const validMonitor = {
  name: 'Example API',
  url: 'https://api.example.com/health',
  method: 'GET',
  intervalSeconds: 300,
  timeoutMs: 5000,
  expectedStatusMin: 200,
  expectedStatusMax: 299,
};

export async function createMonitorRecord(userId: string, data: Partial<typeof validMonitor> = {}) {
  return prisma.monitor.create({
    data: {
      userId,
      name: data.name ?? 'Direct monitor',
      url: data.url ?? 'https://status.example.com',
      method: (data.method as 'GET' | 'HEAD') ?? 'GET',
      intervalSeconds: data.intervalSeconds ?? 300,
      timeoutMs: data.timeoutMs ?? 5000,
      expectedStatusMin: data.expectedStatusMin ?? 200,
      expectedStatusMax: data.expectedStatusMax ?? 399,
    },
  });
}

export function createMemoryLock(): MonitorLock & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async acquire(id) {
      if (held.has(id)) return null;
      held.add(id);
      return 'token';
    },
    async release(id) {
      held.delete(id);
    },
  };
}

/** In-memory TokenCache with the same semantics as the Redis one. */
export function createMemoryTokenCache(): TokenCache & { store: Map<string, CachedToken> } {
  const store = new Map<string, CachedToken>();
  const locks = new Map<string, string>();
  return {
    store,
    async get(k) {
      return store.get(k) ?? null;
    },
    async set(k, v) {
      store.set(k, v);
    },
    async del(k) {
      store.delete(k);
    },
    async tryLock(k) {
      if (locks.has(k)) return null;
      const owner = Math.random().toString(36);
      locks.set(k, owner);
      return owner;
    },
    async unlock(k, owner) {
      if (locks.get(k) === owner) locks.delete(k);
    },
  };
}

export function createTestAuthService(oauth: Partial<OAuth2Deps> = {}) {
  return new AuthService(new OAuth2Provider({ cache: createMemoryTokenCache(), lookup: fakeLookup, ...oauth }));
}

/** Builds a minimal fetch Response. */
export function mockResponse(status: number, headers: Record<string, string> = {}, body = 'ok') {
  return new Response(status === 204 || status === 304 ? null : body, { status, headers });
}

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
