import express from 'express';
import { prisma } from './db';
import { createRequireAuth } from './middleware/auth';
import type { ClerkClient } from './lib/clerk';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { createMonitorRouter } from './modules/monitors/monitor.routes';
import { incidentRouter } from './modules/incidents/incident.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import type { ScheduleSync } from './queue/scheduleSync';
import type { LookupFn } from './monitoring/ssrf';

export interface AppDeps {
  scheduleSync: ScheduleSync;
  /** Clerk Backend API client (looks up a user's verified email on first sign-in). */
  clerk: ClerkClient;
  /** Overridable DNS lookup (tests). */
  lookup?: LookupFn;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error', error: 'database unavailable' });
    }
  });

  // Every endpoint below requires a valid Clerk session JWT.
  const requireAuth = createRequireAuth(deps.clerk);
  app.use('/api/auth', requireAuth, authRouter);

  app.use('/api/monitors', requireAuth, createMonitorRouter(deps));
  app.use('/api/incidents', requireAuth, incidentRouter);
  app.use('/api/dashboard', requireAuth, dashboardRouter);
  app.use('/api/settings', requireAuth, settingsRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
