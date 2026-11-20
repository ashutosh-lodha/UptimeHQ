import type { AuthConfig, ResolvedAuth } from '../auth.types';

/**
 * Providers for methods that need no network call: they only turn the stored
 * configuration into request headers. (OAuth2 lives in oauth2.provider.ts.)
 */

export const noneProvider = (): ResolvedAuth => ({ headers: {}, secrets: [] });

export function bearerProvider(cfg: Extract<AuthConfig, { type: 'BEARER' }>): ResolvedAuth {
  return { headers: { Authorization: `Bearer ${cfg.token}` }, secrets: [cfg.token] };
}

export function basicProvider(cfg: Extract<AuthConfig, { type: 'BASIC' }>): ResolvedAuth {
  const encoded = Buffer.from(`${cfg.username}:${cfg.password}`, 'utf8').toString('base64');
  return { headers: { Authorization: `Basic ${encoded}` }, secrets: [cfg.password, encoded] };
}

export function apiKeyProvider(cfg: Extract<AuthConfig, { type: 'API_KEY' }>): ResolvedAuth {
  return { headers: { [cfg.headerName]: cfg.value }, secrets: [cfg.value] };
}

export function customHeadersProvider(cfg: Extract<AuthConfig, { type: 'CUSTOM_HEADERS' }>): ResolvedAuth {
  const headers: Record<string, string> = {};
  for (const h of cfg.headers) headers[h.name] = h.value;
  // Every custom header value is treated as potentially secret.
  return { headers, secrets: cfg.headers.map((h) => h.value) };
}

