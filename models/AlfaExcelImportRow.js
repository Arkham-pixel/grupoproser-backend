import mongoose from 'mongoose';

const ACTIONS = ['CREATED', 'UPDATED', 'UNCHANGED', 'REJECTED', 'AMBIGUOUS'];

const AlfaExcelImportRowSchema = new mongoose.Schema(
  {
    importId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AlfaExcelImport',
      required: true,
      index: true,
    },
    rowNumber: { type: Number, required: true },
    action: {
      type: String,
      enum: ACTIONS,
      required: true,
      index: true,
    },
    matchedCaseId: mongoose.Schema.Types.ObjectId,
    matchedConsecutivo: String,
    candidateCaseIds: [mongoose.Schema.Types.ObjectId],
    matchStrategy: String,
    matchEvidence: mongoose.Schema.Types.Mixed,
    /** Payload normalizado listo para create/update (sin campos protegidos). */
    payload: mongoose.Schema.Types.Mixed,
    /** Snapshot diagnóstico para preview UI */
    previewSnapshot: mongoose.Schema.Types.Mixed,
    changes: mongoose.Schema.Types.Mixed,
    /** Campos Excel ignorados (protegidos / placeholder incoming). */
    ignoredFields: mongoose.Schema.Types.Mixed,
    errorCode: String,
    message: String,
    warnings: { type: [String], default: [] },
    claimNumberAssigned: { type: Boolean, default: false },
    /** Preview: se generaría ALFA_CLAIM_NUMBER_ASSIGNED en execute (aún no persistido). */
    claimNumberEventPending: { type: Boolean, default: false },
    /** Tras execute */
    applied: { type: Boolean, default: false },
    resultCaseId: mongoose.Schema.Types.ObjectId,
    resultConsecutivo: String,
    policyMatch: mongoose.Schema.Types.Mixed,
  },
  {
    timestamps: true,
    collection: 'alfa_excel_import_rows',
  }
);

AlfaExcelImportRowSchema.index({ importId: 1, rowNumber: 1 }, { unique: true });

const AlfaExcelImportRow =
  mongoose.models.AlfaExcelImportRow ||
  mongoose.model('AlfaExcelImportRow', AlfaExcelImportRowSchema);

export default AlfaExcelImportRow;
export const ALFA_EXCEL_ROW_ACTIONS = ACTIONS;
