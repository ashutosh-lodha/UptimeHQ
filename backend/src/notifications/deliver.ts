import type { PrismaClient } from '@prisma/client';
import type { EmailMessage, Mailer } from './mailer';
import { errorMessage } from '../lib/logger';

export interface DeliverDeps {
  db: PrismaClient;
  mailer: Mailer | null;
  appUrl: string;
}

export type DeliverOutcome = 'sent' | 'skipped' | 'already-processed' | 'missing';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`, !d && !h && `${sec}s`].filter(Boolean);
  return parts.join(' ');
}

export function buildEmail(params: {
  type: 'DOWN' | 'RECOVERY';
  monitorName: string;
  url: string;
  cause: string;
  startedAt: Date;
  resolvedAt: Date | null;
  durationMs: number | null;
  link: string;
}): Omit<EmailMessage, 'to'> {
  const { type, monitorName, url, cause, startedAt, resolvedAt, durationMs, link } = params;
  if (type === 'DOWN') {
    const subject = `[UptimeHQ] DOWN: ${monitorName}`;
    const text = `${monitorName} is DOWN.\n\nURL: ${url}\nReason: ${cause}\nSince: ${startedAt.toISOString()}\n\nView monitor: ${link}`;
    const html = `<h2 style="color:#dc2626">${escapeHtml(monitorName)} is down</h2>
<p><strong>URL:</strong> ${escapeHtml(url)}<br><strong>Reason:</strong> ${escapeHtml(cause)}<br><strong>Since:</strong> ${startedAt.toISOString()}</p>
<p><a href="${escapeHtml(link)}">View monitor in UptimeHQ</a></p>`;
    return { subject, text, html };
  }
  const duration = durationMs != null ? formatDuration(durationMs) : 'unknown';
  const subject = `[UptimeHQ] RECOVERED: ${monitorName}`;
  const text = `${monitorName} has recovered.\n\nURL: ${url}\nDown since: ${startedAt.toISOString()}\nRecovered: ${resolvedAt?.toISOString()}\nDowntime: ${duration}\n\nView monitor: ${link}`;
  const html = `<h2 style="color:#16a34a">${escapeHtml(monitorName)} has recovered</h2>
<p><strong>URL:</strong> ${escapeHtml(url)}<br><strong>Down since:</strong> ${startedAt.toISOString()}<br><strong>Recovered:</strong> ${resolvedAt?.toISOString()}<br><strong>Downtime:</strong> ${duration}</p>
<p><a href="${escapeHtml(link)}">View monitor in UptimeHQ</a></p>`;
  return { subject, text, html };
}

/**
 * Sends the email for one NotificationDelivery row. Idempotent: rows already
 * SENT or SKIPPED are never sent again. Throws on SMTP failure so BullMQ retries.
 */
export async function deliverNotification(deps: DeliverDeps, deliveryId: string): Promise<DeliverOutcome> {
  const delivery = await deps.db.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { incident: { include: { monitor: { include: { user: { include: { notificationSetting: true } } } } } } },
  });
  if (!delivery) return 'missing';
  if (delivery.status === 'SENT' || delivery.status === 'SKIPPED') return 'already-processed';

  const { incident } = delivery;
  const { monitor } = incident;
  const settings = monitor.user.notificationSetting;
  const recipient = settings?.email ?? monitor.user.email;

  const skip = async (reason: string) => {
    await deps.db.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SKIPPED', error: reason, recipient },
    });
    return 'skipped' as const;
  };

  if (settings && !settings.emailEnabled) return skip('Email notifications disabled by user');
  if (delivery.type === 'DOWN' && settings && !settings.notifyOnDown) return skip('Down alerts disabled by user');
  if (delivery.type === 'RECOVERY' && settings && !settings.notifyOnRecovery) return skip('Recovery alerts disabled by user');
  if (!deps.mailer) return skip('SMTP is not configured');

  const message = buildEmail({
    type: delivery.type,
    monitorName: monitor.name,
    url: monitor.url,
    cause: incident.cause,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    durationMs: incident.durationMs,
    link: `${deps.appUrl.replace(/\/$/, '')}/monitors/${monitor.id}`,
  });

  try {
    await deps.mailer.send({ to: recipient, ...message });
  } catch (err) {
    await deps.db.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED', error: errorMessage(err).slice(0, 500), attempts: { increment: 1 }, recipient },
    });
    throw err;
  }

  await deps.db.notificationDelivery.update({
    where: { id: deliveryId },
    data: { status: 'SENT', sentAt: new Date(), error: null, attempts: { increment: 1 }, recipient },
  });
  return 'sent';
}
