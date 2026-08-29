/**
 * Homologa estados Zurich al flujo vigente y completa fechas de acción.
 * Uso: node scripts/migrarEstadosZurich.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import {
  ESTADO_ZURICH_ACEPTACION_CLIENTE,
  ESTADO_ZURICH_ANALISIS,
  ESTADO_ZURICH_AUTORIDAD_DELEGADA,
  ESTADO_ZURICH_FINALIZADO,
  ESTADO_ZURICH_LIQUIDAR,
  ESTADO_ZURICH_PENDIENTE_DOCS,
  homologarEstadoZurich,
} from '../utils/estadosZurich.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI);
const db = mongoose.connection.db;

const patchFechas = (doc, estado) => {
  const set = { estado, updatedAt: new Date() };
  if (estado === ESTADO_ZURICH_ANALISIS && !doc.fechaAnalisisCaso) {
    set.fechaAnalisisCaso = doc.fechaInspeccionado || doc.fechaVerificado || doc.fechaInspeccion || null;
    if (!set.fechaAnalisisCaso) delete set.fechaAnalisisCaso;
  }
  if (estado === ESTADO_ZURICH_PENDIENTE_DOCS && !doc.fechaInformePreliminar) {
    set.fechaInformePreliminar = doc.fechaSolicitudDocumento || null;
    if (!set.fechaInformePreliminar) delete set.fechaInformePreliminar;
  }
  if (estado === ESTADO_ZURICH_LIQUIDAR && !doc.fechaInformeFinal) {
    set.fechaInformeFinal = doc.fechaLiquidado || null;
    if (!set.fechaInformeFinal) delete set.fechaInformeFinal;
  }
  if (estado === ESTADO_ZURICH_AUTORIDAD_DELEGADA && !doc.fechaAutoridadDelegada) {
    set.fechaAutoridadDelegada = doc.fechaAutorizacionAnalista || null;
    if (!set.fechaAutoridadDelegada) delete set.fechaAutoridadDelegada;
  }
  if (estado === ESTADO_ZURICH_ACEPTACION_CLIENTE && !doc.fechaAceptacionCliente) {
    set.fechaAceptacionCliente = doc.fechaAceptacionLiquidacion || null;
    if (!set.fechaAceptacionCliente) delete set.fechaAceptacionCliente;
  }
  if (estado === ESTADO_ZURICH_FINALIZADO && !doc.fechaFinalizado) {
    set.fechaFinalizado = doc.fechaLiquidado || doc.fechaObjecion || doc.fechaCasoParaPago || null;
    if (!set.fechaFinalizado) delete set.fechaFinalizado;
  }
  return set;
};

const migrarColeccion = async (nombre) => {
  const col = db.collection(nombre);
  const distintos = await col.distinct('estado');
  const conteo = {};
  let modified = 0;
  for (const old of distintos) {
    const nuevo = homologarEstadoZurich(old);
    const docs = await col.find({ estado: old }).toArray();
    for (const doc of docs) {
      const set = patchFechas(doc, nuevo);
      const sameEstado = nuevo === doc.estado;
      const extras = Object.keys(set).filter((k) => k !== 'estado' && k !== 'updatedAt');
      if (sameEstado && !extras.length) continue;
      await col.updateOne({ _id: doc._id }, { $set: set });
      modified += 1;
    }
    conteo[`${old || '(vacío)'} → ${nuevo}`] = docs.length;
  }
  const resto = (await col.distinct('estado')).filter(Boolean).sort();
  return { coleccion: nombre, modified, mapeo: conteo, estadosFinales: resto };
};

const cat = await migrarColeccion('gsk3cAppzurichCasos');
const lst = await migrarColeccion('gsk3cAppzurichListadoCasos');
console.log(JSON.stringify({ cat, lst }, null, 2));
await mongoose.disconnect();
