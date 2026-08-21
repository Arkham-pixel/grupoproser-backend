import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.collection('gsk3cAppsegurosAlfaCasos');

const textoItem = (it = {}) =>
  String(it?.actividad || it?.concepto || it?.descripcion || it?.componente || '').trim();

const all = await col
  .find({ liquidador: { $exists: true, $ne: null, $type: 'object' } })
  .project({
    consecutivo: 1,
    asegurado: 1,
    ajustador: 1,
    'liquidador.evaluacionSismicaNSR10.presupuesto.items': 1,
    'liquidador.detalleLiquidacionCat': 1,
    informeUnico: 1,
  })
  .toArray();

const conContenido = all
  .map((c) => {
    const items = c.liquidador?.evaluacionSismicaNSR10?.presupuesto?.items;
    const det = c.liquidador?.detalleLiquidacionCat;
    const nItems = Array.isArray(items) ? items.filter((it) => textoItem(it)).length : 0;
    const nDet = Array.isArray(det) ? det.filter((it) => textoItem(it)).length : 0;
    return {
      consecutivo: c.consecutivo,
      asegurado: c.asegurado,
      ajustador: c.ajustador || '(sin ajustador)',
      items: Math.max(nItems, nDet),
      tieneInforme: Boolean(c.informeUnico),
    };
  })
  .filter((r) => r.items > 0)
  .sort((a, b) => b.items - a.items);

console.log(JSON.stringify({ totalConLiqObj: all.length, conContenidoReal: conContenido.length, lista: conContenido }, null, 2));
await mongoose.disconnect();
