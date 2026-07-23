import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Repara formularios de ajuste cuyo numeroCaso root quedó en RPT-
 * pero ya tienen el nmroAjste real en datos/secuencia/metadata.
 */
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
const db = mongoose.connection.db;
const col = db.collection('historial_formularios');

const candidatos = await col
  .find({
    tipo: { $regex: /ajuste/i },
    eliminado: { $ne: true },
    numeroCaso: { $regex: /^RPT-/i },
    $or: [
      { 'datos.numeroCaso': { $exists: true, $nin: [null, '', 'N/A'] } },
      { 'datos.metadata.numeroAjuste': { $exists: true, $nin: [null, '', 'N/A'] } },
      { 'trazabilidadSecuencia.numeroAjuste': { $exists: true, $nin: [null, '', 'N/A'] } },
    ],
  })
  .project({
    numeroCaso: 1,
    casoId: 1,
    'datos.numeroCaso': 1,
    'datos.metadata': 1,
    'datos.casoId': 1,
    trazabilidadSecuencia: 1,
  })
  .toArray();

const esRpt = (v) => String(v || '').trim().toUpperCase().startsWith('RPT-');
const esOid = (v) => /^[a-fA-F0-9]{24}$/.test(String(v || '').trim());
const pick = (...vals) => {
  const clean = vals.map((v) => String(v || '').trim()).filter((v) => v && v.toUpperCase() !== 'N/A');
  return clean.find((v) => !esRpt(v)) || '';
};

let reparados = 0;
for (const f of candidatos) {
  const numero = pick(
    f?.datos?.metadata?.numeroAjuste,
    f?.datos?.numeroCaso,
    f?.trazabilidadSecuencia?.numeroAjuste
  );
  if (!numero) continue;

  const complexId = pick(
    esOid(f?.datos?.metadata?.complexId) ? f.datos.metadata.complexId : '',
    esOid(f?.datos?.casoId) ? f.datos.casoId : '',
    esOid(f?.casoId) ? f.casoId : ''
  );

  const $set = {
    numeroCaso: numero,
    'datos.numeroCaso': numero,
    'datos.metadata.numeroAjuste': numero,
    'trazabilidadSecuencia.numeroAjuste': numero,
  };
  if (complexId) {
    $set.casoId = complexId;
    $set['datos.casoId'] = complexId;
    $set['datos.metadata.complexId'] = complexId;
  }

  await col.updateOne({ _id: f._id }, { $set });
  reparados += 1;
  console.log(`OK ${f._id}: ${f.numeroCaso} → ${numero}${complexId ? ` (caso ${complexId})` : ''}`);
}

console.log(`\nReparados: ${reparados} / ${candidatos.length}`);
await mongoose.disconnect();
