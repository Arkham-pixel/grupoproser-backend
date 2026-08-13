import mongoose from 'mongoose';

/**
 * Lock global de importación Excel Alfa (un solo documento).
 * collection: alfa_excel_import_locks
 */
const AlfaExcelImportLockSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'alfa_excel_import' },
    locked: { type: Boolean, default: false },
    lockedAt: Date,
    lockedByImportId: mongoose.Schema.Types.ObjectId,
    lockedByLogin: String,
    expiresAt: Date,
  },
  { collection: 'alfa_excel_import_locks', timestamps: true }
);

const AlfaExcelImportLock =
  mongoose.models.AlfaExcelImportLock ||
  mongoose.model('AlfaExcelImportLock', AlfaExcelImportLockSchema);

const LOCK_ID = 'alfa_excel_import';
const LOCK_TTL_MS = 30 * 60 * 1000;

export async function acquireAlfaExcelImportLock({ importId, login } = {}) {
  const now = new Date();
  await AlfaExcelImportLock.updateOne(
    { _id: LOCK_ID },
    {
      $setOnInsert: {
        locked: false,
      },
    },
    { upsert: true }
  );

  // Liberar lock expirado
  await AlfaExcelImportLock.updateOne(
    {
      _id: LOCK_ID,
      locked: true,
      expiresAt: { $lte: now },
    },
    {
      $set: {
        locked: false,
        lockedAt: null,
        lockedByImportId: null,
        lockedByLogin: null,
        expiresAt: null,
      },
    }
  );

  const result = await AlfaExcelImportLock.findOneAndUpdate(
    {
      _id: LOCK_ID,
      locked: false,
    },
    {
      $set: {
        locked: true,
        lockedAt: now,
        lockedByImportId: importId || null,
        lockedByLogin: login || null,
        expiresAt: new Date(now.getTime() + LOCK_TTL_MS),
      },
    },
    { new: true }
  );

  if (!result) {
    const err = new Error('Ya hay una importación Alfa en curso');
    err.code = 'IMPORT_LOCK_HELD';
    err.status = 409;
    throw err;
  }
  return result;
}

export async function releaseAlfaExcelImportLock({ importId } = {}) {
  const filter = { _id: LOCK_ID, locked: true };
  if (importId) filter.lockedByImportId = importId;
  await AlfaExcelImportLock.updateOne(filter, {
    $set: {
      locked: false,
      lockedAt: null,
      lockedByImportId: null,
      lockedByLogin: null,
      expiresAt: null,
    },
  });
}

export default AlfaExcelImportLock;
