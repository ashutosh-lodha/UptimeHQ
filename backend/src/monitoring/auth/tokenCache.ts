import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';

/** Only the access token and its timing are cached; never client secrets or refresh tokens. */
export interface CachedToken {
  accessToken: string;
  obtainedAt: number;
  expiresAt: number;
}

export interface TokenCache {
  get(key: string): Promise<CachedToken | null>;
  set(key: string, token: CachedToken, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Short-lived lock so only one worker requests a token at a time. */
  tryLock(key: string, ttlMs: number): Promise<string | null>;
  unlock(key: string, owner: string): Promise<void>;
}

const UNLOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/** Token cache on the existing BullMQ Redis instance. */
export function createRedisTokenCache(redis: IORedis): TokenCache {
  return {
    async get(key) {
      const raw = await redis.get(key);
      if (!raw) return null;
      try {
        const v = JSON.parse(raw) as CachedToken;
        return typeof v.accessToken === 'string' && Number.isFinite(v.expiresAt) ? v : null;
      } catch {
        return null;
      }
    },
    async set(key, token, ttlMs) {
      await redis.set(key, JSON.stringify(token), 'PX', Math.max(1000, Math.floor(ttlMs)));
    },
    async del(key) {
      await redis.del(key);
    },
    async tryLock(key, ttlMs) {
      const owner = randomUUID();
      return (await redis.set(key, owner, 'PX', ttlMs, 'NX')) === 'OK' ? owner : null;
    },
    async unlock(key, owner) {
      await redis.eval(UNLOCK_SCRIPT, 1, key, owner);
    },
  };
}
