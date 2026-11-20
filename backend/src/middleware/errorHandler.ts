import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/errors';
import { logger, errorMessage } from '../lib/logger';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  logger.error('Unhandled request error', { path: req.path, error: errorMessage(err) });
  res.status(500).json({ error: 'Internal server error' });
}
