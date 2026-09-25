/**
 * Inyecta gestión del back (ítems fijos de oficina) en controles SURA
 * del Excel Control Facturación que no los tienen.
 *
 * Fijos oficiales (2 h + 2 h inicio, 2.5 h cierre):
 * - Recibo back de asignación…
 * - Verificación de póliza con condiciones particulares y generales…
 * - Soporte sistema…
 *
 *   node scripts/inyectarGestionBackControlHorasSura.js --dry
 *   node scripts/inyectarGestionBackControlHorasSura.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';

dotenv.config();

const DRY = process.argv.includes('--dry');
const EXCEL =
  process.argv.find((a) => a.startsWith('--excel='))?.slice('--excel='.length) ||
  'C:/Users/GP-TI/Downloads/Contol Facturación - 24-09-2026 (3).xlsx';

/** Casos cuyo Excel ya se envió: no volver a inyectar gestión del back. */
const NO_INYECTAR_BACK = new Set([
  '9260001729093',
  '9260001729576',
  '9260001729868',
  '9260001730036',
  '9260001730630',
  '9260001730918',
  '9260001730949',
  '9260001730939',
  '9260001731597',
  '9260001734916',
  '9260001737148',
  '9260001739289',
  '9260001737448',
  '9260001739967',
  '9260001728841',
  '9260001729078',
]);

const FIJOS_INICIO = [
  {
    catalogo_id: 'recibo_back',
    descripcion:
      'Recibo back de asignación, cargue documental en plataforma y coordinación de la inspección',
    nombre_funcionario: 'Nombre Gestor Documental',
    cargo: 'Ajustador',
    horas_oficina: 2,
    match: (d) => d.includes('recibo back') || d.includes('recibo base'),
  },
  {
    catalogo_id: 'verificacion_poliza',
    descripcion:
      'Verificación de póliza con condiciones particulares y condiciones generales que aplican a la misma.',
    nombre_funcionario: '', // se pone el ajustador del caso
    cargo: 'Ajustador',
    horas_oficina: 2,
    usaAjustador: true,
    match: (d) => d.includes('verificacion de poliza') || d.includes('condiciones particulares'),
  },
];

const FIJO_CIERRE = {
  catalogo_id: 'soporte_sistema',
  descripcion:
    'Soporte sistema, cargue de documentación en plataformas, envio de correo y otras labores',
  nombre_funcionario: 'Soporte Tecnico y sistemas',
  cargo: 'Ajustador',
  horas_oficina: 2.5,
  match: (d) => d.includes('soporte sistema') || d.includes('soporte tecnico'),
};

function digits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function normDesc(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fechaParaInput(valor) {
  if (valor == null || valor === '') return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return '';
}

function uid() {
  return `fila-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function filaFija(def, fecha, ajustador) {
  return {
    id: uid(),
    fecha: fecha || null,
    descripcion: def.descripcion,
    nombre_funcionario: def.usaAjustador
      ? String(ajustador || def.nombre_funcionario || 'Ajustador').trim()
      : def.nombre_funcionario,
    cargo: def.cargo,
    horas_viaje: 0,
    horas_campo: 0,
    horas_oficina: def.horas_oficina,
    horas_secretaria: 0,
    catalogo_id: def.catalogo_id,
    tipo_item: 'fijo',
    fijo: true,
  };
}

function totalHoras(filas) {
  return (filas || []).reduce(
    (a, f) =>
      a +
      Number(f.horas_viaje || 0) +
      Number(f.horas_campo || 0) +
      Number(f.horas_oficina || 0) +
      Number(f.horas_secretaria || 0),
    0
  );
}

function leerRecs(ruta) {
  const wb = XLSX.readFile(ruta, { cellDates: true, raw: false });
  const sheet = wb.Sheets.Plantilla || wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(sheet, { defval: '', raw: false })
    .map((r) => digits(r.RECLAMACION))
    .filter((r) => r.length >= 10);
}

function inyectar(caso) {
  const ch = caso.control_horas;
  if (!ch || !Array.isArray(ch.filas)) return null;

  const fechaAsig =
    fechaParaInput(caso.fchaAsgncion) ||
    fechaParaInput(caso.fechaAsignacion) ||
    fechaParaInput(ch.filas[0]?.fecha) ||
    '';
  const ajustador = String(caso.ajustador || caso.codiRespnsble || 'Ajustador').trim();

  let filas = [...ch.filas];
  const cambios = [];

  // Quitar verificación corta duplicada (plantilla antigua) si vamos a poner la fija.
  const tieneVerifFija = filas.some(
    (f) =>
      f.catalogo_id === 'verificacion_poliza' ||
      (normDesc(f.descripcion).includes('condiciones generales') &&
        normDesc(f.descripcion).includes('verificacion de poliza'))
  );
  if (!tieneVerifFija) {
    const antes = filas.length;
    filas = filas.filter((f) => {
      const d = normDesc(f.descripcion);
      // Solo la versión corta de la plantilla auto (sin "condiciones generales")
      if (
        d.includes('verificacion de poliza') &&
        d.includes('condiciones particulares') &&
        !d.includes('condiciones generales')
      ) {
        return false;
      }
      return true;
    });
    if (filas.length < antes) cambios.push('quito_verif_corta');
  }

  const inicio = [];
  for (const def of FIJOS_INICIO) {
    const existe = filas.some(
      (f) => f.catalogo_id === def.catalogo_id || def.match(normDesc(f.descripcion))
    );
    if (!existe) {
      inicio.push(filaFija(def, fechaAsig, ajustador));
      cambios.push(`+${def.catalogo_id}`);
    }
  }

  let cierre = [];
  const existeCierre = filas.some(
    (f) =>
      f.catalogo_id === FIJO_CIERRE.catalogo_id || FIJO_CIERRE.match(normDesc(f.descripcion))
  );
  if (!existeCierre) {
    cierre = [filaFija(FIJO_CIERRE, fechaAsig, ajustador)];
    cambios.push(`+${FIJO_CIERRE.catalogo_id}`);
  }

  if (!cambios.length) return null;

  // Sacar fijos existentes del medio para reordenar: inicio + resto no fijo inicio + cierre
  const resto = filas.filter((f) => {
    const d = normDesc(f.descripcion);
    if (f.catalogo_id === 'recibo_back' || FIJOS_INICIO[0].match(d)) return false;
    if (f.catalogo_id === 'verificacion_poliza' || (FIJOS_INICIO[1].match(d) && d.includes('condiciones generales')))
      return false;
    if (f.catalogo_id === 'soporte_sistema' || FIJO_CIERRE.match(d)) return false;
    return true;
  });

  const fijosInicioExistentes = filas.filter((f) => {
    const d = normDesc(f.descripcion);
    return (
      f.catalogo_id === 'recibo_back' ||
      FIJOS_INICIO[0].match(d) ||
      f.catalogo_id === 'verificacion_poliza' ||
      (FIJOS_INICIO[1].match(d) && d.includes('condiciones generales'))
    );
  });
  const fijosCierreExistentes = filas.filter((f) => {
    const d = normDesc(f.descripcion);
    return f.catalogo_id === 'soporte_sistema' || FIJO_CIERRE.match(d);
  });

  const nuevas = [
    ...inicio,
    ...fijosInicioExistentes,
    ...resto,
    ...fijosCierreExistentes,
    ...cierre,
  ];

  const horasAntes = totalHoras(ch.filas);
  const horasDespues = totalHoras(nuevas);
  const valorHora = Number(ch.valor_hora) || 187400;

  return {
    control: {
      ...ch,
      filas: nuevas,
      actualizado_en: new Date(),
      actualizado_por: 'inyectar-gestion-back-sura',
      _honorarios_sugeridos: Math.round(horasDespues * valorHora),
    },
    meta: {
      siniestro: caso.siniestro,
      cambios,
      horasAntes: Math.round(horasAntes * 100) / 100,
      horasDespues: Math.round(horasDespues * 100) / 100,
    },
  };
}

async function main() {
  const recs = leerRecs(EXCEL);
  console.log(JSON.stringify({ excel: EXCEL, n: recs.length, dry: DRY }, null, 2));

  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.collection('gsk3cAppsegurosSuraCasos');
  const casos = await col.find({ siniestro: { $in: recs } }).toArray();

  let ok = 0;
  for (const caso of casos) {
    if (NO_INYECTAR_BACK.has(String(caso.siniestro))) {
      console.log({ siniestro: caso.siniestro, skip: 'ya enviado — sin back' });
      continue;
    }
    const r = inyectar(caso);
    if (!r) continue;
    console.log(r.meta);
    if (!DRY) {
      await col.updateOne(
        { _id: caso._id },
        {
          $set: {
            control_horas: r.control,
            fcha_control_horas: new Date(),
          },
        }
      );
    }
    ok += 1;
  }

  console.log({ actualizados: ok, sinCambio: casos.length - ok });
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
