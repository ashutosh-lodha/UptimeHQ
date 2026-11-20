import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Background services have no HTTP port, so they write a heartbeat file that
 * the Docker health check inspects (see Dockerfile / docker-compose.yml).
 */
export function startHeartbeat(name: string, check: () => Promise<boolean>, intervalMs = 15_000) {
  const file = path.join(os.tmpdir(), `${name}.heartbeat`);
  const beat = async () => {
    try {
      if (await check()) writeFileSync(file, String(Date.now()));
    } catch {
      // A missed heartbeat makes the container unhealthy; Docker restarts it.
    }
  };
  void beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
