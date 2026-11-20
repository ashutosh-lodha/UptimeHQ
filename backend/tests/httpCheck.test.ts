import { describe, expect, it, vi } from 'vitest';
import { performHttpCheck, type CheckTarget } from '../src/monitoring/httpCheck';
import { fakeLookup, mockResponse } from './helpers';

const target: CheckTarget = {
  url: 'https://api.example.com/health',
  method: 'GET',
  timeoutMs: 2000,
  expectedStatusMin: 200,
  expectedStatusMax: 299,
};

function clock(...times: number[]) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

describe('HTTP checks', () => {
  it('records a successful check with status and response time', async () => {
    const fetchMock = vi.fn(async () => mockResponse(200));
    const result = await performHttpCheck(target, { fetch: fetchMock as typeof fetch, lookup: fakeLookup, now: clock(1000, 1123) });
    expect(result).toEqual({ success: true, outcome: 'SUCCESS', statusCode: 200, responseTimeMs: 123, error: null });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('uses HEAD when configured', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => mockResponse(204));
    const result = await performHttpCheck({ ...target, method: 'HEAD' }, { fetch: fetchMock as typeof fetch, lookup: fakeLookup });
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
  });

  it('fails on an unexpected status code', async () => {
    const fetchMock = vi.fn(async () => mockResponse(503));
    const result = await performHttpCheck(target, { fetch: fetchMock as typeof fetch, lookup: fakeLookup });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.error).toMatch(/Unexpected status code 503/);
  });

  it('handles connection failures', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    });
    const result = await performHttpCheck(target, { fetch: fetchMock as typeof fetch, lookup: fakeLookup });
    expect(result).toMatchObject({ success: false, statusCode: null, error: 'Connection refused' });
  });

  it('handles DNS failures without calling fetch', async () => {
    const fetchMock = vi.fn();
    const result = await performHttpCheck(
      { ...target, url: 'https://nxdomain.example.com' },
      { fetch: fetchMock as unknown as typeof fetch, lookup: fakeLookup },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/DNS lookup failed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('times out slow responses', async () => {
    const fetchMock = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const result = await performHttpCheck({ ...target, timeoutMs: 50 }, { fetch: fetchMock as unknown as typeof fetch, lookup: fakeLookup });
    expect(result).toMatchObject({ success: false, error: 'Request timed out after 50 ms' });
  });

  it('follows safe redirects and revalidates every hop', async () => {
    const lookup = vi.fn(fakeLookup);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(301, { location: 'https://www.example.com/health' }))
      .mockResolvedValueOnce(mockResponse(200));
    const result = await performHttpCheck(target, { fetch: fetchMock, lookup });
    expect(result).toMatchObject({ success: true, statusCode: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://www.example.com/health');
    expect(lookup).toHaveBeenCalledWith('api.example.com');
    expect(lookup).toHaveBeenCalledWith('www.example.com');
  });

  it('blocks redirects to private or internal addresses', async () => {
    for (const location of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'https://private.example.com/']) {
      const fetchMock = vi.fn().mockResolvedValueOnce(mockResponse(302, { location }));
      const result = await performHttpCheck(target, { fetch: fetchMock, lookup: fakeLookup });
      expect(result.success, location).toBe(false);
      expect(result.error, location).toMatch(/Blocked destination/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('stops after too many redirects', async () => {
    const fetchMock = vi.fn(async () => mockResponse(302, { location: 'https://api.example.com/loop' }));
    const result = await performHttpCheck(target, { fetch: fetchMock as typeof fetch, lookup: fakeLookup });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Too many redirects/);
  });

  it('treats a 3xx without Location as a final response', async () => {
    const fetchMock = vi.fn(async () => mockResponse(304));
    const ok = await performHttpCheck({ ...target, expectedStatusMax: 399 }, { fetch: fetchMock as typeof fetch, lookup: fakeLookup });
    expect(ok).toMatchObject({ success: true, statusCode: 304 });
  });
});
