import { beforeEach, describe, expect, it } from 'vitest';
import { importMonitors } from '../src/cli/importMonitors';
import { decryptAuthConfig } from '../src/monitoring/auth/auth.crypto';
import { createTestApp, prisma, registerUser, resetDb } from './helpers';

const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const url = 'https://uptime.example.com/testlab/e/bearer';
const input = [
  { name: 'Lab: plain', url, intervalSeconds: 300 },
  { name: 'Lab: bearer', url, intervalSeconds: 30, timeoutMs: 8000, auth: { type: 'BEARER', token: 'test-token-123' } },
];

describe('monitor importer', () => {
  beforeEach(resetDb);

  it('creates monitors for that account only, encrypts credentials and is safe to repeat', async () => {
    const { app } = createTestApp();
    const { user } = await registerUser(app, { email: 'import@example.com' });
    const other = await registerUser(app);

    expect(await importMonitors(prisma, { email: 'Import@Example.com', input, lookup })).toEqual({ created: 2, skipped: 0 });
    expect(await importMonitors(prisma, { email: 'import@example.com', input, lookup })).toEqual({ created: 0, skipped: 2 });
    expect(await prisma.monitor.count({ where: { userId: other.user.id } })).toBe(0);

    const m = await prisma.monitor.findFirstOrThrow({ where: { userId: user.id, name: 'Lab: bearer' } });
    expect(m.authType).toBe('BEARER');
    expect(m.encryptedAuthConfig).not.toContain('test-token-123');
    expect(decryptAuthConfig(m.encryptedAuthConfig!, m.id)).toMatchObject({ token: 'test-token-123' });
  });

  it('can import paused', async () => {
    await registerUser(createTestApp().app, { email: 'paused@example.com' });
    await importMonitors(prisma, { email: 'paused@example.com', input, paused: true, lookup });
    expect(await prisma.monitor.count({ where: { enabled: true } })).toBe(0);
  });

  it('writes nothing for an unknown account or an unsafe or insecure monitor', async () => {
    await registerUser(createTestApp().app, { email: 'safe@example.com' });
    await expect(importMonitors(prisma, { email: 'nobody@example.com', input, lookup })).rejects.toThrow(/No account/);
    for (const bad of ['http://uptime.example.com/x', 'https://10.0.0.1/x']) {
      const items = [input[0], { ...input[1], url: bad }];
      await expect(importMonitors(prisma, { email: 'safe@example.com', input: items, lookup })).rejects.toThrow();
    }
    expect(await prisma.monitor.count()).toBe(0);
  });
});
