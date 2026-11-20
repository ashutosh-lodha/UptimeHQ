import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { rangeSchema, rangeStart } from '../../lib/range';
import { currentUserId } from '../../middleware/auth';

const querySchema = z.object({
  status: z.enum(['open', 'resolved', 'all']).default('all'),
  range: rangeSchema,
  monitorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export function serializeIncident(i: {
  id: string;
  startedAt: Date;
  resolvedAt: Date | null;
  durationMs: number | null;
  cause: string;
  monitor: { id: string; name: string };
}) {
  return {
    id: i.id,
    monitorId: i.monitor.id,
    monitorName: i.monitor.name,
    startedAt: i.startedAt,
    resolvedAt: i.resolvedAt,
    durationMs: i.durationMs,
    cause: i.cause,
    open: i.resolvedAt === null,
  };
}

export const incidentRouter = Router();

incidentRouter.get('/', async (req, res) => {
  const q = querySchema.parse(req.query);
  const since = rangeStart(q.range);
  const where: Prisma.IncidentWhereInput = {
    monitor: { userId: currentUserId(req) },
    ...(q.monitorId ? { monitorId: q.monitorId } : {}),
  };
  if (q.status === 'open') where.resolvedAt = null;
  else if (q.status === 'resolved') Object.assign(where, { resolvedAt: { not: null }, startedAt: { gte: since } });
  // "all": open incidents regardless of age, plus anything that started in the range.
  else where.OR = [{ resolvedAt: null }, { startedAt: { gte: since } }];

  const incidents = await prisma.incident.findMany({
    where,
    include: { monitor: { select: { id: true, name: true } } },
    orderBy: { startedAt: 'desc' },
    take: q.limit,
  });
  res.json({ incidents: incidents.map(serializeIncident) });
});
