/**
 * Importador Excel Seguros Alfa (preview / execute).
 * Acepta buffer desde HTTP, script o futuro SharePoint.
 */

import crypto from 'crypto';
import * as XLSX from 'xlsx';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import { getAlfaExcelImportConfig } from '../config/alfaExcelImport.js';
import {
  ALFA_EXCEL_UPDATABLE_FIELDS,
  ALFA_EXCEL_DATE_FIELDS,
  ALFA_EXCEL_MONEY_FIELDS,
  buildAlfaExcelHeaderLookup,
} from '../config/alfaExcelColumnMap.js';
import {
  normalizeExcelHeader,
  normalizeText,
  normalizeIdentification,
  normalizeClaimNumber,
  normalizeDate,
  normalizeMoney,
  normalizePolicyNumberFromExcel,
  valuesEqualForDiff,
  isPolicyPlaceholder,
  isMeaningfulExcelValue,
  normalizeCreditNumber,
} from '../utils/alfaExcelNormalize.js';
import { normalizePolicyNumber } from '../utils/alfaPolicyNumber.js';
import {
  createAlfaCasoFromImport,
  updateAlfaCasoFields,
  computeAlfaImportDiff,
  buildAlfaCasoPayload,
} from './alfaCasoService.js';
import {
  listAlfaCasosParaMatchExcel,
  restoreAlfaCasoFromRespaldoById,
} from './alfaCasosRespaldoService.js';
import {
  acquireAlfaExcelImportLock,
  releaseAlfaExcelImportLock,
} from './alfaExcelImportLockService.js';
import {
  associateAlfaPolicyDocument,
  enrichAlfaPolicyDocumentsForCase,
} from './alfaPolicyImportService.js';
import { onAlfaCasePolicyMaybeReady } from './alfaClaimDocumentEnqueueService.js';
import { isRealPolicyNumber } from '../utils/alfaIdentification.js';
import { recordAlfaClaimNumberAssigned } from '../models/AlfaClaimNumberAssignedEvent.js';

const HEADER_LOOKUP = buildAlfaExcelHeaderLookup();

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fail(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function normKeyId(v) {
  return normalizeIdentification(v) || '';
}

function normKeyClaim(v) {
  return normalizeClaimNumber(v) || '';
}

function normKeyPolicy(v) {
  return normalizePolicyNumber(v) || '';
}

function normKeyCredit(v) {
  return normalizeCreditNumber(v) || '';
}

function normKeyAddress(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function fechaKey(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return normalizeDate(v) || String(v).slice(0, 10);
}

function buildEvidence({
  siniestro = false,
  identificacion = false,
  numeroPoliza = false,
  numeroCredito = false,
  fechaSiniestro = false,
  direccionPredio = false,
} = {}) {
  return {
    siniestro,
    identificacion,
    numeroPoliza,
    numeroCredito,
    fechaSiniestro,
    direccionPredio,
  };
}

function matchResult(actionHint, cases, strategy, evidence) {
  return {
    actionHint,
    cases,
    strategy,
    matchStrategy: strategy,
    matchEvidence: evidence,
  };
}

/**
 * Matching antiduplicados incremental:
 * 1) siniestro
 * 2) identificacion + numeroPoliza (si póliza no placeholder)
 * 3) identificación + refuerzo cuando póliza ARNALD es placeholder o sin match
 * Nunca findOne({ numeroPoliza }) solo.
 */
export function matchAlfaCaseForExcelRow(payload, allCases) {
  const siniestro = normKeyClaim(payload.siniestro);
  const id = normKeyId(payload.identificacion);
  const polExcel = normKeyPolicy(payload.numeroPoliza);
  const polizaPareceDia =
    /^\d{1,2}$/.test(String(payload.numeroPoliza ?? '').trim()) &&
    Number(String(payload.numeroPoliza).trim()) >= 1 &&
    Number(String(payload.numeroPoliza).trim()) <= 31;
  const polExcelReal =
    polExcel && !isPolicyPlaceholder(payload.numeroPoliza) && !polizaPareceDia;
  const credit = normKeyCredit(payload.numeroCredito);
  const fecha = fechaKey(payload.fechaSiniestro);
  const dir = normKeyAddress(payload.direccionPredio);

  // NIVEL 1 — siniestro
  if (siniestro) {
    const bySin = allCases.filter((c) => normKeyClaim(c.siniestro) === siniestro);
    if (bySin.length === 1) {
      return matchResult('MATCH', bySin, 'SINIESTRO', buildEvidence({ siniestro: true }));
    }
    if (bySin.length > 1) {
      return matchResult('AMBIGUOUS', bySin, 'SINIESTRO', buildEvidence({ siniestro: true }));
    }
  }

  if (!id) {
    return matchResult('CREATE', [], 'CREATE', buildEvidence());
  }

  // NIVEL 2 — identificación + póliza real
  if (polExcelReal) {
    const byIdPol = allCases.filter(
      (c) =>
        normKeyId(c.identificacion) === id &&
        !isPolicyPlaceholder(c.numeroPoliza) &&
        normKeyPolicy(c.numeroPoliza) === polExcel
    );
    if (byIdPol.length === 1) {
      return matchResult(
        'MATCH',
        byIdPol,
        'IDENTIFICACION_POLIZA',
        buildEvidence({ identificacion: true, numeroPoliza: true })
      );
    }
    if (byIdPol.length > 1) {
      // refuerzo dentro de id+poliza
      let cands = byIdPol;
      if (credit) {
        const byC = cands.filter((c) => normKeyCredit(c.numeroCredito) === credit);
        if (byC.length === 1) {
          return matchResult(
            'MATCH',
            byC,
            'IDENTIFICACION_POLIZA',
            buildEvidence({
              identificacion: true,
              numeroPoliza: true,
              numeroCredito: true,
            })
          );
        }
        if (byC.length > 1) cands = byC;
      }
      if (dir) {
        const byDir = cands.filter((c) => normKeyAddress(c.direccionPredio) === dir);
        if (byDir.length === 1) {
          return matchResult(
            'MATCH',
            byDir,
            'IDENTIFICACION_POLIZA',
            buildEvidence({
              identificacion: true,
              numeroPoliza: true,
              direccionPredio: true,
            })
          );
        }
        if (byDir.length > 1) cands = byDir;
      }
      return matchResult(
        'AMBIGUOUS',
        cands,
        'IDENTIFICACION_POLIZA',
        buildEvidence({ identificacion: true, numeroPoliza: true })
      );
    }
  }

  // NIVEL 3 — por identificación + refuerzos (crédito / fecha / dirección)
  // Caso prioritario: póliza placeholder en ARNALD + póliza real en Excel.
  const byId = allCases.filter((c) => normKeyId(c.identificacion) === id);
  if (byId.length === 0) {
    return matchResult('CREATE', [], 'CREATE', buildEvidence({ identificacion: true }));
  }

  let pool = byId;
  let preferredPlaceholder = false;
  if (polExcelReal) {
    const withPlaceholder = byId.filter((c) => isPolicyPlaceholder(c.numeroPoliza));
    if (withPlaceholder.length > 0) {
      pool = withPlaceholder;
      preferredPlaceholder = true;
    }
  }

  const applied = {
    identificacion: true,
    numeroPoliza: false,
    numeroCredito: false,
    fechaSiniestro: false,
    direccionPredio: false,
  };

  // Refuerzo secuencial solo con campos presentes en el Excel
  if (credit) {
    const byCredit = pool.filter((c) => normKeyCredit(c.numeroCredito) === credit);
    if (byCredit.length > 0) {
      pool = byCredit;
      applied.numeroCredito = true;
    } else if (pool.length > 1) {
      // Varios casos misma id y el crédito no cuadra → no adivinar
      return matchResult(
        'AMBIGUOUS',
        pool,
        'IDENTIFICACION_CREDITO',
        buildEvidence({ ...applied, numeroCredito: false })
      );
    }
    // Un solo caso por id: el consolidado Excel actualiza ese caso aunque el crédito viejo difiera
  }

  if (fecha) {
    const byFecha = pool.filter((c) => fechaKey(c.fechaSiniestro) === fecha);
    if (byFecha.length > 0) {
      pool = byFecha;
      applied.fechaSiniestro = true;
    } else if (pool.length > 1) {
      return matchResult(
        'AMBIGUOUS',
        pool,
        'IDENTIFICACION_FECHA',
        buildEvidence({ ...applied, fechaSiniestro: false })
      );
    }
  }

  if (dir) {
    const byDir = pool.filter((c) => normKeyAddress(c.direccionPredio) === dir);
    if (byDir.length > 0) {
      pool = byDir;
      applied.direccionPredio = true;
    } else if (pool.length > 1) {
      return matchResult(
        'AMBIGUOUS',
        pool,
        'IDENTIFICACION_DIRECCION',
        buildEvidence({ ...applied, direccionPredio: false })
      );
    }
  }

  if (pool.length === 1) {
    const only = pool[0];
    const samePol =
      polExcelReal &&
      !isPolicyPlaceholder(only.numeroPoliza) &&
      normKeyPolicy(only.numeroPoliza) === polExcel;
    const placeholderTarget = isPolicyPlaceholder(only.numeroPoliza);

    // Regla duplicados Alfa: otra póliza real = otro caso (CREATE).
    // No fusionar dos pólizas reales distintas en el mismo registro.
    if (polExcelReal && !placeholderTarget && !samePol) {
      return matchResult(
        'CREATE',
        [],
        'CREATE_OTRA_POLIZA',
        buildEvidence({ identificacion: true })
      );
    }

    applied.numeroPoliza = samePol;
    let strategy = 'IDENTIFICACION_MULTI_FACTOR';
    if (samePol) strategy = 'IDENTIFICACION_POLIZA';
    else if (applied.numeroCredito && !applied.fechaSiniestro && !applied.direccionPredio) {
      strategy = 'IDENTIFICACION_CREDITO';
    } else if (applied.fechaSiniestro && !applied.numeroCredito && !applied.direccionPredio) {
      strategy = 'IDENTIFICACION_FECHA';
    } else if (applied.direccionPredio && !applied.numeroCredito && !applied.fechaSiniestro) {
      strategy = 'IDENTIFICACION_DIRECCION';
    } else if (placeholderTarget && polExcelReal) {
      strategy = applied.numeroCredito
        ? 'IDENTIFICACION_CREDITO'
        : 'IDENTIFICACION_MULTI_FACTOR';
    } else if (byId.length === 1) {
      strategy = 'IDENTIFICACION_UNICA';
    }

    return matchResult('MATCH', pool, strategy, buildEvidence(applied));
  }

  if (pool.length > 1) {
    return matchResult('AMBIGUOUS', pool, 'AMBIGUOUS', buildEvidence(applied));
  }

  // Hubo casos por id pero el refuerzo los eliminó → no CREATE (evitar duplicado)
  if (byId.length > 0) {
    return matchResult(
      'AMBIGUOUS',
      byId,
      'AMBIGUOUS',
      buildEvidence({ identificacion: true })
    );
  }

  return matchResult('CREATE', [], 'CREATE', buildEvidence({ identificacion: true }));
}

export function buildAlfaCaseDiff({ currentCase, incomingData, updatableFields }) {
  return computeAlfaImportDiff(incomingData, currentCase, updatableFields);
}

function cellToFieldValue(field, raw) {
  if (ALFA_EXCEL_DATE_FIELDS.includes(field)) return normalizeDate(raw);
  if (ALFA_EXCEL_MONEY_FIELDS.includes(field)) return normalizeMoney(raw);
  if (field === 'numeroPoliza') return normalizePolicyNumberFromExcel(raw);
  if (field === 'identificacion') return normalizeIdentification(raw);
  if (field === 'siniestro') return normalizeClaimNumber(raw);
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return normalizeText(raw);
}

function parseWorkbookToRows(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw fail('CORRUPT_FILE', 'Archivo Excel corrupto o ilegible', 400);
  }
  if (!workbook.SheetNames?.length) {
    throw fail('EMPTY_WORKBOOK', 'El archivo no contiene hojas válidas', 400);
  }

  const nombres = workbook.SheetNames;
  const orden = [];
  const bd = nombres.find((n) => normalizeExcelHeader(n) === 'BD');
  const pendientes = nombres.find((n) => normalizeExcelHeader(n) === 'PENDIENTES');
  if (bd) orden.push(bd);
  if (pendientes) orden.push(pendientes);
  nombres.forEach((n) => {
    if (!orden.includes(n)) orden.push(n);
  });

  for (const nombre of orden) {
    const sheet = workbook.Sheets[nombre];
    if (!sheet) continue;
    const parsed = parseSheet(sheet);
    if (parsed.rows.length > 0) {
      return { sheetName: nombre, ...parsed };
    }
  }

  throw fail(
    'NO_DATA_ROWS',
    'No se encontraron filas con IDENTIFICACIÓN en hojas BD/PENDIENTES',
    400
  );
}

/** Lectura de filas Excel Alfa (para outbound matching). */
export function parseAlfaExcelBuffer(buffer) {
  return parseWorkbookToRows(buffer);
}

function parseSheet(sheet) {
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  if (!matriz.length) return { rows: [], mapping: {}, headerRowIdx: -1 };

  let headerRowIdx = -1;
  let colMap = {};
  for (let r = 0; r < Math.min(matriz.length, 40); r += 1) {
    const row = matriz[r] || [];
    const provisional = {};
    row.forEach((celda, c) => {
      const field = HEADER_LOOKUP.get(normalizeExcelHeader(celda));
      if (field) provisional[c] = field;
    });
    const campos = new Set(Object.values(provisional));
    if (campos.has('identificacion') || (campos.has('siniestro') && campos.has('estado'))) {
      headerRowIdx = r;
      colMap = provisional;
      break;
    }
  }
  if (headerRowIdx < 0) return { rows: [], mapping: {}, headerRowIdx: -1 };

  const mapping = {};
  Object.entries(colMap).forEach(([col, field]) => {
    mapping[field] = Number(col);
  });

  const rows = [];
  for (let r = headerRowIdx + 1; r < matriz.length; r += 1) {
    const row = matriz[r] || [];
    const payload = {};
    let hasData = false;
    Object.entries(colMap).forEach(([colStr, field]) => {
      const raw = row[Number(colStr)];
      const val = cellToFieldValue(field, raw);
      payload[field] = val;
      if (val !== null && val !== undefined && String(val).trim() !== '') hasData = true;
    });
    if (!hasData) continue;
    rows.push({ rowNumber: r + 1, payload });
  }

  return { rows, mapping, headerRowIdx };
}

function canSafelyCreate(payload = {}) {
  const id = normKeyId(payload.identificacion);
  if (!id) return false;
  const hasPol =
    isMeaningfulExcelValue(payload.numeroPoliza) && !isPolicyPlaceholder(payload.numeroPoliza);
  const hasCredit =
    isMeaningfulExcelValue(payload.numeroCredito) && !isPolicyPlaceholder(payload.numeroCredito);
  const hasSin = isMeaningfulExcelValue(payload.siniestro);
  const hasFecha = Boolean(fechaKey(payload.fechaSiniestro));
  const hasAseg = isMeaningfulExcelValue(payload.asegurado);
  return hasPol || hasCredit || hasSin || (hasFecha && hasAseg);
}

/**
 * Filas Excel con columnas corridas (ej. póliza=día, crédito=CIUDAD, correo=teléfono).
 * No deben actualizar ARNALD.
 */
export function looksLikeAlfaExcelColumnShiftCorruption(payload = {}) {
  const pol = String(payload.numeroPoliza ?? '').trim();
  const cred = String(payload.numeroCredito ?? '')
    .trim()
    .toUpperCase();
  const ciudad = String(payload.ciudad ?? '')
    .trim()
    .toUpperCase();
  const correo = String(payload.correo ?? '').trim();
  const contact = String(payload.informacionContacto ?? '').trim();

  const creditoEsCiudad = Boolean(cred && ciudad && cred === ciudad);
  const polizaPareceDia = /^\d{1,2}$/.test(pol) && Number(pol) >= 1 && Number(pol) <= 31;
  const correoEsTelefono = /^\d{7,15}$/.test(correo);
  const contactoPareceCredito =
    /^\d{5,}$/.test(contact) && (correoEsTelefono || creditoEsCiudad);

  if (creditoEsCiudad && (polizaPareceDia || correoEsTelefono)) return true;
  if (polizaPareceDia && correoEsTelefono && contactoPareceCredito) return true;
  return false;
}

export function planRow(row, allCases) {
  const warnings = [];
  const ignoredFields = {};
  const rawPayload = row.payload || {};

  if (!rawPayload.identificacion) {
    return {
      rowNumber: row.rowNumber,
      action: 'REJECTED',
      errorCode: 'MISSING_IDENTIFICACION',
      message: 'Falta identificación',
      payload: rawPayload,
      changes: null,
      ignoredFields,
      matchedCaseId: null,
      candidateCaseIds: [],
      matchStrategy: 'REJECTED',
      matchEvidence: buildEvidence(),
      previewSnapshot: {
        identificacion: null,
        numeroPolizaExcel: rawPayload.numeroPoliza || null,
        siniestroExcel: rawPayload.siniestro || null,
      },
      claimNumberAssigned: false,
      claimNumberEventPending: false,
      warnings,
    };
  }

  if (looksLikeAlfaExcelColumnShiftCorruption(rawPayload)) {
    return {
      rowNumber: row.rowNumber,
      action: 'REJECTED',
      errorCode: 'EXCEL_COLUMN_SHIFT',
      message:
        'Fila Excel con columnas corridas (póliza/crédito/correo inválidos). Corrija o elimine el duplicado en SharePoint.',
      payload: rawPayload,
      changes: null,
      ignoredFields,
      matchedCaseId: null,
      candidateCaseIds: [],
      matchStrategy: 'REJECTED',
      matchEvidence: buildEvidence(),
      previewSnapshot: {
        identificacion: rawPayload.identificacion,
        numeroPolizaExcel: rawPayload.numeroPoliza || null,
        siniestroExcel: rawPayload.siniestro || null,
      },
      claimNumberAssigned: false,
      claimNumberEventPending: false,
      warnings: ['EXCEL_COLUMN_SHIFT'],
    };
  }

  const match = matchAlfaCaseForExcelRow(rawPayload, allCases);
  const evidence = match.matchEvidence || buildEvidence();
  const strategy = match.matchStrategy || match.strategy || 'CREATE';
  const candidateCaseIds = (match.cases || []).map((c) => c._id);

  if (match.actionHint === 'AMBIGUOUS') {
    return {
      rowNumber: row.rowNumber,
      action: 'AMBIGUOUS',
      errorCode: 'AMBIGUOUS_MATCH',
      message: 'Coincidencias múltiples (' + strategy + ') — no se actualiza ni crea',
      payload: rawPayload,
      changes: null,
      ignoredFields,
      matchedCaseId: null,
      candidateCaseIds,
      matchedConsecutivo: null,
      matchStrategy: strategy,
      matchEvidence: evidence,
      previewSnapshot: {
        identificacion: rawPayload.identificacion,
        numeroCredito: rawPayload.numeroCredito || null,
        numeroPolizaExcel: rawPayload.numeroPoliza || null,
        siniestroExcel: rawPayload.siniestro || null,
        candidatos: match.cases.map((c) => ({ id: String(c._id), consecutivo: c.consecutivo })),
      },
      claimNumberAssigned: false,
      claimNumberEventPending: false,
      warnings,
    };
  }

  if (match.actionHint === 'CREATE' || match.cases.length === 0) {
    if (!canSafelyCreate(rawPayload)) {
      return {
        rowNumber: row.rowNumber,
        action: 'REJECTED',
        errorCode: 'INSUFFICIENT_CREATE_DATA',
        message: 'Sin match y datos insuficientes para CREATE seguro',
        payload: rawPayload,
        changes: null,
        ignoredFields,
        matchedCaseId: null,
        candidateCaseIds: [],
        matchStrategy: 'REJECTED',
        matchEvidence: evidence,
        previewSnapshot: {
          identificacion: rawPayload.identificacion,
          numeroPolizaExcel: rawPayload.numeroPoliza || null,
          siniestroExcel: rawPayload.siniestro || null,
          numeroCredito: rawPayload.numeroCredito || null,
        },
        claimNumberAssigned: false,
        claimNumberEventPending: false,
        warnings,
      };
    }

    const createPayload = buildAlfaCasoPayload({ ...rawPayload, estado: 'Sin contactar' });
    createPayload.estado = 'Sin contactar';
    if (
      isMeaningfulExcelValue(rawPayload.estado) &&
      String(rawPayload.estado).trim().toUpperCase() !== 'PENDIENTE' &&
      String(rawPayload.estado).trim() !== 'Sin contactar'
    ) {
      ignoredFields.estado = {
        before: null,
        afterExcel: rawPayload.estado,
        action: 'IGNORED_PROTECTED',
      };
      warnings.push('IGNORED_PROTECTED:estado');
    }
    if (isMeaningfulExcelValue(rawPayload.estadoGestion)) {
      ignoredFields.estadoGestion = {
        before: null,
        afterExcel: rawPayload.estadoGestion,
        action: 'IGNORED_PROTECTED',
      };
      warnings.push('IGNORED_PROTECTED:estadoGestion');
    }
    if (!createPayload.estadoGestion) {
      createPayload.estadoGestion = 'Sin contactar';
    }

    return {
      rowNumber: row.rowNumber,
      action: 'CREATED',
      errorCode: null,
      message: 'Caso nuevo',
      payload: createPayload,
      changes: null,
      ignoredFields,
      matchedCaseId: null,
      candidateCaseIds: [],
      matchStrategy: 'CREATE',
      matchEvidence: evidence,
      previewSnapshot: {
        consecutivoArnald: null,
        identificacion: rawPayload.identificacion,
        numeroCredito: rawPayload.numeroCredito || null,
        numeroPolizaActual: null,
        numeroPolizaExcel: rawPayload.numeroPoliza || null,
        siniestroActual: null,
        siniestroExcel: rawPayload.siniestro || null,
        estadoActual: null,
        estadoExcel: rawPayload.estado || null,
        estadoAction: ignoredFields.estado?.action || 'DEFAULT_PENDIENTE',
        estadoGestionActual: null,
        estadoGestionExcel: rawPayload.estadoGestion || null,
        estadoGestionAction: ignoredFields.estadoGestion?.action || 'DEFAULT_SIN_CONTACTAR',
      },
      claimNumberAssigned: false,
      claimNumberEventPending: false,
      warnings,
    };
  }

  const existing = match.cases[0];
  const { changes, patch, ignored } = buildAlfaCaseDiff({
    currentCase: existing,
    incomingData: rawPayload,
    updatableFields: ALFA_EXCEL_UPDATABLE_FIELDS,
  });
  Object.assign(ignoredFields, ignored || {});

  if (
    rawPayload.estado != null &&
    String(rawPayload.estado).trim() !== '' &&
    !valuesEqualForDiff(rawPayload.estado, existing.estado)
  ) {
    ignoredFields.estado = {
      before: existing.estado ?? null,
      afterExcel: rawPayload.estado,
      action: 'IGNORED_PROTECTED',
    };
    warnings.push('IGNORED_PROTECTED:estado');
  }
  if (
    rawPayload.estadoGestion != null &&
    String(rawPayload.estadoGestion).trim() !== '' &&
    !valuesEqualForDiff(rawPayload.estadoGestion, existing.estadoGestion)
  ) {
    ignoredFields.estadoGestion = {
      before: existing.estadoGestion ?? null,
      afterExcel: rawPayload.estadoGestion,
      action: 'IGNORED_PROTECTED',
    };
    warnings.push('IGNORED_PROTECTED:estadoGestion');
  }

  for (const [field, meta] of Object.entries(ignoredFields)) {
    if (meta?.action === 'INCOMING_PLACEHOLDER_IGNORED') {
      warnings.push('INCOMING_PLACEHOLDER_IGNORED:' + field);
    }
  }

  const claimAssigned =
    !isMeaningfulExcelValue(existing.siniestro) &&
    isMeaningfulExcelValue(rawPayload.siniestro) &&
    Boolean(changes.siniestro);

  const policyPlaceholderUpgrade =
    isPolicyPlaceholder(existing.numeroPoliza) &&
    !isPolicyPlaceholder(rawPayload.numeroPoliza) &&
    Boolean(changes.numeroPoliza);

  if (policyPlaceholderUpgrade) warnings.push('POLIZA_PLACEHOLDER_TO_REAL');
  if (claimAssigned) warnings.push('ALFA_CLAIM_NUMBER_ASSIGNED');

  const finalHasChanges = Object.keys(changes).length > 0;
  return {
    rowNumber: row.rowNumber,
    action: finalHasChanges ? 'UPDATED' : 'UNCHANGED',
    errorCode: null,
    message: finalHasChanges ? 'Actualización pendiente' : 'Sin cambios',
    payload: patch,
    fullIncoming: rawPayload,
    changes: finalHasChanges ? changes : {},
    ignoredFields,
    matchedCaseId: existing._id,
    matchedConsecutivo: existing.consecutivo || null,
    candidateCaseIds: [existing._id],
    matchStrategy: strategy,
    matchEvidence: evidence,
    previewSnapshot: {
      consecutivoArnald: existing.consecutivo || null,
      matchedCaseId: String(existing._id),
      identificacion: existing.identificacion || rawPayload.identificacion,
      numeroCredito: rawPayload.numeroCredito || existing.numeroCredito || null,
      numeroPolizaActual: existing.numeroPoliza || null,
      numeroPolizaExcel: rawPayload.numeroPoliza || null,
      siniestroActual: existing.siniestro || null,
      siniestroExcel: rawPayload.siniestro || null,
      estadoActual: existing.estado || null,
      estadoExcel: rawPayload.estado || null,
      estadoAction: ignoredFields.estado?.action || 'UNCHANGED',
      estadoGestionActual: existing.estadoGestion || null,
      estadoGestionExcel: rawPayload.estadoGestion || null,
      estadoGestionAction: ignoredFields.estadoGestion?.action || 'UNCHANGED',
      changeFields: Object.keys(changes),
    },
    claimNumberAssigned: claimAssigned,
    claimNumberEventPending: claimAssigned,
    warnings,
  };
}

async function matchPoliciesForCase(caso) {
  let matched = 0;
  const idNorm = normalizeIdentification(caso?.identificacion);
  const policyNumber = normalizePolicyNumber(caso?.numeroPoliza);

  if (idNorm) {
    const byIdent = await AlfaPolicyDocument.find({
      status: 'active',
      importStatus: 'imported',
      sourceIdentifier: idNorm,
      sourceIdentifierType: 'identificacion',
      'association.status': { $in: ['unmatched', 'ambiguous'] },
    }).limit(50);
    for (const doc of byIdent) {
      await associateAlfaPolicyDocument(doc);
      matched += 1;
    }
  }

  // Enriquecer policyNumber en docs ya asociados al caso (sin re-descargar).
  if (isRealPolicyNumber(policyNumber)) {
    await enrichAlfaPolicyDocumentsForCase(caso);
    try {
      await onAlfaCasePolicyMaybeReady(caso._id);
    } catch (e) {
      console.warn(
        JSON.stringify({
          event: 'ALFA_PENDING_DESTINATION_RELEASE_WARN',
          message: e?.message,
        })
      );
    }
  }

  return { matched, policyNumber: policyNumber || null, identification: idNorm || null };
}

function validateUpload({ buffer, fileName, mimeType }) {
  const cfg = getAlfaExcelImportConfig();
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw fail('EMPTY_FILE', 'Archivo vacío', 400);
  }
  if (buffer.length > cfg.maxFileBytes) {
    throw fail('FILE_TOO_LARGE', `Archivo supera ${cfg.maxFileBytes} bytes`, 400);
  }
  const name = String(fileName || '').toLowerCase();
  const okExt = name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm');
  if (!okExt) {
    throw fail('INVALID_EXTENSION', 'Solo se aceptan .xlsx / .xls / .xlsm', 400);
  }
  const mime = String(mimeType || '').toLowerCase();
  if (
    mime &&
    ![
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
      'application/haansoftxlsx',
    ].includes(mime) &&
    !mime.includes('sheet') &&
    !mime.includes('excel')
  ) {
    // no bloquear si extensión ok (browsers varían)
  }
}

/**
 * Preview: no modifica casos.
 */
export async function previewAlfaExcelImport({
  buffer,
  fileName,
  mimeType,
  user,
  source = 'manual',
} = {}) {
  validateUpload({ buffer, fileName, mimeType });
  const cfg = getAlfaExcelImportConfig();
  const fileHash = sha256(buffer);

  const previous = await AlfaExcelImport.findOne({
    fileHash,
    status: 'completed',
  })
    .sort({ finishedAt: -1 })
    .lean();

  const parsed = parseWorkbookToRows(buffer);
  if (parsed.rows.length > cfg.maxRows) {
    throw fail('TOO_MANY_ROWS', `Máximo ${cfg.maxRows} filas`, 400);
  }

  const allCases = await listAlfaCasosParaMatchExcel();
  const planned = parsed.rows.map((r) => planRow(r, allCases));

  const totals = {
    rows: planned.length,
    created: planned.filter((p) => p.action === 'CREATED').length,
    updated: planned.filter((p) => p.action === 'UPDATED').length,
    unchanged: planned.filter((p) => p.action === 'UNCHANGED').length,
    rejected: planned.filter((p) => p.action === 'REJECTED').length,
    ambiguous: planned.filter((p) => p.action === 'AMBIGUOUS').length,
  };

  const insights = {
    placeholderPolicyToReal: planned.filter((p) =>
      (p.warnings || []).includes('POLIZA_PLACEHOLDER_TO_REAL')
    ).length,
    /** alias legacy */
    policyPlaceholderToReal: planned.filter((p) =>
      (p.warnings || []).includes('POLIZA_PLACEHOLDER_TO_REAL')
    ).length,
    claimNumberAssignments: planned.filter(
      (p) => p.claimNumberAssigned || p.claimNumberEventPending
    ).length,
    protectedFieldsIgnored: planned.filter(
      (p) =>
        Boolean(p.ignoredFields?.estado) ||
        (p.warnings || []).some((w) => String(w).startsWith('IGNORED_PROTECTED'))
    ).length,
    possibleExistingDuplicates: (() => {
      const byIdPol = new Map();
      for (const c of allCases) {
        const id = normKeyId(c.identificacion);
        const pol = normKeyPolicy(c.numeroPoliza);
        if (!id || !pol || isPolicyPlaceholder(c.numeroPoliza)) continue;
        const k = `${id}|${pol}`;
        byIdPol.set(k, (byIdPol.get(k) || 0) + 1);
      }
      return [...byIdPol.values()].filter((n) => n > 1).length;
    })(),
    /** alias legacy */
    possibleDuplicatesInDb: 0,
    protectedFieldNames: ['estado'],
  };
  insights.possibleDuplicatesInDb = insights.possibleExistingDuplicates;

  const expiresAt = new Date(Date.now() + cfg.sessionTtlHours * 3600 * 1000);
  const warnings = [];
  if (previous) {
    warnings.push('ALREADY_IMPORTED: mismo hash ya importado; use force=true en execute');
  }

  const sampleRows = planned.slice(0, 50).map((p) => {
    const snap = p.previewSnapshot || {};
    return {
      rowNumber: p.rowNumber,
      action: p.action,
      matchedCaseId: p.matchedCaseId ? String(p.matchedCaseId) : null,
      candidateCaseIds: (p.candidateCaseIds || []).map((id) => String(id)),
      consecutivo: p.matchedConsecutivo || snap.consecutivoArnald || null,
      consecutivoArnald: p.matchedConsecutivo || snap.consecutivoArnald || null,
      matchStrategy: p.matchStrategy || null,
      matchEvidence: p.matchEvidence || null,
      identificacion:
        snap.identificacion ||
        p.payload?.identificacion ||
        p.fullIncoming?.identificacion ||
        null,
      numeroCredito: snap.numeroCredito || null,
      numeroPolizaActual: snap.numeroPolizaActual || null,
      numeroPolizaExcel:
        snap.numeroPolizaExcel ||
        p.fullIncoming?.numeroPoliza ||
        p.payload?.numeroPoliza ||
        null,
      siniestroActual: snap.siniestroActual || null,
      siniestroExcel:
        snap.siniestroExcel || p.fullIncoming?.siniestro || p.payload?.siniestro || null,
      estadoActual: snap.estadoActual || null,
      estadoExcel: snap.estadoExcel || null,
      estadoAction: snap.estadoAction || null,
      changeFields: snap.changeFields || Object.keys(p.changes || {}),
      changes: p.changes || null,
      ignoredFields: p.ignoredFields || null,
      message: p.message,
      errorCode: p.errorCode,
      warnings: p.warnings || [],
      claimNumberAssigned: Boolean(p.claimNumberAssigned),
      claimNumberEventPending: Boolean(p.claimNumberEventPending),
    };
  });

  const importDoc = await AlfaExcelImport.create({
    fileName: fileName || 'alfa.xlsx',
    fileHash,
    mimeType: mimeType || null,
    size: buffer.length,
    sheetName: parsed.sheetName,
    source,
    importedBy: {
      id: user?.id || '',
      login: user?.login || '',
      nombre: user?.nombre || '',
    },
    uploadedAt: new Date(),
    expiresAt,
    status: 'preview',
    mapping: parsed.mapping,
    totals,
    warnings,
    alreadyImported: Boolean(previous),
    previousImportId: previous?._id || null,
    sampleRows,
  });

  if (planned.length) {
    await AlfaExcelImportRow.insertMany(
      planned.map((p) => ({
        importId: importDoc._id,
        rowNumber: p.rowNumber,
        action: p.action,
        matchedCaseId: p.matchedCaseId || null,
        matchedConsecutivo: p.matchedConsecutivo || null,
        candidateCaseIds: p.candidateCaseIds || [],
        matchStrategy: p.matchStrategy || null,
        matchEvidence: p.matchEvidence || null,
        payload: p.payload,
        previewSnapshot: p.previewSnapshot || null,
        changes: p.changes || null,
        errorCode: p.errorCode || null,
        message: p.message || null,
        warnings: p.warnings || [],
        claimNumberAssigned: Boolean(p.claimNumberAssigned),
        claimNumberEventPending: Boolean(p.claimNumberEventPending),
        ignoredFields: p.ignoredFields || null,
        applied: false,
      })),
      { ordered: false }
    );
  }

  const examplesClaim = sampleRows.filter((r) => r.claimNumberEventPending).slice(0, 10);
  const examplesPolicyUpgrade = sampleRows
    .filter((r) => (r.warnings || []).includes('POLIZA_PLACEHOLDER_TO_REAL'))
    .slice(0, 10);
  const examplesProtected = sampleRows
    .filter((r) => r.ignoredFields?.estado?.action === 'IGNORED_PROTECTED')
    .slice(0, 10);

  return {
    importSessionId: String(importDoc._id),
    fileHash,
    sheetName: parsed.sheetName,
    mapping: parsed.mapping,
    alreadyImported: Boolean(previous),
    previousImportId: previous?._id ? String(previous._id) : null,
    expiresAt,
    totalRows: totals.rows,
    created: totals.created,
    updated: totals.updated,
    unchanged: totals.unchanged,
    rejected: totals.rejected,
    ambiguous: totals.ambiguous,
    newCases: totals.created,
    updates: totals.updated,
    insights,
    protectedFields: ['estado'],
    examples: {
      claimNumberAssignments: examplesClaim,
      placeholderPolicyToReal: examplesPolicyUpgrade,
      policyPlaceholderToReal: examplesPolicyUpgrade,
      protectedFieldsIgnored: examplesProtected,
      representative: sampleRows.slice(0, 10),
    },
    sampleRows,
    warnings,
    note:
      'Preview solo lectura. NO genera eventos reales ni modifica Mongo/SharePoint hasta POST /import/execute. Campos estado / estadoGestion = IGNORED_PROTECTED (ARNALD → Excel).',
  };
}

/**
 * Execute: aplica filas staged de la sesión.
 */
export async function executeAlfaExcelImport({
  importSessionId,
  force = false,
  user,
} = {}) {
  if (!importSessionId) {
    throw fail('MISSING_SESSION', 'importSessionId requerido', 400);
  }

  const session = await AlfaExcelImport.findById(importSessionId);
  if (!session) throw fail('SESSION_NOT_FOUND', 'Sesión de importación no encontrada', 404);
  if (session.status === 'completed') {
    throw fail('SESSION_ALREADY_COMPLETED', 'Esta sesión ya fue ejecutada', 409);
  }
  if (session.status === 'processing') {
    throw fail('SESSION_PROCESSING', 'Importación en curso', 409);
  }
  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    session.status = 'expired';
    await session.save();
    throw fail('SESSION_EXPIRED', 'Sesión expirada (TTL 2h); vuelva a hacer preview', 410);
  }
  if (session.status !== 'preview' && session.status !== 'failed') {
    throw fail('INVALID_SESSION_STATUS', `Estado inválido: ${session.status}`, 409);
  }

  if (session.alreadyImported && !force) {
    throw fail(
      'ALREADY_IMPORTED',
      'Este Excel ya fue importado (mismo hash). Use force=true (admin/soporte).',
      409
    );
  }

  await acquireAlfaExcelImportLock({
    importId: session._id,
    login: user?.login || session.importedBy?.login,
  });

  const cfg = getAlfaExcelImportConfig();
  session.status = 'processing';
  session.startedAt = new Date();
  session.force = Boolean(force);
  await session.save();

  const totals = {
    rows: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    ambiguous: 0,
  };
  const errors = [];

  try {
    const rows = await AlfaExcelImportRow.find({ importId: session._id }).sort({
      rowNumber: 1,
    });
    totals.rows = rows.length;

    for (let i = 0; i < rows.length; i += cfg.batchSize) {
      const batch = rows.slice(i, i + cfg.batchSize);
      for (const row of batch) {
        try {
          if (row.action === 'REJECTED' || row.action === 'AMBIGUOUS') {
            if (row.action === 'REJECTED') totals.rejected += 1;
            else totals.ambiguous += 1;
            row.applied = true;
            await row.save();
            continue;
          }

          if (row.action === 'UNCHANGED') {
            if (row.matchedCaseId) {
              const live = await SegurosAlfaCaso.findById(row.matchedCaseId).lean();
              if (!live) {
                await restoreAlfaCasoFromRespaldoById(row.matchedCaseId, {
                  unexclude: true,
                });
              }
            }
            totals.unchanged += 1;
            row.applied = true;
            row.resultCaseId = row.matchedCaseId;
            row.resultConsecutivo = row.matchedConsecutivo;
            await row.save();
            continue;
          }

          if (row.action === 'CREATED') {
            const created = await createAlfaCasoFromImport(row.payload || {});
            row.applied = true;
            row.resultCaseId = created._id;
            row.resultConsecutivo = created.consecutivo;
            row.matchedCaseId = created._id;
            const pm = await matchPoliciesForCase(created);
            row.policyMatch = pm;
            await row.save();
            totals.created += 1;
            continue;
          }

          if (row.action === 'UPDATED') {
            if (!row.matchedCaseId) {
              row.action = 'REJECTED';
              row.errorCode = 'MISSING_MATCH';
              row.message = 'UPDATE sin caso matched';
              row.applied = true;
              totals.rejected += 1;
              await row.save();
              continue;
            }
            let before = await SegurosAlfaCaso.findById(row.matchedCaseId).lean();
            if (!before) {
              before = await restoreAlfaCasoFromRespaldoById(row.matchedCaseId, {
                unexclude: true,
              });
            }
            const updated = await updateAlfaCasoFields(row.matchedCaseId, row.payload || {});
            row.applied = true;
            row.resultCaseId = updated?._id || row.matchedCaseId;
            row.resultConsecutivo = updated?.consecutivo || row.matchedConsecutivo;

            if (
              row.claimNumberAssigned ||
              (row.changes?.siniestro &&
                !isMeaningfulExcelValue(before?.siniestro) &&
                isMeaningfulExcelValue(row.changes.siniestro.after))
            ) {
              await recordAlfaClaimNumberAssigned({
                caseId: row.resultCaseId,
                consecutivo: row.resultConsecutivo,
                oldValue: row.changes?.siniestro?.before ?? before?.siniestro ?? null,
                newValue: row.changes?.siniestro?.after || updated?.siniestro,
                importId: session._id,
              });
            }

            const pm = await matchPoliciesForCase(
              updated || { numeroPoliza: row.payload?.numeroPoliza }
            );
            row.policyMatch = pm;
            await row.save();
            totals.updated += 1;
          }
        } catch (errFila) {
          totals.rejected += 1;
          row.action = 'REJECTED';
          row.errorCode = errFila.code || 'ROW_EXECUTE_ERROR';
          row.message = errFila.message;
          row.applied = true;
          await row.save();
          errors.push({ rowNumber: row.rowNumber, message: errFila.message });
        }
      }
    }

    session.totals = totals;
    session.errors = errors;
    session.status = 'completed';
    session.finishedAt = new Date();
    await session.save();

    return {
      importSessionId: String(session._id),
      status: 'completed',
      totals,
      errors,
    };
  } catch (error) {
    session.status = 'failed';
    session.finishedAt = new Date();
    session.errors = [...(session.errors || []), { message: error.message }];
    await session.save();
    throw error;
  } finally {
    await releaseAlfaExcelImportLock({ importId: session._id });
  }
}

export async function getAlfaExcelImportStatus(importSessionId) {
  const session = await AlfaExcelImport.findById(importSessionId).lean();
  if (!session) throw fail('SESSION_NOT_FOUND', 'Sesión no encontrada', 404);
  const rows = await AlfaExcelImportRow.find({ importId: session._id })
    .sort({ rowNumber: 1 })
    .limit(500)
    .lean();
  return { import: session, rows };
}

export async function buildAlfaExcelImportReportRows(importSessionId) {
  const rows = await AlfaExcelImportRow.find({ importId: importSessionId })
    .sort({ rowNumber: 1 })
    .lean();
  return rows.map((r) => ({
    Fila: r.rowNumber,
    Estado: r.action,
    CasoId: r.resultCaseId ? String(r.resultCaseId) : r.matchedCaseId ? String(r.matchedCaseId) : '',
    Consecutivo: r.resultConsecutivo || r.matchedConsecutivo || '',
    NumeroPoliza: r.payload?.numeroPoliza || '',
    NumeroSiniestro: r.payload?.siniestro || '',
    Mensaje: r.message || r.errorCode || '',
  }));
}
