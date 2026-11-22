import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { performHttpCheck, type CheckTarget } from '../src/monitoring/httpCheck';
import { fakeLookup } from './helpers';

// A real socket is needed here: mocked Responses don't abort their body when the signal fires.
let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

async function check(handler: http.RequestListener, overrides: Partial<CheckTarget> = {}) {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const target: CheckTarget = {
    url: 'https://api.example.com/health',
    method: 'GET',
    timeoutMs: 1000,
    expectedStatusMin: 200,
    expectedStatusMax: 399,
    ...overrides,
  };
  return performHttpCheck(target, {
    lookup: fakeLookup,
    fetch: ((_url: URL, init: RequestInit) => fetch(`http://127.0.0.1:${port}/`, init)) as typeof fetch,
  });
}

const stall =
  (status: number, type = 'text/plain'): http.RequestListener =>
  (_req, res) => {
    res.writeHead(status, { 'Content-Type': type });
    res.write('partial');
  };

describe('response body', () => {
  it('times out when a healthy status is followed by a body that hangs', async () => {
    const result = await check(stall(200));
    expect(result).toMatchObject({
      success: false,
      outcome: 'TIMEOUT',
      statusCode: 200,
      error: 'Response body timed out after 1000 ms (HTTP 200)',
    });
  });

  it('accepts a slow body that completes within the timeout', async () => {
    const result = await check((_req, res) => {
      res.writeHead(200);
      res.write('partial');
      setTimeout(() => res.end('done'), 200);
    });
    expect(result).toMatchObject({ success: true, outcome: 'SUCCESS', statusCode: 200 });
  });

  it('keeps the status failure when a failing response also hangs', async () => {
    const result = await check(stall(503));
    expect(result).toMatchObject({ success: false, outcome: 'HTTP_STATUS_FAILURE', statusCode: 503 });
  });

  it('does not wait for an event stream to end', async () => {
    const result = await check(stall(200, 'text/event-stream; charset=utf-8'));
    expect(result).toMatchObject({ success: true, outcome: 'SUCCESS', statusCode: 200 });
    expect(result.responseTimeMs).toBeLessThan(900);
  });

  it('reads no more than 1 MB of an endless body', async () => {
    const result = await check(
      (_req, res) => {
        res.writeHead(200);
        const chunk = Buffer.alloc(64 * 1024, 'a');
        const pump = () => {
          while (!res.destroyed && res.write(chunk));
        };
        res.on('drain', pump);
        pump();
      },
      { timeoutMs: 5000 },
    );
    expect(result).toMatchObject({ success: true, outcome: 'SUCCESS' });
  });

  it('succeeds for HEAD, which has no body', async () => {
    const result = await check((_req, res) => res.writeHead(200, { 'Content-Length': '500' }).end(), { method: 'HEAD' });
    expect(result).toMatchObject({ success: true, statusCode: 200 });
  });
});
