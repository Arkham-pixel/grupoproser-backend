/**
 * Detección + preview + execute Excel Equidad FDM desde SharePoint.
 * Cron solo preview; execute siempre manual.
 */

import { getEquidadFdmExcelSharePointConfig, FDM_EXCEL_INBOUND_FIELDS } from '../config/equidadFdmExcelSharePoint.js';
import {
  listFolder,
  getItemMetadata,
  downloadDriveItemBuffer,
  resolveDriveContext,
} from './microsoftGraphService.js';
import {
  assertEquidadFdmExcelSharePointPath,
  isAcceptedEquidadFdmExcelName,
  isTempOfficeExcelName,
} from '../utils/equidadFdmExcelSharePointPath.js';
import { parsearCasosFdmDesdeBuffer } from '../utils/fdmExcelParse.js';
import EquidadFdmExcelSharePointSource from '../models/EquidadFdmExcelSharePointSource.js';
import EquidadFdmExcelImportSession from '../models/EquidadFdmExcelImportSession.js';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import {
  eventoClaveFdm,
  clavesDeduplicacionFdm,
  ejecutarImportacionFdm,
  sonElMismoCasoFdm,
  elegirKeeperFdm,
} from './fdmImportService.js';

function notifyKey(itemId, eTag) {
  return `${itemId || ''}::${eTag || ''}`;
}

function normVal(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

function valuesEqual(a, b) {
  return normVal(a).toUpperCase() === normVal(b).toUpperCase();
}

function computeUiFromTotals(totals = {}) {
  const created = totals.created || 0;
  const updated = totals.updated || 0;
  const ambiguous = totals.ambiguous || 0;
  const rejected = totals.rejected || 0;
  const hasChanges = created > 0 || updated > 0;
  const hasIncidents = ambiguous > 0 || rejected > 0;

  let status = 'up_to_date';
  let outcome = 'NO_CHANGES';
  if (ambiguous > 0) {
    status = 'requires_review';
    outcome = 'NEEDS_REVIEW';
  } else if (hasChanges) {
    status = 'updates_available';
    outcome = 'UPDATES_AVAILABLE';
  } else if (rejected > 0) {
    status = 'requires_review';
    outcome = 'HAS_REJECTED';
  }

  return {
    hasChanges,
    hasIncidents,
    status,
    outcome,
    summary: {
      created,
      updated,
      unchanged: totals.unchanged || 0,
      ambiguous,
      rejected,
    },
  };
}

function metaOf(item) {
  return {
    name: item.name,
    itemId: item.id,
    eTag: item.eTag,
    lastModifiedDateTime: item.lastModifiedDateTime,
    size: item.size,
    webUrl: item.webUrl,
  };
}

export async function selectEquidadFdmExcelFromSharePointFolder(rootPath, configuredFileName) {
  const path = assertEquidadFdmExcelSharePointPath(rootPath);
  const listed = await listFolder(path, { top: 200 });
  const children = listed.children || [];

  const candidates = [];
  const ignored = [];
  for (const c of children) {
    if (c.folder) {
      ignored.push({ reason: 'FOLDER', name: c.name });
      continue;
    }
    if (isTempOfficeExcelName(c.name)) {
      ignored.push({ reason: 'TEMP_OFFICE', name: c.name });
      continue;
    }
    if (!isAcceptedEquidadFdmExcelName(c.name)) {
      ignored.push({ reason: 'NOT_XLSX', name: c.name });
      continue;
    }
    candidates.push(metaOf(c));
  }

  const wanted = String(configuredFileName || '').trim().toLowerCase();
  if (wanted) {
    const exact = candidates.filter((c) => String(c.name || '').toLowerCase() === wanted);
    if (exact.length === 1) {
      return { ok: true, selected: exact[0], candidates, ignored, path };
    }
    if (exact.length === 0) {
      return {
        ok: false,
        code: 'CONFIGURED_EXCEL_NOT_FOUND',
        selected: null,
        candidates,
        ignored,
        path,
      };
    }
  }

  if (candidates.length === 0) {
    return { ok: false, code: 'NO_EXCEL_FOUND', selected: null, candidates, ignored, path };
  }
  if (candidates.length > 1 && !wanted) {
    return {
      ok: false,
      code: 'MULTIPLE_EXCEL_FILES_FOUND',
      selected: null,
      candidates,
      ignored,
      path,
    };
  }
  return { ok: true, selected: candidates[0], candidates, ignored, path };
}

function indexarCasosFdm(existentes) {
  const indice = new Map();
  for (const doc of existentes) {
    for (const clave of clavesDeduplicacionFdm(doc)) {
      if (!indice.has(clave)) indice.set(clave, []);
      indice.get(clave).push(doc);
    }
  }
  return indice;
}

function colapsarCandidatosFdm(docs = []) {
  const grupos = [];
  for (const doc of docs) {
    const grupo = grupos.find((g) => sonElMismoCasoFdm(g[0], doc));
    if (grupo) grupo.push(doc);
    else grupos.push([doc]);
  }
  return grupos;
}

function keeperDeGrupoFdm(grupo = []) {
  return grupo.reduce((acc, doc) => elegirKeeperFdm(acc, doc));
}

function localizarCasoFdm(fila, indice, existentes, eventoPreferido) {
  const payload = {
    ...fila,
    evento: fila.evento || eventoPreferido,
  };
  const claves = clavesDeduplicacionFdm(payload);
  const hits = new Map();
  for (const clave of claves) {
    for (const doc of indice.get(clave) || []) {
      hits.set(String(doc._id), doc);
    }
  }
  let list = [...hits.values()];
  if (list.length === 0) {
    list = existentes.filter((c) => sonElMismoCasoFdm(payload, c));
  }

  if (list.length === 0) return { action: 'CREATE' };

  const grupos = colapsarCandidatosFdm(list);
  if (grupos.length === 1) {
    return { action: 'MATCH', caso: keeperDeGrupoFdm(grupos[0]) };
  }

  const terr = grupos.filter((g) => eventoClaveFdm(g[0]).includes('TERREMOTO'));
  if (terr.length === 1) return { action: 'MATCH', caso: keeperDeGrupoFdm(terr[0]) };

  return { action: 'AMBIGUOUS', casos: grupos.map((g) => keeperDeGrupoFdm(g)) };
}

function pareceDireccionAjustador(valor) {
  const s = String(valor || '').trim();
  if (!s) return false;
  if (/\(sistema\s*osiris\)/i.test(s)) return true;
  if (/^(CLL|CRA|CR |CALLE|CARRERA|MZ|MANZANA|SUBA|DIAG|AV |AVENIDA|TRANSVERSAL|TV )/i.test(s)) {
    return true;
  }
  // Direcciones típicas: contienen # y números, sin parecer nombre de persona
  if (/#\s*\d/.test(s) && !/\b(TAPIA|GARCIA|PINILLA|MORENO|ESCALANTE)\b/i.test(s)) return true;
  return false;
}

function diffInbound(fila, caso) {
  const changes = {};
  for (const field of FDM_EXCEL_INBOUND_FIELDS) {
    if (!(field in fila) || fila[field] == null || fila[field] === '') continue;
    // No importar direcciones/basura a la columna Ajustador.
    if (field === 'ajustador' && pareceDireccionAjustador(fila[field])) continue;
    if (!valuesEqual(fila[field], caso?.[field])) {
      changes[field] = { from: caso?.[field] ?? null, to: fila[field] };
    }
  }
  return changes;
}

/**
 * Construye sesión preview a partir de filas parseadas.
 */
export async function previewEquidadFdmExcelImport({
  casos = [],
  fileName = '',
  source = 'sharepoint',
  eTag,
  itemId,
  driveId,
  path,
} = {}) {
  const cfg = getEquidadFdmExcelSharePointConfig();
  const existentes = await EquidadFdmCaso.find().lean();
  const indice = indexarCasosFdm(existentes);

  const totals = { created: 0, updated: 0, unchanged: 0, ambiguous: 0, rejected: 0 };
  const rows = [];

  for (let i = 0; i < casos.length; i += 1) {
    const fila = casos[i] || {};
    const sinIdentidad =
      (!fila.nombre || fila.nombre === 'SIN NOMBRE') &&
      !fila.cedula &&
      !fila.direccionAfectada &&
      !fila.celular;
    if (sinIdentidad) {
      totals.rejected += 1;
      rows.push({
        excelRow: i + 2,
        action: 'REJECTED',
        reason: 'Sin nombre/cédula/dirección',
        payload: fila,
      });
      continue;
    }

    const match = localizarCasoFdm(fila, indice, existentes, cfg.eventoPreferido);
    if (match.action === 'AMBIGUOUS') {
      totals.ambiguous += 1;
      rows.push({
        excelRow: i + 2,
        action: 'AMBIGUOUS',
        nombre: fila.nombre,
        cedula: fila.cedula,
        candidatos: match.casos.map((c) => ({
          id: String(c._id),
          consecutivo: c.consecutivo,
          cedula: c.cedula,
        })),
        payload: fila,
      });
      continue;
    }

    if (match.action === 'CREATE') {
      totals.created += 1;
      rows.push({
        excelRow: i + 2,
        action: 'CREATE',
        nombre: fila.nombre,
        cedula: fila.cedula,
        payload: { ...fila, evento: fila.evento || cfg.eventoPreferido },
      });
      continue;
    }

    const changes = diffInbound(fila, match.caso);
    if (Object.keys(changes).length === 0) {
      totals.unchanged += 1;
      rows.push({
        excelRow: i + 2,
        action: 'UNCHANGED',
        casoId: String(match.caso._id),
        consecutivo: match.caso.consecutivo,
        nombre: fila.nombre,
        cedula: fila.cedula,
      });
    } else {
      totals.updated += 1;
      rows.push({
        excelRow: i + 2,
        action: 'UPDATE',
        casoId: String(match.caso._id),
        consecutivo: match.caso.consecutivo,
        nombre: fila.nombre,
        cedula: fila.cedula,
        changes,
        payload: fila,
      });
    }
  }

  const session = await EquidadFdmExcelImportSession.create({
    source,
    fileName,
    status: 'preview',
    eTag,
    itemId,
    driveId,
    path,
    totals,
    rows,
  });

  return session.toObject();
}

export async function executeEquidadFdmExcelImport(
  sessionId,
  { usuario, excelRows } = {}
) {
  const session = await EquidadFdmExcelImportSession.findById(sessionId);
  if (!session) {
    const err = new Error('Sesión de importación no encontrada');
    err.code = 'SESSION_NOT_FOUND';
    throw err;
  }
  if (session.status === 'executed') {
    return { alreadyExecuted: true, session: session.toObject() };
  }

  const selectedSet =
    Array.isArray(excelRows) && excelRows.length > 0
      ? new Set(excelRows.map((n) => Number(n)).filter((n) => Number.isFinite(n)))
      : null;

  const applicable = (session.rows || []).filter((r) => {
    if (r.action !== 'CREATE' && r.action !== 'UPDATE') return false;
    if (!r.payload) return false;
    if (selectedSet && !selectedSet.has(Number(r.excelRow))) return false;
    return true;
  });

  if (selectedSet && applicable.length === 0) {
    const err = new Error('No hay filas seleccionadas para aplicar');
    err.code = 'NO_ROWS_SELECTED';
    throw err;
  }

  const toApply = applicable.map((r) => {
    const payload = { ...(r.payload || {}) };
    // Defensa: el Excel no debe empujar estado ni liquidación a ARNALD.
    delete payload.estado;
    delete payload.liquidador;
    delete payload.perdidaContenidos;
    delete payload.perdidaEdificio;
    delete payload.totalPerdida;
    delete payload.deducible;
    delete payload.subsidio;
    delete payload.totalLiquidado;
    delete payload.valorIndemnizadoAjustador;
    delete payload.valorIndemnizado;
    delete payload.fechaLiquidacion;
    delete payload.fechaGiro;
    return payload;
  });
  const resumen = await ejecutarImportacionFdm(toApply);

  session.status = 'executed';
  session.executedAt = new Date();
  session.executedBy = usuario || null;
  session.executedExcelRows = applicable.map((r) => r.excelRow);
  await session.save();

  return {
    alreadyExecuted: false,
    session: session.toObject(),
    resumen,
    appliedRows: applicable.length,
  };
}

async function getOrCreateSource() {
  const cfg = getEquidadFdmExcelSharePointConfig();
  let source = await EquidadFdmExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  });
  if (!source) {
    source = await EquidadFdmExcelSharePointSource.create({
      integrationKey: cfg.integrationKey,
      path: cfg.rootPath,
      fileName: cfg.fileName,
      status: 'idle',
    });
  }
  return source;
}

/**
 * Ciclo de detección SharePoint → preview (nunca execute).
 */
export async function runEquidadFdmExcelSharePointDetectCycle({ force = false } = {}) {
  const cfg = getEquidadFdmExcelSharePointConfig();
  const source = await getOrCreateSource();
  source.lastCheckedAt = new Date();

  try {
    const selection = await selectEquidadFdmExcelFromSharePointFolder(
      cfg.rootPath,
      cfg.fileName
    );
    source.candidates = selection.candidates || [];
    source.path = selection.path || cfg.rootPath;

    if (!selection.ok) {
      source.status = 'error';
      source.lastOutcome = selection.code;
      source.lastError = selection.code;
      source.hasChanges = false;
      await source.save();
      return {
        outcome: selection.code,
        status: source.status,
        hasChanges: false,
        source: source.toObject(),
      };
    }

    const selected = selection.selected;
    const meta = await getItemMetadata(selected.itemId);
    const eTag = meta.eTag || selected.eTag;
    const { driveId: resolvedDriveId } = await resolveDriveContext();
    source.fileName = meta.name || selected.name;
    source.itemId = meta.id || selected.itemId;
    source.eTag = eTag;
    source.driveId = resolvedDriveId;
    source.lastModifiedDateTime = meta.lastModifiedDateTime
      ? new Date(meta.lastModifiedDateTime)
      : null;
    source.size = meta.size;
    source.webUrl = meta.webUrl || selected.webUrl;
    source.lastDetectedEtag = eTag;
    source.lastDetectedAt = new Date();

    if (!force && eTag && eTag === source.lastArnaldWrittenEtag) {
      source.lastOutcome = 'SKIP_ARNALD_GENERATED_VERSION';
      source.status = source.hasChanges ? source.status : 'up_to_date';
      await source.save();
      return {
        outcome: 'SKIP_ARNALD_GENERATED_VERSION',
        status: source.status,
        hasChanges: source.hasChanges,
        source: source.toObject(),
      };
    }

    if (!force && eTag && eTag === source.lastPreviewedEtag && source.lastPreviewSessionId) {
      source.lastOutcome = 'SKIP_ALREADY_PREVIEWED';
      await source.save();
      return {
        outcome: 'SKIP_ALREADY_PREVIEWED',
        status: source.status,
        hasChanges: source.hasChanges,
        source: source.toObject(),
      };
    }

    const driveId = source.driveId;
    const downloaded = await downloadDriveItemBuffer({
      driveId,
      itemId: source.itemId,
    });
    const buffer = downloaded?.buffer || downloaded;
    const parsed = parsearCasosFdmDesdeBuffer(buffer, source.fileName);
    const session = await previewEquidadFdmExcelImport({
      casos: parsed.casos,
      fileName: source.fileName,
      source: 'sharepoint',
      eTag,
      itemId: source.itemId,
      driveId,
      path: source.path,
    });

    const ui = computeUiFromTotals(session.totals);
    source.lastPreviewedEtag = eTag;
    source.lastPreviewSessionId = session._id;
    source.lastSuccessfulCheckAt = new Date();
    source.hasChanges = ui.hasChanges;
    source.hasIncidents = ui.hasIncidents;
    source.status = ui.status;
    source.lastOutcome = ui.outcome;
    source.summary = ui.summary;
    source.lastError = null;

    const nKey = notifyKey(source.itemId, eTag);
    if (ui.hasChanges || ui.hasIncidents) {
      if (source.notification?.sentForKey !== nKey) {
        source.notification = {
          pending: true,
          sentForKey: nKey,
          message: ui.hasChanges
            ? 'Hay actualizaciones en el Excel de SEGUROS EQUIDAD'
            : 'El Excel de Equidad requiere revisión',
          createdAt: new Date(),
          dismissedAt: null,
        };
      }
    }

    await source.save();
    return {
      outcome: ui.outcome,
      status: ui.status,
      hasChanges: ui.hasChanges,
      source: source.toObject(),
      sessionId: String(session._id),
    };
  } catch (error) {
    source.status = 'error';
    source.lastOutcome = 'ERROR';
    source.lastError = error.message || String(error);
    await source.save();
    return {
      outcome: 'ERROR',
      status: 'error',
      hasChanges: false,
      error: source.lastError,
      source: source.toObject(),
    };
  }
}

export async function getEquidadFdmExcelSharePointStatus() {
  const source = await getOrCreateSource();
  return { source: source.toObject() };
}

export async function dismissEquidadFdmExcelSharePointNotification() {
  const source = await getOrCreateSource();
  if (source.notification) {
    source.notification.pending = false;
    source.notification.dismissedAt = new Date();
  }
  await source.save();
  return { source: source.toObject() };
}

export async function markEquidadFdmExcelSharePointExecuted(sessionId) {
  const source = await getOrCreateSource();
  const session = await EquidadFdmExcelImportSession.findById(sessionId).lean();
  const allApplicable = (session?.rows || []).filter(
    (r) => r.action === 'CREATE' || r.action === 'UPDATE'
  );
  const applied = Array.isArray(session?.executedExcelRows)
    ? session.executedExcelRows.map(Number)
    : allApplicable.map((r) => Number(r.excelRow));
  const appliedSet = new Set(applied);
  const partial =
    allApplicable.length > 0 &&
    allApplicable.some((r) => !appliedSet.has(Number(r.excelRow)));

  if (partial) {
    // Quedan filas por aplicar: no cerrar el eTag para que un nuevo detect las vuelva a listar.
    source.hasChanges = true;
    source.status = 'updates_available';
    source.lastOutcome = 'EXECUTED_PARTIAL';
    source.lastPreviewSessionId = null;
    source.lastPreviewedEtag = null;
    source.lastSyncAt = new Date();
    if (source.notification) {
      source.notification.pending = true;
      source.notification.message =
        'Aplicación parcial: quedan cambios del Excel por revisar';
      source.notification.dismissedAt = null;
    }
    await source.save();
    return source.toObject();
  }

  if (session?.eTag) {
    source.lastExecutedEtag = session.eTag;
    source.lastProcessedEtag = session.eTag;
  }
  source.lastSuccessfulSessionId = sessionId;
  source.lastSyncAt = new Date();
  source.hasChanges = false;
  source.status = 'up_to_date';
  source.lastOutcome = 'EXECUTED';
  if (source.notification) {
    source.notification.pending = false;
    source.notification.dismissedAt = new Date();
  }
  await source.save();
  return source.toObject();
}

export async function getEquidadFdmExcelImportSession(sessionId) {
  const session = await EquidadFdmExcelImportSession.findById(sessionId).lean();
  if (!session) {
    const err = new Error('Sesión no encontrada');
    err.code = 'SESSION_NOT_FOUND';
    throw err;
  }
  return session;
}
