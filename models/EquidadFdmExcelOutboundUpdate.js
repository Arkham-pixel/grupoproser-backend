import mongoose from 'mongoose';

const EquidadFdmExcelOutboundUpdateSchema = new mongoose.Schema(
  {
    casoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EquidadFdmCaso',
      required: true,
      index: true,
    },
    consecutivo: String,
    cedula: String,
    status: {
      type: String,
      enum: ['pending', 'processing', 'synced', 'error', 'skipped'],
      default: 'pending',
      index: true,
    },
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    attempts: { type: Number, default: 0 },
    nextRetryAt: Date,
    lastError: String,
    lastSyncedAt: Date,
  },
  {
    timestamps: true,
    collection: 'equidad_fdm_excel_outbound_updates',
  }
);

EquidadFdmExcelOutboundUpdateSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 });

const EquidadFdmExcelOutboundUpdate =
  mongoose.models.EquidadFdmExcelOutboundUpdate ||
  mongoose.model('EquidadFdmExcelOutboundUpdate', EquidadFdmExcelOutboundUpdateSchema);

export default EquidadFdmExcelOutboundUpdate;
