/**
 * Documentos de Condiciones Alfa: PDFs en la raíz de SEGUROS ALFA/PÓLIZAS.
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

function isFileItem(item) {
  return Boolean(item && !item.folder && (item.file || item.size != null));
}

function isPdfName(name) {
  return /\.pdf$/i.test(String(name || ''));
}

/**
 * Lista archivos (PDF) en la raíz de PÓLIZAS.
 */
export async function listAlfaCondicionesDocuments() {
  const cfg = getAlfaPolicyImportConfig();
  const rootPath = assertAlfaPolicyImportRoot(cfg.rootPath);
  const listed = await listFolder(rootPath, { top: 200 });
  const docs = (listed.children || [])
    .filter((c) => isFileItem(c) && isPdfName(c.name))
    .map((c) => ({
      id: String(c.id),
      name: c.name,
      size: Number(c.size) || 0,
      lastModified: c.lastModifiedDateTime || null,
      webUrl: c.webUrl || null,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));

  return {
    rootPath,
    count: docs.length,
    documents: docs,
  };
}

/**
 * Valida que el item pertenezca a la raíz de PÓLIZAS (no a subcarpetas de caso).
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

  const parentPath = String(meta?.parentReference?.path || '');
  // path típico: /drive/root:/SEGUROS ALFA/PÓLIZAS
  const normalizedRoot = rootPath.replace(/\\/g, '/');
  const okParent =
    parentPath.includes(`/root:/${normalizedRoot}`) ||
    parentPath.endsWith(`/${normalizedRoot}`) ||
    parentPath.includes(`${normalizedRoot}`);

  // Excluir hijos de subcarpetas: parent debe ser exactamente la raíz PÓLIZAS
  const listed = await listFolder(rootPath, { top: 200 });
  const inRoot = (listed.children || []).some((c) => String(c.id) === id && isFileItem(c));
  if (!inRoot) {
    const err = new Error('Documento no está en la carpeta de Condiciones (raíz PÓLIZAS)');
    err.code = 'CONDICION_NOT_IN_ROOT';
    err.status = 404;
    throw err;
  }

  return {
    driveId,
    rootPath,
    meta: {
      id: String(meta.id),
      name: meta.name,
      size: Number(meta.size) || 0,
      mimeType: meta.file?.mimeType || 'application/pdf',
      webUrl: meta.webUrl || null,
      parentOk: okParent,
    },
  };
}

export async function openAlfaCondicionDownloadStream(itemId) {
  const { driveId, meta } = await assertAlfaCondicionItem(itemId);
  const stream = await getItemContentStream(meta.id, { driveId });
  return { stream, meta };
}
