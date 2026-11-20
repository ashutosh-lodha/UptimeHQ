import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordCheckResult } from '../src/monitoring/incidentEngine';
import { deliverNotification } from '../src/notifications/deliver';
import type { Mailer } from '../src/notifications/mailer';
import { createMonitorRecord, createTestApp, prisma, registerUser, resetDb } from './helpers';

const down = { success: false, outcome: 'NETWORK_ERROR' as const, statusCode: null, responseTimeMs: null, error: 'Connection refused' };
const up = { success: true, outcome: 'SUCCESS' as const, statusCode: 200, responseTimeMs: 90, error: null };

function fakeMailer() {
  const send = vi.fn<Mailer['send']>(async () => undefined);
  return { mailer: { send } as Mailer, send };
}

async function setup() {
  await resetDb();
  const { app } = createTestApp();
  const { user, token } = await registerUser(app, { email: 'owner@example.com' });
  const monitor = await createMonitorRecord(user.id, { name: 'Checkout API' });
  return { app, token, user, monitor };
}

describe('email notifications', () => {
  beforeEach(resetDb);

  it('sends a down alert and a recovery alert for incident transitions', async () => {
    const { monitor } = await setup();
    const { mailer, send } = fakeMailer();

    const downOutcome = await recordCheckResult(prisma, monitor.id, down);
    expect(await deliverNotification({ db: prisma, mailer, appUrl: 'https://uptime.test' }, downOutcome.deliveryIds[0])).toBe('sent');

    const upOutcome = await recordCheckResult(prisma, monitor.id, up);
    expect(await deliverNotification({ db: prisma, mailer, appUrl: 'https://uptime.test' }, upOutcome.deliveryIds[0])).toBe('sent');

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'owner@example.com', subject: '[UptimeHQ] DOWN: Checkout API' });
    expect(send.mock.calls[0][0].text).toContain('Connection refused');
    expect(send.mock.calls[0][0].text).toContain(`https://uptime.test/monitors/${monitor.id}`);
    expect(send.mock.calls[1][0]).toMatchObject({ subject: '[UptimeHQ] RECOVERED: Checkout API' });

    const deliveries = await prisma.notificationDelivery.findMany();
    expect(deliveries.every((d) => d.status === 'SENT' && d.sentAt)).toBe(true);
  });

  it('never sends the same transition twice', async () => {
    const { monitor } = await setup();
    const { mailer, send } = fakeMailer();
    const outcome = await recordCheckResult(prisma, monitor.id, down);
    await recordCheckResult(prisma, monitor.id, down); // still down: no new delivery

    const id = outcome.deliveryIds[0];
    await deliverNotification({ db: prisma, mailer, appUrl: 'x' }, id);
    expect(await deliverNotification({ db: prisma, mailer, appUrl: 'x' }, id)).toBe('already-processed');
    expect(send).toHaveBeenCalledTimes(1);

    // Database-level guarantee: one delivery per (incident, type).
    await expect(
      prisma.notificationDelivery.create({ data: { incidentId: outcome.incidentId!, type: 'DOWN' } }),
    ).rejects.toThrow();
  });

  it('skips (without failing monitoring) when SMTP is not configured', async () => {
    const { monitor } = await setup();
    const outcome = await recordCheckResult(prisma, monitor.id, down);
    expect(await deliverNotification({ db: prisma, mailer: null, appUrl: 'x' }, outcome.deliveryIds[0])).toBe('skipped');
    const d = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: outcome.deliveryIds[0] } });
    expect(d).toMatchObject({ status: 'SKIPPED', error: 'SMTP is not configured' });
    // Monitoring state is unaffected.
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } })).status).toBe('DOWN');
  });

  it('respects user notification preferences and custom recipient', async () => {
    const { monitor, user } = await setup();
    const { mailer, send } = fakeMailer();
    await prisma.notificationSetting.update({
      where: { userId: user.id },
      data: { email: 'oncall@example.com', notifyOnDown: false },
    });
    const d1 = await recordCheckResult(prisma, monitor.id, down);
    expect(await deliverNotification({ db: prisma, mailer, appUrl: 'x' }, d1.deliveryIds[0])).toBe('skipped');
    const d2 = await recordCheckResult(prisma, monitor.id, up);
    expect(await deliverNotification({ db: prisma, mailer, appUrl: 'x' }, d2.deliveryIds[0])).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('oncall@example.com');
  });

  it('marks failed sends and rethrows so the queue retries', async () => {
    const { monitor } = await setup();
    const mailer: Mailer = { send: vi.fn(async () => Promise.reject(new Error('SMTP 421'))) };
    const outcome = await recordCheckResult(prisma, monitor.id, down);
    await expect(deliverNotification({ db: prisma, mailer, appUrl: 'x' }, outcome.deliveryIds[0])).rejects.toThrow('SMTP 421');
    const d = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: outcome.deliveryIds[0] } });
    expect(d).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('reports SMTP availability and saves settings through the API', async () => {
    const { app, token } = await setup();
    const auth = { Authorization: `Bearer ${token}` };
    const get = await request(app).get('/api/settings/notifications').set(auth).expect(200);
    expect(get.body.smtpConfigured).toBe(false);
    expect(get.body.settings).toMatchObject({ email: 'owner@example.com', emailEnabled: true });

    const put = await request(app)
      .put('/api/settings/notifications')
      .set(auth)
      .send({ emailEnabled: true, email: 'alerts@example.com', notifyOnDown: true, notifyOnRecovery: false })
      .expect(200);
    expect(put.body.settings).toMatchObject({ email: 'alerts@example.com', notifyOnRecovery: false });

    await request(app)
      .put('/api/settings/notifications')
      .set(auth)
      .send({ emailEnabled: true, email: 'bad', notifyOnDown: true, notifyOnRecovery: true })
      .expect(400);
  });
});
