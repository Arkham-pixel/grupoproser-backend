import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import {
  ALFA_RESPALDO_COLLECTION,
  ALFA_RESPALDO_DB_NAME,
  ALFA_RESPALDO_MOVIMIENTOS,
} from '../config/alfaRespaldoDb.js';

export function getAlfaRespaldoDb() {
  if (!mongoose.connection?.client) {
    throw new Error('Mongo no está conectado');
  }
  return mongoose.connection.client.db(ALFA_RESPALDO_DB_NAME);
}

export function getAlfaRespaldoCollection() {
  return getAlfaRespaldoDb().collection(ALFA_RESPALDO_COLLECTION);
}

export function getAlfaRespaldoMovimientosCollection() {
  return getAlfaRespaldoDb().collection(ALFA_RESPALDO_MOVIMIENTOS);
}

export async function ensureAlfaRespaldoIndexes() {
  const col = getAlfaRespaldoCollection();
  await col.createIndex({ consecutivo: 1 });
  await col.createIndex({ identificacion: 1 });
  await col.createIndex({ excluidoBaseAlfa: 1 });
}

export async function listAlfaCasosRespaldoLean() {
  return getAlfaRespaldoCollection().find({}).toArray();
}

export async function findAlfaCasoRespaldoById(id) {
  if (!id) return null;
  const _id = typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
  return getAlfaRespaldoCollection().findOne({ _id });
}

/**
 * Si el caso solo está en respaldo, lo copia de vuelta a la colección operativa
 * (mismo _id). El ejemplar de respaldo se conserva.
 */
export async function restoreAlfaCasoFromRespaldoById(id, { unexclude = true } = {}) {
  const doc = await findAlfaCasoRespaldoById(id);
  if (!doc) return null;

  const existing = await SegurosAlfaCaso.collection.findOne({ _id: doc._id });
  if (existing) {
    if (unexclude && existing.excluidoBaseAlfa === true) {
      await SegurosAlfaCaso.collection.updateOne(
        { _id: doc._id },
        {
          $set: {
            excluidoBaseAlfa: false,
            restauradoDesdeRespaldoAt: new Date(),
          },
          $unset: { excluidoBaseAlfaAt: 1, excluidoBaseAlfaReason: 1 },
        }
      );
    }
    return SegurosAlfaCaso.findById(doc._id).lean();
  }

  const copy = { ...doc };
  if (unexclude) {
    copy.excluidoBaseAlfa = false;
    copy.excluidoBaseAlfaAt = null;
    copy.excluidoBaseAlfaReason = null;
  }
  copy.restauradoDesdeRespaldoAt = new Date();
  await SegurosAlfaCaso.collection.insertOne(copy);
  return SegurosAlfaCaso.findById(doc._id).lean();
}

/** Operativos + respaldo, para matching de Excel (evita crear duplicados). */
export async function listAlfaCasosParaMatchExcel() {
  const [operativos, respaldo] = await Promise.all([
    SegurosAlfaCaso.find().lean(),
    listAlfaCasosRespaldoLean().catch(() => []),
  ]);
  const seen = new Set(operativos.map((c) => String(c._id)));
  const extra = respaldo.filter((c) => !seen.has(String(c._id)));
  return [...operativos, ...extra];
}
