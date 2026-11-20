import type { Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { schedulerId, type CheckJobData, type NotificationJobData } from '../queue/queues';

export const SUPPORTED_INTERVALS = [5, 10, 30, 60, 300, 600] as const; // seconds

const checkJobOpts = { removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 86400, count: 5000 } };

/** Creates/updates or removes the BullMQ job scheduler for one monitor. */
export async function syncMonitorSchedule(
  db: PrismaClient,
  checks: Queue<CheckJobData>,
  monitorId: string,
  checkNow = false,
): Promise<'scheduled' | 'removed'> {
  const monitor = await db.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor || !monitor.enabled) {
    await checks.removeJobScheduler(schedulerId(monitorId));
    return 'removed';
  }
  const every = monitor.intervalSeconds * 1000;
  const existing = await checks.getJobScheduler(schedulerId(monitorId));
  if (!existing || Number(existing.every) !== every) {
    await checks.upsertJobScheduler(
      schedulerId(monitorId),
      { every },
      { name: 'check', data: { monitorId }, opts: checkJobOpts },
    );
  }
  if (checkNow) {
    // One-off check so a new/resumed/edited monitor gets a status quickly. Simple-mode
    // deduplication (no TTL) only drops it while an identical check is still pending.
    await checks.add('check', { monitorId }, { ...checkJobOpts, deduplication: { id: `now-${monitorId}` } });
  }
  return 'scheduled';
}

/** Full reconciliation between enabled monitors in PostgreSQL and schedulers in Redis. */
export async function reconcileSchedules(db: PrismaClient, checks: Queue<CheckJobData>) {
  const monitors = await db.monitor.findMany({ select: { id: true, enabled: true, intervalSeconds: true } });
  const wanted = new Map(monitors.filter((m) => m.enabled).map((m) => [schedulerId(m.id), m]));
  const existing = await checks.getJobSchedulers(0, -1);
  let removed = 0;
  let upserted = 0;

  for (const s of existing) {
    const id = s.key ?? (s as { id?: string }).id;
    if (id && !wanted.has(id)) {
      await checks.removeJobScheduler(id);
      removed++;
    }
  }
  const existingEvery = new Map(existing.map((s) => [s.key ?? (s as { id?: string }).id, Number(s.every)]));
  for (const [id, m] of wanted) {
    const every = m.intervalSeconds * 1000;
    if (existingEvery.get(id) !== every) {
      await checks.upsertJobScheduler(id, { every }, { name: 'check', data: { monitorId: m.id }, opts: checkJobOpts });
      upserted++;
    }
  }
  return { removed, upserted, active: wanted.size };
}

/** Re-enqueues notification deliveries that were recorded but never queued (e.g. Redis blip). */
export async function sweepPendingDeliveries(db: PrismaClient, notifications: Queue<NotificationJobData>) {
  const stale = await db.notificationDelivery.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 2 * 60_000) } },
    select: { id: true },
    take: 500,
  });
  for (const d of stale) {
    await notifications.add('send', { deliveryId: d.id }, { jobId: `delivery-${d.id}` });
  }
  return stale.length;
}

const PRUNE_BATCH = 5_000;

/**
 * Keeps the database bounded: deletes endpoint check logs (status, response time, error)
 * older than the retention window. Incidents are kept. Rows go in small batches so a large
 * backlog (e.g. after lowering the retention) never holds a long lock or one huge transaction.
 */
export async function pruneOldChecks(db: PrismaClient, retentionDays: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  let checks = 0;
  for (;;) {
    const batch = await db.monitorCheck.findMany({ where: { checkedAt: { lt: cutoff } }, select: { id: true }, take: PRUNE_BATCH });
    if (batch.length === 0) break;
    const { count } = await db.monitorCheck.deleteMany({ where: { id: { in: batch.map((c) => c.id) } } });
    checks += count;
    if (batch.length < PRUNE_BATCH) break;
  }
  return checks;
}
