import { assertSafeUrl, DnsResolutionError, SsrfError, systemLookup, type LookupFn } from '../../ssrf';
import type { OAuth2Config } from '../auth.types';
import type { CachedToken, TokenCache } from '../tokenCache';

/**
 * OAuth2 client credentials grant (RFC 6749 §4.4) for machine-to-machine checks.
 *
 * - Tokens are cached in Redis under `oauth:token:<monitorId>:v<authConfigVersion>`,
 *   so changing credentials (which bumps the version) never reuses an old token.
 * - Tokens are refreshed shortly before they expire.
 * - Concurrent checks share one token request: an in-process single-flight map
 *   plus a short Redis lock across worker processes.
 * - The token endpoint gets the same SSRF validation as monitored URLs, must use
 *   HTTPS, and redirects are not followed.
 * - Token response bodies are never logged or persisted.
 */

export class TokenAcquisitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenAcquisitionError';
  }
}

export interface OAuth2Deps {
  cache: TokenCache;
  fetch?: typeof fetch;
  lookup?: LookupFn;
  now?: () => number;
  /** Token request timeout. */
  timeoutMs?: number;
  /** How long to wait for another worker's in-progress token request. */
  lockWaitMs?: number;
}

export const DEFAULT_TOKEN_TTL_SECONDS = 300;
export const MAX_TOKEN_TTL_SECONDS = 24 * 3600;
const SAFE_ERROR_CODE = /^[\x20-\x21\x23-\x5b\x5d-\x7e]{1,64}$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Form-encodes a client credential for HTTP Basic, per RFC 6749 §2.3.1. */
const formEncode = (v: string) => new URLSearchParams({ v }).toString().slice(2);

export class OAuth2Provider {
  private readonly inflight = new Map<string, Promise<CachedToken>>();
  private readonly doFetch: typeof fetch;
  private readonly lookup: LookupFn;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly lockWaitMs: number;

  constructor(private readonly deps: OAuth2Deps) {
    this.doFetch = deps.fetch ?? fetch;
    this.lookup = deps.lookup ?? systemLookup;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 10_000;
    this.lockWaitMs = deps.lockWaitMs ?? 5_000;
  }

  static cacheKey(monitorId: string, version: number) {
    return `uptimehq:oauth:token:${monitorId}:v${version}`;
  }

  /** Refresh when less than 10% of the lifetime (between 5 s and 60 s) remains. */
  private isFresh(t: CachedToken | null, rejected?: string): t is CachedToken {
    if (!t || t.accessToken === rejected) return false;
    const skew = Math.max(5_000, Math.min(60_000, (t.expiresAt - t.obtainedAt) * 0.1));
    return t.expiresAt - this.now() > skew;
  }

  // Redis problems degrade to "cache miss" instead of failing the check.
  private async cacheGet(key: string) {
    try {
      return await this.deps.cache.get(key);
    } catch {
      return null;
    }
  }

  /**
   * Returns a valid access token. Pass `rejectedToken` after a 401 to discard
   * that token and obtain a new one.
   */
  async getToken(monitorId: string, version: number, cfg: OAuth2Config, opts: { rejectedToken?: string } = {}): Promise<string> {
    const key = OAuth2Provider.cacheKey(monitorId, version);
    const cached = await this.cacheGet(key);
    if (this.isFresh(cached, opts.rejectedToken)) return cached.accessToken;

    const existing = this.inflight.get(key);
    if (existing) {
      const t = await existing;
      if (t.accessToken !== opts.rejectedToken) return t.accessToken;
    }
    const p = this.acquire(key, cfg, opts.rejectedToken).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return (await p).accessToken;
  }

  private async acquire(key: string, cfg: OAuth2Config, rejected?: string): Promise<CachedToken> {
    const lockKey = `${key}:lock`;
    let owner: string | null = null;
    try {
      owner = await this.deps.cache.tryLock(lockKey, this.timeoutMs + 5_000);
    } catch {
      owner = null;
    }

    if (!owner) {
      // Another worker is fetching: wait briefly for its result.
      const deadline = this.now() + this.lockWaitMs;
      while (this.now() < deadline) {
        await sleep(100);
        const t = await this.cacheGet(key);
        if (this.isFresh(t, rejected)) return t;
      }
      // Still nothing: fall through and request a token ourselves.
    }

    try {
      const again = await this.cacheGet(key);
      if (this.isFresh(again, rejected)) return again;
      if (rejected) await this.deps.cache.del(key).catch(() => undefined);

      const token = await this.requestToken(cfg);
      await this.deps.cache.set(key, token, token.expiresAt - this.now()).catch(() => undefined);
      return token;
    } finally {
      if (owner) await this.deps.cache.unlock(lockKey, owner).catch(() => undefined);
    }
  }

  /** Performs the client credentials token request. Throws TokenAcquisitionError. */
  async requestToken(cfg: OAuth2Config): Promise<CachedToken> {
    let url: URL;
    try {
      url = await assertSafeUrl(cfg.tokenUrl, this.lookup);
    } catch (err) {
      if (err instanceof SsrfError) throw new TokenAcquisitionError(`Token URL blocked: ${err.message}`);
      if (err instanceof DnsResolutionError) throw new TokenAcquisitionError(`Token URL ${err.message}`);
      throw new TokenAcquisitionError('Token URL is invalid');
    }
    if (url.protocol !== 'https:') throw new TokenAcquisitionError('Token URL must use HTTPS');

    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (cfg.scope) body.set('scope', cfg.scope);
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'UptimeHQ-Monitor/1.0',
    };
    if (cfg.clientAuthMethod === 'client_secret_post') {
      body.set('client_id', cfg.clientId);
      body.set('client_secret', cfg.clientSecret);
    } else {
      headers.Authorization = `Basic ${Buffer.from(`${formEncode(cfg.clientId)}:${formEncode(cfg.clientSecret)}`).toString('base64')}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.doFetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) throw new TokenAcquisitionError(`Token request timed out after ${this.timeoutMs} ms`);
      const code = (err as { cause?: { code?: string } })?.cause?.code;
      throw new TokenAcquisitionError(`Token request failed${code ? ` (${code})` : ''}`);
    } finally {
      clearTimeout(timer);
    }

    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }

    if (res.status >= 300 && res.status < 400) {
      throw new TokenAcquisitionError(`Token endpoint responded with redirect HTTP ${res.status} (redirects are not followed)`);
    }
    if (!res.ok) {
      // Only the standardised `error` code is surfaced (e.g. invalid_client); never the body.
      const code = typeof json?.error === 'string' && SAFE_ERROR_CODE.test(json.error) ? ` (${json.error})` : '';
      throw new TokenAcquisitionError(`Token endpoint returned HTTP ${res.status}${code}`);
    }
    const accessToken = json?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0 || accessToken.length > 16_384 || /[\r\n]/.test(accessToken)) {
      throw new TokenAcquisitionError('Token endpoint response did not contain a valid access_token');
    }
    const tokenType = json?.token_type;
    if (tokenType !== undefined && (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer')) {
      throw new TokenAcquisitionError('Token endpoint returned an unsupported token_type (expected Bearer)');
    }

    const raw = Number(json?.expires_in);
    const ttlSeconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_TOKEN_TTL_SECONDS) : DEFAULT_TOKEN_TTL_SECONDS;
    const obtainedAt = this.now();
    return { accessToken, obtainedAt, expiresAt: obtainedAt + ttlSeconds * 1000 };
  }
}
