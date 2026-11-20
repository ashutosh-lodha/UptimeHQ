import { generateKeyPairSync } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// Throwaway RSA key pair standing in for Clerk's JWT signing key in tests.
const clerkKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://uptimehq:uptimehq@localhost:54329/uptimehq_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    // Integration tests share one PostgreSQL database, so run files serially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      // Real Redis is used by the OAuth2 token cache tests.
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:63799',
      // Test-only key (32 bytes, hex). Never use this value anywhere else.
      MONITOR_CREDENTIAL_ENCRYPTION_KEY: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      CLERK_SECRET_KEY: 'sk_test_fake_for_tests',
      CLERK_JWT_KEY: clerkKeys.publicKey,
      CLERK_AUTHORIZED_PARTIES: 'http://localhost:8080',
      TEST_CLERK_PRIVATE_KEY: clerkKeys.privateKey,
      APP_URL: 'http://localhost:8080',
      SMTP_HOST: '',
      SMTP_FROM: '',
    },
  },
});
