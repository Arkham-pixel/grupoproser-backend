/**
 * Cliente Microsoft Graph (capa baja).
 *
 * Solo habla con Entra ID + Graph: token, site, drive, requests HTTP.
 * Reglas de negocio ARNALD (rutas de siniestro, S3→SP, sync) viven en
 * sharepointSyncService.js (fases posteriores).
 */

import { ConfidentialClientApplication } from '@azure/msal-node';
import {
  getSharePointConfig,
  isSharePointConfigured,
  validateSharePointCredentialShapes,
} from '../config/sharepoint.js';

const TOKEN_SKEW_MS = 5 * 60 * 1000;
const TOKEN_MAX_ATTEMPTS = 3;
const GRAPH_MAX_ATTEMPTS = 3;

let msalApp = null;
let cachedToken = null;
let cachedExpiresAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetTokenCache() {
  cachedToken = null;
  cachedExpiresAt = 0;
}

function isTransientGraphStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

function isAuthFailureMessage(message = '') {
  const m = String(message);
  return (
    /AADSTS700016/i.test(m) ||
    /AADSTS7000215/i.test(m) ||
    /AADSTS7000222/i.test(m) ||
    /unauthorized_client/i.test(m) ||
    /invalid_client/i.test(m)
  );
}

function humanizeSharePointAuthError(message = '') {
  const m = String(message);
  if (/AADSTS700016/i.test(m) || /was not found in the directory/i.test(m)) {
    return 'SharePoint: la app Microsoft (MS_CLIENT_ID) no existe en el tenant. Revise el Client ID completo (36 caracteres) en Coolify y reinicie el backend.';
  }
  if (/AADSTS7000215/i.test(m) || /Invalid client secret/i.test(m)) {
    return 'SharePoint: MS_CLIENT_SECRET inválido o vencido. Genere un secret nuevo en Entra ID y actualice Coolify.';
  }
  if (/AADSTS7000222/i.test(m)) {
    return 'SharePoint: el client secret expiró. Renueve MS_CLIENT_SECRET en Entra ID / Coolify.';
  }
  return m || 'No se pudo autenticar con Microsoft Graph / SharePoint';
}

function getMsalApp() {
  const config = getSharePointConfig();
  if (!config.tenantId || !config.clientId || !config.clientSecret) {
    throw new SharePointConfigError(
      'Faltan MS_TENANT_ID, MS_CLIENT_ID o MS_CLIENT_SECRET'
    );
  }
  const shapes = validateSharePointCredentialShapes(config);
  if (!shapes.ok) {
    const detail = shapes.issues.map((i) => `${i.field}: ${i.message}`).join('; ');
    throw new SharePointConfigError(
      `Credenciales SharePoint inválidas (${detail})`
    );
  }

  if (!msalApp) {
    msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        clientSecret: config.clientSecret,
      },
    });
  }

  return msalApp;
}

/** Reinicia cliente MSAL (útil si cambian credenciales en runtime / tests). */
export function resetMicrosoftGraphClient() {
  msalApp = null;
  resetTokenCache();
}

export class SharePointConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SharePointConfigError';
    this.code = 'SHAREPOINT_CONFIG';
  }
}

export class SharePointAuthError extends Error {
  constructor(message, cause) {
    super(humanizeSharePointAuthError(message));
    this.name = 'SharePointAuthError';
    this.code = 'SHAREPOINT_AUTH';
    this.cause = cause;
    this.rawMessage = message;
  }
}

export class SharePointGraphError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'SharePointGraphError';
    this.code = code || 'SHAREPOINT_GRAPH';
    this.status = status;
    this.body = body;
  }
}

/**
 * Obtiene access token (client credentials) con caché, reintentos y renovación anticipada.
 */
export async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAt - TOKEN_SKEW_MS) {
    return cachedToken;
  }

  const config = getSharePointConfig();
  let lastError;

  for (let attempt = 1; attempt <= TOKEN_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await getMsalApp().acquireTokenByClientCredential({
        scopes: [config.graphScope],
      });

      if (!result?.accessToken) {
        throw new SharePointAuthError('MSAL no devolvió accessToken');
      }

      cachedToken = result.accessToken;
      cachedExpiresAt = result.expiresOn
        ? new Date(result.expiresOn).getTime()
        : now + 55 * 60 * 1000;

      return cachedToken;
    } catch (error) {
      resetTokenCache();
      lastError = error;
      const msg = error?.message || String(error);
      const fatalAuth = isAuthFailureMessage(msg) || error instanceof SharePointConfigError;
      if (fatalAuth && attempt < TOKEN_MAX_ATTEMPTS) {
        resetMicrosoftGraphClient();
      }
      if (attempt >= TOKEN_MAX_ATTEMPTS || (fatalAuth && /INVALID_GUID|MISSING|TOO_SHORT/i.test(msg))) {
        break;
      }
      await sleep(400 * attempt);
    }
  }

  if (lastError instanceof SharePointAuthError || lastError instanceof SharePointConfigError) {
    throw lastError;
  }
  throw new SharePointAuthError(
    lastError?.message || 'No se pudo obtener token de Microsoft Graph',
    lastError
  );
}

/**
 * Request genérico a Microsoft Graph (reintentos en red / 429 / 5xx; 401 renueva token).
 * @param {string} pathOrUrl - Ruta relativa a /v1.0 o URL absoluta
 * @param {{ method?: string, body?: unknown, headers?: Record<string,string> }} [options]
 */
export async function graphRequest(pathOrUrl, options = {}) {
  const config = getSharePointConfig();
  const method = (options.method || 'GET').toUpperCase();
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${config.graphBaseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

  let lastError;

  for (let attempt = 1; attempt <= GRAPH_MAX_ATTEMPTS; attempt += 1) {
    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    let body;
    if (options.body !== undefined && options.body !== null) {
      if (Buffer.isBuffer(options.body) || typeof options.body === 'string') {
        body = options.body;
      } else {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        body = JSON.stringify(options.body);
      }
    }

    let response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (error) {
      lastError = new SharePointGraphError(
        `Error de red hacia Microsoft Graph: ${error.message}`,
        { code: 'SHAREPOINT_NETWORK' }
      );
      if (attempt < GRAPH_MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastError;
    }

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const graphMessage =
        parsed?.error?.message ||
        (typeof parsed === 'string' ? parsed : null) ||
        response.statusText;
      const graphCode = parsed?.error?.code;

      if (response.status === 401 || response.status === 403) {
        resetTokenCache();
        resetMicrosoftGraphClient();
        lastError = new SharePointAuthError(
          `Graph ${response.status}: ${graphMessage}`,
          { status: response.status, code: graphCode, body: parsed }
        );
        if (attempt < GRAPH_MAX_ATTEMPTS) {
          await sleep(300 * attempt);
          continue;
        }
        throw lastError;
      }

      if (isTransientGraphStatus(response.status) && attempt < GRAPH_MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 600 * attempt
        );
        continue;
      }

      throw new SharePointGraphError(graphMessage || 'Error Microsoft Graph', {
        status: response.status,
        code: graphCode || 'SHAREPOINT_GRAPH',
        body: parsed,
      });
    }

    return parsed;
  }

  throw lastError || new SharePointGraphError('Error Microsoft Graph tras reintentos');
}

/**
 * Resuelve el Site de SharePoint Online.
 * Usa MS_SHAREPOINT_SITE_ID si está definido; si no, hostname + sitePath.
 */
export async function getSite() {
  const config = getSharePointConfig();

  if (config.siteId) {
    return graphRequest(`/sites/${config.siteId}`);
  }

  const sitePath = config.sitePath.replace(/\/$/, '') || '/';
  return graphRequest(`/sites/${config.hostname}:${sitePath}`);
}

/**
 * Resuelve el Drive (biblioteca de documentos).
 * Usa MS_SHAREPOINT_DRIVE_ID si está definido; si no, busca por nombre.
 */
export async function getDrive(siteId) {
  const config = getSharePointConfig();

  if (config.driveId) {
    return graphRequest(`/drives/${config.driveId}`);
  }

  if (!siteId) {
    throw new SharePointConfigError('Se requiere siteId para resolver el drive');
  }

  const list = await graphRequest(`/sites/${siteId}/drives`);
  const drives = list?.value || [];
  const target = config.libraryName.toLowerCase();

  const match =
    drives.find((d) => String(d.name || '').toLowerCase() === target) ||
    drives.find((d) => String(d.name || '').toLowerCase() === 'documents') ||
    drives.find((d) => String(d.name || '').toLowerCase() === 'documentos compartidos');

  if (!match) {
    const names = drives.map((d) => d.name).join(', ') || '(ninguno)';
    throw new SharePointGraphError(
      `No se encontró la biblioteca "${config.libraryName}". Drives: ${names}`,
      { code: 'SHAREPOINT_DRIVE_NOT_FOUND' }
    );
  }

  return match;
}

/** Lista hijos de la raíz del drive (permiso de lectura). */
export async function listDriveRootChildren(driveId, { top = 5 } = {}) {
  return graphRequest(`/drives/${driveId}/root/children?$top=${top}&$select=id,name,folder,file`);
}

/**
 * Resuelve site + drive (usa IDs de env si existen).
 * @returns {Promise<{ site: object, drive: object, driveId: string, siteId: string }>}
 */
export async function resolveDriveContext() {
  const site = await getSite();
  const drive = await getDrive(site.id);
  return {
    site,
    drive,
    siteId: site.id,
    driveId: drive.id,
  };
}

/** Alias Fase 2: hijos de la raíz del drive Documentos. */
export async function getRootChildren({ top = 50 } = {}) {
  const { driveId } = await resolveDriveContext();
  return listDriveRootChildren(driveId, { top });
}

/** Alias Fase 2: item/carpeta por ruta relativa a Documentos. */
export async function getFolderByPath(path) {
  const { driveId } = await resolveDriveContext();
  return getDriveItemByPath(driveId, path);
}

/**
 * Crea la carpeta (y padres) si no existen. Idempotente.
 * @returns {{ item, created: boolean, path: string }}
 */
export async function ensureFolder(path) {
  const { driveId } = await resolveDriveContext();
  const normalized = normalizeRelativePath(path);
  let existed = true;
  try {
    await getDriveItemByPath(driveId, normalized);
  } catch (error) {
    if (error instanceof SharePointGraphError && error.status === 404) {
      existed = false;
    } else {
      throw error;
    }
  }
  const item = await ensureFolderPath(driveId, normalized);
  return { item, created: !existed, path: normalized };
}

/** Lista hijos de una carpeta por ruta relativa. */
export async function listFolder(path, { top = 50 } = {}) {
  const { driveId } = await resolveDriveContext();
  const normalized = normalizeRelativePath(path);
  const folder = await getDriveItemByPath(driveId, normalized);
  const list = await graphRequest(
    `/drives/${driveId}/items/${folder.id}/children?$top=${top}&$select=id,name,size,folder,file,webUrl,createdDateTime,lastModifiedDateTime,eTag,parentReference`
  );
  return {
    folder,
    children: list?.value || [],
  };
}

/**
 * Lista todos los hijos de un item (paginado @odata.nextLink).
 * @param {{ driveId: string, itemId: string, top?: number, select?: string }} opts
 */
export async function listDriveItemChildrenAll({
  driveId,
  itemId,
  top = 100,
  select = 'id,name,size,folder,file,webUrl,createdDateTime,lastModifiedDateTime,eTag,parentReference',
} = {}) {
  if (!driveId || !itemId) {
    throw new SharePointConfigError('driveId e itemId son requeridos para listDriveItemChildrenAll');
  }
  let url = `/drives/${driveId}/items/${itemId}/children?$top=${top}&$select=${encodeURIComponent(select)}`;
  const children = [];
  while (url) {
    const page = await graphRequest(url);
    children.push(...(page?.value || []));
    url = page?.['@odata.nextLink'] || null;
  }
  return children;
}

/**
 * Carga simple (<4 MB) vía PUT content.
 * conflictBehavior: rename para no sobrescribir en pruebas.
 */
export async function uploadSmallFile(folderPath, fileName, buffer, options = {}) {
  const { driveId } = await resolveDriveContext();
  const folder = normalizeRelativePath(folderPath);
  const safeName = String(fileName || '').replace(/^\/+|\/+$/g, '');
  if (!safeName || safeName.includes('/') || safeName.includes('\\')) {
    throw new SharePointConfigError('fileName inválido para uploadSmallFile');
  }

  const fullPath = folder ? `${folder}/${safeName}` : safeName;
  const conflict = options.conflictBehavior || 'rename';
  const contentType = options.contentType || 'application/octet-stream';
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const encoded = encodeSharePointPath(fullPath);
  const item = await graphRequest(
    `/drives/${driveId}/root:/${encoded}:/content?@microsoft.graph.conflictBehavior=${encodeURIComponent(conflict)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body,
    }
  );

  return item;
}

/**
 * Reemplaza el contenido de un DriveItem existente (PUT /content).
 * Si ifMatch se pasa, Graph responde 412 si el eTag cambió (concurrencia).
 */
export async function replaceDriveItemContentBuffer({
  driveId,
  itemId,
  buffer,
  contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ifMatch,
} = {}) {
  if (!driveId || !itemId) {
    throw new SharePointConfigError('driveId e itemId son requeridos para replaceDriveItemContentBuffer');
  }
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const headers = {
    'Content-Type': contentType,
  };
  if (ifMatch) {
    headers['If-Match'] = ifMatch;
  }

  try {
    return await graphRequest(`/drives/${driveId}/items/${itemId}/content`, {
      method: 'PUT',
      headers,
      body,
    });
  } catch (error) {
    if (error?.status === 412 || /precondition|412/i.test(String(error?.message || ''))) {
      throw new SharePointGraphError('EXCEL_SOURCE_ETAG_CHANGED', {
        code: 'EXCEL_SOURCE_ETAG_CHANGED',
        status: 412,
        body: error?.body,
      });
    }
    if (
      error?.status === 423 ||
      /locked|notAllowed/i.test(String(error?.message || '') + String(error?.code || ''))
    ) {
      throw new SharePointGraphError('EXCEL_SOURCE_LOCKED', {
        code: 'EXCEL_SOURCE_LOCKED',
        status: error?.status || 423,
        body: error?.body,
      });
    }
    throw error;
  }
}

/**
 * Sesión workbook Graph (persistChanges) — permite PATCH de rangos/celdas.
 * Probado con app credentials en este tenant pese a docs "Application not supported".
 */
export async function createWorkbookSession({ driveId, itemId, persistChanges = true } = {}) {
  if (!driveId || !itemId) {
    throw new SharePointConfigError('driveId e itemId requeridos para createWorkbookSession');
  }
  return graphRequest(`/drives/${driveId}/items/${itemId}/workbook/createSession`, {
    method: 'POST',
    body: { persistChanges: Boolean(persistChanges) },
  });
}

export async function closeWorkbookSession({ driveId, itemId, sessionId } = {}) {
  if (!driveId || !itemId || !sessionId) return null;
  try {
    return await graphRequest(`/drives/${driveId}/items/${itemId}/workbook/closeSession`, {
      method: 'POST',
      headers: { 'workbook-session-id': sessionId },
      body: {},
    });
  } catch {
    return null;
  }
}

/**
 * Actualiza un rango/celda vía Excel API (no reemplaza el archivo).
 * address ej: "X2" o "BD!X2"
 */
export async function updateWorkbookRange({
  driveId,
  itemId,
  worksheetName,
  address,
  values,
  numberFormat,
  sessionId,
} = {}) {
  if (!driveId || !itemId || !worksheetName || !address) {
    throw new SharePointConfigError('Parámetros incompletos para updateWorkbookRange');
  }
  const ws = encodeURIComponent(worksheetName);
  const addr = encodeURIComponent(address);
  const headers = {};
  if (sessionId) headers['workbook-session-id'] = sessionId;

  const body = {};
  if (values !== undefined) body.values = values;
  if (numberFormat !== undefined) body.numberFormat = numberFormat;

  return graphRequest(
    `/drives/${driveId}/items/${itemId}/workbook/worksheets('${ws}')/range(address='${addr}')`,
    {
      method: 'PATCH',
      headers,
      body,
    }
  );
}

/**
 * Limpia contenido de una celda/rango (borrado explícito outbound).
 * applyTo: Contents | Formats | All
 */
export async function clearWorkbookRange({
  driveId,
  itemId,
  worksheetName,
  address,
  sessionId,
  applyTo = 'Contents',
} = {}) {
  if (!driveId || !itemId || !worksheetName || !address) {
    throw new SharePointConfigError('Parámetros incompletos para clearWorkbookRange');
  }
  const ws = encodeURIComponent(worksheetName);
  const addr = encodeURIComponent(address);
  const headers = {};
  if (sessionId) headers['workbook-session-id'] = sessionId;

  return graphRequest(
    `/drives/${driveId}/items/${itemId}/workbook/worksheets('${ws}')/range(address='${addr}')/clear`,
    {
      method: 'POST',
      headers,
      body: { applyTo },
    }
  );
}

/** Lee values/text de una celda vía Graph. */
export async function readWorkbookRange({
  driveId,
  itemId,
  worksheetName,
  address,
  sessionId,
} = {}) {
  if (!driveId || !itemId || !worksheetName || !address) {
    throw new SharePointConfigError('Parámetros incompletos para readWorkbookRange');
  }
  const ws = encodeURIComponent(worksheetName);
  const addr = encodeURIComponent(address);
  const headers = {};
  if (sessionId) headers['workbook-session-id'] = sessionId;

  return graphRequest(
    `/drives/${driveId}/items/${itemId}/workbook/worksheets('${ws}')/range(address='${addr}')`,
    { method: 'GET', headers }
  );
}

/** Metadata de un DriveItem por id. */
export async function getItemMetadata(itemId) {
  const { driveId } = await resolveDriveContext();
  return graphRequest(
    `/drives/${driveId}/items/${itemId}?$select=id,name,size,webUrl,file,folder,parentReference,createdDateTime,lastModifiedDateTime,eTag`
  );
}

/**
 * Descarga el contenido de un DriveItem como Readable stream (Node).
 * Graph suele devolver 302 a un CDN: no reenviar Authorization en el redirect.
 * @param {string} itemId
 * @param {{ driveId?: string }} [opts]
 */
export async function getItemContentStream(itemId, opts = {}) {
  const config = getSharePointConfig();
  const driveId = opts.driveId || (await resolveDriveContext()).driveId;
  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchDriveItemContentStream(driveId, itemId, config);
    } catch (error) {
      lastError = error;
      const retriable =
        error?.code === 'SHAREPOINT_NETWORK' ||
        /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(
          String(error?.message || '') + String(error?.cause?.code || '')
        );
      if (!retriable || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  // Fallback: @microsoft.graph.downloadUrl + buffer → stream
  try {
    const meta = await graphRequest(
      `/drives/${driveId}/items/${itemId}?$select=id,size,@microsoft.graph.downloadUrl`
    );
    const downloadUrl = meta?.['@microsoft.graph.downloadUrl'];
    if (downloadUrl) {
      const response = await fetch(downloadUrl, { method: 'GET', redirect: 'follow' });
      if (!response.ok) {
        throw new SharePointGraphError('downloadUrl falló', {
          status: response.status,
          code: 'SHAREPOINT_DOWNLOAD_ERROR',
        });
      }
      const { Readable } = await import('stream');
      if (response.body) {
        return Readable.fromWeb(response.body);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      return Readable.from(buf);
    }
  } catch (fallbackError) {
    lastError = lastError || fallbackError;
  }

  throw lastError || new SharePointGraphError('No se pudo descargar contenido', {
    code: 'SHAREPOINT_DOWNLOAD_ERROR',
  });
}

async function fetchDriveItemContentStream(driveId, itemId, config) {
  const token = await getAccessToken();
  let url = `${config.graphBaseUrl}/drives/${driveId}/items/${itemId}/content`;
  let headers = { Authorization: `Bearer ${token}` };

  for (let hop = 0; hop < 6; hop += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });
    } catch (error) {
      throw new SharePointGraphError(
        `Error de red al descargar contenido: ${error.message}`,
        { code: 'SHAREPOINT_NETWORK' }
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new SharePointGraphError('Redirect sin Location al descargar contenido', {
          code: 'SHAREPOINT_DOWNLOAD_ERROR',
          status: response.status,
        });
      }
      url = location.startsWith('http') ? location : new URL(location, url).toString();
      headers = {}; // CDN / download.aspx preautenticado: no enviar Bearer
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      if (response.status === 401 || response.status === 403) {
        resetTokenCache();
        throw new SharePointAuthError(
          `Graph ${response.status}: ${parsed?.error?.message || response.statusText}`,
          { status: response.status, body: parsed }
        );
      }
      throw new SharePointGraphError(parsed?.error?.message || 'Error al descargar contenido', {
        status: response.status,
        code: parsed?.error?.code || 'SHAREPOINT_DOWNLOAD_ERROR',
        body: parsed,
      });
    }

    if (!response.body) {
      throw new SharePointGraphError('Respuesta sin body al descargar contenido', {
        code: 'SHAREPOINT_DOWNLOAD_ERROR',
      });
    }

    const { Readable } = await import('stream');
    return Readable.fromWeb(response.body);
  }

  throw new SharePointGraphError('Demasiados redirects al descargar contenido', {
    code: 'SHAREPOINT_DOWNLOAD_ERROR',
  });
}

/**
 * Alias explícito: descarga por driveId + itemId (stream).
 * @param {{ driveId: string, itemId: string }} opts
 */
export async function downloadDriveItemStream({ driveId, itemId } = {}) {
  if (!driveId || !itemId) {
    throw new SharePointConfigError('driveId e itemId son requeridos para downloadDriveItemStream');
  }
  return getItemContentStream(itemId, { driveId });
}

/**
 * Descarga a Buffer (más tolerante a DNS flaky en redirect SharePoint).
 * Preferible para importación de pólizas con size conocido.
 */
export async function downloadDriveItemBuffer({ driveId, itemId } = {}) {
  if (!driveId || !itemId) {
    throw new SharePointConfigError('driveId e itemId son requeridos para downloadDriveItemBuffer');
  }

  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const meta = await graphRequest(
        `/drives/${driveId}/items/${itemId}?$select=id,size,@microsoft.graph.downloadUrl`
      );
      const downloadUrl = meta?.['@microsoft.graph.downloadUrl'];
      if (downloadUrl) {
        const response = await fetch(downloadUrl, { method: 'GET', redirect: 'follow' });
        if (!response.ok) {
          throw new SharePointGraphError('downloadUrl falló', {
            status: response.status,
            code: 'SHAREPOINT_DOWNLOAD_ERROR',
          });
        }
        return {
          buffer: Buffer.from(await response.arrayBuffer()),
          size: meta.size ?? null,
          mimeType: response.headers.get('content-type') || null,
        };
      }

      // Sin downloadUrl: stream → buffer
      const stream = await getItemContentStream(itemId, { driveId });
      const chunks = [];
      let total = 0;
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        chunks.push(buf);
      }
      return { buffer: Buffer.concat(chunks, total), size: total, mimeType: null };
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  throw lastError || new SharePointGraphError('No se pudo descargar contenido', {
    code: 'SHAREPOINT_DOWNLOAD_ERROR',
  });
}

/** Límite Graph para PUT /content (simple upload). Usamos margen bajo 4 MiB. */
export const GRAPH_SIMPLE_UPLOAD_MAX_BYTES = 3.5 * 1024 * 1024;

/** Tamaño de chunk para upload session (múltiplo de 320 KiB). */
const UPLOAD_SESSION_CHUNK_BYTES = 320 * 1024 * 10; // 3.2 MiB

/**
 * Sube desde un Readable: simple upload si size ≤ umbral; si no, upload session.
 * @param {{ folderPath: string, fileName: string, stream: import('stream').Readable, size?: number, contentType?: string, conflictBehavior?: string }} opts
 */
export async function uploadFileFromStream(opts) {
  const {
    folderPath,
    fileName,
    stream,
    size,
    contentType = 'application/octet-stream',
    conflictBehavior = 'replace',
  } = opts;

  const knownSize = Number.isFinite(size) ? Number(size) : null;

  if (knownSize !== null && knownSize <= GRAPH_SIMPLE_UPLOAD_MAX_BYTES) {
    const buffer = await readStreamToBuffer(stream, GRAPH_SIMPLE_UPLOAD_MAX_BYTES);
    return {
      item: await uploadSmallFile(folderPath, fileName, buffer, {
        contentType,
        conflictBehavior,
      }),
      strategy: 'simple',
    };
  }

  const item = await uploadLargeFileFromStream({
    folderPath,
    fileName,
    stream,
    size: knownSize,
    conflictBehavior,
  });
  return { item, strategy: 'uploadSession' };
}

async function uploadLargeFileFromStream({
  folderPath,
  fileName,
  stream,
  size,
  conflictBehavior = 'replace',
}) {
  const { driveId } = await resolveDriveContext();
  const folder = normalizeRelativePath(folderPath);
  const safeName = String(fileName || '').replace(/^\/+|\/+$/g, '');
  if (!safeName || safeName.includes('/') || safeName.includes('\\')) {
    throw new SharePointConfigError('fileName inválido para upload session');
  }

  const fullPath = folder ? `${folder}/${safeName}` : safeName;
  const encoded = encodeSharePointPath(fullPath);

  let session;
  try {
    session = await graphRequest(`/drives/${driveId}/root:/${encoded}:/createUploadSession`, {
      method: 'POST',
      body: {
        item: {
          '@microsoft.graph.conflictBehavior': conflictBehavior,
          name: safeName,
        },
      },
    });
  } catch (error) {
    mapUploadError(error);
  }

  const uploadUrl = session?.uploadUrl;
  if (!uploadUrl) {
    throw new SharePointGraphError('createUploadSession no devolvió uploadUrl', {
      code: 'SHAREPOINT_UPLOAD_ERROR',
    });
  }

  let offset = 0;
  let lastJson = null;

  try {
    for await (const chunk of readChunks(stream, UPLOAD_SESSION_CHUNK_BYTES)) {
      if (!chunk.length) continue;
      const start = offset;
      const end = offset + chunk.length - 1;
      offset += chunk.length;
      const total = size != null ? size : offset;
      // Si size desconocido, Content-Range usa total provisional; al final Graph acepta cuando stream termina
      const contentRange =
        size != null
          ? `bytes ${start}-${end}/${size}`
          : `bytes ${start}-${end}/${offset}`;

      // En streams sin size fijo Graph espera el total real en el último chunk.
      // Si size es null, al cerrar el stream reenviamos el último rango con total = offset.
      lastJson = await putUploadSessionChunk(uploadUrl, chunk, contentRange);
    }

    // Si no conocíamos size, completar con un PUT vacío no es válido; Graph suele
    // devolver el item cuando el último chunk cubre el total declarado.
    // Si size era null, rehacer último no es posible; exigir size para session.
    if (size == null) {
      // Reintentar: el último contentRange usó total=offset; debería bastar.
    }

    if (lastJson?.id) return lastJson;

    // Algunas respuestas intermedias no incluyen item; consultar por ruta
    return getDriveItemByPath(driveId, fullPath);
  } catch (error) {
    mapUploadError(error);
  }
}

async function putUploadSessionChunk(uploadUrl, chunk, contentRange) {
  let response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': contentRange,
      },
      body: chunk,
    });
  } catch (error) {
    throw new SharePointGraphError(`Error de red en upload session: ${error.message}`, {
      code: 'SHAREPOINT_NETWORK',
    });
  }

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    throw new SharePointGraphError(parsed?.error?.message || 'Error en chunk de upload session', {
      status: response.status,
      code: parsed?.error?.code || 'SHAREPOINT_UPLOAD_ERROR',
      body: parsed,
    });
  }

  return parsed;
}

function mapUploadError(error) {
  if (error instanceof SharePointAuthError) {
    error.code = error.code || 'SHAREPOINT_AUTH_ERROR';
    throw error;
  }
  if (error instanceof SharePointGraphError) {
    if (error.status === 401 || error.status === 403) {
      const authErr = new SharePointAuthError(error.message, error);
      authErr.code =
        error.status === 403 ? 'SHAREPOINT_PERMISSION_ERROR' : 'SHAREPOINT_AUTH_ERROR';
      throw authErr;
    }
    error.code = error.code || 'SHAREPOINT_UPLOAD_ERROR';
    throw error;
  }
  throw error;
}

async function readStreamToBuffer(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      stream.destroy?.();
      throw new SharePointGraphError(
        `Archivo supera el límite de simple upload (${maxBytes} bytes)`,
        { code: 'SHAREPOINT_UPLOAD_ERROR', status: 413 }
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

async function* readChunks(stream, chunkSize) {
  let pending = Buffer.alloc(0);
  for await (const piece of stream) {
    const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    pending = pending.length ? Buffer.concat([pending, buf]) : buf;
    while (pending.length >= chunkSize) {
      yield pending.subarray(0, chunkSize);
      pending = pending.subarray(chunkSize);
    }
  }
  if (pending.length) yield pending;
}

/** Elimina un DriveItem por id. */
export async function deleteItem(itemId) {
  const { driveId } = await resolveDriveContext();
  await deleteDriveItem(driveId, itemId);
  return { deleted: true, itemId };
}

function normalizeRelativePath(path) {
  return String(path || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\\/g, '/');
}

/**
 * Obtiene un item por ruta relativa a la raíz del drive.
 * path vacío → root.
 */
export async function getDriveItemByPath(driveId, itemPath = '') {
  const normalized = normalizeRelativePath(itemPath);

  if (!normalized) {
    return graphRequest(`/drives/${driveId}/root`);
  }

  return graphRequest(`/drives/${driveId}/root:/${encodeSharePointPath(normalized)}`);
}

/** Crea una carpeta bajo un parent item id (falla si ya existe con 409). */
export async function createFolder(driveId, parentItemId, name) {
  return graphRequest(`/drives/${driveId}/items/${parentItemId}/children`, {
    method: 'POST',
    body: {
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    },
  });
}

/** Elimina un drive item por id. */
export async function deleteDriveItem(driveId, itemId) {
  return graphRequest(`/drives/${driveId}/items/${itemId}`, { method: 'DELETE' });
}

/**
 * Asegura carpeta por ruta (idempotente). Solo usado en health write-probe (Fase 1).
 * Fase 2 ampliará uso bajo TEST_ARNALD.
 */
export async function ensureFolderPath(driveId, folderPath) {
  const parts = String(folderPath || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);

  let parent = await graphRequest(`/drives/${driveId}/root`);
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    try {
      parent = await getDriveItemByPath(driveId, currentPath);
    } catch (error) {
      if (error instanceof SharePointGraphError && error.status === 404) {
        try {
          parent = await createFolder(driveId, parent.id, part);
        } catch (createError) {
          // Carrera / ya existe: reconsultar
          if (
            createError instanceof SharePointGraphError &&
            (createError.status === 409 || createError.code === 'nameAlreadyExists')
          ) {
            parent = await getDriveItemByPath(driveId, currentPath);
          } else {
            throw createError;
          }
        }
      } else {
        throw error;
      }
    }
  }

  return parent;
}

function encodeSharePointPath(path) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Health check completo de la integración SharePoint.
 * No requiere S3. El write probe es aislado bajo TEST_ARNALD.
 */
export async function checkSharePointHealth() {
  const config = getSharePointConfig();
  const checks = {
    configured: isSharePointConfigured(),
    token: false,
    site: false,
    library: false,
    read: false,
    write: false,
  };

  const result = {
    connected: false,
    site: config.siteDisplayName,
    library: config.libraryName,
    siteId: null,
    driveId: null,
    checks,
    error: null,
    hint: null,
  };

  if (!checks.configured) {
    result.error = 'Credenciales Microsoft Graph incompletas';
    result.hint =
      'Defina MS_TENANT_ID, MS_CLIENT_ID y MS_CLIENT_SECRET. Ver comentarios en config/sharepoint.js (Sites.Selected).';
    return result;
  }

  try {
    await getAccessToken();
    checks.token = true;

    const site = await getSite();
    checks.site = true;
    result.siteId = site.id;
    result.site = site.displayName || config.siteDisplayName;

    const drive = await getDrive(site.id);
    checks.library = true;
    result.driveId = drive.id;
    result.library = drive.name || config.libraryName;

    await listDriveRootChildren(drive.id, { top: 1 });
    checks.read = true;

    if (config.healthWriteProbe) {
      const probeName = `_health_${Date.now()}`;
      const probePath = `${config.testRootFolder}/${probeName}`;
      const folder = await ensureFolderPath(drive.id, probePath);
      await deleteDriveItem(drive.id, folder.id);
      checks.write = true;
    } else {
      result.hint =
        'Write probe desactivado (MS_SHAREPOINT_HEALTH_WRITE_PROBE=false). Lectura OK.';
      checks.write = false;
    }

    result.connected =
      checks.token &&
      checks.site &&
      checks.library &&
      checks.read &&
      (config.healthWriteProbe ? checks.write : true);

    return result;
  } catch (error) {
    result.error = error.message;
    result.hint = hintForError(error);
    result.connected = false;
    return result;
  }
}

function hintForError(error) {
  if (error instanceof SharePointConfigError) {
    return 'Complete las variables MS_* en el .env del backend.';
  }
  if (error instanceof SharePointAuthError) {
    return 'Verifique secret, admin consent y permiso Sites.Selected concedido al sitio Documental Proser.';
  }
  if (error?.status === 404) {
    return 'Revise MS_SHAREPOINT_HOSTNAME, MS_SHAREPOINT_SITE_PATH y el nombre de la biblioteca.';
  }
  if (error?.code === 'SHAREPOINT_DRIVE_NOT_FOUND') {
    return 'Ajuste MS_SHAREPOINT_LIBRARY_NAME al nombre exacto del drive en el sitio.';
  }
  return 'Revise conectividad a login.microsoftonline.com y graph.microsoft.com.';
}
