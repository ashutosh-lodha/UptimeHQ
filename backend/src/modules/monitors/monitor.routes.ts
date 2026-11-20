import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Monitor, MonitorAuthType } from '@prisma/client';
import { prisma } from '../../db';
import { badRequest, HttpError, notFound } from '../../lib/errors';
import { rangeSchema, rangeStart } from '../../lib/range';
import { currentUserId } from '../../middleware/auth';
import { assertSafeUrl, DnsResolutionError, SsrfError, type LookupFn } from '../../monitoring/ssrf';
import type { AuthInput } from '../../monitoring/auth/auth.types';
import { CredentialKeyError, encryptAuthConfig, getEncryptionKey, isEncryptionKeyConfigured } from '../../monitoring/auth/auth.crypto';
import type { ScheduleSync } from '../../queue/scheduleSync';
import { overallUptime, responseSeries, uptimeByMonitor } from '../stats';
import { createMonitorSchema, updateMonitorSchema } from './monitor.schemas';

const idSchema = z.string().uuid('Invalid monitor id');

/** Public representation. Credentials (encrypted or not) are never included. */
export function serializeMonitor(m: Monitor) {
  return {
    id: m.id,
    name: m.name,
    url: m.url,
    method: m.method,
    intervalSeconds: m.intervalSeconds,
    timeoutMs: m.timeoutMs,
    expectedStatusMin: m.expectedStatusMin,
    expectedStatusMax: m.expectedStatusMax,
    enabled: m.enabled,
    status: m.enabled ? m.status : 'PAUSED',
    authType: m.authType,
    hasCredentials: m.authType !== 'NONE' && Boolean(m.encryptedAuthConfig),
    lastCheckedAt: m.lastCheckedAt,
    lastResponseTimeMs: m.lastResponseTimeMs,
    lastStatusCode: m.lastStatusCode,
    lastError: m.lastError,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/** Loads a monitor only if it belongs to the current user; otherwise 404 (no existence leak). */
export async function findOwnedMonitor(req: Request, id: string): Promise<Monitor> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) throw notFound('Monitor not found');
  const monitor = await prisma.monitor.findFirst({ where: { id: parsed.data, userId: currentUserId(req) } });
  if (!monitor) throw notFound('Monitor not found');
  return monitor;
}

const fieldError = (path: string, message: string) => badRequest('Validation failed', [{ path, message }]);

async function assertDestinationAllowed(url: string, path: string, lookup?: LookupFn) {
  try {
    await assertSafeUrl(url, lookup);
  } catch (err) {
    if (err instanceof SsrfError) throw fieldError(path, err.message);
    if (err instanceof DnsResolutionError) throw fieldError(path, 'Hostname could not be resolved');
    throw err;
  }
}

function requireHttpsForCredentials(url: string, authType: MonitorAuthType) {
  if (authType !== 'NONE' && new URL(url).protocol !== 'https:') {
    throw fieldError('url', 'HTTPS is required when authentication credentials are attached');
  }
}

/**
 * Validates and encrypts an auth input for storage. Fails clearly (503) when the
 * encryption key is missing or invalid, so secrets are never stored in plaintext.
 */
async function buildAuthData(monitorId: string, auth: AuthInput, lookup?: LookupFn) {
  if (auth.type === 'NONE') return { authType: 'NONE' as const, encryptedAuthConfig: null };
  if (auth.type === 'OAUTH2_CLIENT_CREDENTIALS') {
    let tokenUrl: URL;
    try {
      tokenUrl = new URL(auth.tokenUrl);
    } catch {
      throw fieldError('auth.tokenUrl', 'Enter a full token URL, e.g. https://auth.example.com/oauth/token');
    }
    if (tokenUrl.protocol !== 'https:') throw fieldError('auth.tokenUrl', 'Token URL must use HTTPS');
    await assertDestinationAllowed(auth.tokenUrl, 'auth.tokenUrl', lookup);
  }
  let key: Buffer;
  try {
    key = getEncryptionKey();
  } catch (err) {
    if (err instanceof CredentialKeyError) {
      throw new HttpError(503, `Credential storage is not available: ${err.message} See README.`);
    }
    throw err;
  }
  return { authType: auth.type, encryptedAuthConfig: encryptAuthConfig(auth, monitorId, key) };
}

const defaultTimeout = (intervalSeconds: number) => Math.min(10_000, intervalSeconds * 1000);

function assertTimeoutFitsInterval(timeoutMs: number, intervalSeconds: number) {
  if (timeoutMs > intervalSeconds * 1000) {
    throw fieldError('timeoutMs', `Timeout cannot be longer than the check interval (${intervalSeconds * 1000} ms)`);
  }
}

export function createMonitorRouter(deps: { scheduleSync: ScheduleSync; lookup?: LookupFn }) {
  const router = Router();

  /** Lets the UI tell users up front whether credentials can be stored. */
  router.get('/capabilities', (_req, res) => {
    res.json({ credentialEncryption: isEncryptionKeyConfigured() });
  });

  router.get('/', async (req, res) => {
    const userId = currentUserId(req);
    const monitors = await prisma.monitor.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const uptime = await uptimeByMonitor(
      prisma,
      monitors.map((m) => m.id),
      rangeStart('24h'),
    );
    res.json({
      monitors: monitors.map((m) => ({ ...serializeMonitor(m), uptime24h: uptime.get(m.id)?.uptime ?? null })),
    });
  });

  router.post('/', async (req, res) => {
    const { auth, ...input } = createMonitorSchema.parse(req.body);
    const timeoutMs = input.timeoutMs ?? defaultTimeout(input.intervalSeconds);
    assertTimeoutFitsInterval(timeoutMs, input.intervalSeconds);
    requireHttpsForCredentials(input.url, auth?.type ?? 'NONE');
    await assertDestinationAllowed(input.url, 'url', deps.lookup);

    // The id is generated up front because it is bound into the encryption AAD.
    const id = randomUUID();
    const authData = auth ? await buildAuthData(id, auth, deps.lookup) : {};
    const monitor = await prisma.monitor.create({
      data: { ...input, ...authData, id, timeoutMs, userId: currentUserId(req) },
    });
    await deps.scheduleSync.syncMonitor(monitor.id, { checkNow: true });
    res.status(201).json({ monitor: serializeMonitor(monitor) });
  });

  router.get('/:id', async (req, res) => {
    const monitor = await findOwnedMonitor(req, req.params.id);
    res.json({ monitor: serializeMonitor(monitor) });
  });

  router.patch('/:id', async (req, res) => {
    const existing = await findOwnedMonitor(req, req.params.id);
    const { auth, ...input } = updateMonitorSchema.parse(req.body);

    const min = input.expectedStatusMin ?? existing.expectedStatusMin;
    const max = input.expectedStatusMax ?? existing.expectedStatusMax;
    if (min > max) throw fieldError('expectedStatusMax', 'Minimum expected status must not exceed maximum');
    assertTimeoutFitsInterval(input.timeoutMs ?? existing.timeoutMs, input.intervalSeconds ?? existing.intervalSeconds);
    requireHttpsForCredentials(input.url ?? existing.url, auth?.type ?? existing.authType);
    if (input.url && input.url !== existing.url) await assertDestinationAllowed(input.url, 'url', deps.lookup);

    // Any credential change bumps the version so cached OAuth2 tokens are never reused.
    const authData = auth
      ? { ...(await buildAuthData(existing.id, auth, deps.lookup)), authConfigVersion: existing.authConfigVersion + 1 }
      : {};
    const monitor = await prisma.monitor.update({ where: { id: existing.id }, data: { ...input, ...authData } });

    const targetChanged =
      Boolean(auth) ||
      ['url', 'method', 'timeoutMs', 'expectedStatusMin', 'expectedStatusMax'].some(
        (k) => k in input && input[k as keyof typeof input] !== existing[k as keyof Monitor],
      );
    await deps.scheduleSync.syncMonitor(monitor.id, { checkNow: targetChanged && monitor.enabled });
    res.json({ monitor: serializeMonitor(monitor) });
  });

  router.post('/:id/pause', async (req, res) => {
    const existing = await findOwnedMonitor(req, req.params.id);
    const monitor = await prisma.monitor.update({ where: { id: existing.id }, data: { enabled: false } });
    await deps.scheduleSync.syncMonitor(monitor.id);
    res.json({ monitor: serializeMonitor(monitor) });
  });

  router.post('/:id/resume', async (req, res) => {
    const existing = await findOwnedMonitor(req, req.params.id);
    const monitor = await prisma.monitor.update({ where: { id: existing.id }, data: { enabled: true } });
    await deps.scheduleSync.syncMonitor(monitor.id, { checkNow: true });
    res.json({ monitor: serializeMonitor(monitor) });
  });

  router.delete('/:id', async (req, res) => {
    const existing = await findOwnedMonitor(req, req.params.id);
    await prisma.monitor.delete({ where: { id: existing.id } });
    await deps.scheduleSync.syncMonitor(existing.id);
    res.status(204).end();
  });

  router.get('/:id/stats', async (req, res) => {
    const monitor = await findOwnedMonitor(req, req.params.id);
    const range = rangeSchema.parse(req.query.range);
    const userId = currentUserId(req);
    const since = rangeStart(range);
    const [summary, series, incidentCount] = await Promise.all([
      overallUptime(prisma, { userId, monitorId: monitor.id, since }),
      responseSeries(prisma, { userId, monitorId: monitor.id, range }),
      prisma.incident.count({ where: { monitorId: monitor.id, startedAt: { gte: since } } }),
    ]);
    res.json({ range, ...summary, incidentCount, series });
  });

  router.get('/:id/checks', async (req, res) => {
    const monitor = await findOwnedMonitor(req, req.params.id);
    // Paginated, newest first. `result=failed` narrows to failed checks (useful for finding downtime).
    const { limit, page, range, result } = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        page: z.coerce.number().int().min(1).max(100_000).default(1),
        range: rangeSchema,
        result: z.enum(['all', 'failed']).default('all'),
      })
      .parse(req.query);
    const where = {
      monitorId: monitor.id,
      checkedAt: { gte: rangeStart(range) },
      ...(result === 'failed' ? { success: false } : {}),
    };
    const [checks, total] = await Promise.all([
      prisma.monitorCheck.findMany({ where, orderBy: { checkedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.monitorCheck.count({ where }),
    ]);
    res.json({ checks, page, pageSize: limit, total, pageCount: Math.max(1, Math.ceil(total / limit)) });
  });

  return router;
}
