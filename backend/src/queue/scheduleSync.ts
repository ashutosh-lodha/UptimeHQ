import type { Queue } from 'bullmq';
import type { SyncJobData } from './queues';

/**
 * The API never runs checks itself. When a monitor changes it only asks the
 * scheduler service (via a BullMQ control job) to reconcile that monitor's
 * recurring job.
 */
export interface ScheduleSync {
  syncMonitor(monitorId: string, opts?: { checkNow?: boolean }): Promise<void>;
}

export function createQueueScheduleSync(queue: Queue<SyncJobData>): ScheduleSync {
  return {
    async syncMonitor(monitorId, opts) {
      await queue.add('sync', { monitorId, checkNow: opts?.checkNow ?? false });
    },
  };
}
