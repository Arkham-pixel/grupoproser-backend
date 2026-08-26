/**
 * Carga Sharepoint_Z.xlsx en Zurich.
 * Condiciones (mismas de siempre):
 *  - No borra ni reemplaza la colección
 *  - No duplica (CAT: ZC / STRO; listado: ZC)
 *  - En existentes del listado solo completa huecos
 *  - Reporte CAT recibe los casos nuevos (este Excel no cruza con la base CAT de Risk ID)
 *
 * Uso:
 *   node scripts/importarSharepointZurich.js
 *   node scripts/importarSharepointZurich.js "C:\\ruta\\Sharepoint_Z.xlsx"
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import ZurichCaso from '../models/ZurichCaso.js';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { resolverAsignacionCatastrofico } from '../utils/resolverAsignacionCatastrofico.js';
import { homologarEstadoZurich } from '../utils/estadosZurich.js';

const excelPath =
  process.argv[2] || 'C:\\Users\\GP-TI\\Downloads\\Sharepoint_Z.xlsx';

const normHeader = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normClave = (valor) =>
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

const esVacio = (v) => v === undefined || v === null || v === '' || v === 'null';

const completar = (incoming, existing) => {
  if (!esVacio(existing) && existing !== '0') return existing;
  if (!esVacio(incoming) && incoming !== '0') return incoming;
  return existing ?? incoming ?? null;
};

const fechaDia = (valor) => {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, '0');
    const d = String(valor.getDate()).padStart(2, '0');
    return new Date(`${y}-${m}-${d}T12:00:00.000Z`);
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(valor * 86400000);
    return fechaDia(new Date(utc));
  }
  const texto = String(valor).trim();
  if (!texto) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return new Date(`${texto.slice(0, 10)}T12:00:00.000Z`);
  const mdy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (mdy) {
    let month = Number(mdy[1]);
    let day = Number(mdy[2]);
    let year = Number(mdy[3]);
    if (year < 100) year += 2000;
    if (month > 12 && day <= 12) {
      const tmp = month;
      month = day;
      day = tmp;
    }
    return new Date(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00.000Z`
    );
  }
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : fechaDia(d);
};

const parseMoney = (valor) => {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  const texto = String(valor).trim();
  if (!texto || !/\d/.test(texto)) return null;
  const limpio = texto.replace(/[^\d.,-]/g, '');
  if (!limpio) return null;
  const lastComma = limpio.lastIndexOf(',');
  const lastDot = limpio.lastIndexOf('.');
  let n;
  if (lastComma > lastDot) {
    n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  } else {
    n = Number(limpio.replace(/,/g, ''));
  }
  return Number.isFinite(n) ? n : null;
};

const siNo = (valor) => {
  const t = limpiar(valor)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  if (/^(SI|YES|TRUE|1)$/.test(t)) return 'SI';
  if (/^(NO|FALSE|0)$/.test(t)) return 'NO';
  return '';
};

const grado = (valor) => {
  if (valor == null || valor === '') return null;
  const n = Number(String(valor).trim().replace(',', '.'));
  if (Number.isFinite(n) && n >= 1 && n <= 6) return String(Math.round(n));
  const t = limpiar(valor);
  return t || null;
};

const splitCiudadDepto = (valor) => {
  const t = limpiar(valor);
  if (!t) return { ciudad: '', departamento: '' };
  const parts = t.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { ciudad: parts[0], departamento: parts.slice(1).join(', ') };
  }
  return { ciudad: t, departamento: '' };
};

const parseContacto = (valor) => {
  const texto = limpiar(valor);
  if (!texto) return { telefono: '', correo: '', legado: '' };
  const email = texto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const correo = email ? email[0] : '';
  const resto = email
    ? texto.replace(email[0], ' ').replace(/[|,;/]/g, ' ').trim()
    : texto;
  const telefono = resto.replace(/\D/g, '').length >= 7 ? resto : '';
  return {
    telefono,
    correo,
    legado: [telefono, correo].filter(Boolean).join(' | '),
  };
};

const HEADER_MAP = {
  ZC: 'zc',
  'Z CLAIMS': 'zc',
  'Z CLAIM': 'zc',
  STRO: 'siniestro',
  SINIESTRO: 'siniestro',
  AJUSTADOR: 'ajustador',
  'FECHA ASIGNACION': 'fechaAsignacion',
  ASEGURADO: 'asegurado',
  'NOMBRE ASEGURADO': 'asegurado',
  NOMBRE: 'asegurado',
  'VALOR ASEGURADO COP': 'valorAseguradoInmueble',
  'VALOR ASEGURADO': 'valorAseguradoInmueble',
  DIRECCION: 'direccionPredio',
  'DIRECCION PREDIO': 'direccionPredio',
  CIUDAD: 'ciudad',
  'DATOS CONTACTO': 'informacionContacto',
  CONTACTO: 'informacionContacto',
  INSPECCION: 'inspeccion',
  'FECHA DE INSPECCION': 'fechaInspeccion',
  'FECHA INSPECCION': 'fechaInspeccion',
  'GRADO AFECTACION': 'gradoAfectacion',
  'LUCRO CESANTE': 'lucroCesante',
  'PERDIDA ESTIMADA': 'valorReclamado',
  'MONTO ANTICIPO': 'montoAnticipo',
  OBSERVACIONES: 'observaciones',
  'DESCRIPCION DE LOS DANOS': 'observacionesCat',
  'DESCRIPCION DE LOS DAÑOS': 'observacionesCat',
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
      if (campo === 'fechaAsignacion' || campo === 'fechaInspeccion') {
        caso[campo] = fechaDia(raw);
        return;
      }
      if (campo === 'valorAseguradoInmueble' || campo === 'valorReclamado' || campo === 'montoAnticipo') {
        caso[campo] = parseMoney(raw);
        return;
      }
      if (campo === 'inspeccion') {
        caso.inspeccion = siNo(raw);
        return;
      }
      if (campo === 'gradoAfectacion') {
        caso.gradoAfectacion = grado(raw);
        return;
      }
      if (campo === 'lucroCesante') {
        caso.lucroCesante = siNo(raw) || limpiar(raw) || null;
        return;
      }
      caso[campo] = limpiar(raw);
    });
    if (!caso.zc && !caso.siniestro && !caso.asegurado) continue;
    caso.zc = String(caso.zc || '').replace(/\.0$/, '');
    caso.siniestro = String(caso.siniestro || '').replace(/\.0$/, '');
    const loc = splitCiudadDepto(caso.ciudad);
    caso.ciudad = loc.ciudad;
    caso.departamento = loc.departamento;
    const contacto = parseContacto(caso.informacionContacto);
    caso.telefonoAsegurado = contacto.telefono;
    caso.correoAsegurado = contacto.correo;
    caso.contactoAsegurado = contacto.legado;
    caso.celular = contacto.telefono;
    caso.correo = contacto.correo;
    caso.identificacion = caso.zc || caso.siniestro;
    if (caso.montoAnticipo) {
      const anticipo = `Anticipo: ${caso.montoAnticipo}`;
      caso.observaciones = [caso.observaciones, anticipo].filter(Boolean).join(' | ');
    }
    casos.push(caso);
  }
  return casos;
};

const maxSecuencial = (docs, patron) => {
  let max = 0;
  for (const doc of docs) {
    const m = String(doc.consecutivo || '').match(patron);
    if (m?.[1]) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
};

await mongoose.connect(process.env.MONGO_URI);
const casosExcel = parsearExcel(excelPath);
const [inspectores, ajustadores, catExistentes, listadoExistentes] = await Promise.all([
  InspectorCatastrofico.find({}).lean(),
  AjustadorCatastrofico.find({}).lean(),
  ZurichCaso.find({}).lean(),
  ZurichListadoCaso.find({}).lean(),
]);

const catIdx = new Map();
for (const doc of catExistentes) {
  for (const clave of [`ZC:${normClave(doc.zc)}`, `S:${normClave(doc.siniestro)}`, `I:${normClave(doc.identificacion)}`]) {
    if (clave.endsWith(':')) continue;
    if (!catIdx.has(clave)) catIdx.set(clave, doc);
  }
}
const lstIdx = new Map();
for (const doc of listadoExistentes) {
  const zc = normClave(doc.zc);
  if (zc && !lstIdx.has(zc)) lstIdx.set(zc, doc);
}

const ahora = new Date();
const año = ahora.getFullYear();
const mes = String(ahora.getMonth() + 1).padStart(2, '0');
let seqCat = maxSecuencial(catExistentes, /^ZURICH-\d{4}-\d{2}-(\d+)$/i);
let seqLst = maxSecuencial(listadoExistentes, /^ZURICH-LST-\d{4}-\d{2}-(\d+)$/i);

const resumen = {
  excel: casosExcel.length,
  catCreados: 0,
  catYaExistian: 0,
  listadoCreados: 0,
  listadoHuecos: 0,
  omitidos: 0,
};

for (const fila of casosExcel) {
  const asignacion = resolverAsignacionCatastrofico({
    ajustadorExcel: fila.ajustador,
    inspectores,
    ajustadores,
  });
  const inspeccionSi = fila.inspeccion === 'SI';
  const estadoNuevo = homologarEstadoZurich(
    inspeccionSi ? 'COORDINANDO INSPECCIÓN' : 'CASO NUEVO'
  );

  const zcK = normClave(fila.zc);
  const sK = normClave(fila.siniestro);
  const hitCat =
    (zcK && catIdx.get(`ZC:${zcK}`)) ||
    (sK && catIdx.get(`S:${sK}`)) ||
    (zcK && catIdx.get(`I:${zcK}`));

  if (hitCat) {
    resumen.catYaExistian += 1;
  } else if (fila.identificacion) {
    seqCat += 1;
    const creado = await ZurichCaso.create({
      consecutivo: `ZURICH-${año}-${mes}-${seqCat}`,
      zc: fila.zc || null,
      siniestro: fila.siniestro || null,
      identificacion: fila.identificacion,
      asegurado: fila.asegurado || null,
      ajustador: asignacion.ajustador || fila.ajustador || null,
      direccionPredio: fila.direccionPredio || null,
      ciudad: fila.ciudad || null,
      departamento: fila.departamento || null,
      valorAseguradoInmueble: fila.valorAseguradoInmueble ?? null,
      valorReclamado: fila.valorReclamado ?? null,
      informacionContacto: fila.informacionContacto || null,
      telefonoAsegurado: fila.telefonoAsegurado || null,
      correoAsegurado: fila.correoAsegurado || null,
      contactoAsegurado: fila.contactoAsegurado || null,
      celular: fila.celular || null,
      correo: fila.correo || null,
      fechaAsignacion: fila.fechaAsignacion || null,
      fechaInspeccion: fila.fechaInspeccion || null,
      fechaVisita: fila.fechaInspeccion || null,
      fechaCasoNuevo: fila.fechaAsignacion || ahora,
      fechaCoordinandoInspeccion: inspeccionSi ? fila.fechaInspeccion || ahora : null,
      gradoAfectacion: fila.gradoAfectacion || null,
      lucroCesante: fila.lucroCesante || null,
      afectacion: inspeccionSi ? 'SI' : fila.inspeccion || null,
      observaciones: fila.observaciones || null,
      observacionesCat: fila.observacionesCat || null,
      estado: estadoNuevo,
    });
    const lean = creado.toObject();
    resumen.catCreados += 1;
    if (zcK) catIdx.set(`ZC:${zcK}`, lean);
    if (sK) catIdx.set(`S:${sK}`, lean);
  } else {
    resumen.omitidos += 1;
  }

  if (!zcK) continue;
  const hitLst = lstIdx.get(zcK);
  const obsListado = [
    fila.direccionPredio,
    fila.observacionesCat,
    fila.observaciones,
  ]
    .filter(Boolean)
    .join(' | ');

  if (hitLst) {
    const merge = {
      zc: completar(fila.zc, hitLst.zc),
      siniestro: completar(fila.siniestro, hitLst.siniestro),
      identificacion: completar(fila.identificacion, hitLst.identificacion),
      asegurado: completar(fila.asegurado, hitLst.asegurado),
      ciudad: completar(fila.ciudad, hitLst.ciudad),
      departamento: completar(fila.departamento, hitLst.departamento),
      ajustador: completar(asignacion.ajustador || fila.ajustador, hitLst.ajustador),
      telefonoAsegurado: completar(fila.telefonoAsegurado, hitLst.telefonoAsegurado),
      correoAsegurado: completar(fila.correoAsegurado, hitLst.correoAsegurado),
      contactoAsegurado: completar(fila.contactoAsegurado, hitLst.contactoAsegurado),
      observaciones: completar(obsListado, hitLst.observaciones),
      fechaAsignacion: hitLst.fechaAsignacion || fila.fechaAsignacion || null,
      fechaVisita: hitLst.fechaVisita || fila.fechaInspeccion || null,
    };
    await ZurichListadoCaso.findByIdAndUpdate(hitLst._id, { $set: merge });
    resumen.listadoHuecos += 1;
    lstIdx.set(zcK, { ...hitLst, ...merge });
  } else {
    seqLst += 1;
    const creadoLst = await ZurichListadoCaso.create({
      consecutivo: `ZURICH-LST-${año}-${mes}-${seqLst}`,
      zc: fila.zc,
      siniestro: fila.siniestro || null,
      identificacion: fila.identificacion,
      asegurado: fila.asegurado || null,
      ciudad: fila.ciudad || null,
      departamento: fila.departamento || null,
      ajustador: asignacion.ajustador || fila.ajustador || null,
      telefonoAsegurado: fila.telefonoAsegurado || null,
      correoAsegurado: fila.correoAsegurado || null,
      contactoAsegurado: fila.contactoAsegurado || null,
      observaciones: obsListado || null,
      fechaAsignacion: fila.fechaAsignacion || null,
      fechaVisita: fila.fechaInspeccion || null,
      fechaCasoNuevo: fila.fechaAsignacion || ahora,
      fechaCoordinandoInspeccion: inspeccionSi ? fila.fechaInspeccion || ahora : null,
      estado: estadoNuevo,
    });
    resumen.listadoCreados += 1;
    lstIdx.set(zcK, creadoLst.toObject());
  }
}

const [catTotal, listadoTotal] = await Promise.all([
  ZurichCaso.countDocuments(),
  ZurichListadoCaso.countDocuments(),
]);

console.log(JSON.stringify({ ...resumen, catTotal, listadoTotal }, null, 2));
await mongoose.disconnect();
