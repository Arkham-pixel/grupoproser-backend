/**
 * Aplica la agenda compartida de inspectores Zurich (Excel) a los casos.
 * Empareja por siniestro en Zurich CAT y, si hace falta, por nombre del predio.
 *
 * Uso:
 *   node scripts/importarAgendaInspectoresZurichExcel.js
 *   node scripts/importarAgendaInspectoresZurichExcel.js --apply
 *   node scripts/importarAgendaInspectoresZurichExcel.js "C:\\ruta\\archivo.xlsx" --apply
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import ZurichCaso from '../models/ZurichCaso.js';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { resolverAsignacionCatastrofico } from '../utils/resolverAsignacionCatastrofico.js';
import { normalizarHora } from '../utils/agendaCatastrofico.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const apply = args.includes('--apply');
const excelPath =
  args.find((a) => !a.startsWith('--')) ||
  'C:\\Users\\GP-TI\\Downloads\\AGENDA - COMPARTIDA -INSPECTORES.xlsx';

/** Errores evidentes del Excel (siniestro copiado / transposición). */
const ALIAS_SINIESTRO = {
  131980: '181980',
};

const TOKENS_DEBILES = new Set([
  'CONJUNTO',
  'EDIFICIO',
  'PROPIEDAD',
  'HORIZONTAL',
  'MULTIFAMILIAR',
  'RESIDENCIAL',
  'ETAPA',
  'ETAPAS',
  'PH',
  'CR',
  'DE',
  'DEL',
  'LA',
  'EL',
  'LOS',
  'LAS',
]);

const limpiar = (raw) => String(raw ?? '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();

const normTxt = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const scoreCliente = (asegurado, cliente) => {
  const a = normTxt(asegurado);
  const c = normTxt(cliente);
  if (!a || !c) return 0;
  if (a === c) return 100;
  if (a.includes(c) || c.includes(a)) return 90;
  const tokens = c.split(' ').filter((t) => t.length > 3 && !TOKENS_DEBILES.has(t));
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => a.includes(t));
  return Math.round((hits.length / tokens.length) * 80);
};

const variantesSiniestro = (valor) => {
  const crudo = limpiar(valor);
  const digits = crudo.replace(/\D/g, '');
  const set = new Set([crudo, digits]);
  if (digits) set.add(digits.replace(/^0+/, '') || '0');
  return [...set].filter(Boolean);
};

const parseFechaYmd = (valor) => {
  if (valor == null || valor === '') return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, '0');
    const d = String(valor.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const texto = limpiar(valor);
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return '';
};

const parseHora = (valor) => {
  const texto = limpiar(valor)
    .replace(/\u00a0/g, ' ')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
  if (!texto) return '';
  const m = texto.match(/^(\d{1,2}):(\d{2})\s*(A\s*M|P\s*M|AM|PM)?$/i);
  if (!m) return normalizarHora(texto);
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = String(m[3] || '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return normalizarHora(`${h}:${String(min).padStart(2, '0')}`);
};

const fechaBogota = (ymd) => {
  if (!ymd) return null;
  const dt = new Date(`${ymd}T12:00:00.000-05:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

function leerVisitas(ruta) {
  const wb = XLSX.readFile(ruta, { cellDates: true });
  const sh = wb.Sheets['Programación'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '' });
  const visitas = [];
  for (const row of rows.slice(4)) {
    const siniestro = limpiar(row[0]);
    const fecha = parseFechaYmd(row[2]);
    const inspector = limpiar(row[5]);
    const horaInicio = parseHora(row[6]);
    const horaFin = parseHora(row[7]);
    if (!siniestro || !fecha || !inspector || !horaInicio || !horaFin) continue;
    if (!/zurich/i.test(limpiar(row[1])) && limpiar(row[1])) continue;
    visitas.push({
      siniestro,
      fecha,
      tipo: limpiar(row[4]),
      inspector,
      horaInicio,
      horaFin,
      cliente: limpiar(row[8]),
      direccion: limpiar(row[9]),
      notas: limpiar(row[12]),
    });
  }
  return visitas;
}

const PROYECCION =
  '_id siniestro zc consecutivo asegurado inspector fechaCoordinandoInspeccion horaInicioCoordinacion horaFinCoordinacion direccionPredio estado';

async function buscarCasos(Model, siniestro) {
  const vars = variantesSiniestro(siniestro);
  const digits = vars.find((v) => /^\d+$/.test(v));
  return Model.find({
    $or: [
      { siniestro: { $in: vars } },
      ...(digits ? [{ siniestro: { $regex: `^0*${digits}$` } }] : []),
    ],
  })
    .select(PROYECCION)
    .lean();
}

async function buscarPorCliente(cliente) {
  const tokens = normTxt(cliente)
    .split(' ')
    .filter((t) => t.length > 3 && !TOKENS_DEBILES.has(t));
  if (!tokens.length) return [];
  const rx = tokens.slice(0, 3).join('|');
  const filtro = { asegurado: { $regex: rx, $options: 'i' } };
  const [cat, listado] = await Promise.all([
    ZurichCaso.find(filtro).select(PROYECCION).lean(),
    ZurichListadoCaso.find(filtro).select(PROYECCION).lean(),
  ]);
  return [
    ...cat.map((d) => ({ ...d, coleccion: 'zurich', Model: ZurichCaso })),
    ...listado.map((d) => ({ ...d, coleccion: 'zurichListado', Model: ZurichListadoCaso })),
  ];
}

function mejorCandidato(lista, cliente) {
  return [...lista].sort(
    (a, b) => scoreCliente(b.asegurado, cliente) - scoreCliente(a.asegurado, cliente)
  )[0];
}

async function main() {
  const visitas = leerVisitas(excelPath);
  console.log(JSON.stringify({ excel: excelPath, visitas: visitas.length, apply }, null, 2));
  if (!visitas.length) {
    console.log('Sin filas de programación (siniestro + fecha + inspector + horario).');
    return;
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
  });

  const inspectores = await InspectorCatastrofico.find({}).lean();
  const ajustadores = await AjustadorCatastrofico.find({}).lean();

  const usados = new Set();
  const resumen = { actualizados: 0, noEncontrados: [] };

  for (const visita of visitas) {
    const asignacion = resolverAsignacionCatastrofico({
      inspectorExcel: visita.inspector,
      inspectores,
      ajustadores,
    });
    const inspector = asignacion.inspector || visita.inspector;
    const siniestroBusqueda = ALIAS_SINIESTRO[visita.siniestro] || visita.siniestro;

    const [cat, listado] = await Promise.all([
      buscarCasos(ZurichCaso, siniestroBusqueda),
      buscarCasos(ZurichListadoCaso, siniestroBusqueda),
    ]);
    const porSiniestro = [
      ...cat.map((d) => ({ ...d, coleccion: 'zurich', Model: ZurichCaso })),
      ...listado.map((d) => ({ ...d, coleccion: 'zurichListado', Model: ZurichListadoCaso })),
    ].filter((d) => !usados.has(`${d.coleccion}:${d._id}`));

    let caso = mejorCandidato(porSiniestro, visita.cliente) || null;
    const score = caso ? scoreCliente(caso.asegurado, visita.cliente) : 0;

    if (!caso || (visita.cliente && score < 40)) {
      const porNombre = (await buscarPorCliente(visita.cliente)).filter(
        (d) => !usados.has(`${d.coleccion}:${d._id}`)
      );
      const alt = mejorCandidato(porNombre, visita.cliente);
      if (alt && scoreCliente(alt.asegurado, visita.cliente) >= 50) {
        caso = alt;
      }
    }

    if (!caso) {
      resumen.noEncontrados.push({
        siniestro: visita.siniestro,
        fecha: visita.fecha,
        cliente: visita.cliente,
      });
      continue;
    }

    usados.add(`${caso.coleccion}:${caso._id}`);
    const patch = {
      inspector,
      fechaCoordinandoInspeccion: fechaBogota(visita.fecha),
      horaInicioCoordinacion: visita.horaInicio,
      horaFinCoordinacion: visita.horaFin,
    };
    if (visita.direccion && !caso.direccionPredio) {
      patch.direccionPredio = visita.direccion;
    }

    console.log(
      [
        apply ? 'SET' : 'DRY',
        visita.siniestro,
        siniestroBusqueda !== visita.siniestro ? `(alias ${siniestroBusqueda})` : '',
        visita.fecha,
        `${visita.horaInicio}-${visita.horaFin}`,
        inspector,
        caso.coleccion,
        String(caso._id),
        `stro ${caso.siniestro || ''}`,
        caso.asegurado || visita.cliente,
      ]
        .filter(Boolean)
        .join(' | ')
    );

    if (apply) {
      await caso.Model.updateOne({ _id: caso._id }, { $set: patch });
      resumen.actualizados += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        actualizados: apply ? resumen.actualizados : 0,
        habriaActualizado: visitas.length - resumen.noEncontrados.length,
        noEncontrados: resumen.noEncontrados,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
