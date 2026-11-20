import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import type { MonitorLock } from './runCheck';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/** Simple single-instance Redis lock (SET NX PX + compare-and-delete release). */
export function createRedisLock(redis: IORedis): MonitorLock {
  const key = (id: string) => `uptimehq:lock:monitor:${id}`;
  return {
    async acquire(monitorId, ttlMs) {
      const token = randomUUID();
      const ok = await redis.set(key(monitorId), token, 'PX', ttlMs, 'NX');
      return ok === 'OK' ? token : null;
    },
    async release(monitorId, token) {
      await redis.eval(RELEASE_SCRIPT, 1, key(monitorId), token);
    },
  };
}
