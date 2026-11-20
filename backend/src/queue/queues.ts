import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

export const QUEUE_CHECKS = 'monitor-checks';
export const QUEUE_SCHEDULER_CONTROL = 'scheduler-control';
export const QUEUE_NOTIFICATIONS = 'notifications';

export interface CheckJobData {
  monitorId: string;
}
export interface SyncJobData {
  monitorId: string;
  /** Run one immediate check after syncing (used when a monitor is created or resumed). */
  checkNow?: boolean;
}
export interface NotificationJobData {
  deliveryId: string;
}

export const schedulerId = (monitorId: string) => `monitor-${monitorId}`;

/** BullMQ requires `maxRetriesPerRequest: null` for blocking worker connections. */
export function createRedisConnection(): IORedis {
  return new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
}

const defaultJobOptions = {
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 5000 },
};

export function createChecksQueue(connection: IORedis) {
  return new Queue<CheckJobData>(QUEUE_CHECKS, { connection, defaultJobOptions });
}

export function createControlQueue(connection: IORedis) {
  return new Queue<SyncJobData>(QUEUE_SCHEDULER_CONTROL, { connection, defaultJobOptions });
}

export function createNotificationsQueue(connection: IORedis) {
  return new Queue<NotificationJobData>(QUEUE_NOTIFICATIONS, {
    connection,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  });
}
