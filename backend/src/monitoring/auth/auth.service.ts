import type { MonitorAuthType } from '@prisma/client';
import { decryptAuthConfig, CredentialDecryptError } from './auth.crypto';
import type { ResolvedAuth } from './auth.types';
import { OAuth2Provider } from './providers/oauth2.provider';
import { apiKeyProvider, basicProvider, bearerProvider, customHeadersProvider, noneProvider } from './providers/static.providers';

export interface MonitorAuthFields {
  id: string;
  authType: MonitorAuthType;
  encryptedAuthConfig: string | null;
  authConfigVersion: number;
}

/**
 * Turns a monitor's stored (encrypted) authentication into request headers.
 * The worker calls this before each check; it never handles credentials itself.
 *
 * Throws CredentialKeyError / CredentialDecryptError when credentials cannot be
 * read, and TokenAcquisitionError when an OAuth2 token cannot be obtained.
 */
export class AuthService {
  constructor(private readonly oauth2: OAuth2Provider) {}

  async resolve(monitor: MonitorAuthFields, opts: { rejectedToken?: string } = {}): Promise<ResolvedAuth> {
    if (monitor.authType === 'NONE') return noneProvider();
    if (!monitor.encryptedAuthConfig) throw new CredentialDecryptError('Monitor has no stored credentials');

    const cfg = decryptAuthConfig(monitor.encryptedAuthConfig, monitor.id);
    if (cfg.type !== monitor.authType) throw new CredentialDecryptError('Stored credentials do not match the authentication type');

    switch (cfg.type) {
      case 'BEARER':
        return bearerProvider(cfg);
      case 'BASIC':
        return basicProvider(cfg);
      case 'API_KEY':
        return apiKeyProvider(cfg);
      case 'CUSTOM_HEADERS':
        return customHeadersProvider(cfg);
      case 'OAUTH2_CLIENT_CREDENTIALS': {
        const token = await this.oauth2.getToken(monitor.id, monitor.authConfigVersion, cfg, opts);
        return { headers: { Authorization: `Bearer ${token}` }, secrets: [token, cfg.clientSecret], oauthToken: token };
      }
    }
  }
}

/** Replaces any secret value occurring in a message (defence in depth for persisted errors). */
export function redactSecrets(message: string | null, secrets: string[]): string | null {
  if (!message) return message;
  let out = message;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[REDACTED]');
  return out;
}
