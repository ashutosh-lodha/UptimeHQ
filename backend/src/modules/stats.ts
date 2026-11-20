import { Prisma, type PrismaClient } from '@prisma/client';
import { RANGE_CONFIG, rangeStart, type Range } from '../lib/range';

export interface SeriesPoint {
  timestamp: string;
  avgResponseMs: number | null;
  uptime: number | null;
  total: number;
}

interface BucketRow {
  bucket: Date;
  monitor_id?: string;
  avg_ms: number | null;
  total: number;
  up: number;
}

const BIN_ORIGIN = Prisma.sql`TIMESTAMPTZ '2000-01-01 00:00:00+00'`;

export function pct(up: number, total: number): number | null {
  return total > 0 ? Math.round((up / total) * 10000) / 100 : null;
}

/** Fills every bucket in the range so charts show gaps instead of joining across them. */
function fillBuckets(rows: BucketRow[], range: Range, now: Date): SeriesPoint[] {
  const { bucketMs } = RANGE_CONFIG[range];
  const origin = Date.UTC(2000, 0, 1);
  const startMs = rangeStart(range, now).getTime();
  const first = origin + Math.floor((startMs - origin) / bucketMs) * bucketMs;
  const byTime = new Map(rows.map((r) => [new Date(r.bucket).getTime(), r]));
  const points: SeriesPoint[] = [];
  for (let t = first; t <= now.getTime(); t += bucketMs) {
    const r = byTime.get(t);
    points.push({
      timestamp: new Date(t).toISOString(),
      avgResponseMs: r?.avg_ms != null ? Math.round(Number(r.avg_ms)) : null,
      uptime: r ? pct(Number(r.up), Number(r.total)) : null,
      total: r ? Number(r.total) : 0,
    });
  }
  return points;
}

/** Bucketed response-time/uptime series for a user's monitors (optionally one monitor). */
export async function responseSeries(
  db: PrismaClient,
  opts: { userId: string; monitorId?: string; range: Range; now?: Date },
): Promise<SeriesPoint[]> {
  const now = opts.now ?? new Date();
  const start = rangeStart(opts.range, now);
  const bucket = RANGE_CONFIG[opts.range].bucket;
  const monitorFilter = opts.monitorId ? Prisma.sql`AND c."monitorId" = ${opts.monitorId}::uuid` : Prisma.empty;
  const rows = await db.$queryRaw<BucketRow[]>`
    SELECT date_bin(${bucket}::interval, c."checkedAt", ${BIN_ORIGIN}) AS bucket,
           AVG(c."responseTimeMs") FILTER (WHERE c.success)::float AS avg_ms,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE c.success)::int AS up
    FROM "MonitorCheck" c
    JOIN "Monitor" m ON m.id = c."monitorId"
    WHERE m."userId" = ${opts.userId}::uuid ${monitorFilter}
      AND c."checkedAt" >= ${start}
    GROUP BY 1
    ORDER BY 1`;
  return fillBuckets(rows, opts.range, now);
}

/** Uptime and average response time per monitor over a range. */
export async function uptimeByMonitor(
  db: PrismaClient,
  monitorIds: string[],
  since: Date,
): Promise<Map<string, { uptime: number | null; avgResponseMs: number | null; total: number }>> {
  const map = new Map<string, { uptime: number | null; avgResponseMs: number | null; total: number }>();
  if (monitorIds.length === 0) return map;
  const rows = await db.$queryRaw<{ monitor_id: string; total: number; up: number; avg_ms: number | null }[]>`
    SELECT c."monitorId"::text AS monitor_id,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE c.success)::int AS up,
           AVG(c."responseTimeMs") FILTER (WHERE c.success)::float AS avg_ms
    FROM "MonitorCheck" c
    WHERE c."monitorId" IN (${Prisma.join(monitorIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND c."checkedAt" >= ${since}
    GROUP BY 1`;
  for (const r of rows) {
    map.set(r.monitor_id, {
      uptime: pct(Number(r.up), Number(r.total)),
      avgResponseMs: r.avg_ms != null ? Math.round(Number(r.avg_ms)) : null,
      total: Number(r.total),
    });
  }
  return map;
}

/** Aggregate uptime for all of a user's monitors (or one monitor) over a range. */
export async function overallUptime(
  db: PrismaClient,
  opts: { userId: string; monitorId?: string; since: Date },
): Promise<{ uptime: number | null; avgResponseMs: number | null; total: number }> {
  const monitorFilter = opts.monitorId ? Prisma.sql`AND c."monitorId" = ${opts.monitorId}::uuid` : Prisma.empty;
  const [row] = await db.$queryRaw<{ total: number; up: number; avg_ms: number | null }[]>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE c.success)::int AS up,
           AVG(c."responseTimeMs") FILTER (WHERE c.success)::float AS avg_ms
    FROM "MonitorCheck" c
    JOIN "Monitor" m ON m.id = c."monitorId"
    WHERE m."userId" = ${opts.userId}::uuid ${monitorFilter}
      AND c."checkedAt" >= ${opts.since}`;
  const total = Number(row?.total ?? 0);
  return {
    uptime: pct(Number(row?.up ?? 0), total),
    avgResponseMs: row?.avg_ms != null ? Math.round(Number(row.avg_ms)) : null,
    total,
  };
}
