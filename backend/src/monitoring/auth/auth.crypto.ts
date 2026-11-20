import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AuthConfig } from './auth.types';

/**
 * AES-256-GCM encryption for monitor credentials.
 *
 * Payload format (all base64): `v1:<iv 12 bytes>:<auth tag 16 bytes>:<ciphertext>`
 * Additional authenticated data: `uptimehq:monitor:<monitorId>`, so a payload
 * copied onto a different monitor row fails to decrypt.
 *
 * The key comes only from MONITOR_CREDENTIAL_ENCRYPTION_KEY (64 hex chars or
 * base64 for exactly 32 bytes). It is read on use, so the application runs
 * without it as long as no monitor uses authentication.
 */

export const PAYLOAD_VERSION = 'v1';
const ENV_KEY = 'MONITOR_CREDENTIAL_ENCRYPTION_KEY';

export class CredentialKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialKeyError';
  }
}

export class CredentialDecryptError extends Error {
  constructor(message = 'Stored credentials could not be decrypted') {
    super(message);
    this.name = 'CredentialDecryptError';
  }
}

/** Parses a key string; throws CredentialKeyError when missing or not 32 bytes. */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) {
    throw new CredentialKeyError(`${ENV_KEY} is not set. It is required to store monitor credentials.`);
  }
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, 'hex');
  else if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32) key = decoded;
  }
  if (!key) {
    throw new CredentialKeyError(`${ENV_KEY} is invalid: it must encode exactly 32 bytes (64 hex characters or base64).`);
  }
  return key;
}

export function getEncryptionKey(): Buffer {
  return parseEncryptionKey(process.env[ENV_KEY]);
}

export function isEncryptionKeyConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

const aad = (monitorId: string) => Buffer.from(`uptimehq:monitor:${monitorId}`, 'utf8');

export function encryptAuthConfig(config: AuthConfig, monitorId: string, key: Buffer = getEncryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(monitorId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PAYLOAD_VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptAuthConfig(payload: string, monitorId: string, key: Buffer = getEncryptionKey()): AuthConfig {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PAYLOAD_VERSION) throw new CredentialDecryptError('Unsupported credential payload format');
  const [, ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(aad(monitorId));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as AuthConfig;
  } catch {
    // Wrong key, tampered payload or wrong monitor id. Never echo payload contents.
    throw new CredentialDecryptError();
  }
}
