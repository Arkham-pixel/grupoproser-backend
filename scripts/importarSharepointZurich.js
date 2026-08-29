/**
 * Carga Sharepoint_Z.xlsx en Zurich.
 * Condiciones:
 *  - No borra ni reemplaza la colección
 *  - No duplica por ZC / STRO
 *  - Mismo nombre + misma cédula + misma póliza = duplicado (se omite)
 *  - Mismo nombre + misma cédula + distinta póliza = válido (se crea)
 *  - En existentes del listado solo completa huecos (no pisa cédula/póliza)
 *  - Reporte CAT recibe los casos nuevos que no cruzan por ZC/STRO
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
import ZurichCaso from '../models/ZurichCaso.js';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { resolverAsignacionCatastrofico } from '../utils/resolverAsignacionCatastrofico.js';
import { catalogoPerteneceAModulo, LIDER_ZURICH } from '../utils/filtrarCatalogoPorModulo.js';
import { homologarEstadoZurich } from '../utils/estadosZurich.js';
import { homologarCiudadZurich } from '../utils/ciudadesBbvaCat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

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

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
const { casos: casosExcel, dupsExcel } = parsearExcel(excelPath);
const [inspectores, ajustadores, catExistentes, listadoExistentes] = await Promise.all([
  InspectorCatastrofico.find({}).lean(),
  AjustadorCatastrofico.find({}).lean(),
  ZurichCaso.find({}).lean(),
  ZurichListadoCaso.find({}).lean(),
]);
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

const lstIdx = new Map();
const lstPersona = [];
for (const doc of listadoExistentes) {
  const zc = normClave(doc.zc);
  if (zc && !lstIdx.has(zc)) lstIdx.set(zc, doc);
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
  const hitCatZc =
    (zcK && catIdx.get(`ZC:${zcK}`)) ||
    (sK && catIdx.get(`S:${sK}`));
  const dupCatPersona = hitPersonaMismaPoliza(catPersona, fila);
  const otraPolCat = hitPersonaOtraPoliza(catPersona, fila);

  if (hitCatZc) {
    resumen.catYaExistian += 1;
  } else if (dupCatPersona) {
    resumen.catDuplicadoPersonaPoliza += 1;
  } else if (fila.identificacion) {
    if (otraPolCat.length) {
      resumen.permitidosMismoNombreOtraPoliza.push({
        destino: 'CAT',
        zc: fila.zc,
        asegurado: fila.asegurado,
        poliza: fila.numeroPoliza || null,
      });
    }
    seqCat += 1;
    const payloadCat = {
      consecutivo: `ZURICH-${año}-${mes}-${seqCat}`,
      zc: fila.zc || null,
      siniestro: fila.siniestro || null,
      identificacion: fila.identificacion,
      tipoIdentificacion: fila.tipoIdentificacion || null,
      numeroPoliza: fila.numeroPoliza || null,
      asegurado: fila.asegurado || null,
      ajustador: asignacion.ajustador || null,
      ajustadorLider: liderZurich,
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
    };
    if (!dryRun) {
      const creado = await ZurichCaso.create(payloadCat);
      const lean = creado.toObject();
      if (zcK) catIdx.set(`ZC:${zcK}`, lean);
      if (sK) catIdx.set(`S:${sK}`, lean);
      const persona = clavePersonaPoliza(lean);
      if (persona) catPersona.push({ ...persona, doc: lean });
    } else {
      if (zcK) catIdx.set(`ZC:${zcK}`, payloadCat);
      if (sK) catIdx.set(`S:${sK}`, payloadCat);
    }
    resumen.catCreados += 1;
  } else {
    resumen.omitidos += 1;
  }

  if (!zcK) continue;
  const hitLst = lstIdx.get(zcK);
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
      zc: completar(fila.zc, hitLst.zc),
      siniestro: completar(fila.siniestro, hitLst.siniestro),
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
      await ZurichListadoCaso.findByIdAndUpdate(hitLst._id, { $set: merge });
    }
    resumen.listadoHuecos += 1;
    lstIdx.set(zcK, { ...hitLst, ...merge });
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
      const creadoLst = await ZurichListadoCaso.create(payloadLst);
      const leanLst = creadoLst.toObject();
      lstIdx.set(zcK, leanLst);
      const persona = clavePersonaPoliza(leanLst);
      if (persona) lstPersona.push({ ...persona, doc: leanLst });
    } else {
      lstIdx.set(zcK, payloadLst);
    }
    resumen.listadoCreados += 1;
  }
}

const [catTotal, listadoTotal] = dryRun
  ? [catExistentes.length + resumen.catCreados, listadoExistentes.length + resumen.listadoCreados]
  : await Promise.all([ZurichCaso.countDocuments(), ZurichListadoCaso.countDocuments()]);

console.log(JSON.stringify({ ...resumen, catTotal, listadoTotal }, null, 2));
await mongoose.disconnect();
