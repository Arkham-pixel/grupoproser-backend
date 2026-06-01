import mongoose from 'mongoose';

const emailOutboxSchema = new mongoose.Schema(
  {
    tipo: { type: String, default: 'general', index: true },
    mailOptions: { type: mongoose.Schema.Types.Mixed, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 10 },
    lastError: { type: String, default: null },
    nextRetryAt: { type: Date, default: () => new Date(), index: true },
    sentAt: { type: Date, default: null },
    messageId: { type: String, default: null },
  },
  { timestamps: true }
);

emailOutboxSchema.index({ status: 1, nextRetryAt: 1 });

export default mongoose.models.EmailOutbox ||
  mongoose.model('EmailOutbox', emailOutboxSchema);
