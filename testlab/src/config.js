import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE } from './catalogue.js';

/**
 * The password protects the control panel and seeds the test credentials. It is taken from
 * TESTLAB_PASSWORD, or generated on first start and kept in the data volume. It is never logged.
 */
function loadPassword(dataDir, fromEnv) {
  if (fromEnv) {
    if (fromEnv.length < 16) throw new Error('TESTLAB_PASSWORD must be at least 16 characters');
    return fromEnv;
  }
  const file = join(dataDir, 'password');
  if (!existsSync(file)) {
    try {
      writeFileSync(file, randomBytes(18).toString('base64url'), { mode: 0o600, flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return readFileSync(file, 'utf8').trim();
}

export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || './data';
  mkdirSync(dataDir, { recursive: true });

  const app = new URL(env.APP_URL || 'http://localhost:8090');
  return {
    port: Number(env.PORT || 8090),
    dataDir,
    password: loadPassword(dataDir, env.TESTLAB_PASSWORD),
    publicUrl: `${app.origin}${BASE}`,
    // Where the checker is sent for failures that happen below HTTP.
    targets: {
      dns: 'https://uptimehq-testlab.invalid/',
      unreachable: 'https://[2606:4700:4700::1111]/', // containers have no IPv6 route
      blackhole: 'https://1.2.3.4/',
      blocked: 'http://10.0.0.1/',
      tls: env.TESTLAB_TLS_URL || 'https://wrong.host.badssl.com/',
      // Open in GCP's default firewall (RDP) with nothing listening on a Linux VM.
      refused: env.TESTLAB_REFUSED_URL || `https://${app.hostname}:3389/`,
    },
  };
}
