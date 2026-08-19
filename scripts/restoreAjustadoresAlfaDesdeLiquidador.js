/**
 * Restaura SegurosAlfaCaso.ajustador desde liquidador/informe cuando el caso
 * quedó sin ajustador (efecto colateral del filtro por ciudad).
 *
 * DRY_RUN=true (default) solo reporta.
 * DRY_RUN=false aplica updates.
 *
 * Uso:
 *   node scripts/restoreAjustadoresAlfaDesdeLiquidador.js
 *   DRY_RUN=false node scripts/restoreAjustadoresAlfaDesdeLiquidador.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const DRY = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function pickAjustador(caso) {
  const candidates = [
    caso?.liquidador?.encabezado?.ajustador,
    caso?.liquidador?.ajustador,
    caso?.informeUnico?.ajustador,
    caso?.informeUnico?.encabezado?.ajustador,
    caso?.informeUnico?.datosGenerales?.ajustador,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (!s) continue;
    if (/^por\s*confirm/i.test(s)) continue;
    if (/^pendiente$/i.test(s)) continue;
    return s;
  }
  return '';
}

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.db.collection('gsk3cAppsegurosAlfaCasos');

const sinAj = await col
  .find({
    $or: [{ ajustador: null }, { ajustador: '' }, { ajustador: { $exists: false } }],
  })
  .project({
    consecutivo: 1,
    ajustador: 1,
    ciudad: 1,
    liquidador: 1,
    informeUnico: 1,
  })
  .toArray();

const restaurables = [];
for (const c of sinAj) {
  const aj = pickAjustador(c);
  if (!aj) continue;
  restaurables.push({
    _id: c._id,
    consecutivo: c.consecutivo,
    ciudad: c.ciudad,
    ajustador: aj,
  });
}

const porNombre = {};
for (const r of restaurables) {
  porNombre[r.ajustador] = (porNombre[r.ajustador] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      dryRun: DRY,
      sinAjustador: sinAj.length,
      restaurables: restaurables.length,
      porNombre,
      muestra: restaurables.slice(0, 25),
    },
    null,
    2
  )
);

if (!DRY && restaurables.length) {
  let ok = 0;
  for (const r of restaurables) {
    const res = await col.updateOne(
      { _id: r._id, $or: [{ ajustador: null }, { ajustador: '' }, { ajustador: { $exists: false } }] },
      { $set: { ajustador: r.ajustador, updatedAt: new Date() } }
    );
    if (res.modifiedCount) ok += 1;
  }
  console.log(JSON.stringify({ aplicados: ok }, null, 2));
} else if (DRY) {
  console.log('DRY_RUN: no se escribió nada. Ejecuta con DRY_RUN=false para aplicar.');
}

await mongoose.disconnect();
