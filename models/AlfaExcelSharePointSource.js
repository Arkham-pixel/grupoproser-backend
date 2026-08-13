import mongoose from 'mongoose';

const UI_STATUSES = [
  'up_to_date',
  'updates_available',
  'requires_review',
  'error',
  'idle',
];

const OUTCOMES = [
  'NEW_EXCEL_DETECTED',
  'SKIP_ALREADY_PREVIEWED',
  'SKIP_ARNALD_GENERATED_VERSION',
  'PREVIEW_READY',
  'NO_CHANGES',
  'UPDATES_AVAILABLE',
  'NEEDS_REVIEW',
  'HAS_REJECTED',
  'MULTIPLE_EXCEL_FILES_FOUND',
  'CONFIGURED_EXCEL_NOT_FOUND',
  'NO_EXCEL_FOUND',
  'ERROR',
  'EXECUTED',
];

/**
 * Checkpoint de detección Excel Alfa en SharePoint (Control y Seguimiento).
 * Cron solo hace preview; execute es siempre manual.
 */
const AlfaExcelSharePointSourceSchema = new mongoose.Schema(
  {
    integrationKey: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    path: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true },
    driveId: String,
    itemId: String,
    eTag: String,
    lastModifiedDateTime: Date,
    size: Number,
    webUrl: String,

    lastDetectedEtag: String,
    lastPreviewedEtag: String,
    lastProcessedEtag: String,
    lastExecutedEtag: String,
    /** eTag tras escritura outbound ARNALD (anti-loop inbound). */
    lastArnaldWrittenEtag: String,

    lastPreviewImportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AlfaExcelImport',
    },
    lastSuccessfulImportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AlfaExcelImport',
    },

    lastCheckedAt: Date,
    lastSuccessfulCheckAt: Date,
    lastDetectedAt: Date,
    lastSyncAt: Date,

    status: {
      type: String,
      enum: UI_STATUSES,
      default: 'idle',
      index: true,
    },
    lastOutcome: { type: String, enum: OUTCOMES },
    lastError: String,

    hasChanges: { type: Boolean, default: false },
    hasIncidents: { type: Boolean, default: false },
    summary: mongoose.Schema.Types.Mixed,

    /** Notificación in-app: una vez por itemId+eTag */
    notification: {
      pending: { type: Boolean, default: false },
      sentForKey: String,
      message: String,
      createdAt: Date,
      dismissedAt: Date,
    },

    candidates: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  {
    timestamps: true,
    collection: 'alfa_excel_sharepoint_sources',
  }
);

const AlfaExcelSharePointSource =
  mongoose.models.AlfaExcelSharePointSource ||
  mongoose.model('AlfaExcelSharePointSource', AlfaExcelSharePointSourceSchema);

export default AlfaExcelSharePointSource;
export const ALFA_EXCEL_SP_UI_STATUSES = UI_STATUSES;
export const ALFA_EXCEL_SP_OUTCOMES = OUTCOMES;
