/**
 * Documentos de Condiciones Alfa: PDFs en la raíz de SEGUROS ALFA/PÓLIZAS
 * y en la carpeta compartida POLIZAS GENERAL.
 * No incluye subcarpetas por identificación (esas son del Archivero).
 */

import { getAlfaPolicyImportConfig } from '../config/alfaPolicyImport.js';
import {
  listFolder,
  getItemMetadata,
  getItemContentStream,
  resolveDriveContext,
} from './microsoftGraphService.js';
import { assertAlfaPolicyImportRoot } from '../utils/alfaPolicySharePointPath.js';

/** Carpeta compartida de condiciones generales dentro de PÓLIZAS. */
export const ALFA_CONDICIONES_GENERAL_FOLDER = 'POLIZAS GENERAL';

function isFileItem(item) {
  return Boolean(item && !item.folder && (item.file || item.size != null));
}

function isPdfName(name) {
  return /\.pdf$/i.test(String(name || ''));
}

function isGeneralFolderName(name) {
  const n = String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  return n === 'POLIZAS GENERAL' || n === 'POLIZA GENERAL';
}

function mapDoc(item, { folder = null } = {}) {
  return {
    id: String(item.id),
    name: item.name,
    size: Number(item.size) || 0,
    lastModified: item.lastModifiedDateTime || null,
    webUrl: item.webUrl || null,
    folder,
  };
}

/**
 * Resuelve la ruta de la carpeta POLIZAS GENERAL bajo la raíz PÓLIZAS.
 */
export async function resolveAlfaCondicionesGeneralPath(rootPath) {
  const listed = await listFolder(rootPath, { top: 200 });
  const folder = (listed.children || []).find(
    (c) => c?.folder && isGeneralFolderName(c.name)
  );
  if (!folder) return null;
  return {
    path: `${rootPath}/${folder.name}`,
    name: folder.name,
    id: String(folder.id),
  };
}

/**
 * Lista PDFs de Condiciones: raíz PÓLIZAS + POLIZAS GENERAL.
 */
export async function listAlfaCondicionesDocuments() {
  const cfg = getAlfaPolicyImportConfig();
  const rootPath = assertAlfaPolicyImportRoot(cfg.rootPath);
  const listed = await listFolder(rootPath, { top: 200 });
  const children = listed.children || [];

  const docs = children
    .filter((c) => isFileItem(c) && isPdfName(c.name))
    .map((c) => mapDoc(c, { folder: null }));

  const general = children.find((c) => c?.folder && isGeneralFolderName(c.name));
  if (general) {
    const generalPath = `${rootPath}/${general.name}`;
    try {
      const inner = await listFolder(generalPath, { top: 200 });
      for (const c of inner.children || []) {
        if (isFileItem(c) && isPdfName(c.name)) {
          docs.push(mapDoc(c, { folder: general.name }));
        }
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: 'ALFA_CONDICIONES_GENERAL_LIST_WARN',
          path: generalPath,
          message: String(err?.message || err).slice(0, 200),
        })
      );
    }
  }

  docs.sort((a, b) => {
    const fa = String(a.folder || '');
    const fb = String(b.folder || '');
    if (fa !== fb) return fa.localeCompare(fb, 'es', { sensitivity: 'base' });
    return String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' });
  });

  // Deduplicar por id por si un mismo archivo aparece dos veces
  const seen = new Set();
  const unique = docs.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });

  return {
    rootPath,
    generalFolder: general?.name || null,
    count: unique.length,
    documents: unique,
  };
}

/**
 * Valida que el item sea un PDF de Condiciones (raíz PÓLIZAS o POLIZAS GENERAL).
 */
export async function assertAlfaCondicionItem(itemId) {
  const id = String(itemId || '').trim();
  if (!id) {
    const err = new Error('itemId requerido');
    err.code = 'MISSING_ITEM_ID';
    err.status = 400;
    throw err;
  }

  const cfg = getAlfaPolicyImportConfig();
  const rootPath = assertAlfaPolicyImportRoot(cfg.rootPath);
  const { driveId } = await resolveDriveContext();
  const meta = await getItemMetadata(id);

  if (meta?.folder) {
    const err = new Error('El ítem es una carpeta, no un documento');
    err.code = 'NOT_A_FILE';
    err.status = 400;
    throw err;
  }

  if (!isPdfName(meta?.name)) {
    const err = new Error('Solo se permiten PDF de Condiciones');
    err.code = 'NOT_A_PDF';
    err.status = 400;
    throw err;
  }

  const listed = await listFolder(rootPath, { top: 200 });
  const children = listed.children || [];
  const inRoot = children.some((c) => String(c.id) === id && isFileItem(c));

  let inGeneral = false;
  let generalName = null;
  if (!inRoot) {
    const general = children.find((c) => c?.folder && isGeneralFolderName(c.name));
    if (general) {
      generalName = general.name;
      const inner = await listFolder(`${rootPath}/${general.name}`, { top: 200 });
      inGeneral = (inner.children || []).some(
        (c) => String(c.id) === id && isFileItem(c)
      );
    }
  }

  if (!inRoot && !inGeneral) {
    const err = new Error(
      'Documento no está en Condiciones (raíz PÓLIZAS o POLIZAS GENERAL)'
    );
    err.code = 'CONDICION_NOT_ALLOWED';
    err.status = 404;
    throw err;
  }

  return {
    driveId,
    rootPath,
    folder: inGeneral ? generalName : null,
    meta: {
      id: String(meta.id),
      name: meta.name,
      size: Number(meta.size) || 0,
      mimeType: meta.file?.mimeType || 'application/pdf',
      webUrl: meta.webUrl || null,
    },
  };
}

export async function openAlfaCondicionDownloadStream(itemId) {
  const { driveId, meta } = await assertAlfaCondicionItem(itemId);
  const stream = await getItemContentStream(meta.id, { driveId });
  return { stream, meta };
}
