import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { isSmtpConfigured } from '../../config';
import { currentUserId } from '../../middleware/auth';

const notificationSchema = z
  .object({
    emailEnabled: z.boolean(),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
    notifyOnDown: z.boolean(),
    notifyOnRecovery: z.boolean(),
  })
  .strict();

async function getOrCreateSettings(userId: string) {
  const existing = await prisma.notificationSetting.findUnique({ where: { userId } });
  if (existing) return existing;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return prisma.notificationSetting.upsert({
    where: { userId },
    update: {},
    create: { userId, email: user.email },
  });
}

async function recentDeliveries(userId: string) {
  const rows = await prisma.notificationDelivery.findMany({
    where: { incident: { monitor: { userId } } },
    include: { incident: { include: { monitor: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  return rows.map((d) => ({
    id: d.id,
    type: d.type,
    status: d.status,
    recipient: d.recipient,
    error: d.error,
    monitorName: d.incident.monitor.name,
    createdAt: d.createdAt,
    sentAt: d.sentAt,
  }));
}

const serialize = (s: { emailEnabled: boolean; email: string; notifyOnDown: boolean; notifyOnRecovery: boolean }) => ({
  emailEnabled: s.emailEnabled,
  email: s.email,
  notifyOnDown: s.notifyOnDown,
  notifyOnRecovery: s.notifyOnRecovery,
});

export const settingsRouter = Router();

settingsRouter.get('/notifications', async (req, res) => {
  const userId = currentUserId(req);
  const settings = await getOrCreateSettings(userId);
  res.json({
    settings: serialize(settings),
    smtpConfigured: isSmtpConfigured(),
    deliveries: await recentDeliveries(userId),
  });
});

settingsRouter.put('/notifications', async (req, res) => {
  const userId = currentUserId(req);
  const input = notificationSchema.parse(req.body);
  const settings = await prisma.notificationSetting.upsert({
    where: { userId },
    update: input,
    create: { userId, ...input },
  });
  res.json({ settings: serialize(settings), smtpConfigured: isSmtpConfigured() });
});
