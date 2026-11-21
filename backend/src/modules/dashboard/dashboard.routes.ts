import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { rangeSchema, rangeStart } from '../../lib/range';
import { currentUserId } from '../../middleware/auth';
import { overallUptime, perMonitorSeries, responseSeries } from '../stats';
import { serializeIncident } from '../incidents/incident.routes';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  const { range } = z.object({ range: rangeSchema }).parse(req.query);
  const userId = currentUserId(req);
  const since = rangeStart(range);

  const [grouped, summary, series, monitorSeries, recentIncidents] = await Promise.all([
    prisma.monitor.groupBy({ by: ['enabled', 'status'], where: { userId }, _count: { _all: true } }),
    overallUptime(prisma, { userId, since }),
    responseSeries(prisma, { userId, range }),
    perMonitorSeries(prisma, { userId, range }),
    prisma.incident.findMany({
      where: { monitor: { userId }, OR: [{ resolvedAt: null }, { startedAt: { gte: since } }] },
      include: { monitor: { select: { id: true, name: true } } },
      orderBy: { startedAt: 'desc' },
      take: 8,
    }),
  ]);

  const counts = { total: 0, up: 0, down: 0, paused: 0, pending: 0 };
  for (const g of grouped) {
    const n = g._count._all;
    counts.total += n;
    if (!g.enabled) counts.paused += n;
    else if (g.status === 'UP') counts.up += n;
    else if (g.status === 'DOWN') counts.down += n;
    else counts.pending += n;
  }

  res.json({
    range,
    monitors: counts,
    uptime: summary.uptime,
    avgResponseMs: summary.avgResponseMs,
    totalChecks: summary.total,
    series,
    monitorSeries,
    recentIncidents: recentIncidents.map(serializeIncident),
  });
});
