/**
 * Copia informe + liquidador + archivos de inspección CAT Zurich al listado,
 * emparejando por número de siniestro (STRO).
 *
 * Copia informe/liquidador/archivos si CAT está más completo, y además
 * rellena huecos del listado (fechas, valores, inspección CAT).
 * No pisa un informe de listado que ya está más lleno.
 *
 * Uso:
 *   node scripts/copiarInformeZurichCatAListadoPorSiniestro.js
 *   node scripts/copiarInformeZurichCatAListadoPorSiniestro.js --apply
 */
import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import ZurichCaso from '../models/ZurichCaso.js';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import { espejarArchivosCasoZurichCatEnListado } from '../utils/espejarArchivoZurichCatEnListado.js';
import {
  aplicarEstadoDesdeTipoInformeZurich,
  aplicarFechaAccionEstadoZurich,
  homologarEstadoZurich,
} from '../utils/estadosZurich.js';
import { aplicarReservaDesdePresupuestoZurich } from '../utils/reservaPresupuestoZurich.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const APPLY = process.argv.includes('--apply');

const PEDIDOS = [
  { zc: '318345', stro: '181871', asegurado: 'LA URBANIZACIÓN CUBIK PH' },
  { zc: '317812', stro: '182118', asegurado: 'CIUDADELA SAN GABRIEL PH' },
  { zc: '317588', stro: '181545', asegurado: 'URBANIZACION COLINA VERDE PH' },
  { zc: '317902', stro: '181774', asegurado: 'UNIDAD RESIDENCIAL TORRES DE BARCELONA' },
  { zc: '317607', stro: '181986', asegurado: 'CONJUNTO RESIDENCIAL NUEVO CONQUISTADORES' },
];

const clone = (valor) => {
  if (valor == null) return valor;
  return JSON.parse(JSON.stringify(valor));
};

const len = (v) => {
  if (v == null) return 0;
  if (typeof v === 'string') return v.trim().length;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'object') return JSON.stringify(v).length;
  return String(v).length;
};

const filasConDato = (filas) => {
  if (!Array.isArray(filas)) return 0;
  return filas.filter((f) => {
    if (!f || typeof f !== 'object') return false;
    return Object.values(f).some((v) => String(v ?? '').trim() !== '');
  }).length;
};

const fotosCount = (iu) => {
  if (!iu || typeof iu !== 'object') return 0;
  const a = iu.fotosInspeccion;
  if (Array.isArray(a)) return a.length;
  if (a && typeof a === 'object' && Array.isArray(a.imagenes)) return a.imagenes.length;
  return 0;
};

const scoreInforme = (iu) => {
  if (!iu || typeof iu !== 'object') return 0;
  return (
    len(iu.descripcionDanios) +
    len(iu.conclusiones) +
    len(iu.recomendacion) +
    len(iu.infoEvento) +
    filasConDato(iu.filasDanios) * 80 +
    filasConDato(iu.filasPresupuestoPreliminar) * 40 +
    fotosCount(iu) * 50 +
    (iu.firmaAjustador || iu.actaAjustadorFirmaImagen ? 100 : 0)
  );
};

const scoreLiquidador = (liq) => {
  if (!liq || typeof liq !== 'object') return 0;
  return JSON.stringify(liq).length;
};

const vacio = (v) => {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
};

const tieneChecklistCat = (doc) => {
  if (doc?.checklistCatCompleto === true) return true;
  const n = doc?.severidadCatNiveles;
  if (!n || typeof n !== 'object') return false;
  for (let i = 1; i <= 6; i += 1) {
    const item = n[`nivel${i}`] || n[String(i)] || n[i];
    const aplica = item?.aplica;
    if (aplica === 'SI' || aplica === 'NO' || aplica === true || aplica === false) return true;
  }
  return Number(doc?.severidadCat) >= 1;
};

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 25000,
});

const resumen = [];

for (const pedido of PEDIDOS) {
  const cat = await ZurichCaso.findOne({ siniestro: pedido.stro }).lean();
  const listado = await ZurichListadoCaso.findOne({ siniestro: pedido.stro });
  const fila = {
    stro: pedido.stro,
    zc: pedido.zc,
    asegurado: pedido.asegurado,
    cat: cat ? cat.consecutivo : null,
    listado: listado ? listado.consecutivo : null,
    accion: 'omitir',
    motivo: '',
    copiados: {},
  };

  if (!cat) {
    fila.motivo = 'No hay caso CAT con ese siniestro';
    resumen.push(fila);
    continue;
  }
  if (!listado) {
    fila.motivo = 'No hay caso de listado con ese siniestro';
    resumen.push(fila);
    continue;
  }

  const iuCat = cat.informeUnico && typeof cat.informeUnico === 'object' ? cat.informeUnico : null;
  const iuLst = listado.informeUnico && typeof listado.informeUnico === 'object' ? listado.informeUnico : null;
  const liqCat = cat.liquidador && typeof cat.liquidador === 'object' ? cat.liquidador : null;
  const liqLst = listado.liquidador && typeof listado.liquidador === 'object' ? listado.liquidador : null;
  const scoreCat = scoreInforme(iuCat);
  const scoreLst = scoreInforme(iuLst);
  const copiarInforme = Boolean(iuCat) && scoreCat > scoreLst;
  const copiarLiquidador = Boolean(liqCat) && scoreLiquidador(liqCat) > scoreLiquidador(liqLst);
  const nArchivosCat = Array.isArray(cat.archivos) ? cat.archivos.length : 0;
  const copiarChecklist = tieneChecklistCat(cat);

  const $set = { updatedAt: new Date() };
  const huecos = [];

  const llenarSiVacio = (campo, valor) => {
    if (vacio(listado[campo]) && !vacio(valor)) {
      $set[campo] = valor;
      huecos.push(campo);
    }
  };

  llenarSiVacio('fechaInspeccion', cat.fechaInspeccion);
  llenarSiVacio('fechaInspeccionado', cat.fechaInspeccionado);
  llenarSiVacio('fechaUltimoDocumento', cat.fechaUltimoDocumento);
  llenarSiVacio('fechaAnalisisCaso', cat.fechaAnalisisCaso);
  llenarSiVacio('fechaInformePreliminar', cat.fechaInformePreliminar);
  llenarSiVacio('fechaInformeFinal', cat.fechaInformeFinal);
  if (Number(cat.valorReclamado) > 0) llenarSiVacio('valorReclamado', cat.valorReclamado);
  if (Number(cat.valorLiquidado) > 0) llenarSiVacio('valorLiquidado', cat.valorLiquidado);
  llenarSiVacio('valorAseguradoInmueble', cat.valorAseguradoInmueble);
  llenarSiVacio('reserva', cat.reserva);
  llenarSiVacio('observacionesCat', cat.observacionesCat);
  llenarSiVacio('cobertura', cat.cobertura);
  llenarSiVacio('celular', cat.celular);
  llenarSiVacio('telefonoAsegurado', cat.telefonoAsegurado);

  if (copiarChecklist) {
    if (cat.severidadCat != null) $set.severidadCat = cat.severidadCat;
    if (cat.severidadCatNiveles) $set.severidadCatNiveles = clone(cat.severidadCatNiveles);
    if (cat.evidenciaCat) $set.evidenciaCat = clone(cat.evidenciaCat);
    if (cat.checklistCatCompleto != null) $set.checklistCatCompleto = cat.checklistCatCompleto;
    if (!vacio(cat.accesoPredio)) $set.accesoPredio = cat.accesoPredio;
    if (!vacio(cat.afectacion)) $set.afectacion = cat.afectacion;
    if (!vacio(cat.gradoAfectacion)) $set.gradoAfectacion = cat.gradoAfectacion;
    huecos.push('inspeccionCat');
  }

  if (copiarInforme) $set.informeUnico = clone(iuCat);
  if (copiarLiquidador) $set.liquidador = clone(liqCat);

  const payload = {
    estado: listado.estado,
    informeUnico: copiarInforme ? clone(iuCat) : iuLst,
    liquidador: copiarLiquidador ? clone(liqCat) : liqLst,
    reserva: $set.reserva ?? listado.reserva,
    valorReclamado: $set.valorReclamado ?? listado.valorReclamado,
    valorLiquidado: $set.valorLiquidado ?? listado.valorLiquidado,
    fechaAnalisisCaso: $set.fechaAnalisisCaso ?? listado.fechaAnalisisCaso,
    fechaInformePreliminar: $set.fechaInformePreliminar ?? listado.fechaInformePreliminar,
    fechaInformeFinal: $set.fechaInformeFinal ?? listado.fechaInformeFinal,
  };
  const conEstado = aplicarFechaAccionEstadoZurich(
    aplicarEstadoDesdeTipoInformeZurich(payload, listado.toObject?.() || listado),
    listado.toObject?.() || listado
  );
  const conReserva = aplicarReservaDesdePresupuestoZurich(conEstado);
  if (conReserva.reserva != null) $set.reserva = conReserva.reserva;
  if (conReserva.valorReclamado != null) $set.valorReclamado = conReserva.valorReclamado;
  if (conReserva.valorLiquidado != null) $set.valorLiquidado = conReserva.valorLiquidado;
  for (const campo of ['fechaAnalisisCaso', 'fechaInformePreliminar', 'fechaInformeFinal']) {
    if (conReserva[campo] && vacio(listado[campo])) $set[campo] = conReserva[campo];
  }
  if (copiarInforme) {
    $set.estado = homologarEstadoZurich(conReserva.estado || cat.estado || listado.estado);
  }

  const hayAlgo =
    copiarInforme ||
    copiarLiquidador ||
    nArchivosCat > 0 ||
    huecos.length > 0;

  if (!hayAlgo) {
    fila.motivo =
      scoreLst > 0
        ? `CAT sin trabajo extra (informe listado ${scoreLst} vs CAT ${scoreCat})`
        : 'CAT no tiene informe, inspección, liquidador ni archivos para pasar';
    resumen.push(fila);
    continue;
  }

  fila.accion = APPLY ? 'completar' : 'dry-run-completar';
  fila.motivo = [
    copiarInforme ? `informe CAT ${scoreCat}` : `informe listado ${scoreLst} (se conserva)`,
    huecos.length ? `huecos: ${huecos.join(', ')}` : null,
    nArchivosCat ? `${nArchivosCat} archivos CAT` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (APPLY) {
    await ZurichListadoCaso.collection.updateOne({ _id: listado._id }, { $set });
    const archivos = await espejarArchivosCasoZurichCatEnListado(cat, listado);
    fila.copiados = {
      informe: copiarInforme,
      liquidador: copiarLiquidador,
      huecos,
      tipoInformeListado: copiarInforme ? iuCat?.tipoInforme : iuLst?.tipoInforme,
      estado: $set.estado || listado.estado,
      archivos: archivos.copiados,
      archivosDuplicados: archivos.duplicados,
    };
  } else {
    fila.copiados = {
      informe: copiarInforme,
      liquidador: copiarLiquidador,
      huecos,
      tipoInformeCat: iuCat?.tipoInforme || '',
      estadoCat: cat.estado,
      nArchivosCat,
      checklistCat: copiarChecklist,
    };
  }

  resumen.push(fila);
}

console.log(JSON.stringify({ apply: APPLY, resumen }, null, 2));
await mongoose.disconnect();
process.exit(0);
