import { z } from 'zod';

/**
 * Credential configuration for authenticated monitors. Validated on input,
 * then stored only as an AES-256-GCM encrypted payload (see auth.crypto.ts).
 */

/** RFC 9110 token characters. */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Visible ASCII, space and tab; no CR, LF or NUL (prevents header injection). */
const HEADER_VALUE_RE = /^[\t\x20-\x7e]*$/;

/** Headers users may never set: transport-managed, or would override managed auth. */
export const RESTRICTED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'expect',
  'proxy-authorization',
  'proxy-connection',
  'authorization',
]);

export function headerNameIssue(name: string): string | null {
  if (!HEADER_NAME_RE.test(name)) return 'Header name contains invalid characters';
  const lower = name.toLowerCase();
  if (RESTRICTED_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
    return `Header "${name}" cannot be set`;
  }
  return null;
}

const headerName = z
  .string()
  .trim()
  .min(1, 'Header name is required')
  .max(100, 'Header name is too long')
  .superRefine((v, ctx) => {
    const issue = headerNameIssue(v);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
  });

const headerValue = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .max(4096, `${label} is too long`)
    .regex(HEADER_VALUE_RE, `${label} contains invalid characters (line breaks are not allowed)`);

const secret = (label: string, max = 4096) =>
  z.string().min(1, `${label} is required`).max(max, `${label} is too long`).regex(HEADER_VALUE_RE, `${label} contains invalid characters`);

export const authInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }).strict(),
  z.object({ type: z.literal('BEARER'), token: secret('Token') }).strict(),
  z
    .object({
      type: z.literal('BASIC'),
      // RFC 7617: the user-id must not contain a colon.
      username: secret('Username', 256).refine((v) => !v.includes(':'), 'Username cannot contain ":"'),
      password: secret('Password', 1024),
    })
    .strict(),
  z.object({ type: z.literal('API_KEY'), headerName, value: headerValue('API key') }).strict(),
  z
    .object({
      type: z.literal('CUSTOM_HEADERS'),
      headers: z
        .array(z.object({ name: headerName, value: headerValue('Header value') }).strict())
        .min(1, 'Add at least one header')
        .max(20, 'At most 20 headers are allowed')
        .superRefine((hs, ctx) => {
          const seen = new Set<string>();
          hs.forEach((h, i) => {
            const k = h.name.toLowerCase();
            if (seen.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate header "${h.name}"`, path: [i, 'name'] });
            seen.add(k);
          });
        }),
    })
    .strict(),
  z
    .object({
      type: z.literal('OAUTH2_CLIENT_CREDENTIALS'),
      tokenUrl: z.string().trim().min(1, 'Token URL is required').max(2048),
      clientId: secret('Client ID', 512),
      clientSecret: secret('Client secret', 2048),
      scope: z
        .string()
        .trim()
        .max(1024)
        .regex(/^[\x21\x23-\x5b\x5d-\x7e ]*$/, 'Scope contains invalid characters')
        .optional()
        .transform((v) => (v ? v : undefined)),
      clientAuthMethod: z.enum(['client_secret_basic', 'client_secret_post']).default('client_secret_basic'),
    })
    .strict(),
]);

export type AuthInput = z.infer<typeof authInputSchema>;
/** What is encrypted and stored (everything except NONE). */
export type AuthConfig = Exclude<AuthInput, { type: 'NONE' }>;
export type AuthType = AuthInput['type'];
export type OAuth2Config = Extract<AuthConfig, { type: 'OAUTH2_CLIENT_CREDENTIALS' }>;

/** Headers to attach to one request, plus the secret values to redact from errors. */
export interface ResolvedAuth {
  headers: Record<string, string>;
  secrets: string[];
  /** Present for OAuth2 so a 401 can invalidate exactly this token. */
  oauthToken?: string;
}
