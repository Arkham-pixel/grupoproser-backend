/**
 * Rutas de prueba SharePoint: solo bajo MS_SHAREPOINT_ROOT_TEST (TEST_ARNALD).
 */
import { getSharePointConfig } from '../config/sharepoint.js';

export function getSharePointTestRoot() {
  return getSharePointConfig().testRootFolder || 'TEST_ARNALD';
}

/**
 * Aborta si la ruta no está bajo TEST_ARNALD.
 * @throws {{ code: 'INVALID_TEST_PATH', message: string }}
 */
export function assertTestPath(pathValue) {
  const root = getSharePointTestRoot();
  const normalized = String(pathValue || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');

  if (!normalized) {
    const err = new Error(`assertTestPath: ruta vacía o raíz prohibida (solo bajo ${root})`);
    err.code = 'INVALID_TEST_PATH';
    throw err;
  }

  const first = normalized.split('/')[0];
  const blocked = new Set([
    'PÓLIZAS',
    'POLIZAS',
    'CONTROL Y SEGUIMIENTO',
    'SINIESTROS',
    'Documentos',
    'Documents',
  ]);

  if (blocked.has(first) || blocked.has(first.toUpperCase())) {
    const err = new Error(`assertTestPath: ruta bloqueada "${normalized}"`);
    err.code = 'INVALID_TEST_PATH';
    throw err;
  }

  if (normalized !== root && !normalized.startsWith(`${root}/`)) {
    const err = new Error(
      `assertTestPath: "${normalized}" no comienza por ${root}. Operación abortada.`
    );
    err.code = 'INVALID_TEST_PATH';
    throw err;
  }

  return normalized;
}
