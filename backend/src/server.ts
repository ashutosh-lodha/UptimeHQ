import { createApp } from './app';
import { assertClerkConfigured, config } from './config';
import { createClerkClient } from './lib/clerk';
import { prisma } from './db';
import { logger, errorMessage } from './lib/logger';
import { createControlQueue, createRedisConnection } from './queue/queues';
import { createQueueScheduleSync } from './queue/scheduleSync';

// Without Clerk the API still starts (health checks pass) but every protected request
// is rejected with 401, so nothing is reachable until Clerk is configured.
try {
  assertClerkConfigured();
} catch (err) {
  logger.warn(`${errorMessage(err)} All authenticated endpoints will return 401 until then.`);
}

const connection = createRedisConnection();
const controlQueue = createControlQueue(connection);
const app = createApp({ scheduleSync: createQueueScheduleSync(controlQueue), clerk: createClerkClient() });

const server = app.listen(config.PORT, () => {
  logger.info('API listening', { port: config.PORT });
});

const shutdown = (signal: string) => {
  logger.info('API shutting down', { signal });
  server.close(async () => {
    await controlQueue.close().catch(() => undefined);
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { error: errorMessage(err) }));
