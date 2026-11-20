import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { recordCheckResult } from '../src/monitoring/incidentEngine';
import { runMonitorCheck } from '../src/monitoring/runCheck';
import type { CheckResult } from '../src/monitoring/httpCheck';
import {
  createMemoryLock,
  createTestAuthService,
  createMonitorRecord,
  createTestApp,
  fakeLookup,
  mockResponse,
  prisma,
  registerUser,
  resetDb,
} from './helpers';

const up: CheckResult = { success: true, outcome: 'SUCCESS', statusCode: 200, responseTimeMs: 120, error: null };
const down: CheckResult = { success: false, outcome: 'HTTP_STATUS_FAILURE', statusCode: 500, responseTimeMs: 80, error: 'Unexpected status code 500' };

async function setup() {
  await resetDb();
  const { app } = createTestApp();
  const { user, token } = await registerUser(app);
  const monitor = await createMonitorRecord(user.id);
  return { app, user, token, monitor };
}

describe('incident engine', () => {
  beforeEach(resetDb);

  it('creates an incident when an operational monitor goes down', async () => {
    const { monitor } = await setup();
    await recordCheckResult(prisma, monitor.id, up, new Date('2026-01-01T00:00:00Z'));
    const outcome = await recordCheckResult(prisma, monitor.id, down, new Date('2026-01-01T00:05:00Z'));

    expect(outcome.transition).toBe('DOWN');
    const incidents = await prisma.incident.findMany({ where: { monitorId: monitor.id } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ resolvedAt: null, cause: 'Unexpected status code 500' });
    expect(incidents[0].startedAt.toISOString()).toBe('2026-01-01T00:05:00.000Z');

    const m = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(m).toMatchObject({ status: 'DOWN', lastStatusCode: 500, lastResponseTimeMs: 80 });
    expect(await prisma.monitorCheck.count({ where: { monitorId: monitor.id } })).toBe(2);
  });

  it('does not create duplicate incidents for consecutive failures', async () => {
    const { monitor } = await setup();
    const first = await recordCheckResult(prisma, monitor.id, down);
    const second = await recordCheckResult(prisma, monitor.id, down);
    const third = await recordCheckResult(prisma, monitor.id, down);

    expect([first.transition, second.transition, third.transition]).toEqual(['DOWN', null, null]);
    expect(await prisma.incident.count({ where: { monitorId: monitor.id } })).toBe(1);
    expect(await prisma.notificationDelivery.count()).toBe(1);
    expect(await prisma.monitorCheck.count()).toBe(3);
  });

  it('prevents duplicate incidents under concurrent failing results', async () => {
    const { monitor } = await setup();
    await Promise.all(Array.from({ length: 5 }, () => recordCheckResult(prisma, monitor.id, down)));
    expect(await prisma.incident.count({ where: { monitorId: monitor.id, resolvedAt: null } })).toBe(1);
  });

  it('resolves the incident on recovery and records duration', async () => {
    const { monitor } = await setup();
    await recordCheckResult(prisma, monitor.id, down, new Date('2026-01-01T00:00:00Z'));
    await recordCheckResult(prisma, monitor.id, down, new Date('2026-01-01T00:05:00Z'));
    const outcome = await recordCheckResult(prisma, monitor.id, up, new Date('2026-01-01T00:12:30Z'));

    expect(outcome.transition).toBe('RECOVERY');
    const incident = await prisma.incident.findFirstOrThrow({ where: { monitorId: monitor.id } });
    expect(incident.resolvedAt?.toISOString()).toBe('2026-01-01T00:12:30.000Z');
    expect(incident.durationMs).toBe(12.5 * 60 * 1000);
    const m = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(m.status).toBe('UP');

    // A later outage opens a new, separate incident.
    await recordCheckResult(prisma, monitor.id, down, new Date('2026-01-01T01:00:00Z'));
    expect(await prisma.incident.count({ where: { monitorId: monitor.id } })).toBe(2);
  });

  it('enforces one open incident per monitor at the database level', async () => {
    const { monitor } = await setup();
    await prisma.incident.create({ data: { monitorId: monitor.id, startedAt: new Date(), cause: 'a' } });
    await expect(
      prisma.incident.create({ data: { monitorId: monitor.id, startedAt: new Date(), cause: 'b' } }),
    ).rejects.toThrow();
  });

  it('ignores results for paused or deleted monitors', async () => {
    const { monitor } = await setup();
    await prisma.monitor.update({ where: { id: monitor.id }, data: { enabled: false } });
    const outcome = await recordCheckResult(prisma, monitor.id, down);
    expect(outcome.recorded).toBe(false);
    expect(await prisma.monitorCheck.count()).toBe(0);
    expect(await prisma.incident.count()).toBe(0);
  });

  it('exposes incidents through the API with open/resolved filters', async () => {
    const { app, token, monitor } = await setup();
    await recordCheckResult(prisma, monitor.id, down);
    await recordCheckResult(prisma, monitor.id, up);
    await recordCheckResult(prisma, monitor.id, down);
    const auth = { Authorization: `Bearer ${token}` };

    const open = await request(app).get('/api/incidents?status=open').set(auth).expect(200);
    const resolved = await request(app).get('/api/incidents?status=resolved').set(auth).expect(200);
    const all = await request(app).get('/api/incidents').set(auth).expect(200);
    expect(open.body.incidents).toHaveLength(1);
    expect(resolved.body.incidents).toHaveLength(1);
    expect(resolved.body.incidents[0].durationMs).toEqual(expect.any(Number));
    expect(all.body.incidents).toHaveLength(2);
    expect(all.body.incidents[0]).toMatchObject({ monitorName: 'Direct monitor', open: true });
  });
});

describe('scheduled check execution', () => {
  it('runs a real check flow: HTTP -> stored result -> incident -> notification enqueued', async () => {
    const { monitor } = await setup();
    const enqueued: string[] = [];
    const deps = {
      db: prisma,
      lock: createMemoryLock(),
      auth: createTestAuthService(),
      enqueueNotification: async (id: string) => void enqueued.push(id),
    };

    const failing = vi.fn(async () => mockResponse(502));
    const r1 = await runMonitorCheck({ ...deps, http: { fetch: failing as typeof fetch, lookup: fakeLookup } }, monitor.id);
    expect(r1).toMatchObject({ status: 'checked', transition: 'DOWN' });

    const r2 = await runMonitorCheck({ ...deps, http: { fetch: failing as typeof fetch, lookup: fakeLookup } }, monitor.id);
    expect(r2).toMatchObject({ status: 'checked', transition: null });

    const ok = vi.fn(async () => mockResponse(200));
    const r3 = await runMonitorCheck({ ...deps, http: { fetch: ok as typeof fetch, lookup: fakeLookup } }, monitor.id);
    expect(r3).toMatchObject({ status: 'checked', transition: 'RECOVERY' });

    const deliveries = await prisma.notificationDelivery.findMany({ orderBy: { createdAt: 'asc' } });
    expect(deliveries.map((d) => d.type)).toEqual(['DOWN', 'RECOVERY']);
    expect(enqueued).toEqual(deliveries.map((d) => d.id));

    const checks = await prisma.monitorCheck.findMany({ orderBy: { checkedAt: 'asc' } });
    expect(checks.map((c) => [c.success, c.statusCode])).toEqual([
      [false, 502],
      [false, 502],
      [true, 200],
    ]);
  });

  it('skips overlapping checks for the same monitor', async () => {
    const { monitor } = await setup();
    const lock = createMemoryLock();
    lock.held.add(monitor.id);
    const fetchMock = vi.fn(async () => mockResponse(200));
    const r = await runMonitorCheck(
      { db: prisma, lock, auth: createTestAuthService(), enqueueNotification: async () => undefined, http: { fetch: fetchMock as typeof fetch, lookup: fakeLookup } },
      monitor.id,
    );
    expect(r).toEqual({ status: 'skipped', reason: 'locked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not crash when the network throws and still records the failure', async () => {
    const { monitor } = await setup();
    const throwing = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const r = await runMonitorCheck(
      { db: prisma, lock: createMemoryLock(), auth: createTestAuthService(), enqueueNotification: async () => undefined, http: { fetch: throwing as typeof fetch, lookup: fakeLookup } },
      monitor.id,
    );
    expect(r).toMatchObject({ status: 'checked', transition: 'DOWN' });
    const check = await prisma.monitorCheck.findFirstOrThrow();
    expect(check.error).toMatch(/socket hang up/);
  });

  it('skips paused monitors', async () => {
    const { monitor } = await setup();
    await prisma.monitor.update({ where: { id: monitor.id }, data: { enabled: false } });
    const fetchMock = vi.fn();
    const r = await runMonitorCheck(
      { db: prisma, lock: createMemoryLock(), auth: createTestAuthService(), enqueueNotification: async () => undefined, http: { fetch: fetchMock as unknown as typeof fetch } },
      monitor.id,
    );
    expect(r).toEqual({ status: 'skipped', reason: 'paused' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
