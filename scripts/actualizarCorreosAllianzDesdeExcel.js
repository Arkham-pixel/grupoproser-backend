/**
 * Actualiza gsk3cAppallianzListadoCasos con correos/contactos del Excel
 * "Registro siniestro Allianz.xlsx". Empareja por siniestro; crea si no existe.
 *
 * Uso:
 *   node scripts/actualizarCorreosAllianzDesdeExcel.js
 *   node scripts/actualizarCorreosAllianzDesdeExcel.js "C:\\ruta\\archivo.xlsx"
 */
import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import AllianzListadoCaso from '../models/AllianzListadoCaso.js';
import { homologarEstadoAllianz } from '../utils/estadosAllianz.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const excelPath =
  process.argv[2] || 'C:\\Users\\GP-TI\\Downloads\\Registro siniestro Allianz.xlsx';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const normSiniestro = (valor) =>
  String(valor ?? '')
    .replace(/\.0$/, '')
    .replace(/\s+/g, '')
    .trim();

const limpiar = (raw) => {
  if (raw === null || raw === undefined || raw === '') return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  return String(raw).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
};

function extraerEmail(raw) {
  const found = String(raw || '').match(EMAIL_RE) || [];
  return found.length ? found[0].trim().toLowerCase() : '';
}

function extraerTelefono(raw) {
  const texto = String(raw || '');
  const digits = texto.replace(/[^\d]/g, '');
  if (digits.length >= 7 && digits.length <= 15) return digits;
  const m = texto.match(/(\d[\d\s-]{6,14}\d)/);
  return m ? m[1].replace(/\s+/g, '') : '';
}

function parsearExcel(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  return rows
    .map((r) => {
      const siniestro = normSiniestro(r.Siniestro ?? r.siniestro ?? r.SINIESTRO);
      const correo = extraerEmail(r['Correo electronico'] ?? r['Correo electrónico'] ?? r.Correo);
      const contactoAseg = limpiar(r['Contacto asegurado']);
      const telefono = extraerTelefono(contactoAseg) || extraerTelefono(r['Contacto intermediario']);
      const correoInt = extraerEmail(r['Contacto intermediario']);
      return {
        siniestro,
        asegurado: limpiar(r.Asegurado),
        correoAsegurado: correo,
        telefonoAsegurado: telefono,
        contactoAsegurado: [telefono, correo].filter(Boolean).join(' | ') || contactoAseg,
        tipoPoliza: limpiar(r['Tipo de Poliza'] ?? r['Tipo de Póliza']),
        numeroPoliza: limpiar(r.Poliza ?? r.Póliza),
        intermediario: limpiar(r.Intermediario),
        correoIntermediario: correoInt,
        contactoIntermediario: limpiar(r['Contacto intermediario']),
        ciudad: limpiar(r.Ciudad),
        observaciones: limpiar(r.observaciones ?? r.Observaciones),
        estado: homologarEstadoAllianz(limpiar(r.Estado)),
        inspector: limpiar(r.Inspector),
      };
    })
    .filter((c) => c.siniestro);
}

async function main() {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) {
    console.error('Falta MONGO_URI');
    process.exit(1);
  }

  const filas = parsearExcel(excelPath);
  console.log(`Excel: ${filas.length} filas, con correo: ${filas.filter((f) => f.correoAsegurado).length}`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const existentes = await AllianzListadoCaso.find({}).lean();
  const indice = new Map();
  for (const doc of existentes) {
    const clave = normSiniestro(doc.siniestro);
    if (clave && !indice.has(clave)) indice.set(clave, doc);
  }

  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  let secuencial = 0;
  for (const doc of existentes) {
    const m = String(doc.consecutivo || '').match(/^ALLIANZ-LST-\d{4}-\d{2}-(\d+)$/i);
    if (m) secuencial = Math.max(secuencial, Number(m[1]));
  }

  const resumen = { actualizados: 0, creados: 0, sinCambio: 0, conCorreoNuevo: 0 };

  for (const fila of filas) {
    const doc = indice.get(fila.siniestro);
    if (doc) {
      const $set = { updatedAt: ahora };
      if (fila.correoAsegurado && fila.correoAsegurado !== doc.correoAsegurado) {
        $set.correoAsegurado = fila.correoAsegurado;
        resumen.conCorreoNuevo += 1;
      }
      if (fila.telefonoAsegurado && !doc.telefonoAsegurado) {
        $set.telefonoAsegurado = fila.telefonoAsegurado;
      }
      if (fila.contactoAsegurado) $set.contactoAsegurado = fila.contactoAsegurado;
      if (fila.asegurado && fila.asegurado !== doc.asegurado) $set.asegurado = fila.asegurado;
      if (fila.intermediario && !doc.intermediario) $set.intermediario = fila.intermediario;
      if (fila.correoIntermediario && !doc.correoIntermediario) {
        $set.correoIntermediario = fila.correoIntermediario;
      }
      if (fila.contactoIntermediario && !doc.contactoIntermediario) {
        $set.contactoIntermediario = fila.contactoIntermediario;
      }
      if (fila.ciudad && (!doc.ciudad || doc.ciudad === '0')) $set.ciudad = fila.ciudad;
      if (fila.numeroPoliza && !doc.numeroPoliza) $set.numeroPoliza = fila.numeroPoliza;
      if (fila.tipoPoliza && !doc.tipoPoliza) $set.tipoPoliza = fila.tipoPoliza;
      if (fila.observaciones && !doc.observaciones) $set.observaciones = fila.observaciones;
      if (fila.inspector && !doc.inspector) $set.inspector = fila.inspector;

      if (Object.keys($set).length === 1) {
        resumen.sinCambio += 1;
        continue;
      }
      await AllianzListadoCaso.updateOne({ _id: doc._id }, { $set });
      resumen.actualizados += 1;
    } else {
      secuencial += 1;
      const creado = await AllianzListadoCaso.create({
        consecutivo: `ALLIANZ-LST-${año}-${mes}-${secuencial}`,
        siniestro: fila.siniestro,
        identificacion: fila.siniestro,
        asegurado: fila.asegurado || fila.siniestro,
        correoAsegurado: fila.correoAsegurado || null,
        telefonoAsegurado: fila.telefonoAsegurado || null,
        contactoAsegurado: fila.contactoAsegurado || null,
        intermediario: fila.intermediario || null,
        correoIntermediario: fila.correoIntermediario || null,
        contactoIntermediario: fila.contactoIntermediario || null,
        ciudad: fila.ciudad || null,
        numeroPoliza: fila.numeroPoliza || null,
        tipoPoliza: fila.tipoPoliza || null,
        observaciones: fila.observaciones || null,
        inspector: fila.inspector || null,
        estado: fila.estado || 'CASO NUEVO',
      });
      indice.set(fila.siniestro, creado.toObject());
      resumen.creados += 1;
      if (fila.correoAsegurado) resumen.conCorreoNuevo += 1;
    }
  }

  const conCorreo = await AllianzListadoCaso.countDocuments({
    correoAsegurado: { $regex: '@' },
  });
  console.log(JSON.stringify({ ...resumen, totalConCorreoEnBd: conCorreo }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
