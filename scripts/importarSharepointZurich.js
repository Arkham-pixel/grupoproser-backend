/**
 * Carga Sharepoint_Z.xlsx en Zurich.
 * Condiciones:
 *  - No borra ni reemplaza la colección
 *  - No duplica por ZC / STRO (workflow)
 *  - Nunca cambia ZC ni número de siniestro/STRO en registros existentes
 *  - Mismo nombre + misma cédula + misma póliza = duplicado (se omite)
 *  - Mismo nombre + misma cédula + distinta póliza = válido (se crea)
 *  - En existentes del listado solo completa huecos (no pisa cédula/póliza/ZC/STRO)
 *  - No escribe en reporte CAT (gsk3cAppzurichCasos)
 *
 * Uso:
 *   node scripts/importarSharepointZurich.js
 *   node scripts/importarSharepointZurich.js --dry-run
 *   node scripts/importarSharepointZurich.js "C:\\ruta\\Sharepoint_Z.xlsx"
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { resolverAsignacionCatastrofico } from '../utils/resolverAsignacionCatastrofico.js';
import { catalogoPerteneceAModulo, LIDER_ZURICH } from '../utils/filtrarCatalogoPorModulo.js';
import { homologarEstadoZurich } from '../utils/estadosZurich.js';
import { homologarCiudadZurich } from '../utils/ciudadesBbvaCat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
process.env.SKIP_NOTIFICACIONES_OPERATIVAS = '1';

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const excelPath =
  args.find((a) => !a.startsWith('--')) || 'C:\\Users\\GP-TI\\Downloads\\Sharepoint_Z.xlsx';

const PLACEHOLDER_ID = /^(DILIGENCIAR|PENDIENTE|N\/?A|NA|NULL|-|0|SIN DATO|POR CONFIRMAR)$/i;

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

const esPlaceholder = (valor) => {
  if (esVacio(valor)) return true;
  return PLACEHOLDER_ID.test(String(valor).trim());
};

const completar = (incoming, existing) => {
  if (!esVacio(existing) && existing !== '0' && !esPlaceholder(existing)) return existing;
  if (!esVacio(incoming) && incoming !== '0' && !esPlaceholder(incoming)) return incoming;
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
  const homologada = homologarCiudadZurich(t);
  if (homologada === 'CALI') {
    return { ciudad: 'CALI', departamento: 'VALLE DEL CAUCA' };
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

/** Cédula/NIT real: no es ZC, STRO ni Risk ID estilo "3518-NOMBRE". */
const esCedulaReal = (id, zc, stro) => {
  const n = normClave(id);
  if (!n || esPlaceholder(id)) return false;
  if (n === normClave(zc) || n === normClave(stro)) return false;
  if (/^\d+-[A-Z]/.test(n)) return false;
  const digitos = String(id).replace(/\D/g, '');
  return digitos.length >= 5;
};

const HEADER_MAP = {
  ZC: 'zc',
  'Z CLAIMS': 'zc',
  'Z CLAIM': 'zc',
  STRO: 'siniestro',
  SINIESTRO: 'siniestro',
  WORKFLOW: 'siniestro',
  'CODIGO WORKFLOW': 'siniestro',
  'COD WORKFLOW': 'siniestro',
  AJUSTADOR: 'ajustador',
  'FECHA ASIGNACION': 'fechaAsignacion',
  ASEGURADO: 'asegurado',
  'NOMBRE ASEGURADO': 'asegurado',
  NOMBRE: 'asegurado',
  CEDULA: 'cedula',
  IDENTIFICACION: 'cedula',
  'NIT': 'cedula',
  DOCUMENTO: 'cedula',
  'TIPO IDENTIFICACION': 'tipoIdentificacion',
  POLIZA: 'numeroPoliza',
  'N POLIZA': 'numeroPoliza',
  'NUMERO POLIZA': 'numeroPoliza',
  'NO POLIZA': 'numeroPoliza',
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
  const vistosZc = new Set();
  const dupsExcel = [];
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
    caso.cedula = String(caso.cedula || '').replace(/\.0$/, '');
    caso.numeroPoliza = String(caso.numeroPoliza || '').replace(/\.0$/, '');
    const loc = splitCiudadDepto(caso.ciudad);
    caso.ciudad = homologarCiudadZurich(loc.ciudad) || loc.ciudad;
    caso.departamento = loc.departamento;
    const contacto = parseContacto(caso.informacionContacto);
    caso.telefonoAsegurado = contacto.telefono;
    caso.correoAsegurado = contacto.correo;
    caso.contactoAsegurado = contacto.legado;
    caso.celular = contacto.telefono;
    caso.correo = contacto.correo;
    caso.identificacion =
      (esCedulaReal(caso.cedula, caso.zc, caso.siniestro) && caso.cedula) ||
      caso.zc ||
      caso.siniestro;
    if (caso.montoAnticipo) {
      const anticipo = `Anticipo: ${caso.montoAnticipo}`;
      caso.observaciones = [caso.observaciones, anticipo].filter(Boolean).join(' | ');
    }
    const zcK = normClave(caso.zc);
    if (zcK) {
      if (vistosZc.has(zcK)) {
        dupsExcel.push({ zc: caso.zc, asegurado: caso.asegurado, siniestro: caso.siniestro });
        continue;
      }
      vistosZc.add(zcK);
    }
    casos.push(caso);
  }
  return { casos, dupsExcel };
};

const maxSecuencial = (docs, patron) => {
  let max = 0;
  for (const doc of docs) {
    const m = String(doc.consecutivo || '').match(patron);
    if (m?.[1]) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
};

const clavePersonaPoliza = (doc) => {
  const ced = esCedulaReal(doc.identificacion || doc.cedula, doc.zc, doc.siniestro)
    ? normClave(doc.identificacion || doc.cedula)
    : '';
  const pol = normClave(doc.numeroPoliza);
  const nom = normClave(doc.asegurado);
  if (!ced || !nom) return null;
  return { nom, ced, pol };
};

console.error('[zurich-import] conectando…');
await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  family: 4,
  serverSelectionTimeoutMS: 45000,
  socketTimeoutMS: 60000,
  retryWrites: true,
  retryReads: true,
  readPreference: 'primaryPreferred',
});
const db = mongoose.connection.db;
const colCat = db.collection('gsk3cAppzurichCasos');
const colLst = db.collection('gsk3cAppzurichListadoCasos');
const readOpts = { readPreference: 'secondaryPreferred' };
console.error('[zurich-import] conectado, parseando excel…');
const { casos: casosExcel, dupsExcel } = parsearExcel(excelPath);
console.error('[zurich-import] excel', casosExcel.length, 'dups', dupsExcel.length);
console.error('[zurich-import] cargando catálogos y casos…');
const [inspectores, ajustadores, catExistentes, listadoExistentes] = await Promise.all([
  db.collection('gsk3cAppinspectorcatastrofico').find({}, readOpts).toArray(),
  db.collection('gsk3cAppajustadorcatastrofico').find({}, readOpts).toArray(),
  colCat.find({}, readOpts).project({ archivos: 0, liquidador: 0, informeUnico: 0 }).toArray(),
  colLst.find({}, readOpts).project({ archivos: 0, liquidador: 0, informeUnico: 0 }).toArray(),
]);
console.error('[zurich-import] cat', catExistentes.length, 'listado', listadoExistentes.length);
const inspectoresZurich = inspectores.filter((d) => catalogoPerteneceAModulo(d, 'zurich'));
const ajustadoresZurich = ajustadores.filter((d) => catalogoPerteneceAModulo(d, 'zurich'));
const liderZurich =
  ajustadoresZurich.find((a) => /ladys/i.test(a.nombre || ''))?.nombre || LIDER_ZURICH;

const catIdx = new Map();
const catPersona = [];
for (const doc of catExistentes) {
  for (const clave of [`ZC:${normClave(doc.zc)}`, `S:${normClave(doc.siniestro)}`]) {
    if (clave.endsWith(':')) continue;
    if (!catIdx.has(clave)) catIdx.set(clave, doc);
  }
  const persona = clavePersonaPoliza(doc);
  if (persona) catPersona.push({ ...persona, doc });
}

const snapshotIds = [
  ...catExistentes.map((d) => ({
    col: 'cat',
    id: String(d._id),
    zc: d.zc ?? null,
    siniestro: d.siniestro ?? null,
  })),
  ...listadoExistentes.map((d) => ({
    col: 'listado',
    id: String(d._id),
    zc: d.zc ?? null,
    siniestro: d.siniestro ?? null,
  })),
];

const lstIdx = new Map();
const lstIdxStro = new Map();
const lstPersona = [];
for (const doc of listadoExistentes) {
  const zc = normClave(doc.zc);
  const stro = normClave(doc.siniestro);
  if (zc && !lstIdx.has(zc)) lstIdx.set(zc, doc);
  if (stro && !lstIdxStro.has(stro)) lstIdxStro.set(stro, doc);
  const persona = clavePersonaPoliza(doc);
  if (persona) lstPersona.push({ ...persona, doc });
}

const hitPersonaMismaPoliza = (lista, fila) => {
  const persona = clavePersonaPoliza(fila);
  if (!persona) return null;
  return (
    lista.find((p) => p.nom === persona.nom && p.ced === persona.ced && p.pol && p.pol === persona.pol) ||
    (!persona.pol
      ? lista.find((p) => p.nom === persona.nom && p.ced === persona.ced && !p.pol)
      : null)
  );
};

const hitPersonaOtraPoliza = (lista, fila) => {
  const persona = clavePersonaPoliza(fila);
  if (!persona || !persona.pol) return [];
  return lista.filter((p) => p.nom === persona.nom && p.ced === persona.ced && p.pol && p.pol !== persona.pol);
};

const ahora = new Date();
const año = ahora.getFullYear();
const mes = String(ahora.getMonth() + 1).padStart(2, '0');
let seqCat = maxSecuencial(catExistentes, /^ZURICH-\d{4}-\d{2}-(\d+)$/i);
let seqLst = maxSecuencial(listadoExistentes, /^ZURICH-LST-\d{4}-\d{2}-(\d+)$/i);

const resumen = {
  dryRun,
  excel: casosExcel.length,
  excelDupsZcOmitidos: dupsExcel.length,
  catCreados: 0,
  catYaExistian: 0,
  catDuplicadoPersonaPoliza: 0,
  listadoCreados: 0,
  listadoHuecos: 0,
  listadoDuplicadoPersonaPoliza: 0,
  omitidos: 0,
  permitidosMismoNombreOtraPoliza: [],
  nuevosListado: [],
};

for (const fila of casosExcel) {
  const asignacion = resolverAsignacionCatastrofico({
    ajustadorExcel: fila.ajustador,
    inspectores: inspectoresZurich,
    ajustadores: ajustadoresZurich,
  });
  const inspeccionSi = fila.inspeccion === 'SI';
  const estadoNuevo = homologarEstadoZurich(
    inspeccionSi ? 'COORDINANDO INSPECCIÓN' : 'CASO NUEVO'
  );

  const zcK = normClave(fila.zc);
  const sK = normClave(fila.siniestro);

  if (!zcK && !sK) continue;
  const hitLst = (zcK && lstIdx.get(zcK)) || (sK && lstIdxStro.get(sK));
  const dupLstPersona = !hitLst ? hitPersonaMismaPoliza(lstPersona, fila) : null;
  const otraPolLst = hitPersonaOtraPoliza(lstPersona, fila);
  const obsListado = [
    fila.direccionPredio,
    fila.observacionesCat,
    fila.observaciones,
  ]
    .filter(Boolean)
    .join(' | ');

  if (hitLst) {
    const merge = {
      identificacion: completar(fila.identificacion, hitLst.identificacion),
      tipoIdentificacion: completar(fila.tipoIdentificacion, hitLst.tipoIdentificacion),
      numeroPoliza: completar(fila.numeroPoliza, hitLst.numeroPoliza),
      asegurado: completar(fila.asegurado, hitLst.asegurado),
      ciudad: completar(fila.ciudad, hitLst.ciudad),
      departamento: completar(fila.departamento, hitLst.departamento),
      direccionPredio: completar(fila.direccionPredio, hitLst.direccionPredio),
      ajustador: completar(asignacion.ajustador, hitLst.ajustador),
      ajustadorLider: completar(liderZurich, hitLst.ajustadorLider),
      telefonoAsegurado: completar(fila.telefonoAsegurado, hitLst.telefonoAsegurado),
      correoAsegurado: completar(fila.correoAsegurado, hitLst.correoAsegurado),
      contactoAsegurado: completar(fila.contactoAsegurado, hitLst.contactoAsegurado),
      observaciones: completar(obsListado, hitLst.observaciones),
      fechaAsignacion: hitLst.fechaAsignacion || fila.fechaAsignacion || null,
      fechaVisita: hitLst.fechaVisita || fila.fechaInspeccion || null,
    };
    if (!dryRun) {
      await colLst.updateOne({ _id: hitLst._id }, { $set: { ...merge, updatedAt: ahora } });
    }
    resumen.listadoHuecos += 1;
    const merged = { ...hitLst, ...merge, zc: hitLst.zc, siniestro: hitLst.siniestro };
    if (zcK) lstIdx.set(zcK, merged);
    if (sK) lstIdxStro.set(sK, merged);
  } else if (dupLstPersona) {
    resumen.listadoDuplicadoPersonaPoliza += 1;
  } else {
    if (otraPolLst.length) {
      resumen.permitidosMismoNombreOtraPoliza.push({
        destino: 'listado',
        zc: fila.zc,
        asegurado: fila.asegurado,
        poliza: fila.numeroPoliza || null,
      });
    }
    seqLst += 1;
    const payloadLst = {
      consecutivo: `ZURICH-LST-${año}-${mes}-${seqLst}`,
      zc: fila.zc,
      siniestro: fila.siniestro || null,
      identificacion: fila.identificacion,
      tipoIdentificacion: fila.tipoIdentificacion || null,
      numeroPoliza: fila.numeroPoliza || null,
      asegurado: fila.asegurado || null,
      ciudad: fila.ciudad || null,
      departamento: fila.departamento || null,
      direccionPredio: fila.direccionPredio || null,
      ajustador: asignacion.ajustador || null,
      ajustadorLider: liderZurich,
      telefonoAsegurado: fila.telefonoAsegurado || null,
      correoAsegurado: fila.correoAsegurado || null,
      contactoAsegurado: fila.contactoAsegurado || null,
      observaciones: obsListado || null,
      fechaAsignacion: fila.fechaAsignacion || null,
      fechaVisita: fila.fechaInspeccion || null,
      fechaCasoNuevo: fila.fechaAsignacion || ahora,
      fechaCoordinandoInspeccion: inspeccionSi ? fila.fechaInspeccion || ahora : null,
      estado: estadoNuevo,
    };
    resumen.nuevosListado.push({
      zc: fila.zc,
      siniestro: fila.siniestro,
      asegurado: fila.asegurado,
      ciudad: fila.ciudad,
    });
    if (!dryRun) {
      const creadoLst = { ...payloadLst, createdAt: ahora, updatedAt: ahora };
      const insLst = await colLst.insertOne(creadoLst);
      const leanLst = { ...creadoLst, _id: insLst.insertedId };
      if (zcK) lstIdx.set(zcK, leanLst);
      if (sK) lstIdxStro.set(sK, leanLst);
      const persona = clavePersonaPoliza(leanLst);
      if (persona) lstPersona.push({ ...persona, doc: leanLst });
    } else {
      if (zcK) lstIdx.set(zcK, payloadLst);
      if (sK) lstIdxStro.set(sK, payloadLst);
    }
    resumen.listadoCreados += 1;
  }
}

const [catTotal, listadoTotal] = dryRun
  ? [catExistentes.length + resumen.catCreados, listadoExistentes.length + resumen.listadoCreados]
  : await Promise.all([colCat.countDocuments(), colLst.countDocuments()]);

const idsAlterados = [];
if (!dryRun) {
  const catIds = catExistentes.map((d) => d._id);
  const lstIds = listadoExistentes.map((d) => d._id);
  const [catAfter, lstAfter] = await Promise.all([
    colCat
      .find({ _id: { $in: catIds } })
      .project({ zc: 1, siniestro: 1 })
      .toArray(),
    colLst
      .find({ _id: { $in: lstIds } })
      .project({ zc: 1, siniestro: 1 })
      .toArray(),
  ]);
  const afterMap = new Map(
    [...catAfter.map((d) => [`cat:${d._id}`, d]), ...lstAfter.map((d) => [`listado:${d._id}`, d])]
  );
  for (const snap of snapshotIds) {
    const now = afterMap.get(`${snap.col}:${snap.id}`);
    if (!now) {
      idsAlterados.push({ ...snap, motivo: 'desaparecio' });
      continue;
    }
    if (String(now.zc ?? '') !== String(snap.zc ?? '') || String(now.siniestro ?? '') !== String(snap.siniestro ?? '')) {
      idsAlterados.push({
        ...snap,
        zcAhora: now.zc ?? null,
        siniestroAhora: now.siniestro ?? null,
      });
    }
  }
}

console.log(
  JSON.stringify(
    { ...resumen, catTotal, listadoTotal, idsAlterados: idsAlterados.length, idsAlteradosMuestra: idsAlterados.slice(0, 10) },
    null,
    2
  )
);
if (idsAlterados.length) {
  throw new Error(`Se alteraron ${idsAlterados.length} ZC/STRO existentes. Abortando verificación.`);
}
await mongoose.disconnect();
