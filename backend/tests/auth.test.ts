import request from 'supertest';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createClerkClient } from '../src/lib/clerk';
import { createTestApp, fakeClerk, prisma, registerUser, resetDb, signClerkToken } from './helpers';

const { app } = createTestApp();

describe('authentication (Clerk session JWTs)', () => {
  beforeEach(async () => {
    await resetDb();
    fakeClerk.failing = false;
  });

  it('creates the local user and default settings on the first authenticated request', async () => {
    fakeClerk.users.set('user_ada', { id: 'user_ada', verifiedEmail: 'ada@example.com', name: 'Ada Lovelace' });
    const token = signClerkToken('user_ada');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace' });

    const user = await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_ada' }, include: { notificationSetting: true } });
    expect(user.notificationSetting?.email).toBe('ada@example.com');

    // Subsequent requests don't call Clerk again.
    const before = fakeClerk.calls;
    await request(app).get('/api/monitors').set('Authorization', `Bearer ${token}`).expect(200);
    expect(fakeClerk.calls).toBe(before);
    expect(await prisma.user.count()).toBe(1);
  });

  it('links an existing (pre-Clerk) account by verified email, keeping its monitors', async () => {
    const legacy = await prisma.user.create({ data: { email: 'legacy@example.com', name: 'Legacy' } });
    await prisma.monitor.create({
      data: { userId: legacy.id, name: 'Old monitor', url: 'https://example.com', intervalSeconds: 300 },
    });
    fakeClerk.users.set('user_legacy', { id: 'user_legacy', verifiedEmail: 'legacy@example.com', name: 'Legacy' });
    const res = await request(app).get('/api/monitors').set('Authorization', `Bearer ${signClerkToken('user_legacy')}`).expect(200);
    expect(res.body.monitors.map((m: { name: string }) => m.name)).toEqual(['Old monitor']);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).clerkUserId).toBe('user_legacy');
  });

  it('refuses to link an email already linked to a different Clerk user', async () => {
    await prisma.user.create({ data: { email: 'taken@example.com', name: 'A', clerkUserId: 'user_a' } });
    fakeClerk.users.set('user_b', { id: 'user_b', verifiedEmail: 'taken@example.com', name: 'B' });
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signClerkToken('user_b')}`).expect(409);
  });

  it('requires a verified email address', async () => {
    fakeClerk.users.set('user_unverified', { id: 'user_unverified', verifiedEmail: null, name: 'U' });
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signClerkToken('user_unverified')}`).expect(403);
    expect(await prisma.user.count()).toBe(0);
  });

  it('returns 503 (not a crash) when Clerk is unreachable for a new user', async () => {
    fakeClerk.users.set('user_new', { id: 'user_new', verifiedEmail: 'new@example.com', name: 'N' });
    fakeClerk.failing = true;
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signClerkToken('user_new')}`).expect(503);
  });

  it('protects every API endpoint with JWT authentication', async () => {
    const { token } = await registerUser(app);
    for (const path of ['/api/auth/me', '/api/monitors', '/api/incidents', '/api/dashboard', '/api/settings/notifications', '/api/monitors/capabilities']) {
      await request(app).get(path).expect(401);
      await request(app).get(path).set('Authorization', 'Bearer not-a-jwt').expect(401);
      await request(app).get(path).set('Authorization', `Bearer ${token}`).expect(200);
    }
    // Health check stays public for container health probes.
    await request(app).get('/api/health').expect(200);
  });

  it('rejects forged, expired, foreign-origin and algorithm-confusion tokens', async () => {
    const { clerkUserId } = await registerUser(app);
    const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const bad = [
      signClerkToken(clerkUserId, { key: otherKey }), // signed by someone else
      signClerkToken(clerkUserId, { expiresIn: -60 }), // expired
      signClerkToken(clerkUserId, { azp: 'https://evil.example.com' }), // token minted for another site
      signClerkToken(clerkUserId, { sts: 'pending' }), // session not active
      // HS256 "signed" with the public key (classic algorithm confusion).
      jwt.sign({ sub: clerkUserId, azp: 'http://localhost:8080' }, process.env.CLERK_JWT_KEY!, { algorithm: 'HS256' }),
      `${jwt.sign({ sub: clerkUserId }, 'x', { algorithm: 'HS256' }).split('.').slice(0, 2).join('.')}.`, // stripped signature
    ];
    for (const token of bad) {
      await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    }
  });

  it('re-creates a fresh local account (without old data) for a valid Clerk user whose record was deleted', async () => {
    const { token, user } = await registerUser(app);
    await prisma.user.delete({ where: { id: user.id } });
    // Still a valid Clerk user: a fresh local account is created (no access to old data).
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.user.id).not.toBe(user.id);
  });

  it('reads the verified primary email from the Clerk Backend API', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const client = createClerkClient({
      secretKey: 'sk_test_example',
      apiUrl: 'https://api.clerk.test',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get('authorization') });
        return new Response(
          JSON.stringify({
            id: 'user_1',
            first_name: 'Grace',
            last_name: 'Hopper',
            username: null,
            primary_email_address_id: 'idn_2',
            email_addresses: [
              { id: 'idn_1', email_address: 'old@example.com', verification: { status: 'verified' } },
              { id: 'idn_2', email_address: 'Grace@Example.com', verification: { status: 'verified' } },
            ],
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    });
    expect(await client.getUser('user_1')).toEqual({ id: 'user_1', verifiedEmail: 'grace@example.com', name: 'Grace Hopper' });
    expect(calls[0]).toEqual({ url: 'https://api.clerk.test/v1/users/user_1', auth: 'Bearer sk_test_example' });
  });
});
