import { describe, expect, it } from 'vitest';
import { assertSafeUrl, DnsResolutionError, isBlockedIp, SsrfError, validateUrlSyntax } from '../src/monitoring/ssrf';
import { fakeLookup } from './helpers';

describe('SSRF protection', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd00:ec2::254',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a9fe:a9fe',
  ])('blocks internal address %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public address %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it('rejects non-http schemes, credentials and internal hostnames', () => {
    for (const url of [
      'file:///etc/passwd',
      'gopher://example.com',
      'javascript:alert(1)',
      'http://user:pw@example.com',
      'http://localhost',
      'http://app.localhost',
      'http://metadata.google.internal',
      'http://service.internal',
      'http://printer.local',
      'http://intranet',
      'http://0x7f.0.0.1', // WHATWG URL normalises to 127.0.0.1
      'http://2130706433', // decimal 127.0.0.1
      'http://[::ffff:127.0.0.1]',
      'not a url',
    ]) {
      expect(validateUrlSyntax(url).ok, url).toBe(false);
    }
    expect(validateUrlSyntax('https://example.com/health?x=1').ok).toBe(true);
    expect(validateUrlSyntax('http://93.184.216.34:8080/').ok).toBe(true);
  });

  it('validates DNS-resolved addresses', async () => {
    await expect(assertSafeUrl('https://ok.example.com', fakeLookup)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl('https://private.example.com', fakeLookup)).rejects.toBeInstanceOf(SsrfError);
    // Any blocked record among several is enough to reject.
    await expect(assertSafeUrl('https://rebind.example.com', fakeLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://nxdomain.example.com', fakeLookup)).rejects.toBeInstanceOf(DnsResolutionError);
  });
});
