import { Worker } from 'bullmq';
import { config, isSmtpConfigured } from './config';
import { prisma } from './db';
import { logger, errorMessage } from './lib/logger';
import { startHeartbeat } from './lib/heartbeat';
import {
  QUEUE_CHECKS,
  QUEUE_NOTIFICATIONS,
  createNotificationsQueue,
  createRedisConnection,
  type CheckJobData,
  type NotificationJobData,
} from './queue/queues';
import { runMonitorCheck } from './monitoring/runCheck';
import { createRedisLock } from './monitoring/redisLock';
import { deliverNotification } from './notifications/deliver';
import { createSmtpMailer } from './notifications/mailer';
import { AuthService } from './monitoring/auth/auth.service';
import { OAuth2Provider } from './monitoring/auth/providers/oauth2.provider';
import { createRedisTokenCache } from './monitoring/auth/tokenCache';
import { isEncryptionKeyConfigured } from './monitoring/auth/auth.crypto';

async function main() {
  const connection = createRedisConnection();
  const notificationsQueue = createNotificationsQueue(connection);
  const lock = createRedisLock(connection);
  const mailer = createSmtpMailer();
  // OAuth2 tokens are cached on the same Redis instance BullMQ uses.
  const auth = new AuthService(new OAuth2Provider({ cache: createRedisTokenCache(connection) }));

  if (!isEncryptionKeyConfigured()) {
    logger.warn('MONITOR_CREDENTIAL_ENCRYPTION_KEY is not set or invalid: monitors with credentials will fail their checks');
  }

  if (!isSmtpConfigured()) {
    logger.warn('SMTP is not configured: monitoring continues, email notifications will be recorded as SKIPPED');
  }

  const enqueueNotification = async (deliveryId: string) => {
    await notificationsQueue.add('send', { deliveryId }, { jobId: `delivery-${deliveryId}` });
  };

  const checksWorker = new Worker<CheckJobData>(
    QUEUE_CHECKS,
    async (job) => {
      const outcome = await runMonitorCheck({ db: prisma, lock, auth, enqueueNotification }, job.data.monitorId);
      return outcome.status === 'checked' ? { transition: outcome.transition } : outcome;
    },
    { connection: createRedisConnection(), concurrency: config.WORKER_CONCURRENCY },
  );

  const notificationsWorker = new Worker<NotificationJobData>(
    QUEUE_NOTIFICATIONS,
    async (job) => ({
      outcome: await deliverNotification({ db: prisma, mailer, appUrl: config.APP_URL }, job.data.deliveryId),
    }),
    { connection: createRedisConnection(), concurrency: 5 },
  );

  for (const w of [checksWorker, notificationsWorker]) {
    // Job failures are logged; they never crash the process.
    w.on('failed', (job, err) => logger.error('Job failed', { queue: w.name, jobId: job?.id, error: errorMessage(err) }));
    w.on('error', (err) => logger.error('Worker error', { queue: w.name, error: errorMessage(err) }));
  }

  startHeartbeat('worker', async () => checksWorker.isRunning() && (await connection.ping()) === 'PONG');
  logger.info('Worker started', { concurrency: config.WORKER_CONCURRENCY });

  const shutdown = async (signal: string) => {
    logger.info('Worker shutting down', { signal });
    await Promise.allSettled([checksWorker.close(), notificationsWorker.close()]);
    await notificationsQueue.close();
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { error: errorMessage(err) }));

main().catch((err) => {
  logger.error('Worker failed to start', { error: errorMessage(err) });
  process.exit(1);
});
