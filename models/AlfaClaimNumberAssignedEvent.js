import mongoose from 'mongoose';

/**
 * Evento: siniestro vacío → informado (para futura reorg SharePoint).
 */
const AlfaClaimNumberAssignedSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      default: 'ALFA_CLAIM_NUMBER_ASSIGNED',
      index: true,
    },
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SegurosAlfaCaso',
      required: true,
      index: true,
    },
    consecutivo: String,
    oldValue: { type: String, default: null },
    newValue: { type: String, required: true },
    importId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AlfaExcelImport',
      index: true,
    },
    occurredAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'alfa_claim_number_assigned_events',
  }
);

const AlfaClaimNumberAssignedEvent =
  mongoose.models.AlfaClaimNumberAssignedEvent ||
  mongoose.model('AlfaClaimNumberAssignedEvent', AlfaClaimNumberAssignedSchema);

export default AlfaClaimNumberAssignedEvent;

export async function recordAlfaClaimNumberAssigned({
  caseId,
  consecutivo,
  oldValue,
  newValue,
  importId,
} = {}) {
  if (!caseId || !newValue) return null;
  const oldNorm = oldValue == null || String(oldValue).trim() === '' ? null : String(oldValue);
  return AlfaClaimNumberAssignedEvent.create({
    event: 'ALFA_CLAIM_NUMBER_ASSIGNED',
    caseId,
    consecutivo: consecutivo || null,
    oldValue: oldNorm,
    newValue: String(newValue),
    importId: importId || null,
    occurredAt: new Date(),
  });
}
