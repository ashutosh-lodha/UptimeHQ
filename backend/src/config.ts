import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // --- Clerk (sign-in / sign-up). Required by the API process only; see assertClerkConfigured(). ---
  /** Backend secret key (sk_test_… / sk_live_…): used once per user to read their verified email. */
  CLERK_SECRET_KEY: z.string().optional(),
  /**
   * Clerk's JWT public key (PEM). Session JWTs are verified locally with RS256.
   * May be given on one line with literal "\n" sequences.
   */
  CLERK_JWT_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\\n/g, '\n').trim() : undefined)),
  /** Comma-separated allowed `azp` origins, e.g. "http://localhost:8080,https://uptime.example.com". */
  CLERK_AUTHORIZED_PARTIES: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ),
  CLERK_API_URL: z.string().default('https://api.clerk.com'),
  APP_URL: z.string().default('http://localhost:8080'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  SCHEDULER_RECONCILE_SECONDS: z.coerce.number().int().min(10).default(60),
  /** Days of endpoint check logs to keep (30 covers the longest chart range). */
  CHECK_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(30),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: boolish,
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Fail fast: a misconfigured service must not start silently.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();

/** The API refuses to start without Clerk configuration (worker and scheduler don't need it). */
export function assertClerkConfigured(cfg: AppConfig = config) {
  const missing: string[] = [];
  if (!cfg.CLERK_SECRET_KEY) missing.push('CLERK_SECRET_KEY');
  if (!cfg.CLERK_JWT_KEY) missing.push('CLERK_JWT_KEY');
  else if (!cfg.CLERK_JWT_KEY.includes('BEGIN PUBLIC KEY')) missing.push('CLERK_JWT_KEY (must be a PEM public key)');
  if (cfg.CLERK_AUTHORIZED_PARTIES.length === 0) missing.push('CLERK_AUTHORIZED_PARTIES');
  if (missing.length) throw new Error(`Clerk is not configured. Set: ${missing.join(', ')} (see README "Clerk setup").`);
}

/** SMTP is considered configured when a host and sender address are present. */
export function isSmtpConfigured(cfg: AppConfig = config): boolean {
  return Boolean(cfg.SMTP_HOST && cfg.SMTP_FROM);
}
