/**
 * Auditoría: casos FACTURADOS / cerrados que aún generan alertas por correo.
 * Uso: node scripts/auditarAlertasFacturados.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from '../models/Complex.js';
import Responsable from '../models/Responsable.js';
import Estado from '../models/Estado.js';
import { generarAlertasCaso } from '../services/alertasService.js';
import { obtenerProtocoloActivo } from '../services/protocoloConfigService.js';

const FECHA_LIMITE = new Date('2025-10-01T00:00:00.000Z');

function debeRecibirAlertas(caso) {
  if (caso.fchaAsgncion) return new Date(caso.fchaAsgncion) >= FECHA_LIMITE;
  if (caso._id) return caso._id.getTimestamp() >= FECHA_LIMITE;
  return false;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const estados = await Estado.find().select('codiEstdo descEstdo').lean();
  console.log('=== CATÁLOGO ESTADOS ===');
  for (const e of [...estados].sort((a, b) => Number(a.codiEstdo) - Number(b.codiEstdo))) {
    console.log(String(e.codiEstdo).padStart(3), e.descEstdo);
  }

  const facturado = estados.find((e) => /FACTURADO/i.test(e.descEstdo || ''));
  const finalizado = estados.find((e) => /FINALIZ/i.test(e.descEstdo || ''));
  const cancelado = estados.find((e) => /CANCEL/i.test(e.descEstdo || ''));
  const archivado = estados.find((e) => /ARCHIV/i.test(e.descEstdo || ''));
  const codFact = String(facturado?.codiEstdo ?? '17');

  console.log('\nClaves cierre:', {
    facturado: facturado?.codiEstdo,
    finalizado: finalizado?.codiEstdo,
    cancelado: cancelado?.codiEstdo,
    archivado: archivado?.codiEstdo,
  });

  const sample = await Complex.aggregate([
    { $group: { _id: { v: '$codiEstdo', t: { $type: '$codiEstdo' } }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 40 },
  ]);
  console.log('\n=== DISTRIBUCIÓN codiEstdo (valor / tipo BSON) ===');
  for (const s of sample) console.log(JSON.stringify(s._id), '→', s.n);

  const candidatos = await Complex.find({})
    .select(
      'nmroAjste nmroSinstro codiRespnsble codiEstdo fchaAsgncion fchaFactra nmroFactra anxoFactra nombreResponsable'
    )
    .lean();

  const elegibles = candidatos.filter(debeRecibirAlertas);

  const filtroActual = await Complex.find({ codiEstdo: { $nin: [4, 5, 6] } })
    .select('_id codiEstdo fchaAsgncion')
    .lean();
  const filtroActualElegibles = filtroActual.filter(debeRecibirAlertas);

  console.log('\n=== VOLÚMENES ===');
  console.log('Total casos BD:', candidatos.length);
  console.log('Elegibles por fecha (oct 2025+):', elegibles.length);
  console.log('Pasan filtro actual $nin [4,5,6]:', filtroActual.length);
  console.log('Pasan filtro actual + fecha:', filtroActualElegibles.length);

  const porEstado = {};
  for (const c of elegibles) {
    const k = String(c.codiEstdo ?? '(vacío)');
    porEstado[k] = (porEstado[k] || 0) + 1;
  }
  console.log('\nElegibles por estado:', porEstado);

  const esFacturado = (caso) => {
    const codigo = String(caso.codiEstdo ?? '').trim();
    return codigo === codFact || Number(codigo) === Number(codFact);
  };

  const esCerradoLegacy = (caso) => {
    const codigo = String(caso.codiEstdo ?? '').trim();
    return ['4', '5', '6'].includes(codigo);
  };

  const facturadosElegibles = elegibles.filter(esFacturado);
  const facturadosEnFiltroActual = filtroActualElegibles.filter(esFacturado);
  const cerradosLegacyEnFiltro = filtroActualElegibles.filter(esCerradoLegacy);

  console.log('\nFacturados elegibles por fecha:', facturadosElegibles.length);
  console.log('Facturados que AÚN pasan filtro actual (bug):', facturadosEnFiltroActual.length);
  console.log(
    'Finalizados/cancelados/archivados (4/5/6 string) que pasan $nin [4,5,6]:',
    cerradosLegacyEnFiltro.length
  );

  const protocolo = await obtenerProtocoloActivo();
  const porAjustador = new Map();

  for (const caso of facturadosElegibles) {
    const alertas = generarAlertasCaso(caso, protocolo);
    if (alertas.totalAlertas === 0) continue;
    const key = String(caso.codiRespnsble || '(sin responsable)');
    if (!porAjustador.has(key)) porAjustador.set(key, []);
    porAjustador.get(key).push({
      nmroAjste: caso.nmroAjste,
      nmroSinstro: caso.nmroSinstro,
      codiEstdo: caso.codiEstdo,
      totalAlertas: alertas.totalAlertas,
      tipos: alertas.alertas.map((a) => a.tipo).slice(0, 6),
      fchaFactra: caso.fchaFactra || null,
      nmroFactra: caso.nmroFactra || null,
    });
  }

  // También casos 4/5/6 string que generan alertas (filtro tipo roto)
  const legacyConAlertas = new Map();
  for (const caso of cerradosLegacyEnFiltro) {
    const full = elegibles.find((c) => String(c._id) === String(caso._id)) || caso;
    const alertas = generarAlertasCaso(full, protocolo);
    if (alertas.totalAlertas === 0) continue;
    const key = String(full.codiRespnsble || '(sin responsable)');
    if (!legacyConAlertas.has(key)) legacyConAlertas.set(key, []);
    legacyConAlertas.get(key).push({
      nmroAjste: full.nmroAjste,
      codiEstdo: full.codiEstdo,
      totalAlertas: alertas.totalAlertas,
    });
  }

  const responsables = await Responsable.find()
    .select('codiRespnsble nmbrRespnsble email')
    .lean();
  const mapResp = new Map(responsables.map((r) => [String(r.codiRespnsble), r]));

  console.log('\n=== AJUSTADOR × AJUSTADOR: FACTURADOS con alertas (aún generarían correo) ===');
  const sorted = [...porAjustador.entries()].sort((a, b) => b[1].length - a[1].length);
  let totalCasosBug = 0;
  for (const [cod, casos] of sorted) {
    totalCasosBug += casos.length;
    const r = mapResp.get(cod);
    console.log(
      `\n--- ${cod} | ${r?.nmbrRespnsble || '(nombre?)'} | ${r?.email || 'SIN EMAIL'} | ${casos.length} casos ---`
    );
    for (const c of casos.slice(0, 20)) {
      console.log(
        `   ${c.nmroAjste} sin:${c.nmroSinstro || '-'} alertas:${c.totalAlertas} tipos:${c.tipos.join(',')} factura:${c.nmroFactra || '-'} ${c.fchaFactra || ''}`
      );
    }
    if (casos.length > 20) console.log(`   ... +${casos.length - 20} más`);
  }
  console.log('\nTOTAL ajustadores afectados (facturados):', sorted.length);
  console.log('TOTAL casos facturados con alertas (bug correo):', totalCasosBug);

  if (legacyConAlertas.size) {
    console.log('\n=== También: estados 4/5/6 (string) con alertas por bug de tipo ===');
    for (const [cod, casos] of legacyConAlertas) {
      const r = mapResp.get(cod);
      console.log(`  ${cod} | ${r?.nmbrRespnsble || '?'} | ${casos.length} casos`);
    }
  }

  console.log('\n=== BUG TIPO STRING vs NUMBER ===');
  const finString = await Complex.countDocuments({ codiEstdo: { $in: ['4', '5', '6'] } });
  const finNum = await Complex.countDocuments({ codiEstdo: { $in: [4, 5, 6] } });
  const finPasanNin = await Complex.countDocuments({
    codiEstdo: { $in: ['4', '5', '6'], $nin: [4, 5, 6] },
  });
  const factPasanNin = await Complex.countDocuments({
    codiEstdo: { $in: [codFact, Number(codFact)], $nin: [4, 5, 6] },
  });
  console.log('casos codiEstdo string 4/5/6:', finString);
  console.log('casos codiEstdo number 4/5/6:', finNum);
  console.log('string 4/5/6 que PASAN $nin [4,5,6]:', finPasanNin);
  console.log('facturados que PASAN $nin [4,5,6]:', factPasanNin);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
