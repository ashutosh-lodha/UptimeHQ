import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF protection for user-supplied monitor URLs.
 *
 * - Only http/https, no embedded credentials.
 * - Hostnames such as localhost, *.internal and cloud metadata names are rejected.
 * - IP literals and every DNS-resolved address are checked against private,
 *   loopback, link-local, CGNAT, multicast, reserved and metadata ranges.
 * - The HTTP checker calls `assertSafeUrl` again before every request and every
 *   redirect hop, so a destination is revalidated at request time.
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export class DnsResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DnsResolutionError';
  }
}

export interface LookupAddress {
  address: string;
  family: number;
}
export type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

export const systemLookup: LookupFn = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

const blockList = new net.BlockList();
// IPv4
for (const [net4, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes 169.254.169.254 metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blockList.addSubnet(net4, prefix, 'ipv4');
}
// IPv6
for (const [net6, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (incl. Teredo)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds IPv4)
  ['fc00::', 7], // unique local, includes AWS fd00:ec2::254 metadata
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
] as const) {
  blockList.addSubnet(net6, prefix, 'ipv6');
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

/** Expands an IPv6 address into 8 numeric hextets. Returns null when invalid. */
function expandIpv6(ip: string): number[] | null {
  let addr = ip;
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  // Embedded dotted IPv4 tail, e.g. ::ffff:127.0.0.1
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!net.isIPv4(tail)) return null;
    const o = tail.split('.').map(Number);
    addr = `${addr.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const nums = parts.map((p) => parseInt(p, 16));
  if (nums.length !== 8 || nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

/** Returns true when an IP address must never be contacted by the monitor. */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return blockList.check(ip, 'ipv4');
  if (net.isIPv6(ip)) {
    const h = expandIpv6(ip);
    if (!h) return true;
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses.
    const firstFiveZero = h.slice(0, 5).every((x) => x === 0);
    if (firstFiveZero && (h[5] === 0xffff || h[5] === 0)) {
      const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
      if (h[5] === 0xffff || h[6] !== 0 || h[7] > 1) return blockList.check(v4, 'ipv4');
    }
    const canonical = h.map((x) => x.toString(16)).join(':');
    return blockList.check(canonical, 'ipv6');
  }
  return true; // not an IP at all
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  // Single-label names resolve via search domains to internal hosts.
  if (!h.includes('.') && !net.isIP(h)) return true;
  return false;
}

/** Synchronous structural validation used by request validation (Zod refinement). */
export function validateUrlSyntax(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs are allowed' };
  }
  if (url.username || url.password) return { ok: false, reason: 'URLs with credentials are not allowed' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'URL must include a host' };
  if (net.isIP(host)) {
    if (isBlockedIp(host)) return { ok: false, reason: 'Private, loopback and reserved IP addresses are not allowed' };
  } else if (isBlockedHostname(host)) {
    return { ok: false, reason: 'Internal or local hostnames are not allowed' };
  }
  return { ok: true, url };
}

/**
 * Full validation including DNS resolution. Throws SsrfError when the target is
 * internal, or DnsResolutionError when the hostname does not resolve.
 */
export async function assertSafeUrl(raw: string, lookup: LookupFn = systemLookup): Promise<URL> {
  const result = validateUrlSyntax(raw);
  if (!result.ok) throw new SsrfError(result.reason);
  const host = result.url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return result.url;

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    throw new DnsResolutionError(`DNS lookup failed for ${host}${code ? ` (${code})` : ''}`);
  }
  if (addresses.length === 0) throw new DnsResolutionError(`DNS lookup returned no addresses for ${host}`);
  const blocked = addresses.find((a) => isBlockedIp(a.address));
  if (blocked) throw new SsrfError(`${host} resolves to a blocked address (${blocked.address})`);
  return result.url;
}
