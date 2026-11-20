import { z } from 'zod';

export const rangeSchema = z.enum(['24h', '7d', '30d']).default('24h');
export type Range = z.infer<typeof rangeSchema>;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Chart bucket sizes: fine enough that frequent checks show as a line, not a single point. */
export const RANGE_CONFIG: Record<Range, { durationMs: number; bucket: string; bucketMs: number }> = {
  '24h': { durationMs: 24 * HOUR, bucket: '5 minutes', bucketMs: 5 * MINUTE }, // 288 points
  '7d': { durationMs: 7 * 24 * HOUR, bucket: '1 hour', bucketMs: HOUR }, // 168 points
  '30d': { durationMs: 30 * 24 * HOUR, bucket: '6 hours', bucketMs: 6 * HOUR }, // 120 points
};

export function rangeStart(range: Range, now = new Date()): Date {
  return new Date(now.getTime() - RANGE_CONFIG[range].durationMs);
}
