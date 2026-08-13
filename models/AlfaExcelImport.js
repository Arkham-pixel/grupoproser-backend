import mongoose from 'mongoose';

const STATUSES = [
  'preview',
  'processing',
  'completed',
  'failed',
  'expired',
];

const AlfaExcelImportSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileHash: { type: String, required: true, index: true },
    mimeType: String,
    size: Number,
    sheetName: String,
    source: {
      type: String,
      enum: ['manual', 'sharepoint', 'script'],
      default: 'manual',
    },
    importedBy: {
      id: String,
      login: String,
      nombre: String,
    },
    uploadedAt: { type: Date, default: Date.now },
    startedAt: Date,
    finishedAt: Date,
    expiresAt: { type: Date, index: true },
    status: {
      type: String,
      enum: STATUSES,
      default: 'preview',
      index: true,
    },
    force: { type: Boolean, default: false },
    mapping: mongoose.Schema.Types.Mixed,
    totals: {
      rows: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      unchanged: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
      ambiguous: { type: Number, default: 0 },
    },
    errors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    warnings: { type: [String], default: [] },
    alreadyImported: { type: Boolean, default: false },
    previousImportId: mongoose.Schema.Types.ObjectId,
    sampleRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  {
    timestamps: true,
    collection: 'alfa_excel_imports',
    suppressReservedKeysWarning: true,
  }
);

AlfaExcelImportSchema.index({ status: 1, createdAt: -1 });
AlfaExcelImportSchema.index({ fileHash: 1, status: 1 });

const AlfaExcelImport =
  mongoose.models.AlfaExcelImport ||
  mongoose.model('AlfaExcelImport', AlfaExcelImportSchema);

export default AlfaExcelImport;
export const ALFA_EXCEL_IMPORT_STATUSES = STATUSES;
