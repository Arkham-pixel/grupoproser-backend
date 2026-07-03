import {
  deleteStoredFiles,
  deleteOrphanedStoredFiles,
  deleteReplacedStoredFile,
  isStoredFileReference,
} from '../services/fileStorageService.js';
import { normalizeStoredFileReference } from './storageKeyBuilder.js';

export const RIESGO_ATTACHMENT_FIELDS = Object.freeze([
  'adjuntoAsignacion',
  'adjuntoInspeccion',
  'adjuntoContIni',
  'anxoInfoFnal',
  'anxoFactra',
]);

export const COMPLEX_ATTACHMENT_FIELDS = Object.freeze([
  'anexContIni',
  'anexActaInspccion',
  'anexSolDoc',
  'anxoInfPrelim',
  'anxoInfoFnal',
  'anxoRepoActi',
  'anxoPresentacionCifras',
  'anxoEnvioFiniquito',
  'anxoFactra',
  'anxoHonorarios',
  'anxoHonorariosdefinit',
  'anxoAutorizacion',
  'anxoEvidencia',
  'anxo_seguimiento_envio_control_horas',
]);

export const CASO_COMPLEX_ATTACHMENT_FIELDS = Object.freeze([
  'anex_cont_ini',
  'anex_acta_inspccion',
  'anex_sol_doc',
  'anxo_inf_prelim',
  'anxo_info_fnal',
  'anxo_repo_acti',
  'anxo_presentacion_cifras',
  'anxo_envio_finiquito',
  'anxo_factra',
  'anxo_honorarios',
  'anxo_honorariosdefinit',
  'anxo_autorizacion',
  'anxo_evidencia',
  'anxo_seguimiento_envio_control_horas',
]);

const HISTORIAL_IMAGE_ARRAY_KEYS = Object.freeze([
  'imagenesRegistro',
  'imagenesInspeccion',
  'imagenes',
  'fotos',
]);

const PATH_OBJECT_KEYS = Object.freeze(['ruta', 'url', 'path']);

export function collectPathsFromFields(record, fields = []) {
  if (!record) return [];
  const paths = [];
  for (const field of fields) {
    const value = record[field];
    if (isStoredFileReference(value)) paths.push(value);
  }
  return paths;
}

export function collectPathsFromHistorialDatos(datos) {
  if (!datos || typeof datos !== 'object') return [];

  const paths = new Set();

  for (const key of HISTORIAL_IMAGE_ARRAY_KEYS) {
    const items = datos[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      for (const pathKey of PATH_OBJECT_KEYS) {
        if (isStoredFileReference(item[pathKey])) paths.add(item[pathKey]);
      }
    }
  }

  for (const key of ['fotoPrincipal', 'foto', 'archivo', 'adjunto']) {
    if (isStoredFileReference(datos[key])) paths.add(datos[key]);
  }

  return [...paths];
}

export function collectPathsFromHistorialFormulario(formulario) {
  const paths = [];
  if (formulario?.archivo?.ruta) paths.push(formulario.archivo.ruta);
  paths.push(...collectPathsFromHistorialDatos(formulario?.datos));
  return paths;
}

export function collectPathsFromExpressAnexos(anexos = []) {
  if (!Array.isArray(anexos)) return [];
  return anexos
    .map((anexo) => anexo?.url || anexo?.ruta || anexo?.path)
    .filter(isStoredFileReference)
    .map((path) => normalizeStoredFileReference(path))
    .filter(Boolean);
}

export function collectPathsFromComplexRecord(record) {
  if (!record) return [];
  const paths = collectPathsFromFields(record, COMPLEX_ATTACHMENT_FIELDS);
  if (Array.isArray(record.historialDocs)) {
    for (const doc of record.historialDocs) {
      for (const pathKey of PATH_OBJECT_KEYS) {
        if (isStoredFileReference(doc?.[pathKey])) paths.push(doc[pathKey]);
      }
    }
  }
  return paths;
}

export async function deleteAttachmentsFromRecord(record, fields) {
  return deleteStoredFiles(collectPathsFromFields(record, fields));
}

export async function deleteHistorialFormularioFiles(formulario) {
  return deleteStoredFiles(collectPathsFromHistorialFormulario(formulario));
}

export async function deleteComplexRecordFiles(record) {
  return deleteStoredFiles(collectPathsFromComplexRecord(record));
}

export {
  deleteStoredFiles,
  deleteOrphanedStoredFiles,
  deleteReplacedStoredFile,
  isStoredFileReference,
};
