/**
 * Carga LISTADO SINIESTRO COMPLEX CAT en gsk3cAppzurichListadoCasos.
 * Empareja por ZC: no duplica; solo completa huecos.
 * Inspector/ajustador se resuelven contra catálogos catastróficos.
 *
 * Uso:
 *   node scripts/importarListadoZurichExcel.js
 *   node scripts/importarListadoZurichExcel.js "C:\\ruta\\archivo.xlsx"
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { resolverAsignacionCatastrofico } from '../utils/resolverAsignacionCatastrofico.js';
import { homologarEstadoZurich } from '../utils/estadosZurich.js';

const excelPath =
  process.argv[2] ||
  'C:\\Users\\GP-TI\\Downloads\\LISTADO SINIESTRO COMPLEX CAT (1).xlsx';

const normHeader = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normZc = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const limpiar = (raw) => {
  if (raw === null || raw === undefined || raw === '') return '';
  return String(raw).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
};

const fechaIso = (valor) => {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  if (/^pendiente$/i.test(texto)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  if (typeof valor === 'number') {
    const utc = Date.UTC(1899, 11, 30) + Math.round(valor * 86400000);
    return new Date(utc).toISOString().slice(0, 10);
  }
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const HEADER_MAP = {
  ZC: 'zc',
  STRO: 'siniestro',
  SINIESTRO: 'siniestro',
  ASEGURADO: 'asegurado',
  INTERMEDIARIO: 'intermediario',
  'CONTACTO INTERMEDIARIO': 'contactoIntermediario',
  'CORREO INTERMEDIARIO': 'correoIntermediario',
  'TELEFONO INTERMEDIARIO': 'telefonoIntermediario',
  'CONTACTO ASEGURADO': 'contactoAsegurado',
  'TELEFONO ASEGURADO': 'telefonoAsegurado',
  'TEL ASEGURADO': 'telefonoAsegurado',
  'CELULAR ASEGURADO': 'telefonoAsegurado',
  'CORREO ASEGURADO': 'correoAsegurado',
  'EMAIL ASEGURADO': 'correoAsegurado',
  'MAIL ASEGURADO': 'correoAsegurado',
  CIUDAD: 'ciudad',
  'FECHA ASIGNACION': 'fechaAsignacion',
  'FECHA VISITA': 'fechaVisita',
  INSPECTOR: 'inspector',
  AJUSTADOR: 'ajustador',
  ESTADO: 'estado',
};

const parsearExcel = (filePath) => {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const header = matriz[0] || [];
  const colMap = {};
  header.forEach((celda, c) => {
    const campo = HEADER_MAP[normHeader(celda)];
    if (campo) colMap[c] = campo;
  });
  const casos = [];
  for (let r = 1; r < matriz.length; r += 1) {
    const row = matriz[r] || [];
    const caso = {};
    Object.entries(colMap).forEach(([colStr, campo]) => {
      const raw = row[Number(colStr)];
      if (campo === 'fechaAsignacion' || campo === 'fechaVisita') {
        caso[campo] = fechaIso(raw);
        return;
      }
      caso[campo] = limpiar(raw);
    });
    if (!caso.zc && !caso.siniestro && !caso.asegurado) continue;
    caso.contactoIntermediario = [
      caso.intermediario,
      caso.correoIntermediario,
      caso.telefonoIntermediario,
    ]
      .filter(Boolean)
      .join(' | ');
    const contactoAseguradoTexto = String(caso.contactoAsegurado || '').trim();
    if (contactoAseguradoTexto && !caso.telefonoAsegurado && !caso.correoAsegurado) {
      const email = contactoAseguradoTexto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (email) caso.correoAsegurado = email[0];
      const resto = email
        ? contactoAseguradoTexto.replace(email[0], ' ').replace(/[|,;]/g, ' ').trim()
        : contactoAseguradoTexto;
      if (resto.replace(/\D/g, '').length >= 7) caso.telefonoAsegurado = resto;
    }
    caso.contactoAsegurado = [caso.telefonoAsegurado, caso.correoAsegurado]
      .filter(Boolean)
      .join(' | ');
    caso.identificacion = caso.zc || caso.siniestro;
    if (!caso.estado || caso.estado === '0') caso.estado = '';
    caso.estado = homologarEstadoZurich(caso.estado);
    casos.push(caso);
  }
  return casos;
};

const esVacio = (v) => v === undefined || v === null || v === '' || v === 'null';
const completar = (incoming, existing) => {
  if (!esVacio(existing) && existing !== '0') return existing;
  if (!esVacio(incoming) && incoming !== '0') return incoming;
  return existing ?? incoming ?? null;
};

await mongoose.connect(process.env.MONGO_URI);
const casosExcel = parsearExcel(excelPath);
const [inspectores, ajustadores, existentes] = await Promise.all([
  InspectorCatastrofico.find({}).lean(),
  AjustadorCatastrofico.find({}).lean(),
  ZurichListadoCaso.find({}).lean(),
]);

const indice = new Map();
for (const doc of existentes) {
  const zc = normZc(doc.zc);
  if (zc && !indice.has(zc)) indice.set(zc, doc);
}

let max = 0;
for (const doc of existentes) {
  const m = String(doc.consecutivo || '').match(/^ZURICH-LST-\d{4}-\d{2}-(\d+)$/i);
  if (m) max = Math.max(max, parseInt(m[1], 10));
}

const ahora = new Date();
const año = ahora.getFullYear();
const mes = String(ahora.getMonth() + 1).padStart(2, '0');
const resumen = {
  excel: casosExcel.length,
  creados: 0,
  actualizados: 0,
  omitidos: 0,
  sinCatalogo: [],
  mapeos: [],
};

for (const fila of casosExcel) {
  const asignacion = resolverAsignacionCatastrofico({
    inspectorExcel: fila.inspector,
    ajustadorExcel: fila.ajustador,
    inspectores,
    ajustadores,
  });
  resumen.mapeos.push({
    zc: fila.zc,
    excelInspector: fila.inspector || '',
    excelAjustador: fila.ajustador || '',
    inspector: asignacion.inspector || '',
    ajustador: asignacion.ajustador || '',
  });
  if (asignacion.inspectorSinCatalogo || asignacion.ajustadorSinCatalogo) {
    resumen.sinCatalogo.push({
      zc: fila.zc,
      inspector: asignacion.inspectorSinCatalogo ? fila.inspector : null,
      ajustador: asignacion.ajustadorSinCatalogo ? fila.ajustador : null,
    });
  }

  const incoming = {
    ...fila,
    inspector: asignacion.inspector,
    ajustador: asignacion.ajustador,
  };
  const clave = normZc(incoming.zc);
  const existente = clave ? indice.get(clave) : null;
  if (existente) {
    const merge = {
      zc: completar(incoming.zc, existente.zc),
      siniestro: completar(incoming.siniestro, existente.siniestro),
      identificacion: completar(incoming.identificacion, existente.identificacion),
      asegurado: completar(incoming.asegurado, existente.asegurado),
      intermediario: completar(incoming.intermediario, existente.intermediario),
      correoIntermediario: completar(incoming.correoIntermediario, existente.correoIntermediario),
      telefonoIntermediario: completar(
        incoming.telefonoIntermediario,
        existente.telefonoIntermediario
      ),
      contactoIntermediario: completar(
        incoming.contactoIntermediario,
        existente.contactoIntermediario
      ),
      telefonoAsegurado: completar(incoming.telefonoAsegurado, existente.telefonoAsegurado),
      correoAsegurado: completar(incoming.correoAsegurado, existente.correoAsegurado),
      contactoAsegurado: completar(incoming.contactoAsegurado, existente.contactoAsegurado),
      ciudad: completar(incoming.ciudad, existente.ciudad),
      inspector: completar(incoming.inspector, existente.inspector),
      ajustador: completar(incoming.ajustador, existente.ajustador),
      estado: homologarEstadoZurich(completar(incoming.estado, existente.estado)),
      fechaAsignacion: existente.fechaAsignacion || incoming.fechaAsignacion || null,
      fechaVisita: existente.fechaVisita || incoming.fechaVisita || null,
      consecutivo: existente.consecutivo || `ZURICH-LST-${año}-${mes}-${max + 1}`,
    };
    if (!existente.consecutivo) max += 1;
    await ZurichListadoCaso.findByIdAndUpdate(existente._id, { $set: merge });
    resumen.actualizados += 1;
    indice.set(clave, { ...existente, ...merge });
  } else if (clave) {
    max += 1;
    const creado = await ZurichListadoCaso.create({
      consecutivo: `ZURICH-LST-${año}-${mes}-${max}`,
      zc: incoming.zc,
      siniestro: incoming.siniestro || null,
      identificacion: incoming.identificacion,
      asegurado: incoming.asegurado || null,
      intermediario: incoming.intermediario || null,
      correoIntermediario: incoming.correoIntermediario || null,
      telefonoIntermediario: incoming.telefonoIntermediario || null,
      contactoIntermediario: incoming.contactoIntermediario || null,
      telefonoAsegurado: incoming.telefonoAsegurado || null,
      correoAsegurado: incoming.correoAsegurado || null,
      contactoAsegurado: incoming.contactoAsegurado || null,
      ciudad: incoming.ciudad || null,
      inspector: incoming.inspector || null,
      ajustador: incoming.ajustador || null,
      estado: homologarEstadoZurich(incoming.estado),
      fechaAsignacion: incoming.fechaAsignacion || null,
      fechaVisita: incoming.fechaVisita || null,
    });
    resumen.creados += 1;
    indice.set(clave, creado.toObject());
  } else {
    resumen.omitidos += 1;
  }
}

const total = await ZurichListadoCaso.countDocuments();
const pendientes = await ZurichListadoCaso.find({}).lean();
let migradosContactoAsegurado = 0;
for (const doc of pendientes) {
  let telefono = doc.telefonoAsegurado || null;
  let correo = doc.correoAsegurado || null;
  const texto = String(doc.contactoAsegurado || '').trim();
  if ((!telefono || !correo) && texto) {
    const email = texto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!correo && email) correo = email[0];
    const resto = email
      ? texto.replace(email[0], ' ').replace(/[|,;]/g, ' ').trim()
      : texto;
    if (!telefono && resto.replace(/\D/g, '').length >= 7) telefono = resto;
  }
  const legado = [telefono, correo].filter(Boolean).join(' | ') || null;
  const mismoTel = String(telefono || '') === String(doc.telefonoAsegurado || '');
  const mismoCorreo = String(correo || '') === String(doc.correoAsegurado || '');
  const mismoLegado = String(legado || '') === String(doc.contactoAsegurado || '');
  if (mismoTel && mismoCorreo && mismoLegado) continue;
  await ZurichListadoCaso.updateOne(
    { _id: doc._id },
    {
      $set: {
        telefonoAsegurado: telefono,
        correoAsegurado: correo,
        contactoAsegurado: legado,
      },
    }
  );
  migradosContactoAsegurado += 1;
}

console.log(
  JSON.stringify(
    { ...resumen, totalListado: total, migradosContactoAsegurado, mapeos: resumen.mapeos },
    null,
    2
  )
);
await mongoose.disconnect();
