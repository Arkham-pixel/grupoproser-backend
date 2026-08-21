import mongoose from 'mongoose';

const ArnaldFormDraftSchema = new mongoose.Schema(
  {
    usuarioId: { type: String, required: true, index: true },
    login: { type: String, default: '', index: true },
    nombre: { type: String, default: '' },
    formKey: { type: String, required: true, trim: true },
    modulo: { type: String, default: 'plataforma', index: true },
    recursoId: { type: String, default: '' },
    titulo: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    savedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  {
    timestamps: true,
    collection: 'arnald_form_drafts',
  }
);

ArnaldFormDraftSchema.index({ usuarioId: 1, formKey: 1 }, { unique: true });
ArnaldFormDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.ArnaldFormDraft ||
  mongoose.model('ArnaldFormDraft', ArnaldFormDraftSchema);
