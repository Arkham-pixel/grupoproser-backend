import mongoose from 'mongoose';

const EquidadFdmExcelImportSessionSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ['sharepoint', 'upload', 'manual'],
      default: 'sharepoint',
    },
    fileName: String,
    status: {
      type: String,
      enum: ['preview', 'executed', 'expired', 'error'],
      default: 'preview',
      index: true,
    },
    eTag: String,
    itemId: String,
    driveId: String,
    path: String,
    totals: {
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      unchanged: { type: Number, default: 0 },
      ambiguous: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
    },
    /** Filas del plan (CREATE/UPDATE/…) embebidas para MVP. */
    rows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    executedAt: Date,
    executedBy: mongoose.Schema.Types.Mixed,
    error: String,
  },
  {
    timestamps: true,
    collection: 'equidad_fdm_excel_import_sessions',
  }
);

const EquidadFdmExcelImportSession =
  mongoose.models.EquidadFdmExcelImportSession ||
  mongoose.model('EquidadFdmExcelImportSession', EquidadFdmExcelImportSessionSchema);

export default EquidadFdmExcelImportSession;
