import type { PrismaClient } from '@prisma/client';
import { performHttpCheck, type CheckResult, type HttpCheckDeps } from './httpCheck';
import { recordCheckResult, type RecordOutcome } from './incidentEngine';
import { AuthService, redactSecrets } from './auth/auth.service';
import { CredentialDecryptError, CredentialKeyError } from './auth/auth.crypto';
import { TokenAcquisitionError } from './auth/providers/oauth2.provider';
import type { ResolvedAuth } from './auth/auth.types';
import { logger, errorMessage } from '../lib/logger';

export interface MonitorLock {
  /** Returns a token when acquired, or null when another check holds the lock. */
  acquire(monitorId: string, ttlMs: number): Promise<string | null>;
  release(monitorId: string, token: string): Promise<void>;
}

export interface RunCheckDeps {
  db: PrismaClient;
  lock: MonitorLock;
  auth: AuthService;
  enqueueNotification: (deliveryId: string) => Promise<void>;
  http?: HttpCheckDeps;
}

export type RunCheckOutcome =
  | { status: 'skipped'; reason: 'locked' | 'missing' | 'paused' }
  | ({ status: 'checked' } & RecordOutcome);

/** Maps an authentication failure (raised before any request is sent) to a check result. */
function authFailure(err: unknown): CheckResult {
  const base = { success: false, statusCode: null, responseTimeMs: null } as const;
  if (err instanceof TokenAcquisitionError) {
    return { ...base, outcome: 'TOKEN_ACQUISITION_FAILED', error: `OAuth2 token request failed: ${err.message}` };
  }
  if (err instanceof CredentialKeyError || err instanceof CredentialDecryptError) {
    return { ...base, outcome: 'AUTHENTICATION_FAILED', error: `Credentials unavailable: ${err.message}` };
  }
  return { ...base, outcome: 'AUTHENTICATION_FAILED', error: 'Could not prepare authentication for this check' };
}

/**
 * Executes a scheduled check for one monitor:
 * Authentication Service -> HTTP Checker -> Result Processing.
 * Prevents overlapping checks via a lock.
 */
export async function runMonitorCheck(deps: RunCheckDeps, monitorId: string): Promise<RunCheckOutcome> {
  const monitor = await deps.db.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor) return { status: 'skipped', reason: 'missing' };
  if (!monitor.enabled) return { status: 'skipped', reason: 'paused' };

  // Covers a token request, the check and at most one OAuth2 retry.
  const token = await deps.lock.acquire(monitorId, monitor.timeoutMs * 2 + 40_000);
  if (!token) return { status: 'skipped', reason: 'locked' };

  try {
    const checkedAt = new Date();
    const target = {
      url: monitor.url,
      method: monitor.method,
      timeoutMs: monitor.timeoutMs,
      expectedStatusMin: monitor.expectedStatusMin,
      expectedStatusMax: monitor.expectedStatusMax,
      authenticated: monitor.authType !== 'NONE',
    };

    let result: CheckResult;
    let auth: ResolvedAuth | null = null;
    try {
      auth = await deps.auth.resolve(monitor);
      result = await performHttpCheck({ ...target, headers: auth.headers }, deps.http);

      // OAuth2: a 401 may mean the cached token was revoked. Refresh once and retry once.
      if (result.statusCode === 401 && auth.oauthToken) {
        auth = await deps.auth.resolve(monitor, { rejectedToken: auth.oauthToken });
        result = await performHttpCheck({ ...target, headers: auth.headers }, deps.http);
      }
    } catch (err) {
      result = authFailure(err);
    }
    result.error = redactSecrets(result.error, auth?.secrets ?? []);

    const outcome = await recordCheckResult(deps.db, monitorId, result, checkedAt);

    for (const deliveryId of outcome.deliveryIds) {
      try {
        await deps.enqueueNotification(deliveryId);
      } catch (err) {
        // The delivery row stays PENDING; the scheduler's sweep re-enqueues it.
        logger.error('Failed to enqueue notification', { deliveryId, error: errorMessage(err) });
      }
    }
    if (outcome.transition) {
      logger.info('Monitor state transition', { monitorId, transition: outcome.transition, incidentId: outcome.incidentId });
    }
    return { status: 'checked', ...outcome };
  } finally {
    await deps.lock.release(monitorId, token).catch(() => undefined);
  }
}
