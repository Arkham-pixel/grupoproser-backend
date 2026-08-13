import mongoose from 'mongoose';

const ChangeSchema = new mongoose.Schema(
  {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    column: String,
    header: String,
  },
  { _id: false }
);

/**
 * Outbox asíncrono: ARNALD → celdas amarillas del Excel Control y Seguimiento.
 * No bloquea el PUT del caso.
 */
const AlfaExcelOutboundUpdateSchema = new mongoose.Schema(
  {
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SegurosAlfaCaso',
      required: true,
      index: true,
    },
    consecutivo: String,
    source: { type: String, default: 'arnald' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'synced', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    changes: {
      type: Map,
      of: ChangeSchema,
      default: {},
    },
    attempts: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: Date.now, index: true },
    lastAttemptAt: Date,
    syncedAt: Date,
    lastError: String,
    lastErrorCode: String,

    match: {
      excelRowNumber: Number,
      strategy: String,
      evidence: mongoose.Schema.Types.Mixed,
    },

    sourceExcel: {
      itemId: String,
      driveId: String,
      fileName: String,
      sheetName: String,
      eTagBefore: String,
      eTagAfter: String,
      columnsWritten: [String],
      writeStrategy: String,
      verified: mongoose.Schema.Types.Mixed,
    },

    rejectedAtEnqueue: [
      {
        field: String,
        code: String,
        reason: String,
      },
    ],
  },
  {
    timestamps: true,
    collection: 'alfa_excel_outbound_updates',
  }
);

AlfaExcelOutboundUpdateSchema.index({ status: 1, nextRetryAt: 1 });

const AlfaExcelOutboundUpdate =
  mongoose.models.AlfaExcelOutboundUpdate ||
  mongoose.model('AlfaExcelOutboundUpdate', AlfaExcelOutboundUpdateSchema);

export default AlfaExcelOutboundUpdate;
