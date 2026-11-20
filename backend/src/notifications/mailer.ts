import nodemailer from 'nodemailer';
import { config, isSmtpConfigured } from '../config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** Returns an SMTP mailer, or null when SMTP is not configured. */
export function createSmtpMailer(): Mailer | null {
  if (!isSmtpConfigured()) return null;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    async send(message) {
      await transport.sendMail({ from: config.SMTP_FROM, ...message });
    },
  };
}
