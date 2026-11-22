/**
 * Adds monitors from JSON on stdin to one existing account. Run by the server's operator, e.g.
 *
 *   docker compose exec -T testlab node src/monitors.js |
 *     docker compose exec -T api node dist/cli/importMonitors.js you@example.com [--paused]
 *
 * Applies the same rules as POST /api/monitors and encrypts credentials the same way. Monitors
 * whose name already exists on the account are left untouched, so it is safe to run again.
 * Nothing is updated or deleted. The scheduler picks new monitors up within a minute.
 */
import { randomUUID } from 'node:crypto';
import { text } from 'node:stream/consumers';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { createMonitorSchema } from '../modules/monitors/monitor.schemas';
import { encryptAuthConfig } from '../monitoring/auth/auth.crypto';
import { assertSafeUrl, type LookupFn } from '../monitoring/ssrf';

export async function importMonitors(
  db: PrismaClient,
  opts: { email: string; input: unknown; paused?: boolean; lookup?: LookupFn },
): Promise<{ created: number; skipped: number }> {
  const items = z.array(createMonitorSchema).min(1).max(100).parse(opts.input);
  const user = await db.user.findUnique({ where: { email: opts.email.trim().toLowerCase() }, select: { id: true } });
  if (!user) throw new Error('No account has that email. Sign in to UptimeHQ once, then run this again.');

  // Validate everything before writing anything.
  for (const { name, url, timeoutMs, intervalSeconds, auth } of items) {
    if (timeoutMs && timeoutMs > intervalSeconds * 1000) throw new Error(`${name}: timeout is longer than the interval`);
    const urls = [url];
    if (auth && auth.type !== 'NONE') {
      if (new URL(url).protocol !== 'https:') throw new Error(`${name}: HTTPS is required with credentials`);
      if (auth.type === 'OAUTH2_CLIENT_CREDENTIALS') {
        if (new URL(auth.tokenUrl).protocol !== 'https:') throw new Error(`${name}: token URL must use HTTPS`);
        urls.push(auth.tokenUrl);
      }
    }
    for (const u of urls) await assertSafeUrl(u, opts.lookup);
  }

  const existing = await db.monitor.findMany({ where: { userId: user.id }, select: { name: true } });
  const names = new Set(existing.map((m) => m.name));
  const data = [];
  for (const { auth, ...fields } of items) {
    if (names.has(fields.name)) continue;
    names.add(fields.name);
    const id = randomUUID(); // bound into the encryption AAD
    data.push({
      ...fields,
      id,
      userId: user.id,
      enabled: !opts.paused,
      timeoutMs: fields.timeoutMs ?? Math.min(10_000, fields.intervalSeconds * 1000),
      ...(auth && auth.type !== 'NONE' ? { authType: auth.type, encryptedAuthConfig: encryptAuthConfig(auth, id) } : {}),
    });
  }
  if (data.length) await db.monitor.createMany({ data });
  return { created: data.length, skipped: items.length - data.length };
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith('--'));
  if (!email || process.stdin.isTTY) throw new Error('Usage: <monitors JSON> | node dist/cli/importMonitors.js <email> [--paused]');
  const { created, skipped } = await importMonitors(prisma, {
    email,
    input: JSON.parse(await text(process.stdin)),
    paused: args.includes('--paused'),
  });
  console.log(`Created ${created} monitors, skipped ${skipped} that already existed. Checks start within a minute.`);
}

if (require.main === module) {
  main()
    .catch((err: Error) => {
      console.error(`Import failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
