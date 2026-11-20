import { Worker } from 'bullmq';
import { config } from './config';
import { prisma } from './db';
import { logger, errorMessage } from './lib/logger';
import { startHeartbeat } from './lib/heartbeat';
import {
  QUEUE_SCHEDULER_CONTROL,
  createChecksQueue,
  createNotificationsQueue,
  createRedisConnection,
  type SyncJobData,
} from './queue/queues';
import { pruneOldChecks, reconcileSchedules, sweepPendingDeliveries, syncMonitorSchedule } from './monitoring/scheduling';

/**
 * Scheduler service: owns the recurring BullMQ job schedulers (one per enabled
 * monitor). It reacts to control jobs sent by the API and periodically
 * reconciles Redis with PostgreSQL so schedules self-heal after restarts.
 */
async function main() {
  const connection = createRedisConnection();
  const checks = createChecksQueue(connection);
  const notifications = createNotificationsQueue(connection);

  const controlWorker = new Worker<SyncJobData>(
    QUEUE_SCHEDULER_CONTROL,
    async (job) => ({ result: await syncMonitorSchedule(prisma, checks, job.data.monitorId, job.data.checkNow) }),
    { connection: createRedisConnection(), concurrency: 1 },
  );
  controlWorker.on('failed', (job, err) => logger.error('Schedule sync failed', { jobId: job?.id, error: errorMessage(err) }));
  controlWorker.on('error', (err) => logger.error('Control worker error', { error: errorMessage(err) }));

  let lastPrune = 0;
  const tick = async () => {
    try {
      const r = await reconcileSchedules(prisma, checks);
      const swept = await sweepPendingDeliveries(prisma, notifications);
      if (r.removed || r.upserted || swept) logger.info('Reconciled schedules', { ...r, sweptDeliveries: swept });
      if (Date.now() - lastPrune > 6 * 3600_000) {
        lastPrune = Date.now();
        const pruned = await pruneOldChecks(prisma, config.CHECK_RETENTION_DAYS);
        if (pruned) logger.info('Pruned check logs past retention', { pruned, retentionDays: config.CHECK_RETENTION_DAYS });
      }
    } catch (err) {
      logger.error('Reconcile failed', { error: errorMessage(err) });
    }
  };
  await tick();
  const timer = setInterval(tick, config.SCHEDULER_RECONCILE_SECONDS * 1000);

  startHeartbeat('scheduler', async () => controlWorker.isRunning() && (await connection.ping()) === 'PONG');
  logger.info('Scheduler started', { reconcileSeconds: config.SCHEDULER_RECONCILE_SECONDS });

  const shutdown = async (signal: string) => {
    logger.info('Scheduler shutting down', { signal });
    clearInterval(timer);
    await controlWorker.close();
    await Promise.allSettled([checks.close(), notifications.close()]);
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { error: errorMessage(err) }));

main().catch((err) => {
  logger.error('Scheduler failed to start', { error: errorMessage(err) });
  process.exit(1);
});
