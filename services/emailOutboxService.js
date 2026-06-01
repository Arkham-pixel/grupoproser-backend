import EmailOutbox from '../models/EmailOutbox.js';
import { deliverMail, isAuthError } from './mailTransport.js';

const OUTBOX_ENABLED = process.env.EMAIL_OUTBOX_ENABLED !== 'false';
const MAX_ATTEMPTS = Number(process.env.EMAIL_OUTBOX_MAX_ATTEMPTS) || 10;
const BATCH_SIZE = Number(process.env.EMAIL_OUTBOX_BATCH_SIZE) || 20;

function isAuthErrorLocal(error) {
  const message = (error?.message || '').toLowerCase();
  return (
    message.includes('credenciales') ||
    message.includes('invalid login') ||
    message.includes('username and password not accepted') ||
    message.includes('authentication failed')
  );
}

export async function enqueueOutgoingMail(mailOptions, meta = {}, error = null) {
  if (!OUTBOX_ENABLED) return null;

  const tipo = meta.tipo || meta.source || 'general';
  const doc = await EmailOutbox.create({
    tipo,
    mailOptions,
    meta,
    status: 'pending',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    lastError: error?.message || null,
    nextRetryAt: new Date(Date.now() + 60_000),
  });

  return doc;
}

export async function processEmailOutbox() {
  if (!OUTBOX_ENABLED) {
    return { processed: 0, sent: 0, failed: 0, skipped: true };
  }

  const now = new Date();
  const pending = await EmailOutbox.find({
    status: 'pending',
    nextRetryAt: { $lte: now },
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(BATCH_SIZE);

  let sent = 0;
  let failed = 0;

  for (const item of pending) {
    item.status = 'processing';
    await item.save();

    try {
      const info = await deliverMail(item.mailOptions, {
        ...item.meta,
        enqueue: false,
        outboxId: String(item._id),
      });
      item.status = 'sent';
      item.sentAt = new Date();
      item.messageId = info.messageId;
      item.lastError = null;
      await item.save();
      sent += 1;
    } catch (error) {
      item.attempts += 1;
      item.lastError = error.message;

      const authFailure = isAuthError(error) || isAuthErrorLocal(error);
      if (authFailure || item.attempts >= item.maxAttempts) {
        item.status = 'failed';
      } else {
        item.status = 'pending';
        const backoffMin = Math.min(60, 2 ** item.attempts);
        item.nextRetryAt = new Date(Date.now() + backoffMin * 60_000);
      }
      await item.save();
      failed += 1;
    }
  }

  return { processed: pending.length, sent, failed, skipped: false };
}

export async function getEmailOutboxStats() {
  const [pending, failed, sent] = await Promise.all([
    EmailOutbox.countDocuments({ status: 'pending' }),
    EmailOutbox.countDocuments({ status: 'failed' }),
    EmailOutbox.countDocuments({ status: 'sent' }),
  ]);
  return { pending, failed, sent, enabled: OUTBOX_ENABLED };
}
