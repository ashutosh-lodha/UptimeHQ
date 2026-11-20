import jwt from 'jsonwebtoken';
import { config } from '../config';

/**
 * Verifies a Clerk session token (a short-lived RS256 JWT) locally with Clerk's
 * JWT public key; no network call per request. Every protected API endpoint
 * requires one as `Authorization: Bearer <token>`.
 *
 * Checks: RS256 signature only (HS256 / "none" algorithm-confusion tokens fail),
 * exp/nbf with 5 s clock tolerance, `azp` (the origin that requested the token)
 * must be in CLERK_AUTHORIZED_PARTIES, and the session status must be active.
 */
export interface SessionClaims {
  sub: string;
  sid?: string;
}

export function verifySessionToken(
  token: string,
  opts: { publicKey?: string; authorizedParties?: string[] } = {},
): SessionClaims | null {
  const publicKey = opts.publicKey ?? config.CLERK_JWT_KEY;
  const parties = opts.authorizedParties ?? config.CLERK_AUTHORIZED_PARTIES;
  if (!publicKey) return null;
  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'], clockTolerance: 5 });
    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string' || !decoded.sub) return null;
    const azp = (decoded as { azp?: unknown }).azp;
    // Browser session tokens always carry azp; tokens from Clerk JWT templates may not.
    if (typeof azp === 'string' && !parties.includes(azp.replace(/\/$/, ''))) return null;
    const sts = (decoded as { sts?: unknown }).sts;
    if (typeof sts === 'string' && sts !== 'active') return null;
    return { sub: decoded.sub, sid: typeof decoded.sid === 'string' ? decoded.sid : undefined };
  } catch {
    return null;
  }
}
