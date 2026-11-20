import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, prisma, registerUser, resetDb, validMonitor } from './helpers';

describe('monitor CRUD', () => {
  let ctx: ReturnType<typeof createTestApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    await resetDb();
    ctx = createTestApp();
    token = (await registerUser(ctx.app)).token;
  });

  it('creates a monitor and asks the scheduler to schedule it', async () => {
    const res = await request(ctx.app).post('/api/monitors').set(auth()).send(validMonitor).expect(201);
    expect(res.body.monitor).toMatchObject({
      name: 'Example API',
      url: 'https://api.example.com/health',
      method: 'GET',
      intervalSeconds: 300,
      enabled: true,
      status: 'PENDING',
    });
    expect(ctx.syncCalls).toEqual([{ monitorId: res.body.monitor.id, checkNow: true }]);
    // API must not run checks itself.
    expect(await prisma.monitorCheck.count()).toBe(0);
  });

  it('applies defaults and validates fields', async () => {
    const res = await request(ctx.app)
      .post('/api/monitors')
      .set(auth())
      .send({ name: 'Minimal', url: 'http://example.org', intervalSeconds: 600 })
      .expect(201);
    expect(res.body.monitor).toMatchObject({ method: 'GET', timeoutMs: 10000, expectedStatusMin: 200, expectedStatusMax: 399 });

    const bad = await request(ctx.app)
      .post('/api/monitors')
      .set(auth())
      .send({ name: 'x', url: 'ftp://example.org', intervalSeconds: 3, method: 'POST', timeoutMs: 100 })
      .expect(400);
    const paths = bad.body.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['url', 'intervalSeconds', 'method', 'timeoutMs']));

    await request(ctx.app)
      .post('/api/monitors')
      .set(auth())
      .send({ ...validMonitor, expectedStatusMin: 400, expectedStatusMax: 200 })
      .expect(400);
  });

  it('lists, reads, updates, pauses, resumes and deletes monitors', async () => {
    const created = await request(ctx.app).post('/api/monitors').set(auth()).send(validMonitor).expect(201);
    const id = created.body.monitor.id;

    const list = await request(ctx.app).get('/api/monitors').set(auth()).expect(200);
    expect(list.body.monitors).toHaveLength(1);
    expect(list.body.monitors[0]).toHaveProperty('uptime24h', null);

    await request(ctx.app).get(`/api/monitors/${id}`).set(auth()).expect(200);

    const updated = await request(ctx.app)
      .patch(`/api/monitors/${id}`)
      .set(auth())
      .send({ name: 'Renamed', intervalSeconds: 600, method: 'HEAD' })
      .expect(200);
    expect(updated.body.monitor).toMatchObject({ name: 'Renamed', intervalSeconds: 600, method: 'HEAD' });

    const paused = await request(ctx.app).post(`/api/monitors/${id}/pause`).set(auth()).expect(200);
    expect(paused.body.monitor).toMatchObject({ enabled: false, status: 'PAUSED' });

    const resumed = await request(ctx.app).post(`/api/monitors/${id}/resume`).set(auth()).expect(200);
    expect(resumed.body.monitor.enabled).toBe(true);

    await request(ctx.app).delete(`/api/monitors/${id}`).set(auth()).expect(204);
    await request(ctx.app).get(`/api/monitors/${id}`).set(auth()).expect(404);
    expect(await prisma.monitor.count()).toBe(0);

    // create, update, pause, resume, delete each sync the schedule
    expect(ctx.syncCalls.map((c) => c.checkNow)).toEqual([true, true, false, true, false]);
  });

  it('rejects an update where status range becomes invalid', async () => {
    const created = await request(ctx.app).post('/api/monitors').set(auth()).send(validMonitor).expect(201);
    await request(ctx.app)
      .patch(`/api/monitors/${created.body.monitor.id}`)
      .set(auth())
      .send({ expectedStatusMin: 500 })
      .expect(400);
  });

  it('rejects SSRF destinations when creating and updating monitors', async () => {
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://10.1.2.3',
      'http://[::1]/',
      'https://private-host.example.com', // resolves to 10.0.0.5 in fakeLookup
      'https://rebind.example.com', // one of the A records is 127.0.0.1
      'https://user:pass@example.com',
    ]) {
      const res = await request(ctx.app).post('/api/monitors').set(auth()).send({ ...validMonitor, url });
      expect(res.status, url).toBe(400);
    }
    const nx = await request(ctx.app)
      .post('/api/monitors')
      .set(auth())
      .send({ ...validMonitor, url: 'https://nxdomain.example.com' })
      .expect(400);
    expect(nx.body.details[0].message).toMatch(/could not be resolved/);

    const created = await request(ctx.app).post('/api/monitors').set(auth()).send(validMonitor).expect(201);
    await request(ctx.app)
      .patch(`/api/monitors/${created.body.monitor.id}`)
      .set(auth())
      .send({ url: 'http://192.168.1.1/admin' })
      .expect(400);
    expect(await prisma.monitor.count()).toBe(1);
  });
});

describe('user ownership', () => {
  it('prevents users from reading or changing other users\' data', async () => {
    await resetDb();
    const { app } = createTestApp();
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const asAlice = { Authorization: `Bearer ${alice.token}` };
    const asBob = { Authorization: `Bearer ${bob.token}` };

    const created = await request(app).post('/api/monitors').set(asAlice).send(validMonitor).expect(201);
    const id = created.body.monitor.id;
    await prisma.incident.create({ data: { monitorId: id, startedAt: new Date(), cause: 'test' } });

    const bobList = await request(app).get('/api/monitors').set(asBob).expect(200);
    expect(bobList.body.monitors).toHaveLength(0);

    await request(app).get(`/api/monitors/${id}`).set(asBob).expect(404);
    await request(app).patch(`/api/monitors/${id}`).set(asBob).send({ name: 'hijack' }).expect(404);
    await request(app).post(`/api/monitors/${id}/pause`).set(asBob).expect(404);
    await request(app).post(`/api/monitors/${id}/resume`).set(asBob).expect(404);
    await request(app).delete(`/api/monitors/${id}`).set(asBob).expect(404);
    await request(app).get(`/api/monitors/${id}/stats`).set(asBob).expect(404);
    await request(app).get(`/api/monitors/${id}/checks`).set(asBob).expect(404);

    const bobIncidents = await request(app).get('/api/incidents').set(asBob).expect(200);
    expect(bobIncidents.body.incidents).toHaveLength(0);
    const bobIncidentsFiltered = await request(app).get(`/api/incidents?monitorId=${id}`).set(asBob).expect(200);
    expect(bobIncidentsFiltered.body.incidents).toHaveLength(0);

    const bobDash = await request(app).get('/api/dashboard').set(asBob).expect(200);
    expect(bobDash.body.monitors.total).toBe(0);
    expect(bobDash.body.recentIncidents).toHaveLength(0);

    const aliceIncidents = await request(app).get('/api/incidents').set(asAlice).expect(200);
    expect(aliceIncidents.body.incidents).toHaveLength(1);

    const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    expect(monitor.name).toBe('Example API');
    expect(monitor.enabled).toBe(true);
  });
});
