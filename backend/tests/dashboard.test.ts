import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordCheckResult } from '../src/monitoring/incidentEngine';
import { pruneOldChecks } from '../src/monitoring/scheduling';
import { createMonitorRecord, createTestApp, prisma, registerUser, resetDb } from './helpers';

const up = (ms: number) => ({ success: true, outcome: 'SUCCESS' as const, statusCode: 200, responseTimeMs: ms, error: null });
const down = { success: false, outcome: 'HTTP_STATUS_FAILURE' as const, statusCode: 500, responseTimeMs: 50, error: 'Unexpected status code 500' };

describe('dashboard', () => {
  beforeEach(resetDb);

  async function seed() {
    const { app } = createTestApp();
    const { user, token } = await registerUser(app);
    const a = await createMonitorRecord(user.id, { name: 'Alpha' });
    const b = await createMonitorRecord(user.id, { name: 'Beta' });
    const c = await createMonitorRecord(user.id, { name: 'Gamma' });
    const now = Date.now();
    await recordCheckResult(prisma, a.id, up(100), new Date(now - 30 * 60_000));
    await recordCheckResult(prisma, a.id, up(300), new Date(now - 20 * 60_000));
    await recordCheckResult(prisma, b.id, up(200), new Date(now - 20 * 60_000));
    await recordCheckResult(prisma, b.id, down, new Date(now - 10 * 60_000));
    await prisma.monitor.update({ where: { id: c.id }, data: { enabled: false } });
    return { app, token, user, a, b, c };
  }

  it('computes dashboard metrics from stored checks', async () => {
    const { app, token } = await seed();
    const res = await request(app).get('/api/dashboard?range=24h').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.monitors).toEqual({ total: 3, up: 1, down: 1, paused: 1, pending: 0 });
    expect(res.body.totalChecks).toBe(4);
    expect(res.body.uptime).toBe(75);
    expect(res.body.avgResponseMs).toBe(200);
    expect(res.body.series.length).toBeGreaterThanOrEqual(24);
    const withData = res.body.series.filter((p: { total: number }) => p.total > 0);
    expect(withData.reduce((s: number, p: { total: number }) => s + p.total, 0)).toBe(4);
    expect(res.body.recentIncidents).toHaveLength(1);
    expect(res.body.recentIncidents[0].monitorName).toBe('Beta');

    await request(app).get('/api/dashboard?range=1y').set('Authorization', `Bearer ${token}`).expect(400);
  });

  it('returns per-monitor stats and check history', async () => {
    const { app, token, a } = await seed();
    const auth = { Authorization: `Bearer ${token}` };
    const stats = await request(app).get(`/api/monitors/${a.id}/stats?range=7d`).set(auth).expect(200);
    expect(stats.body).toMatchObject({ range: '7d', uptime: 100, avgResponseMs: 200, total: 2, incidentCount: 0 });
    const checks = await request(app).get(`/api/monitors/${a.id}/checks`).set(auth).expect(200);
    expect(checks.body.checks).toHaveLength(2);
    expect(checks.body.checks[0].responseTimeMs).toBe(300);
    expect(checks.body).toMatchObject({ page: 1, total: 2, pageCount: 1 });
  });

  it('paginates check history newest first and filters failures', async () => {
    const { app, token, a } = await seed();
    const auth = { Authorization: `Bearer ${token}` };
    const base = Date.now() - 60_000;
    await prisma.monitorCheck.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        monitorId: a.id,
        checkedAt: new Date(base + i * 1000),
        success: i % 2 === 0,
        outcome: i % 2 === 0 ? ('SUCCESS' as const) : ('HTTP_STATUS_FAILURE' as const),
        statusCode: i % 2 === 0 ? 200 : 503,
        responseTimeMs: 100 + i,
      })),
    });
    const p1 = await request(app).get(`/api/monitors/${a.id}/checks?range=24h&limit=3&page=1`).set(auth).expect(200);
    expect(p1.body).toMatchObject({ page: 1, pageSize: 3, total: 7, pageCount: 3 });
    expect(p1.body.checks).toHaveLength(3);
    expect(p1.body.checks[0].responseTimeMs).toBe(104);
    const p3 = await request(app).get(`/api/monitors/${a.id}/checks?range=24h&limit=3&page=3`).set(auth).expect(200);
    expect(p3.body.checks).toHaveLength(1);
    const failed = await request(app).get(`/api/monitors/${a.id}/checks?range=24h&result=failed`).set(auth).expect(200);
    expect(failed.body.total).toBe(2);
    expect(failed.body.checks.every((c: { success: boolean }) => !c.success)).toBe(true);
    await request(app).get(`/api/monitors/${a.id}/checks?page=0`).set(auth).expect(400);
    await request(app).get(`/api/monitors/${a.id}/checks?result=bogus`).set(auth).expect(400);
  });


  it('prunes check logs older than the retention window and keeps incidents', async () => {
    const { a, b } = await seed();
    const day = 86_400_000;
    const now = Date.now();
    // 5,003 old rows forces more than one delete batch; 2 rows sit just inside the window.
    await prisma.monitorCheck.createMany({
      data: Array.from({ length: 5_003 }, (_, i) => ({
        monitorId: a.id,
        checkedAt: new Date(now - 31 * day - i * 1000),
        success: true,
        outcome: 'SUCCESS' as const,
        statusCode: 200,
        responseTimeMs: 100,
      })),
    });
    await prisma.monitorCheck.createMany({
      data: [29, 29.9].map((d) => ({ monitorId: a.id, checkedAt: new Date(now - d * day), success: true, outcome: 'SUCCESS' as const, statusCode: 200, responseTimeMs: 100 })),
    });
    const before = await prisma.monitorCheck.count();
    const incidentsBefore = await prisma.incident.count();
    const pruned = await pruneOldChecks(prisma, 30);
    expect(pruned).toBe(5_003);
    expect(await prisma.monitorCheck.count()).toBe(before - 5_003);
    expect(await prisma.monitorCheck.count({ where: { checkedAt: { lt: new Date(now - 30 * day) } } })).toBe(0);
    expect(await prisma.incident.count()).toBe(incidentsBefore);
    expect(await prisma.monitorCheck.count({ where: { monitorId: b.id } })).toBe(2);
    expect(await pruneOldChecks(prisma, 30)).toBe(0);
  });

  it('no longer exposes public status page endpoints', async () => {
    const { app, token } = await seed();
    await request(app).get('/api/status-page').set('Authorization', `Bearer ${token}`).expect(404);
    await request(app).get('/api/public/status/anything').expect(404);
  });
});
