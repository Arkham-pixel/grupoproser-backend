/**
 * Busca rastros de ajustador en historial_formularios, liquidador, informe, outbound.
 * Uso: node scripts/buscarRastroAjustadoresAlfa.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const hist = db.collection('historial_formularios');
const histCount = await hist.countDocuments({});
const histSample = await hist.find({}).limit(2).toArray();
const histKeys = histSample[0] ? Object.keys(histSample[0]) : [];

// Buscar docs con ajustador en historial
const histConAj = await hist
  .find({
    $or: [
      { ajustador: { $nin: [null, ''] } },
      { 'datos.ajustador': { $nin: [null, ''] } },
      { 'formulario.ajustador': { $nin: [null, ''] } },
      { 'payload.ajustador': { $nin: [null, ''] } },
      { 'antes.ajustador': { $nin: [null, ''] } },
      { 'despues.ajustador': { $nin: [null, ''] } },
    ],
  })
  .limit(5)
  .toArray();

const casos = db.collection('gsk3cAppsegurosAlfaCasos');
const conLiquidadorAj = await casos
  .find({
    $or: [
      { 'liquidador.ajustador': { $nin: [null, ''] } },
      { 'liquidador.encabezado.ajustador': { $nin: [null, ''] } },
      { 'informeUnico.ajustador': { $nin: [null, ''] } },
      { 'informeUnico.encabezado.ajustador': { $nin: [null, ''] } },
    ],
  })
  .project({
    consecutivo: 1,
    ajustador: 1,
    'liquidador.ajustador': 1,
    'liquidador.encabezado': 1,
    'informeUnico.ajustador': 1,
  })
  .limit(20)
  .toArray();

// Sample liquidador keys from one case that has liquidador
const conLiq = await casos.findOne(
  { liquidador: { $ne: null } },
  { projection: { consecutivo: 1, ajustador: 1, liquidador: 1 } }
);
const liqKeys = conLiq?.liquidador ? Object.keys(conLiq.liquidador) : [];

const outbox = db.collection('alfa_excel_outbound_updates');
const outSample = await outbox.find({}).sort({ createdAt: -1 }).limit(2).toArray();
const outWithAj = await outbox.countDocuments({
  $or: [{ 'changes.ajustador': { $exists: true } }, { 'payload.ajustador': { $exists: true } }],
});

// Cases that still HAVE adjuster - use as pattern? Not enough.
// Check if there's BSON backup or dump
console.log(
  JSON.stringify(
    {
      histCount,
      histKeys,
      histConAjCount: histConAj.length,
      histConAj: histConAj.map((h) => ({
        _id: h._id,
        keys: Object.keys(h),
        snippet: JSON.stringify(h).slice(0, 400),
      })),
      conLiquidadorAj: conLiquidadorAj.length,
      conLiquidadorAjSample: conLiquidadorAj.slice(0, 5),
      liqKeys,
      liqEncabezado: conLiq?.liquidador?.encabezado || conLiq?.liquidador?.portada || null,
      outWithAj,
      outSampleKeys: outSample[0] ? Object.keys(outSample[0]) : [],
    },
    null,
    2
  )
);

await mongoose.disconnect();
