/**
 * Aplica la plantilla "Control Facturación" como fuente de verdad:
 * - Regenera control_horas de los 31 casos del Excel según tipología
 *   INFORME FINAL = preliminar+final ($3M)
 *   INFORME ÚNICO = único ($2.5M) / objetado ($2M) / desistido ($1M) según estado
 * - Inserta horas de viaje de observaciones (8h / 3h)
 * - Quita controles auto-generados de casos que NO están en el Excel
 *   (sin envío de control_horas), para que la bandeja muestre solo estos.
 *
 *   node scripts/aplicarExcelControlFacturacionSura.js --dry
 *   node scripts/aplicarExcelControlFacturacionSura.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');
const EXCEL_ARG = process.argv.find((a) => a.startsWith('--excel='));
const EXCEL =
  (EXCEL_ARG && EXCEL_ARG.slice('--excel='.length)) ||
  'C:/Users/GP-TI/Downloads/Contol Facturación - 24-09-2026 (3).xlsx';

const VALOR_HORA = 187400;
const TOPES = {
  preliminar_final: 3_000_000,
  unico: 2_500_000,
  objetado: 2_000_000,
  desistido: 1_000_000,
  cancelado_sura: 0,
};

const FRANJAS = [
  { kmHasta: 80, factor: 0.78 },
  { kmHasta: 200, factor: 0.88 },
  { kmHasta: Infinity, factor: 0.96 },
];

function digits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function norm(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
}

function parseHorasViajeObs(obs) {
  const m = String(obs || '').match(/(\d+(?:[.,]\d+)?)\s*horas?\s+de\s+tr+aslado/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function esCanceladoSura(caso) {
  return [caso.estadoFacilitador, caso.estado, caso.descripcionEstado].some((v) => {
    const e = norm(v);
    if (!e) return false;
    if (e.includes('CANCELADO SURA') || e.includes('CANCELADO POR SURA')) return true;
    if (e === 'CANCELADO' || e.startsWith('CANCELADO ')) return true;
    if (e.includes('DADO DE BAJA')) return true;
    return false;
  });
}

/** Tipología según Excel + estado (objetado/desistido/cancelado mandan). */
function tipoDesdeExcel(filaExcel, caso) {
  if (esCanceladoSura(caso)) return 'cancelado_sura';
  const estado = norm(caso.estado || caso.descripcionEstado || caso.estadoFacilitador);
  if (estado.includes('DESIST')) return 'desistido';
  if (estado.includes('OBJET')) return 'objetado';
  if (filaExcel.informeFinal) return 'preliminar_final';
  if (filaExcel.informeUnico) return 'unico';
  return 'unico';
}

function tipoLiquidador(tipo) {
  if (tipo === 'unico' || tipo === 'objetado' || tipo === 'desistido' || tipo === 'cancelado_sura') {
    return 'unico';
  }
  return 'preliminar';
}

function zona(caso) {
  const depto = norm(caso.departamento || caso.departamentoCiudad);
  const ciudad = norm(caso.ciudad || caso.ciudadSiniestro);
  if (depto.includes('CHOCO') || ciudad.includes('QUIBDO')) return 'Choco';
  if (depto.includes('CALDAS') || depto.includes('RISARALDA')) return 'Cafetera';
  if (depto.includes('VALLE') || depto.includes('CAUCA') || depto.includes('NARINO')) {
    return 'Occidente';
  }
  return 'Otros';
}

function kmEstimado(caso) {
  const z = zona(caso);
  if (z === 'Cafetera') return 45;
  if (z === 'Occidente') return 140;
  if (z === 'Choco') return 280;
  return 180;
}

function jitter(caso) {
  const clave = String(caso.siniestro || caso.consecutivo || caso._id || '');
  let h = 0;
  for (let i = 0; i < clave.length; i += 1) h = (h * 31 + clave.charCodeAt(i)) % 1000;
  return (h / 1000 - 0.5) * 0.05;
}

function fechaParaInput(valor) {
  if (valor == null || valor === '') return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, '0');
    const d = String(valor.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return fechaParaInput(new Date(t));
  return '';
}

function primerFecha(...valores) {
  for (const v of valores) {
    const f = fechaParaInput(v);
    if (f) return f;
  }
  return '';
}

function fechasCaso(caso) {
  const asig = primerFecha(caso.fchaAsgncion, caso.fechaAsignacion);
  const contacto = primerFecha(caso.fchaContIni, caso.fechaLlamada);
  const inspeccion = primerFecha(
    caso.fechaInspeccion,
    caso.fchaInspccion,
    caso.fchaProgInspeccion,
    contacto
  );
  const prelim = primerFecha(
    caso.fchaInfoPrelm,
    caso.informeUnico?.fechaInformePreliminar,
    String(caso.informeUnico?.tipoInforme || '').toLowerCase().includes('prelim')
      ? caso.informeUnico?.fechaInforme
      : null
  );
  const finalOUnico = primerFecha(
    caso.fchaInfoFnal,
    caso.fechaLiquidado,
    caso.fechaEnvioAseguradora,
    caso.informeUnico?.fechaInforme,
    prelim,
    inspeccion
  );
  const cifras = primerFecha(
    caso.fchaPresentacionCifras,
    caso.fechaAceptacionLiquidacion,
    finalOUnico
  );
  return { asig, contacto, inspeccion, prelim, finalOUnico, cifras };
}

function totalFila(f) {
  return (
    Number(f.horas_viaje || 0) +
    Number(f.horas_campo || 0) +
    Number(f.horas_oficina || 0) +
    Number(f.horas_secretaria || 0)
  );
}

function plantilla(tipoLiq, ajustador, fechas = {}) {
  const nombre = String(ajustador || 'Ajustador').trim() || 'Ajustador';
  const uid = () => `fila-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const fijo = (catalogo_id, desc, funcionario, oficina, fecha = '') => ({
    id: uid(),
    fecha: fecha || null,
    descripcion: desc,
    nombre_funcionario: funcionario,
    cargo: 'Ajustador',
    horas_viaje: 0,
    horas_campo: 0,
    horas_oficina: oficina,
    horas_secretaria: 0,
    catalogo_id,
    tipo_item: 'fijo',
    fijo: true,
  });
  const base = (desc, oficina, campo = 0, viaje = 0, fecha = '') => ({
    id: uid(),
    fecha: fecha || null,
    descripcion: desc,
    nombre_funcionario: nombre,
    cargo: 'Ajustador',
    horas_viaje: viaje,
    horas_campo: campo,
    horas_oficina: oficina,
    horas_secretaria: 0,
    catalogo_id: '',
    tipo_item: 'extra',
    fijo: false,
  });

  const gestionBack = [
    fijo(
      'recibo_back',
      'Recibo back de asignación, cargue documental en plataforma y coordinación de la inspección',
      'Nombre Gestor Documental',
      2,
      fechas.asig
    ),
    fijo(
      'verificacion_poliza',
      'Verificación de póliza con condiciones particulares y condiciones generales que aplican a la misma.',
      nombre,
      2,
      fechas.asig
    ),
  ];
  const soporte = fijo(
    'soporte_sistema',
    'Soporte sistema, cargue de documentación en plataformas, envio de correo y otras labores',
    'Soporte Tecnico y sistemas',
    2.5,
    fechas.asig
  );

  if (tipoLiq === 'unico') {
    return [
      ...gestionBack,
      base(
        'Coordinación e inspección / verificación en sitio.',
        0.5,
        2,
        1,
        fechas.inspeccion
      ),
      base('Elaboración de informe único.', 3, 0, 0, fechas.finalOUnico),
      base(
        'Presentación de cifras, labores administrativas y otras.',
        1.5,
        0,
        0,
        fechas.cifras
      ),
      soporte,
    ];
  }
  return [
    ...gestionBack,
    base(
      'Coordinación e inspección / verificación en sitio.',
      0.5,
      2,
      1,
      fechas.inspeccion
    ),
    base('Elaboración de informe preliminar.', 2, 0, 0, fechas.prelim),
    base('Elaboración de informe final.', 2.5, 0, 0, fechas.finalOUnico),
    base(
      'Presentación de cifras, labores administrativas y otras.',
      1.5,
      0,
      0,
      fechas.cifras
    ),
    soporte,
  ];
}

function escalar(filas, horasObjetivo) {
  const objetivo = Number(horasObjetivo);
  if (!Number.isFinite(objetivo) || objetivo <= 0) return filas;
  const fijas = filas.filter((f) => f.fijo === true || f.tipo_item === 'fijo');
  const variables = filas.filter((f) => !(f.fijo === true || f.tipo_item === 'fijo'));
  const horasFijas = fijas.reduce((a, f) => a + totalFila(f), 0);
  const horasVar = variables.reduce((a, f) => a + totalFila(f), 0);
  const restante = Math.max(0, objetivo - horasFijas);
  if (horasVar <= 0.001 || restante <= 0.001) return filas;
  const ratio = restante / horasVar;
  const esc = (v) => Math.round(Number(v || 0) * ratio * 4) / 4;
  return filas.map((f) => {
    if (f.fijo === true || f.tipo_item === 'fijo') return f;
    return {
      ...f,
      horas_viaje: esc(f.horas_viaje),
      horas_campo: esc(f.horas_campo),
      horas_oficina: esc(f.horas_oficina),
      horas_secretaria: esc(f.horas_secretaria),
    };
  });
}

/** Pone horas de viaje en la fila de inspección (o crea una si no hay). */
function aplicarHorasViaje(filas, horasViaje, obs) {
  const hrs = Number(horasViaje);
  if (!Number.isFinite(hrs) || hrs <= 0) return filas;
  const out = filas.map((f) => ({ ...f }));
  const idx = out.findIndex((f) =>
    /inspecci|sitio|coordinaci|visita|campo/i.test(String(f.descripcion || ''))
  );
  const i = idx >= 0 ? idx : 0;
  out[i] = {
    ...out[i],
    horas_viaje: hrs,
    descripcion:
      String(out[i].descripcion || '').trim() ||
      'Coordinación e inspección / verificación en sitio.',
  };
  // Nota en observaciones del control
  return out;
}

function armarControl(caso, filaExcel) {
  const tipo = tipoDesdeExcel(filaExcel, caso);
  const max = TOPES[tipo] ?? TOPES.unico;
  const km = kmEstimado(caso);
  const franja = FRANJAS.find((f) => km <= f.kmHasta) || FRANJAS.at(-1);
  const horasViajeObs = parseHorasViajeObs(filaExcel.obs);

  if (tipo === 'cancelado_sura' || max <= 0) {
    return {
      control: {
        valor_hora: VALOR_HORA,
        valor_hora_origen: 'tarifa',
        tipo_liquidador: 'unico',
        gastos: 0,
        filas: [
          {
            id: `fila-cero-${Date.now().toString(36)}`,
            fecha: null,
            descripcion: 'Cancelado SURA — sin cobro.',
            nombre_funcionario: String(caso.ajustador || caso.codiRespnsble || '').trim(),
            cargo: 'Ajustador',
            horas_viaje: 0,
            horas_campo: 0,
            horas_oficina: 0,
            horas_secretaria: 0,
            catalogo_id: '',
            tipo_item: 'extra',
            fijo: false,
          },
        ],
        actualizado_en: new Date(),
        actualizado_por: 'excel-control-facturacion-sura',
        observaciones: filaExcel.obs || '',
        _tipo_honorarios: 'cancelado_sura',
        _honorarios_sugeridos: 0,
        _tope: 0,
        _distancia_km: km,
        _fuente_excel: true,
      },
      meta: { tipo, sugerido: 0, max: 0, horasViajeObs },
    };
  }

  const factor = Math.min(0.99, Math.max(0.7, franja.factor * (1 + jitter(caso))));
  let sugerido = Math.min(max, Math.round((max * factor) / 1000) * 1000);
  let horasSugeridas = Math.round((sugerido / VALOR_HORA) * 100) / 100;
  const tipoLiq = tipoLiquidador(tipo);
  let filas = escalar(
    plantilla(tipoLiq, caso.ajustador || caso.codiRespnsble, fechasCaso(caso)),
    horasSugeridas
  );

  if (horasViajeObs != null) {
    // Horas de traslado observadas van completas (no se escalan ni se cortan).
    filas = aplicarHorasViaje(filas, horasViajeObs, filaExcel.obs);
    const totalH = filas.reduce((a, f) => a + totalFila(f), 0);
    sugerido = Math.round((totalH * VALOR_HORA) / 1000) * 1000;
    horasSugeridas = Math.round(totalH * 100) / 100;
  }

  return {
    control: {
      valor_hora: VALOR_HORA,
      valor_hora_origen: 'tarifa',
      tipo_liquidador: tipoLiq,
      gastos: 0,
      filas,
      actualizado_en: new Date(),
      actualizado_por: 'excel-control-facturacion-sura',
      observaciones: filaExcel.obs || '',
      _tipo_honorarios: tipo,
      _honorarios_sugeridos: sugerido,
      _tope: max,
      _distancia_km: km,
      _horas_viaje_obs: horasViajeObs,
      _fuente_excel: true,
    },
    meta: { tipo, sugerido, max, horasSugeridas, horasViajeObs, km },
  };
}

function leerExcel(ruta) {
  const wb = XLSX.readFile(ruta, { cellDates: true, raw: false });
  const sheet = wb.Sheets.Plantilla || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return rows
    .map((r) => ({
      reclamacion: digits(r.RECLAMACION),
      informeFinal: String(r['INFORME FINAL'] || '').trim() === '1',
      informeUnico: String(r['INFORME ÚNICO'] || r['INFORME UNICO'] || '').trim() === '1',
      obs: String(r.OBSERVACIONES || '').trim(),
    }))
    .filter((r) => r.reclamacion.length >= 10);
}

async function main() {
  const excel = leerExcel(EXCEL);
  console.log(JSON.stringify({ excel: EXCEL, filas: excel.length, dry: DRY }, null, 2));

  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.collection('gsk3cAppsegurosSuraCasos');
  const recs = excel.map((e) => e.reclamacion);

  const casos = await col.find({ siniestro: { $in: recs } }).toArray();
  const bySin = new Map(casos.map((c) => [String(c.siniestro), c]));

  const faltan = excel.filter((e) => !bySin.has(e.reclamacion)).map((e) => e.reclamacion);
  if (faltan.length) console.log('Faltan en BD:', faltan);

  let aplicados = 0;
  const detalle = [];

  for (const fila of excel) {
    const caso = bySin.get(fila.reclamacion);
    if (!caso) continue;
    const { control, meta } = armarControl(caso, fila);
    const totalH = control.filas.reduce((a, f) => a + totalFila(f), 0);
    const viaje = control.filas.reduce((a, f) => a + Number(f.horas_viaje || 0), 0);
    detalle.push({
      rec: fila.reclamacion,
      tipExcel: fila.informeFinal ? 'FINAL→prelim+final' : 'ÚNICO',
      tipo: meta.tipo,
      tope: meta.max,
      hrs: Math.round(totalH * 100) / 100,
      viaje: Math.round(viaje * 100) / 100,
      obs: fila.obs || null,
    });
    if (!DRY) {
      await col.updateOne(
        { _id: caso._id },
        {
          $set: {
            control_horas: control,
            fcha_control_horas: new Date(),
          },
        }
      );
    }
    aplicados += 1;
  }

  // Quitar controles auto del sistema que no están en el Excel y no tienen envío.
  const filtroLimpiar = {
    siniestro: { $nin: recs },
    'control_horas.actualizado_por': {
      $in: [
        'sistema-tarifario-sura',
        'excel-control-facturacion-sura',
        'sistema-cancelado-sura-cero',
      ],
    },
    $or: [
      { envios_facturacion: { $exists: false } },
      { envios_facturacion: { $size: 0 } },
      { envios_facturacion: { $not: { $elemMatch: { tipo: 'control_horas' } } } },
    ],
  };
  const aLimpiar = await col.countDocuments(filtroLimpiar);
  if (!DRY && aLimpiar > 0) {
    await col.updateMany(filtroLimpiar, {
      $unset: { control_horas: '', fcha_control_horas: '' },
    });
  }

  console.log('Aplicados:', aplicados);
  console.log('Limpiar fuera de Excel (auto, sin envío):', aLimpiar);
  console.table(detalle.filter((d) => d.obs || d.tipExcel.startsWith('FINAL')));
  console.log('Resumen tipologías:', {
    preliminar_final: detalle.filter((d) => d.tipo === 'preliminar_final').length,
    unico: detalle.filter((d) => d.tipo === 'unico').length,
    objetado: detalle.filter((d) => d.tipo === 'objetado').length,
    desistido: detalle.filter((d) => d.tipo === 'desistido').length,
  });
  console.log(
    'Viaje obs:',
    detalle.filter((d) => d.obs)
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
