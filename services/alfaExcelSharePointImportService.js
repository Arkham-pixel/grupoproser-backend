/**
 * Detección automática Excel Alfa SharePoint → preview incremental.
 * NUNCA llama executeAlfaExcelImport.
 */

import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import {
  resolveDriveContext,
  listFolder,
  getItemMetadata,
  downloadDriveItemBuffer,
} from './microsoftGraphService.js';
import {
  assertAlfaExcelSharePointPath,
  isAcceptedAlfaExcelName,
  isAlfaExcelFinalProtectedName,
  isTempOfficeExcelName,
  toAlfaExcelOperationalFileName,
} from '../utils/alfaExcelSharePointPath.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import { previewAlfaExcelImport } from './alfaExcelImportService.js';

function notifyKey(itemId, eTag) {
  return `${itemId || ''}::${eTag || ''}`;
}

function computeUiFromTotals(totals = {}, insights = {}) {
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

  const summary = {
    created,
    updated,
    unchanged: totals.unchanged || 0,
    ambiguous,
    rejected,
    claimNumberAssignments: insights.claimNumberAssignments || 0,
    policyNumberUpdates: insights.policyNumberUpdates ?? 0,
    placeholderPolicyToReal:
      insights.placeholderPolicyToReal ?? insights.policyPlaceholderToReal ?? 0,
    protectedFieldsIgnored: insights.protectedFieldsIgnored || 0,
    possibleExistingDuplicates: insights.possibleExistingDuplicates || 0,
  };

  return { hasChanges, hasIncidents, status, outcome, summary };
}

async function enrichPolicyNumberUpdates(importId) {
  if (!importId) return 0;
  const rows = await AlfaExcelImportRow.find({
    importId,
    action: 'UPDATED',
    'changes.numeroPoliza': { $exists: true },
  })
    .select('_id')
    .lean();
  return rows.length;
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

/**
 * Selección segura del Excel fuente (sin descarga).
 */
export async function selectAlfaExcelFromSharePointFolder(rootPath, configuredFileName) {
  const path = assertAlfaExcelSharePointPath(rootPath);
  const listed = await listFolder(path, { top: 200 });
  const children = listed.children || [];

  const candidates = [];
  const ignored = [];
  for (const c of children) {
    if (c.folder) {
      ignored.push({ reason: 'FOLDER', name: c.name });
      continue;
    }
    const name = c.name || '';
    if (isTempOfficeExcelName(name)) {
      ignored.push({ reason: 'TEMP_OFFICE', name, itemId: c.id });
      continue;
    }
    if (!isAcceptedAlfaExcelName(name)) {
      ignored.push({ reason: 'NOT_XLSX_XLS', name, itemId: c.id });
      continue;
    }
    // Copia humana de revisión: ARNALD no la selecciona nunca
    if (isAlfaExcelFinalProtectedName(name)) {
      ignored.push({ reason: 'FINAL_PROTECTED', name, itemId: c.id });
      continue;
    }
    if (!c.size || Number(c.size) === 0) {
      ignored.push({ reason: 'ZERO_SIZE', name, itemId: c.id });
      continue;
    }
    candidates.push(metaOf(c));
  }

  // Si .env tenía *_Final.xlsx, usar el operativo sin _Final
  const configured = toAlfaExcelOperationalFileName(configuredFileName);
  if (configured) {
    const hit = candidates.find((x) => x.name === configured);
    if (!hit) {
      return {
        outcome: 'CONFIGURED_EXCEL_NOT_FOUND',
        selected: null,
        candidates,
        ignored,
        path,
        configuredFileName: configured,
      };
    }
    return {
      outcome: 'SELECTED_BY_CONFIG',
      selected: hit,
      candidates,
      ignored,
      path,
      configuredFileName: configured,
    };
  }

  if (candidates.length === 1) {
    return {
      outcome: 'SELECTED_SINGLE_EXCEL',
      selected: candidates[0],
      candidates,
      ignored,
      path,
    };
  }
  if (candidates.length === 0) {
    return { outcome: 'NO_EXCEL_FOUND', selected: null, candidates, ignored, path };
  }
  return {
    outcome: 'MULTIPLE_EXCEL_FILES_FOUND',
    selected: null,
    candidates,
    ignored,
    path,
  };
}

async function getOrCreateSource(cfg) {
  let doc = await AlfaExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  });
  if (!doc) {
    doc = await AlfaExcelSharePointSource.create({
      integrationKey: cfg.integrationKey,
      path: cfg.rootPath,
      status: 'idle',
    });
  }
  return doc;
}

function maybeQueueNotification(doc, { previousStatus, nextStatus, itemId, eTag }) {
  if (previousStatus === 'up_to_date' && nextStatus === 'updates_available') {
    const key = notifyKey(itemId, eTag);
    if (doc.notification?.sentForKey === key) return;
    doc.notification = {
      pending: true,
      sentForKey: key,
      message: 'Hay nuevas actualizaciones de Seguros Alfa',
      createdAt: new Date(),
      dismissedAt: null,
    };
  }
}

function logSp(event, payload = {}) {
  console.log(
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...payload,
    })
  );
}

/**
 * Un ciclo de detección + preview (sin execute).
 */
export async function runAlfaExcelSharePointDetectCycle({ force = false } = {}) {
  const cfg = getAlfaExcelSharePointImportConfig();
  const started = Date.now();
  const source = await getOrCreateSource(cfg);
  const previousStatus = source.status;

  source.lastCheckedAt = new Date();
  source.path = cfg.rootPath;

  logSp('ALFA_EXCEL_SP_CHECK_STARTED', {
    force: Boolean(force),
    path: cfg.rootPath,
    fileName: cfg.fileName || null,
    previousStatus,
    previousEtag: source.lastPreviewedEtag || null,
  });

  try {
    assertAlfaExcelSharePointPath(cfg.rootPath);
    const ctx = await resolveDriveContext();
    const selection = await selectAlfaExcelFromSharePointFolder(
      cfg.rootPath,
      cfg.fileName
    );

    if (
      selection.outcome === 'MULTIPLE_EXCEL_FILES_FOUND' ||
      selection.outcome === 'CONFIGURED_EXCEL_NOT_FOUND' ||
      selection.outcome === 'NO_EXCEL_FOUND'
    ) {
      source.status = 'error';
      source.lastOutcome = selection.outcome;
      source.lastError = selection.outcome;
      source.candidates = selection.candidates;
      source.hasChanges = false;
      await source.save();
      logSp('ALFA_EXCEL_SP_ERROR', {
        outcome: selection.outcome,
        candidates: (selection.candidates || []).map((c) => c.name),
      });
      return {
        outcome: selection.outcome,
        status: 'error',
        candidates: selection.candidates,
        durationMs: Date.now() - started,
        source: toPublicSource(source),
      };
    }

    const selected = selection.selected;
    const meta = await getItemMetadata(selected.itemId);
    source.driveId = ctx.driveId;
    source.itemId = meta.id;
    source.fileName = meta.name;
    source.eTag = meta.eTag;
    source.lastModifiedDateTime = meta.lastModifiedDateTime
      ? new Date(meta.lastModifiedDateTime)
      : null;
    source.size = meta.size;
    source.webUrl = meta.webUrl;
    source.lastDetectedEtag = meta.eTag;
    source.lastDetectedAt = new Date();
    source.candidates = [];

    // Anti-loop: versión escrita por ARNALD outbound (antes del skip genérico).
    // No borrar un preview pendiente (p. ej. 90 CREATED) solo porque outbound
    // reescribió el mismo etag: el banner quedaría en "sin pendientes" con falso.
    if (
      !force &&
      source.lastArnaldWrittenEtag &&
      source.lastArnaldWrittenEtag === meta.eTag
    ) {
      const keepPendingReview =
        Boolean(source.lastPreviewImportId) &&
        (source.status === 'updates_available' ||
          source.status === 'requires_review' ||
          source.hasChanges === true ||
          source.hasIncidents === true);

      source.eTag = meta.eTag;
      source.lastDetectedEtag = meta.eTag;
      source.lastOutcome = 'SKIP_ARNALD_GENERATED_VERSION';
      source.lastSuccessfulCheckAt = new Date();
      source.lastError = null;

      if (!keepPendingReview) {
        source.lastPreviewedEtag = meta.eTag;
        source.hasChanges = false;
        source.hasIncidents = false;
        source.status = 'up_to_date';
        if (source.notification) source.notification.pending = false;
      }

      await source.save();
      logSp('SKIP_ARNALD_GENERATED_VERSION', {
        itemId: meta.id,
        eTag: meta.eTag,
        lastArnaldWrittenEtag: source.lastArnaldWrittenEtag,
        keepPendingReview,
        status: source.status,
        durationMs: Date.now() - started,
      });
      return {
        outcome: 'SKIP_ARNALD_GENERATED_VERSION',
        status: source.status,
        hasChanges: source.hasChanges,
        hasIncidents: source.hasIncidents,
        summary: source.summary,
        importSessionId: source.lastPreviewImportId
          ? String(source.lastPreviewImportId)
          : null,
        durationMs: Date.now() - started,
        source: toPublicSource(source),
      };
    }

    const already =
      !force &&
      source.lastPreviewedEtag &&
      source.lastPreviewedEtag === meta.eTag &&
      source.itemId === meta.id &&
      source.lastPreviewImportId;

    if (already) {
      source.lastOutcome = 'SKIP_ALREADY_PREVIEWED';
      source.lastSuccessfulCheckAt = new Date();
      source.lastError = null;
      // Mantener status de negocio (up_to_date / updates_available / …),
      // pero salir de 'error' si Graph ya respondió bien (etag sin cambios).
      if (source.status === 'error') {
        if (source.hasIncidents) source.status = 'requires_review';
        else if (source.hasChanges) source.status = 'updates_available';
        else source.status = 'up_to_date';
      }
      await source.save();
      logSp('ALFA_EXCEL_SP_ETAG_UNCHANGED', {
        itemId: meta.id,
        eTag: meta.eTag,
        status: source.status,
        importSessionId: source.lastPreviewImportId
          ? String(source.lastPreviewImportId)
          : null,
        durationMs: Date.now() - started,
      });
      return {
        outcome: 'SKIP_ALREADY_PREVIEWED',
        status: source.status,
        hasChanges: source.hasChanges,
        summary: source.summary,
        importSessionId: source.lastPreviewImportId
          ? String(source.lastPreviewImportId)
          : null,
        durationMs: Date.now() - started,
        source: toPublicSource(source),
      };
    }

    logSp('ALFA_EXCEL_SP_NEW_VERSION', {
      itemId: meta.id,
      eTag: meta.eTag,
      previousEtag: source.lastPreviewedEtag || null,
      size: meta.size,
    });

    // Descargar + preview
    const downloaded = await downloadDriveItemBuffer({
      driveId: ctx.driveId,
      itemId: meta.id,
    });

    const preview = await previewAlfaExcelImport({
      buffer: downloaded.buffer,
      fileName: meta.name,
      mimeType:
        downloaded.mimeType ||
        meta.file?.mimeType ||
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      user: {
        id: 'sharepoint-cron',
        login: 'sharepoint-cron',
        nombre: 'Alfa Excel SharePoint detector',
      },
      source: 'sharepoint',
    });

    const policyNumberUpdates = await enrichPolicyNumberUpdates(preview.importSessionId);
    const totals = {
      created: preview.created || 0,
      updated: preview.updated || 0,
      unchanged: preview.unchanged || 0,
      ambiguous: preview.ambiguous || 0,
      rejected: preview.rejected || 0,
      rows: preview.totalRows || 0,
    };
    const insights = {
      ...(preview.insights || {}),
      policyNumberUpdates,
    };
    const computed = computeUiFromTotals(totals, insights);

    source.lastPreviewedEtag = meta.eTag;
    source.lastProcessedEtag = meta.eTag;
    source.lastPreviewImportId = preview.importSessionId;
    source.hasChanges = computed.hasChanges;
    source.hasIncidents = computed.hasIncidents;
    source.summary = { ...computed.summary, totalRows: totals.rows };
    source.status = computed.status;
    source.lastOutcome = computed.outcome;
    source.lastError = null;
    source.lastSuccessfulCheckAt = new Date();

    maybeQueueNotification(source, {
      previousStatus,
      nextStatus: computed.status,
      itemId: meta.id,
      eTag: meta.eTag,
    });

    await source.save();

    logSp('ALFA_EXCEL_SP_PREVIEW_READY', {
      importSessionId: String(preview.importSessionId),
      eTag: meta.eTag,
      hasChanges: computed.hasChanges,
      status: computed.status,
      summary: source.summary,
    });
    if (computed.hasChanges) {
      logSp('ALFA_EXCEL_SP_UPDATES_AVAILABLE', {
        importSessionId: String(preview.importSessionId),
        created: totals.created,
        updated: totals.updated,
      });
    } else if (!computed.hasIncidents) {
      logSp('ALFA_EXCEL_SP_NO_CHANGES', {
        importSessionId: String(preview.importSessionId),
        unchanged: totals.unchanged,
      });
    }

    // Adjuntar sharepoint meta a la sesión de import
    try {
      await AlfaExcelImport.findByIdAndUpdate(preview.importSessionId, {
        $set: {
          warnings: [
            ...(preview.warnings || []),
            `SHAREPOINT_ITEM:${meta.id}`,
            `SHAREPOINT_ETAG:${meta.eTag}`,
          ],
        },
      });
    } catch {
      /* no crítico */
    }

    return {
      outcome: computed.outcome,
      status: computed.status,
      hasChanges: computed.hasChanges,
      hasIncidents: computed.hasIncidents,
      summary: source.summary,
      importSessionId: String(preview.importSessionId),
      fileMeta: {
        fileName: meta.name,
        itemId: meta.id,
        eTag: meta.eTag,
        lastModifiedDateTime: meta.lastModifiedDateTime,
        size: meta.size,
        sourcePath: cfg.rootPath,
      },
      durationMs: Date.now() - started,
      source: toPublicSource(source),
    };
  } catch (error) {
    const keepPendingReview =
      Boolean(source.lastPreviewImportId) &&
      (previousStatus === 'updates_available' ||
        previousStatus === 'requires_review' ||
        source.hasChanges === true ||
        source.hasIncidents === true);

    // Fallo temporal de Graph/auth: no borrar un preview pendiente válido
    if (keepPendingReview) {
      source.lastError = error.message || String(error);
      source.lastOutcome = 'ERROR_TRANSIENT';
      source.lastCheckedAt = new Date();
      // conservar status / hasChanges / summary del preview previo
      await source.save();
      logSp('ALFA_EXCEL_SP_ERROR_TRANSIENT_KEEP_PENDING', {
        code: error.code || 'SHAREPOINT_EXCEL_DETECT_ERROR',
        message: source.lastError,
        keptStatus: source.status,
        durationMs: Date.now() - started,
      });
      return {
        outcome: 'ERROR_TRANSIENT',
        status: source.status,
        hasChanges: source.hasChanges,
        hasIncidents: source.hasIncidents,
        summary: source.summary,
        error: source.lastError,
        code: error.code || 'SHAREPOINT_EXCEL_DETECT_ERROR',
        importSessionId: source.lastPreviewImportId
          ? String(source.lastPreviewImportId)
          : null,
        durationMs: Date.now() - started,
        source: toPublicSource(source),
      };
    }

    source.status = 'error';
    source.lastOutcome = 'ERROR';
    source.lastError = error.message || String(error);
    source.hasChanges = false;
    await source.save();
    logSp('ALFA_EXCEL_SP_ERROR', {
      code: error.code || 'SHAREPOINT_EXCEL_DETECT_ERROR',
      message: source.lastError,
      durationMs: Date.now() - started,
    });
    return {
      outcome: 'ERROR',
      status: 'error',
      error: source.lastError,
      code: error.code || 'SHAREPOINT_EXCEL_DETECT_ERROR',
      durationMs: Date.now() - started,
      source: toPublicSource(source),
    };
  }
}

export function toPublicSource(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    integrationKey: o.integrationKey,
    path: o.path,
    fileName: o.fileName,
    itemId: o.itemId,
    eTag: o.eTag,
    lastModifiedDateTime: o.lastModifiedDateTime,
    size: o.size,
    webUrl: o.webUrl,
    status: o.status,
    lastOutcome: o.lastOutcome,
    lastError: o.lastError,
    hasChanges: o.hasChanges,
    hasIncidents: o.hasIncidents,
    summary: o.summary,
    lastCheckedAt: o.lastCheckedAt,
    lastSuccessfulCheckAt: o.lastSuccessfulCheckAt,
    lastDetectedAt: o.lastDetectedAt,
    lastSyncAt: o.lastSyncAt,
    lastPreviewImportId: o.lastPreviewImportId
      ? String(o.lastPreviewImportId)
      : null,
    lastSuccessfulImportId: o.lastSuccessfulImportId
      ? String(o.lastSuccessfulImportId)
      : null,
    lastPreviewedEtag: o.lastPreviewedEtag,
    lastProcessedEtag: o.lastProcessedEtag,
    lastExecutedEtag: o.lastExecutedEtag,
    lastArnaldWrittenEtag: o.lastArnaldWrittenEtag || null,
    notification: o.notification
      ? {
          pending: Boolean(o.notification.pending),
          message: o.notification.message || null,
          createdAt: o.notification.createdAt || null,
        }
      : { pending: false, message: null, createdAt: null },
    candidates: o.candidates || [],
  };
}

/**
 * Estado para UI (sin forzar ciclo).
 */
export async function getAlfaExcelSharePointStatus() {
  const cfg = getAlfaExcelSharePointImportConfig();
  const source = await AlfaExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  }).lean();

  const publicSource = source
    ? toPublicSource(source)
    : {
        status: 'idle',
        hasChanges: false,
        hasIncidents: false,
        summary: null,
        lastCheckedAt: null,
        notification: { pending: false },
        message: 'Aún no se ha ejecutado detección',
      };

  const ui = buildUiPayload(publicSource);
  return {
    cronEnabled: cfg.cronEnabled,
    cronSchedule: cfg.cronSchedule,
    configuredFileName: cfg.fileName || null,
    rootPath: cfg.rootPath,
    ...ui,
    source: publicSource,
  };
}

function buildUiPayload(source) {
  const status = source?.status || 'idle';
  const summary = source?.summary || {};
  let headline = 'Control y Seguimiento';
  let detail = '';
  let tone = 'neutral';

  if (status === 'error') {
    headline = '⚠ No fue posible consultar Control y Seguimiento';
    detail = source.lastError || 'Error de SharePoint / Graph';
    tone = 'error';
  } else if (status === 'requires_review') {
    headline = '⚠ Hay registros que requieren revisión';
    detail = `${summary.ambiguous || 0} ambiguos · ${summary.rejected || 0} rechazados`;
    tone = 'warning';
  } else if (status === 'updates_available') {
    headline = '● Hay actualizaciones de Seguros Alfa';
    detail = `${summary.updated || 0} actualizados · ${summary.created || 0} nuevos`;
    tone = 'info';
  } else if (status === 'up_to_date') {
    headline = '✓ Control y Seguimiento actualizado';
    detail = 'Sin actualizaciones pendientes';
    tone = 'ok';
  } else {
    headline = 'Control y Seguimiento — Seguros Alfa';
    detail = 'Esperando primera revisión automática';
    tone = 'neutral';
  }

  return {
    uiStatus: status,
    headline,
    detail,
    tone,
    hasChanges: Boolean(source?.hasChanges),
    hasIncidents: Boolean(source?.hasIncidents),
    canReview: Boolean(
      source?.lastPreviewImportId &&
        (status === 'updates_available' || status === 'requires_review')
    ),
    canConfirm: Boolean(
      source?.lastPreviewImportId &&
        (status === 'updates_available' || status === 'requires_review') &&
        source?.hasChanges
    ),
    lastCheckedAt: source?.lastSuccessfulCheckAt || source?.lastCheckedAt || null,
  };
}

export async function dismissAlfaExcelSharePointNotification() {
  const cfg = getAlfaExcelSharePointImportConfig();
  const source = await AlfaExcelSharePointSource.findOne({
    integrationKey: cfg.integrationKey,
  });
  if (!source) return { dismissed: false };
  if (source.notification) {
    source.notification.pending = false;
    source.notification.dismissedAt = new Date();
  }
  await source.save();
  return { dismissed: true };
}

/**
 * Tras execute manual exitoso: re-evaluar / marcar up_to_date.
 */
export async function markAlfaExcelSharePointExecuted({
  importSessionId,
  eTag,
} = {}) {
  const cfg = getAlfaExcelSharePointImportConfig();
  const source = await getOrCreateSource(cfg);
  if (importSessionId) {
    source.lastSuccessfulImportId = importSessionId;
  }
  if (eTag || source.lastPreviewedEtag) {
    source.lastExecutedEtag = eTag || source.lastPreviewedEtag;
  }
  source.lastSyncAt = new Date();
  source.hasChanges = false;
  source.status = 'up_to_date';
  source.lastOutcome = 'EXECUTED';
  source.lastError = null;
  if (source.notification) {
    source.notification.pending = false;
    source.notification.dismissedAt = new Date();
  }
  await source.save();
  return toPublicSource(source);
}
