import { execSync } from 'node:child_process';

/** Applies all Prisma migrations to the test database before the suite runs. */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://uptimehq:uptimehq@localhost:54329/uptimehq_test?schema=public';
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
