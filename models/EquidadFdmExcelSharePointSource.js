import mongoose from 'mongoose';

const UI_STATUSES = ['up_to_date', 'updates_available', 'requires_review', 'error', 'idle'];

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

const EquidadFdmExcelSharePointSourceSchema = new mongoose.Schema(
  {
    integrationKey: { type: String, required: true, trim: true, unique: true },
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
    lastArnaldWrittenEtag: String,

    lastPreviewSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EquidadFdmExcelImportSession',
    },
    lastSuccessfulSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EquidadFdmExcelImportSession',
    },

    lastCheckedAt: Date,
    lastSuccessfulCheckAt: Date,
    lastDetectedAt: Date,
    lastSyncAt: Date,

    status: { type: String, enum: UI_STATUSES, default: 'idle', index: true },
    lastOutcome: { type: String, enum: OUTCOMES },
    lastError: String,

    hasChanges: { type: Boolean, default: false },
    hasIncidents: { type: Boolean, default: false },
    summary: mongoose.Schema.Types.Mixed,

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
    collection: 'equidad_fdm_excel_sharepoint_sources',
  }
);

const EquidadFdmExcelSharePointSource =
  mongoose.models.EquidadFdmExcelSharePointSource ||
  mongoose.model('EquidadFdmExcelSharePointSource', EquidadFdmExcelSharePointSourceSchema);

export default EquidadFdmExcelSharePointSource;
export const EQUIDAD_FDM_EXCEL_SP_UI_STATUSES = UI_STATUSES;
export const EQUIDAD_FDM_EXCEL_SP_OUTCOMES = OUTCOMES;
