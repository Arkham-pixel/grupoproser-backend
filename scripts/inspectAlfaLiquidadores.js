import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.collection('gsk3cAppsegurosAlfaCasos');

const total = await col.countDocuments({});
const conLiq = await col.countDocuments({
  liquidador: { $exists: true, $ne: null, $type: 'object' },
});
const conInf = await col.countDocuments({
  informeUnico: { $exists: true, $ne: null, $type: 'object' },
});
const conAmbos = await col.countDocuments({
  liquidador: { $exists: true, $ne: null, $type: 'object' },
  informeUnico: { $exists: true, $ne: null, $type: 'object' },
});

const samples = await col
  .find({ liquidador: { $exists: true, $ne: null } })
  .project({
    consecutivo: 1,
    siniestro: 1,
    asegurado: 1,
    ajustador: 1,
    tomador: 1,
    updatedAt: 1,
    'liquidador.modelo': 1,
    'liquidador.detalleLiquidacionCat': 1,
    'liquidador.evaluacionSismicaNSR10.presupuesto.items': 1,
    informeUnico: 1,
  })
  .sort({ updatedAt: -1 })
  .limit(40)
  .toArray();

const textoItem = (it = {}) =>
  String(it?.actividad || it?.concepto || it?.descripcion || it?.componente || '').trim();

const resumen = samples.map((c) => {
  const items = c.liquidador?.evaluacionSismicaNSR10?.presupuesto?.items;
  const det = c.liquidador?.detalleLiquidacionCat;
  const nItems = Array.isArray(items) ? items.filter((it) => textoItem(it)).length : 0;
  const nDet = Array.isArray(det) ? det.filter((it) => textoItem(it)).length : 0;
  return {
    consecutivo: c.consecutivo,
    siniestro: c.siniestro,
    asegurado: c.asegurado,
    ajustador: c.ajustador,
    updatedAt: c.updatedAt,
    modelo: c.liquidador?.modelo,
    itemsPresupuesto: nItems,
    itemsDetalle: nDet,
    tieneInforme: Boolean(c.informeUnico),
    keysLiq: c.liquidador ? Object.keys(c.liquidador).slice(0, 12) : [],
  };
});

const vacios = resumen.filter((r) => r.itemsPresupuesto === 0 && r.itemsDetalle === 0);
const conContenido = resumen.filter((r) => r.itemsPresupuesto > 0 || r.itemsDetalle > 0);

console.log(
  JSON.stringify(
    {
      total,
      conLiq,
      conInf,
      conAmbos,
      samplesConContenido: conContenido.slice(0, 20),
      samplesVacios: vacios.slice(0, 10),
      samplesAllCount: resumen.length,
    },
    null,
    2
  )
);

await mongoose.disconnect();
