import { config } from '../config';

/** The profile fields UptimeHQ needs from Clerk. */
export interface ClerkProfile {
  id: string;
  /** Primary email address, only if Clerk has verified it. */
  verifiedEmail: string | null;
  name: string;
}

export interface ClerkClient {
  /** Returns null when the user does not exist; throws on network/API errors. */
  getUser(userId: string): Promise<ClerkProfile | null>;
}

interface ClerkApiUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string; verification: { status: string } | null }[];
}

/** Minimal Clerk Backend API client using native fetch (no SDK dependency). */
export function createClerkClient(opts: { secretKey?: string; apiUrl?: string; fetch?: typeof fetch } = {}): ClerkClient {
  const secretKey = opts.secretKey ?? config.CLERK_SECRET_KEY;
  const apiUrl = (opts.apiUrl ?? config.CLERK_API_URL).replace(/\/$/, '');
  const doFetch = opts.fetch ?? fetch;
  return {
    async getUser(userId) {
      if (!secretKey) throw new Error('CLERK_SECRET_KEY is not set');
      const res = await doFetch(`${apiUrl}/v1/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Clerk API returned HTTP ${res.status}`);
      const u = (await res.json()) as ClerkApiUser;
      const primary = u.email_addresses.find((e) => e.id === u.primary_email_address_id);
      const verifiedEmail = primary && primary.verification?.status === 'verified' ? primary.email_address.toLowerCase() : null;
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || verifiedEmail?.split('@')[0] || 'User';
      return { id: u.id, verifiedEmail, name };
    },
  };
}
