import { Router } from 'express';
import { prisma } from '../../db';
import { currentUserId } from '../../middleware/auth';

/**
 * Sign-in and sign-up are handled by Clerk in the browser. The API only exposes
 * the current user (mounted behind requireAuth in app.ts).
 */
export const authRouter = Router();

authRouter.get('/me', async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUserId(req) } });
  res.json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } });
});
