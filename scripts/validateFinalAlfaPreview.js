/**
 * Validación final (sin /execute, sin mutar casos reales).
 * Cubre puntos: estado protegido, correo-only, placeholder ignore/upgrade,
 * claim pending, matchEvidence, AMBIGUOUS candidates, no CREATE ciego.
 */
import mongoose from 'mongoose';
import {
  matchAlfaCaseForExcelRow,
  planRow,
  buildAlfaCaseDiff,
} from '../services/alfaExcelImportService.js';
import { ALFA_EXCEL_UPDATABLE_FIELDS } from '../config/alfaExcelColumnMap.js';
import { isPolicyPlaceholder } from '../utils/alfaExcelNormalize.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function oid(n) {
  return new mongoose.Types.ObjectId(`64a${String(n).padStart(21, '0')}`);
}

const baseCase = {
  _id: oid(1),
  consecutivo: 'ALFA-001',
  estado: 'PENDIENTE',
  identificacion: '100200300',
  asegurado: 'Juan Perez',
  numeroPoliza: 'POR CONFIRMAR OPERACIONES',
  numeroCredito: 'CRED-99',
  fechaSiniestro: '2024-05-10',
  direccionPredio: 'Calle 1 # 2-3',
  siniestro: null,
  correo: 'viejo@mail.com',
};

function run() {
  const results = [];

  // 1) estado protegido
  {
    const planned = planRow(
      {
        rowNumber: 1,
        payload: {
          ...baseCase,
          estado: 'CERRADO',
          correo: 'viejo@mail.com',
        },
      },
      [baseCase]
    );
    assert(planned.action === 'UNCHANGED' || planned.action === 'UPDATED', '1 action');
    assert(!planned.changes?.estado, '1 estado no en changes');
    assert(planned.ignoredFields?.estado?.action === 'IGNORED_PROTECTED', '1 IGNORED_PROTECTED');
    assert(
      (planned.warnings || []).includes('IGNORED_PROTECTED:estado'),
      '1 warning estado'
    );
    results.push({
      point: 1,
      ok: true,
      estadoAction: planned.ignoredFields.estado.action,
      before: planned.ignoredFields.estado.before,
      afterExcel: planned.ignoredFields.estado.afterExcel,
    });
  }

  // 6) solo correo
  {
    const planned = planRow(
      {
        rowNumber: 2,
        payload: {
          identificacion: baseCase.identificacion,
          numeroPoliza: baseCase.numeroPoliza,
          numeroCredito: baseCase.numeroCredito,
          fechaSiniestro: baseCase.fechaSiniestro,
          correo: 'nuevo@mail.com',
        },
      },
      [baseCase]
    );
    assert(planned.action === 'UPDATED', '6 UPDATED');
    assert(Object.keys(planned.changes || {}).length === 1, '6 solo un campo');
    assert(planned.changes.correo?.after === 'nuevo@mail.com', '6 correo after');
    results.push({ point: 6, ok: true, changes: planned.changes });
  }

  // 7) real no lo pisa placeholder
  {
    const realCase = { ...baseCase, _id: oid(2), numeroPoliza: 'INC-25334' };
    const planned = planRow(
      {
        rowNumber: 3,
        payload: {
          identificacion: realCase.identificacion,
          numeroPoliza: 'POR CONFIRMAR OPERACIONES',
          numeroCredito: realCase.numeroCredito,
          correo: realCase.correo,
        },
      },
      [realCase]
    );
    assert(!planned.changes?.numeroPoliza, '7 poliza no cambia');
    assert(
      planned.ignoredFields?.numeroPoliza?.action === 'INCOMING_PLACEHOLDER_IGNORED',
      '7 ignored placeholder'
    );
    results.push({
      point: 7,
      ok: true,
      action: planned.action,
      ignored: planned.ignoredFields.numeroPoliza,
    });
  }

  // 8) placeholder → real
  {
    const planned = planRow(
      {
        rowNumber: 4,
        payload: {
          identificacion: baseCase.identificacion,
          numeroPoliza: 'INC-25334',
          numeroCredito: baseCase.numeroCredito,
          fechaSiniestro: baseCase.fechaSiniestro,
          correo: baseCase.correo,
        },
      },
      [baseCase]
    );
    assert(planned.action === 'UPDATED', '8 UPDATED');
    assert(planned.changes?.numeroPoliza?.after === 'INC-25334', '8 poliza real');
    assert(
      (planned.warnings || []).includes('POLIZA_PLACEHOLDER_TO_REAL'),
      '8 warning upgrade'
    );
    assert(planned.matchEvidence?.identificacion === true, '8 evidence id');
    assert(planned.matchEvidence?.numeroCredito === true, '8 evidence credit');
    results.push({
      point: 8,
      ok: true,
      strategy: planned.matchStrategy,
      evidence: planned.matchEvidence,
      changes: planned.changes.numeroPoliza,
    });
  }

  // 5) claim pending (no evento real)
  {
    const planned = planRow(
      {
        rowNumber: 5,
        payload: {
          identificacion: baseCase.identificacion,
          numeroPoliza: baseCase.numeroPoliza,
          numeroCredito: baseCase.numeroCredito,
          siniestro: '123456',
          correo: baseCase.correo,
        },
      },
      [baseCase]
    );
    assert(planned.claimNumberEventPending === true, '5 pending');
    assert(
      (planned.warnings || []).includes('ALFA_CLAIM_NUMBER_ASSIGNED'),
      '5 warning claim'
    );
    results.push({
      point: 5,
      ok: true,
      claimNumberEventPending: planned.claimNumberEventPending,
      siniestro: planned.changes?.siniestro,
    });
  }

  // 4) AMBIGUOUS + candidateCaseIds
  {
    const a = { ...baseCase, _id: oid(10), consecutivo: 'A' };
    const b = {
      ...baseCase,
      _id: oid(11),
      consecutivo: 'B',
      numeroCredito: 'OTRO',
    };
    const match = matchAlfaCaseForExcelRow(
      {
        identificacion: baseCase.identificacion,
        numeroPoliza: 'INC-999',
      },
      [a, b]
    );
    // sin crédito: dos placeholders → AMBIGUOUS
    assert(match.actionHint === 'AMBIGUOUS', '4 ambiguous');
    const planned = planRow(
      {
        rowNumber: 6,
        payload: {
          identificacion: baseCase.identificacion,
          numeroPoliza: 'INC-999',
        },
      },
      [a, b]
    );
    assert(planned.action === 'AMBIGUOUS', '4 action');
    assert((planned.candidateCaseIds || []).length === 2, '4 candidates');
    assert(!planned.matchedCaseId, '4 no auto-select');
    results.push({
      point: 4,
      ok: true,
      candidateCaseIds: planned.candidateCaseIds.map(String),
    });
  }

  // 9) no CREATE ciego
  {
    const planned = planRow(
      {
        rowNumber: 7,
        payload: {
          identificacion: '999888777',
          // sin poliza real, crédito, siniestro, ni fecha+asegurado
        },
      },
      [baseCase]
    );
    assert(planned.action === 'REJECTED', '9 REJECTED');
    assert(planned.errorCode === 'INSUFFICIENT_CREATE_DATA', '9 code');
    results.push({ point: 9, ok: true, action: planned.action });
  }

  // 2) matching placeholder único con crédito
  {
    const match = matchAlfaCaseForExcelRow(
      {
        identificacion: baseCase.identificacion,
        numeroPoliza: 'INC-25334',
        numeroCredito: baseCase.numeroCredito,
        fechaSiniestro: baseCase.fechaSiniestro,
      },
      [baseCase]
    );
    assert(match.actionHint === 'MATCH', '2 MATCH');
    assert(match.cases[0]._id.equals(baseCase._id), '2 same case');
    assert(isPolicyPlaceholder(baseCase.numeroPoliza), '2 was placeholder');
    results.push({
      point: 2,
      ok: true,
      strategy: match.matchStrategy,
      evidence: match.matchEvidence,
    });
  }

  // diff correo only via buildAlfaCaseDiff
  {
    const { changes } = buildAlfaCaseDiff({
      currentCase: baseCase,
      incomingData: { correo: 'x@y.com', estado: 'CERRADO' },
      updatableFields: ALFA_EXCEL_UPDATABLE_FIELDS,
    });
    assert(Object.keys(changes).join(',') === 'correo', 'diff only correo');
    results.push({ point: 'diff', ok: true, keys: Object.keys(changes) });
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

try {
  run();
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: e.message, stack: e.stack }, null, 2));
  process.exit(1);
}
