import type { Prisma, PrismaClient } from '@prisma/client';
import type { CheckResult } from './httpCheck';

export type Transition = 'DOWN' | 'RECOVERY' | null;

export interface RecordOutcome {
  /** false when the monitor no longer exists or is paused; nothing was written. */
  recorded: boolean;
  transition: Transition;
  incidentId: string | null;
  deliveryIds: string[];
}

/**
 * Persists one check result and applies incident state changes atomically.
 *
 * The monitor row is locked with SELECT ... FOR UPDATE so concurrent results for
 * the same monitor are serialised. A partial unique index additionally
 * guarantees at most one open incident per monitor, and the
 * (incidentId, type) unique key guarantees one notification per transition.
 */
export async function recordCheckResult(
  db: PrismaClient,
  monitorId: string,
  result: CheckResult,
  checkedAt: Date = new Date(),
): Promise<RecordOutcome> {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const locked = await tx.$queryRaw<{ id: string; enabled: boolean }[]>`
      SELECT id, enabled FROM "Monitor" WHERE id = ${monitorId}::uuid FOR UPDATE`;
    if (locked.length === 0 || !locked[0].enabled) {
      return { recorded: false, transition: null, incidentId: null, deliveryIds: [] };
    }

    await tx.monitorCheck.create({
      data: {
        monitorId,
        checkedAt,
        success: result.success,
        outcome: result.outcome,
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      },
    });

    const openIncident = await tx.incident.findFirst({
      where: { monitorId, resolvedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    let transition: Transition = null;
    let incidentId: string | null = openIncident?.id ?? null;
    const deliveryIds: string[] = [];

    if (!result.success && !openIncident) {
      // Operational (or pending) -> down: open exactly one incident.
      const incident = await tx.incident.create({
        data: { monitorId, startedAt: checkedAt, cause: result.error ?? 'Check failed' },
      });
      const delivery = await tx.notificationDelivery.create({
        data: { incidentId: incident.id, type: 'DOWN' },
      });
      transition = 'DOWN';
      incidentId = incident.id;
      deliveryIds.push(delivery.id);
    } else if (result.success && openIncident) {
      // Down -> operational: resolve the open incident.
      const durationMs = Math.max(0, checkedAt.getTime() - openIncident.startedAt.getTime());
      await tx.incident.update({
        where: { id: openIncident.id },
        data: { resolvedAt: checkedAt, durationMs },
      });
      const delivery = await tx.notificationDelivery.create({
        data: { incidentId: openIncident.id, type: 'RECOVERY' },
      });
      transition = 'RECOVERY';
      deliveryIds.push(delivery.id);
    }

    await tx.monitor.update({
      where: { id: monitorId },
      data: {
        status: result.success ? 'UP' : 'DOWN',
        lastCheckedAt: checkedAt,
        lastResponseTimeMs: result.responseTimeMs,
        lastStatusCode: result.statusCode,
        lastError: result.error,
      },
    });

    return { recorded: true, transition, incidentId, deliveryIds };
  });
}
