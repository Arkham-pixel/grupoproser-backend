import mongoose from 'mongoose';

const ArnaldAuditLogSchema = new mongoose.Schema(
  {
    occurredAt: { type: Date, default: Date.now, index: true },
    usuarioId: { type: String, index: true, default: null },
    login: { type: String, index: true, default: '' },
    nombre: { type: String, default: '' },
    rol: { type: String, default: '' },
    accion: {
      type: String,
      required: true,
      index: true,
      enum: [
        'LOGIN',
        'LOGOUT',
        'NAVIGATE',
        'CREATE',
        'UPDATE',
        'DELETE',
        'VIEW',
        'DRAFT_SAVE',
        'DRAFT_RESTORE',
        'DRAFT_DISCARD',
        'OTHER',
      ],
    },
    modulo: { type: String, default: 'plataforma', index: true },
    recursoTipo: { type: String, default: '' },
    recursoId: { type: String, default: '', index: true },
    metodo: { type: String, default: '' },
    ruta: { type: String, default: '' },
    statusCode: { type: Number, default: null },
    resumen: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'arnald_audit_logs',
  }
);

ArnaldAuditLogSchema.index({ login: 1, occurredAt: -1 });
ArnaldAuditLogSchema.index({ modulo: 1, occurredAt: -1 });
ArnaldAuditLogSchema.index({ accion: 1, occurredAt: -1 });
ArnaldAuditLogSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

export default mongoose.models.ArnaldAuditLog ||
  mongoose.model('ArnaldAuditLog', ArnaldAuditLogSchema);
