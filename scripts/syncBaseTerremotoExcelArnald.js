/**
 * Analiza Excel local vs ARNALD y hace merge seguro (sin borrar casos/archivos).
 * Luego sube ese Excel a SharePoint como fuente del sync.
 */
import '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import { parsearCasosFdmDesdeBuffer } from '../utils/fdmExcelParse.js';
import {
  eventoClaveFdm,
  elegirMejorCedulaFdm,
} from '../services/fdmImportService.js';
import {
  downloadDriveItemBuffer,
  replaceDriveItemContentBuffer,
  getItemMetadata,
  resolveDriveContext,
} from '../services/microsoftGraphService.js';
import EquidadFdmExcelSharePointSource from '../models/EquidadFdmExcelSharePointSource.js';
import { getEquidadFdmExcelSharePointConfig } from '../config/equidadFdmExcelSharePoint.js';
import { runEquidadFdmExcelSharePointDetectCycle } from '../services/equidadFdmExcelSharePointService.js';
import ExcelJS from 'exceljs';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const EXCEL_PATH = path.resolve('C:/Users/GP-TI/Downloads/BASE TERREMOTO 10 DE AGOSTO.xlsx');
const EVENTO = 'TERREMOTO 10 AGOSTO 2026';

const PROTEGIDOS = new Set([
  'liquidador',
  'archivos',
  'consecutivo',
  'esNuevo',
  '_id',
]);

const LIQUIDACION = new Set([
  'estado',
  'perdidaContenidos',
  'perdidaEdificio',
  'totalPerdida',
  'deducible',
  'subsidio',
  'totalLiquidado',
  'valorIndemnizadoAjustador',
  'valorIndemnizado',
  'fechaLiquidacion',
  'fechaGiro',
]);

const vacio = (v) =>
  v === undefined || v === null || v === '' || (typeof v === 'string' && !v.trim());

const digits = (v) => String(v ?? '').replace(/\D/g, '');

function mergeCampo(incoming, existing) {
  if (!vacio(incoming)) return incoming;
  if (!vacio(existing)) return existing;
  return existing ?? incoming ?? null;
}

function mergeLiquidacion(incoming, existing) {
  // Si ARNALD ya tiene LIQUIDADO/GIRADO/OBJETADO, no bajar a PENDIENTE por Excel vacío/PENDIENTE.
  const estEx = String(existing?.estado || '').toUpperCase();
  const estIn = String(incoming?.estado || '').toUpperCase();
  const out = { ...existing };
  for (const f of LIQUIDACION) {
    if (f === 'estado') {
      if (['LIQUIDADO', 'GIRADO', 'OBJETADO'].includes(estEx)) {
        out.estado = existing.estado;
      } else if (!vacio(incoming?.estado)) {
        out.estado = incoming.estado;
      } else if (!vacio(existing?.estado)) {
        out.estado = existing.estado;
      }
      continue;
    }
    // Montos: Excel llena si ARNALD vacío; si ambos tienen, prioriza el que no esté vacío
    // y si Excel trae valor y ARNALD también, preferir ARNALD si ya liquidó.
    if (['LIQUIDADO', 'GIRADO', 'OBJETADO'].includes(estEx) && !vacio(existing?.[f])) {
      out[f] = existing[f];
    } else {
      out[f] = mergeCampo(incoming?.[f], existing?.[f]);
    }
  }
  return out;
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const buffer = fs.readFileSync(EXCEL_PATH);
const parsed = parsearCasosFdmDesdeBuffer(buffer, path.basename(EXCEL_PATH));
const filas = (parsed.casos || []).map((f) => ({
  ...f,
  evento: f.evento || EVENTO,
}));

console.log(JSON.stringify({ excelFilas: filas.length, file: EXCEL_PATH }, null, 2));

const existentes = await EquidadFdmCaso.find({
  $or: [
    { evento: new RegExp('TERREMOTO', 'i') },
    { cobertura: new RegExp('TEMBLOR|TERREMOTO', 'i') },
  ],
}).lean();

console.log('arnaldTerremoto', existentes.length);

const byCed = new Map();
for (const doc of existentes) {
  const d = digits(doc.cedula);
  if (d) {
    if (!byCed.has(d)) byCed.set(d, []);
    byCed.get(d).push(doc);
  }
}

const resumen = {
  matched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  ambiguous: 0,
  excelSinCedula: 0,
  sampleUpdates: [],
};

const CAMPOS_DATOS = [
  'nombre',
  'cedula',
  'celular',
  'direccionAfectada',
  'municipio',
  'departamento',
  'oficinaRadicadora',
  'ajustador',
  'aif',
  'polizaDanosVigente',
  'polizaAfectar',
  'orden',
  'vigenciaPoliza',
  'afectacionesAnteriores',
  'siniestroIndemnizado',
  'valorEdificio',
  'valorContenido',
  'valoresIndemnizables',
  'subsidioEmpresarial',
  'cobertura',
  'primas',
  'tipoNegocio',
  'caso',
  'siniestro',
  'fechaRegistro',
  'fechaAviso',
  'observaciones',
  'detalle',
  'valorObjecion',
  'fechaCausacion',
];

for (const fila of filas) {
  const d = digits(fila.cedula);
  if (!d) {
    resumen.excelSinCedula += 1;
    // crear si tiene nombre
    if (fila.nombre && fila.nombre !== 'SIN NOMBRE') {
      await EquidadFdmCaso.create({
        ...fila,
        evento: EVENTO,
        estado: fila.estado || 'PENDIENTE',
        esNuevo: true,
      });
      resumen.created += 1;
    }
    continue;
  }

  const candidatos = byCed.get(d) || [];
  let doc = null;
  if (candidatos.length === 1) doc = candidatos[0];
  else if (candidatos.length > 1) {
    const terr = candidatos.filter((c) => String(c.evento || '').toUpperCase().includes('TERREMOTO'));
    if (terr.length === 1) doc = terr[0];
    else {
      resumen.ambiguous += 1;
      continue;
    }
  }

  if (!doc) {
    const created = await EquidadFdmCaso.create({
      ...fila,
      evento: EVENTO,
      estado: fila.estado || 'PENDIENTE',
      esNuevo: true,
    });
    const lean = created.toObject();
    if (!byCed.has(d)) byCed.set(d, []);
    byCed.get(d).push(lean);
    resumen.created += 1;
    continue;
  }

  resumen.matched += 1;
  const patch = {};
  for (const campo of CAMPOS_DATOS) {
    if (PROTEGIDOS.has(campo)) continue;
    const next = mergeCampo(fila[campo], doc[campo]);
    const prev = doc[campo];
    const same =
      (vacio(prev) && vacio(next)) ||
      String(prev ?? '') === String(next ?? '') ||
      (prev instanceof Date && next instanceof Date && prev.getTime() === next.getTime());
    if (!same && !vacio(next) && String(prev ?? '') !== String(next ?? '')) {
      // solo escribe si Excel aporta o mejora
      if (!vacio(fila[campo]) && String(fila[campo]) !== String(prev ?? '')) {
        patch[campo] = fila[campo];
      }
    }
  }

  const liq = mergeLiquidacion(fila, doc);
  for (const f of LIQUIDACION) {
    if (String(liq[f] ?? '') !== String(doc[f] ?? '') && !vacio(liq[f])) {
      // no bajar estado protegido
      if (f === 'estado') {
        const estEx = String(doc.estado || '').toUpperCase();
        if (['LIQUIDADO', 'GIRADO', 'OBJETADO'].includes(estEx)) continue;
      }
      if (['LIQUIDADO', 'GIRADO', 'OBJETADO'].includes(String(doc.estado || '').toUpperCase()) &&
          f !== 'estado' &&
          !vacio(doc[f])) {
        continue;
      }
      // rellenar vacíos desde Excel o actualizar si ARNALD vacío
      if (vacio(doc[f]) && !vacio(fila[f])) patch[f] = fila[f];
      else if (f === 'estado' && !vacio(fila.estado) && String(doc.estado || '').toUpperCase() === 'PENDIENTE') {
        // Excel puede subir de PENDIENTE a algo más, o mantener
        if (String(fila.estado).toUpperCase() !== 'PENDIENTE') patch.estado = fila.estado;
      }
    }
  }

  // cédula/nombre: mejorar calidad
  const betterCed = elegirMejorCedulaFdm(fila.cedula, doc.cedula);
  if (betterCed && betterCed !== doc.cedula) patch.cedula = betterCed;
  if (!vacio(fila.nombre) && (vacio(doc.nombre) || fila.nombre.length > String(doc.nombre || '').length)) {
    if (fila.nombre !== doc.nombre) patch.nombre = fila.nombre;
  }

  if (Object.keys(patch).length === 0) {
    resumen.unchanged += 1;
    continue;
  }

  await EquidadFdmCaso.updateOne({ _id: doc._id }, { $set: patch });
  resumen.updated += 1;
  if (resumen.sampleUpdates.length < 12) {
    resumen.sampleUpdates.push({
      cedula: d,
      consecutivo: doc.consecutivo,
      fields: Object.keys(patch),
      estadoAntes: doc.estado,
      estadoDespues: patch.estado || doc.estado,
    });
  }

  // refresh index
  Object.assign(doc, patch);
}

// Contar estados tras merge
const afterEstados = await EquidadFdmCaso.aggregate([
  {
    $match: {
      $or: [
        { evento: /TERREMOTO/i },
        { cobertura: /TEMBLOR|TERREMOTO/i },
      ],
    },
  },
  { $group: { _id: '$estado', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]);

console.log('MERGE', JSON.stringify(resumen, null, 2));
console.log('ESTADOS_POST', JSON.stringify(afterEstados, null, 2));

// Subir Excel a SharePoint (reemplaza contenido del item actual, mismo nombre)
const cfg = getEquidadFdmExcelSharePointConfig();
let source = await EquidadFdmExcelSharePointSource.findOne({ integrationKey: cfg.integrationKey });
if (!source?.itemId) {
  await runEquidadFdmExcelSharePointDetectCycle({ force: true });
  source = await EquidadFdmExcelSharePointSource.findOne({ integrationKey: cfg.integrationKey });
}

if (!source?.itemId) {
  console.error('No hay itemId SharePoint; no se pudo subir el Excel.');
} else {
  const { driveId } = await resolveDriveContext();
  const meta = await getItemMetadata(source.itemId);
  const uploaded = await replaceDriveItemContentBuffer({
    driveId: source.driveId || driveId,
    itemId: source.itemId,
    buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ifMatch: meta.eTag,
  });
  source.eTag = uploaded?.eTag || meta.eTag;
  source.lastArnaldWrittenEtag = source.eTag;
  source.fileName = cfg.fileName;
  source.lastSyncAt = new Date();
  await source.save();
  console.log('SHAREPOINT_UPLOAD_OK', {
    itemId: source.itemId,
    eTag: source.eTag,
    bytes: buffer.length,
  });
}

// Detect fresco
const detect = await runEquidadFdmExcelSharePointDetectCycle({ force: true });
console.log('DETECT', {
  outcome: detect.outcome,
  status: detect.status,
  summary: detect.source?.summary,
  error: detect.error || detect.source?.lastError,
});

await mongoose.disconnect();
