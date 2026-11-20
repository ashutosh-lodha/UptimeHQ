import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma, type User } from '@prisma/client';
import { verifySessionToken } from '../lib/auth';
import type { ClerkClient } from '../lib/clerk';
import { HttpError, unauthorized } from '../lib/errors';
import { logger, errorMessage } from '../lib/logger';
import { prisma } from '../db';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Finds the local user for a Clerk user id, creating it on first sign-in.
 * An existing account (from before Clerk) with the same *verified* email is
 * linked instead of duplicated, so its monitors and history are kept.
 */
export async function provisionUser(clerk: ClerkClient, clerkUserId: string): Promise<User> {
  let profile;
  try {
    profile = await clerk.getUser(clerkUserId);
  } catch (err) {
    logger.error('Clerk user lookup failed', { error: errorMessage(err) });
    throw new HttpError(503, 'Could not verify your account with Clerk. Please try again shortly.');
  }
  if (!profile) throw unauthorized('Unknown Clerk user');
  if (!profile.verifiedEmail) throw new HttpError(403, 'Your Clerk account needs a verified primary email address.');
  const email = profile.verifiedEmail;

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.clerkUserId && existing.clerkUserId !== clerkUserId) {
          throw new HttpError(409, 'This email address is already linked to a different sign-in.');
        }
        return tx.user.update({ where: { id: existing.id }, data: { clerkUserId } });
      }
      const created = await tx.user.create({ data: { clerkUserId, email, name: profile.name } });
      await tx.notificationSetting.create({ data: { userId: created.id, email } });
      return created;
    });
  } catch (err) {
    // Two first requests raced: the other one created the user.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const user = await prisma.user.findUnique({ where: { clerkUserId } });
      if (user) return user;
    }
    throw err;
  }
}

/** Requires `Authorization: Bearer <Clerk session JWT>` on every protected endpoint. */
export function createRequireAuth(clerk: ClerkClient): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const claims = verifySessionToken(header.slice(7));
    if (!claims) throw unauthorized('Invalid or expired session token');
    const user = (await prisma.user.findUnique({ where: { clerkUserId: claims.sub }, select: { id: true } })) ?? (await provisionUser(clerk, claims.sub));
    req.userId = user.id;
    next();
  };
}

export function currentUserId(req: Request): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}
