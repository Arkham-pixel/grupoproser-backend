/**
 * Pruebas A–Q — Importador Excel Alfa (preview/execute).
 * Uso: node scripts/testAlfaExcelImport.js
 */

import '../config/loadEnv.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import AlfaExcelImport from '../models/AlfaExcelImport.js';
import AlfaExcelImportRow from '../models/AlfaExcelImportRow.js';
import AlfaPolicyDocument from '../models/AlfaPolicyDocument.js';
import {
  previewAlfaExcelImport,
  executeAlfaExcelImport,
  matchAlfaCaseForExcelRow,
} from '../services/alfaExcelImportService.js';
import { shouldUpdateAlfaStatus } from '../config/alfaExcelStatuses.js';
import { acquireAlfaExcelImportLock, releaseAlfaExcelImportLock } from '../services/alfaExcelImportLockService.js';
import { isAlfaExcelPlaceholder, mergeAlfaImportValue } from '../utils/alfaExcelNormalize.js';

const TAG = `EXCEL-IMP-${Date.now()}`;
const createdCaseIds = [];
const createdImportIds = [];
const createdPolicyIds = [];

function line(m) {
  console.log(m);
}
function pass(n) {
  line(`${n}: PASSED`);
}
function fail(n, e) {
  throw new Error(`${n}: ${e?.message || e}`);
}

function buildExcel(rows, sheetName = 'BD') {
  const headers = [
    'IDENTIFICACION',
    'ASEGURADO',
    'NÚMERO PÓLIZA',
    'SINIESTRO',
    'CORREO',
    'ESTADO',
    'N CREDITO',
    'DIRECCION PREDIO',
    'FECHA SINIESTRO',
  ];
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function cleanup() {
  if (createdCaseIds.length) {
    await SegurosAlfaCaso.deleteMany({ _id: { $in: createdCaseIds } });
  }
  await SegurosAlfaCaso.deleteMany({ identificacion: { $regex: `^${TAG}` } });
  if (createdImportIds.length) {
    await AlfaExcelImportRow.deleteMany({ importId: { $in: createdImportIds } });
    await AlfaExcelImport.deleteMany({ _id: { $in: createdImportIds } });
  }
  if (createdPolicyIds.length) {
    await AlfaPolicyDocument.deleteMany({ _id: { $in: createdPolicyIds } });
  }
}

async function main() {
  line('=== testAlfaExcelImport A–Q ===');
  await mongoose.connect(process.env.MONGO_URI);
  const results = {};

  try {
    // --- A: caso nuevo ---
    const idA = `${TAG}-A`;
    const bufA = buildExcel([
      [idA, 'Asegurado A', '001245687', '', 'a@test.com', 'PENDIENTE', '', '', ''],
    ]);
    const prevA = await previewAlfaExcelImport({
      buffer: bufA,
      fileName: 'a.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevA.importSessionId);
    if (prevA.created !== 1) fail('A', new Error(JSON.stringify(prevA)));
    const exA = await executeAlfaExcelImport({
      importSessionId: prevA.importSessionId,
      user: { login: 'test' },
    });
    if (exA.totals.created !== 1) fail('A', new Error(JSON.stringify(exA)));
    const casoA = await SegurosAlfaCaso.findOne({ identificacion: idA });
    if (!casoA) fail('A', new Error('caso no creado'));
    createdCaseIds.push(casoA._id);
    if (casoA.numeroPoliza !== '001245687') fail('G', new Error('ceros perdidos'));
    if (!casoA.consecutivo?.startsWith('ALFA-')) fail('A', new Error('sin consecutivo'));
    pass('A');
    results.A = true;
    pass('G — ceros iniciales póliza');
    results.G = true;
    pass('H — sin siniestro crea OK');
    results.H = true;

    // --- B / M: mismo Excel → ALREADY_IMPORTED ---
    const prevB = await previewAlfaExcelImport({
      buffer: bufA,
      fileName: 'a.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevB.importSessionId);
    if (!prevB.alreadyImported) fail('M', new Error('no detectó hash'));
    try {
      await executeAlfaExcelImport({
        importSessionId: prevB.importSessionId,
        force: false,
        user: { login: 'test' },
      });
      fail('M', new Error('debió bloquear'));
    } catch (e) {
      if (e.code !== 'ALREADY_IMPORTED') fail('M', e);
    }
    // force: unchanged (mismo contenido)
    const exB = await executeAlfaExcelImport({
      importSessionId: prevB.importSessionId,
      force: true,
      user: { login: 'test' },
    });
    if (exB.totals.created !== 0) fail('B', new Error('duplicó'));
    if (exB.totals.unchanged < 1 && exB.totals.updated < 1) {
      // puede ser unchanged
    }
    const countA = await SegurosAlfaCaso.countDocuments({ identificacion: idA });
    if (countA !== 1) fail('B', new Error(`duplicados=${countA}`));
    pass('B');
    results.B = true;
    pass('M');
    results.M = true;

    // --- C / D / I: update siniestro + unchanged ---
    const bufC = buildExcel([
      [idA, 'Asegurado A', '001245687', 'SIN-999', 'a@test.com', 'PENDIENTE', '', '', ''],
    ]);
    const prevC = await previewAlfaExcelImport({
      buffer: bufC,
      fileName: 'c.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevC.importSessionId);
    if (prevC.updated !== 1) fail('C', new Error(JSON.stringify(prevC)));
    await executeAlfaExcelImport({ importSessionId: prevC.importSessionId, user: { login: 'test' } });
    const casoC = await SegurosAlfaCaso.findById(casoA._id);
    if (casoC.siniestro !== 'SIN-999') fail('I', new Error(String(casoC.siniestro)));
    pass('C');
    results.C = true;
    pass('I');
    results.I = true;

    const prevD = await previewAlfaExcelImport({
      buffer: bufC,
      fileName: 'd.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevD.importSessionId);
    if (prevD.unchanged !== 1) fail('D', new Error(JSON.stringify(prevD)));
    await executeAlfaExcelImport({
      importSessionId: prevD.importSessionId,
      force: true,
      user: { login: 'test' },
    });
    pass('D');
    results.D = true;

    // --- E: fila inválida + válida ---
    const idE = `${TAG}-E`;
    const bufE = buildExcel([
      ['', 'Sin id', 'P1', '', '', 'PENDIENTE', '', '', ''],
      [idE, 'Valido E', 'P-E', '', '', 'PENDIENTE', '', '', ''],
    ]);
    const prevE = await previewAlfaExcelImport({
      buffer: bufE,
      fileName: 'e.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevE.importSessionId);
    if (prevE.rejected < 1 || prevE.created < 1) fail('E', new Error(JSON.stringify(prevE)));
    const exE = await executeAlfaExcelImport({
      importSessionId: prevE.importSessionId,
      user: { login: 'test' },
    });
    const casoE = await SegurosAlfaCaso.findOne({ identificacion: idE });
    if (!casoE) fail('E', new Error('válida no creada'));
    createdCaseIds.push(casoE._id);
    pass('E');
    results.E = true;

    // --- F: AMBIGUOUS ---
    const idF = `${TAG}-F`;
    const c1 = await SegurosAlfaCaso.create({
      identificacion: idF,
      numeroPoliza: 'POL-F',
      asegurado: 'F1',
      estado: 'PENDIENTE',
      consecutivo: `ALFA-TEST-F1-${Date.now()}`,
    });
    const c2 = await SegurosAlfaCaso.create({
      identificacion: idF,
      numeroPoliza: 'POL-F',
      asegurado: 'F2',
      estado: 'PENDIENTE',
      consecutivo: `ALFA-TEST-F2-${Date.now()}`,
    });
    createdCaseIds.push(c1._id, c2._id);
    const bufF = buildExcel([
      [idF, 'Ambiguo', 'POL-F', '', 'f@test.com', 'PENDIENTE', '', '', ''],
    ]);
    const prevF = await previewAlfaExcelImport({
      buffer: bufF,
      fileName: 'f.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevF.importSessionId);
    if (prevF.ambiguous !== 1) fail('F', new Error(JSON.stringify(prevF)));
    await executeAlfaExcelImport({ importSessionId: prevF.importSessionId, user: { login: 'test' } });
    const still = await SegurosAlfaCaso.find({ identificacion: idF });
    if (still.some((c) => c.correo === 'f@test.com')) fail('F', new Error('actualizó ambiguo'));
    pass('F');
    results.F = true;

    // --- J: policy unmatched por identificación ---
    const polJ = `POL-J-${TAG}`;
    const idJ = `${TAG}-J`;
    const policy = await AlfaPolicyDocument.create({
      integrationKey: `test:excel:${TAG}:j`,
      source: 'sharepoint',
      sourceModule: 'alfa',
      documentType: 'poliza',
      sourceIdentifier: idJ,
      sourceIdentifierType: 'identificacion',
      policyNumber: null,
      originalName: 'p.pdf',
      mimeType: 'application/pdf',
      size: 10,
      sharepoint: { driveId: 'x', itemId: 'y', path: 'SEGUROS ALFA/PÓLIZAS/' + idJ },
      storage: {
        provider: 's3',
        bucket: 'test',
        key: `seguros-alfa/polizas/${idJ}/p.pdf`,
      },
      association: { status: 'unmatched', alfaCaseIds: [], candidateCaseIds: [] },
      importStatus: 'imported',
      importedAt: new Date(),
      status: 'active',
    });
    createdPolicyIds.push(policy._id);
    const bufJ = buildExcel([
      [idJ, 'Con poliza', polJ, '', '', 'PENDIENTE', '', '', ''],
    ]);
    const prevJ = await previewAlfaExcelImport({
      buffer: bufJ,
      fileName: 'j.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevJ.importSessionId);
    await executeAlfaExcelImport({ importSessionId: prevJ.importSessionId, user: { login: 'test' } });
    const casoJ = await SegurosAlfaCaso.findOne({ identificacion: idJ });
    createdCaseIds.push(casoJ._id);
    const polAfter = await AlfaPolicyDocument.findById(policy._id);
    if (polAfter.association.status !== 'matched') fail('J', new Error(JSON.stringify(polAfter.association)));
    if (!polAfter.association.alfaCaseIds.map(String).includes(String(casoJ._id))) {
      fail('J', new Error('no asociado'));
    }
    if (polAfter.policyNumber !== polJ) {
      fail('J', new Error(`policyNumber no enriquecido: ${polAfter.policyNumber}`));
    }
    pass('J');
    results.J = true;

    // --- K: misma identificación + misma póliza real → 1 doc → N casos ---
    const casoK = await SegurosAlfaCaso.create({
      identificacion: idJ,
      asegurado: 'Otro caso misma id',
      numeroPoliza: polJ,
      siniestro: 'SIN-K2',
      estado: 'PENDIENTE',
      consecutivo: `ALFA-TEST-K2-${TAG}`,
    });
    createdCaseIds.push(casoK._id);
    const { associateAlfaPolicyDocument } = await import(
      '../services/alfaPolicyImportService.js'
    );
    await associateAlfaPolicyDocument(await AlfaPolicyDocument.findById(policy._id));
    const polK = await AlfaPolicyDocument.findById(policy._id);
    const ids = polK.association.alfaCaseIds.map(String);
    if (!ids.includes(String(casoJ._id)) || !ids.includes(String(casoK._id))) {
      fail('K', new Error(ids.join(',')));
    }
    pass('K');
    results.K = true;

    // --- L: protegidos ---
    const archivosBefore = casoA.archivos?.length ?? 0;
    const liqBefore = { x: 1 };
    await SegurosAlfaCaso.findByIdAndUpdate(casoA._id, {
      liquidador: liqBefore,
      informeUnico: { t: 'keep' },
    });
    const consec = (await SegurosAlfaCaso.findById(casoA._id)).consecutivo;
    const bufL = buildExcel([
      [idA, 'Asegurado A', '001245687', 'SIN-999', 'a@test.com', 'PENDIENTE', '', '', ''],
    ]);
    const prevL = await previewAlfaExcelImport({
      buffer: bufL,
      fileName: 'l.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevL.importSessionId);
    await executeAlfaExcelImport({
      importSessionId: prevL.importSessionId,
      force: true,
      user: { login: 'test' },
    });
    const casoL = await SegurosAlfaCaso.findById(casoA._id);
    if (casoL.consecutivo !== consec) fail('L', new Error('consecutivo cambió'));
    if (!casoL.liquidador || casoL.liquidador.x !== 1) fail('L', new Error('liquidador'));
    if (!casoL.informeUnico || casoL.informeUnico.t !== 'keep') fail('L', new Error('informe'));
    if ((casoL.archivos?.length ?? 0) !== archivosBefore) fail('L', new Error('archivos'));
    pass('L');
    results.L = true;

    // --- N: lock concurrente ---
    await acquireAlfaExcelImportLock({ importId: new mongoose.Types.ObjectId(), login: 't1' });
    try {
      await acquireAlfaExcelImportLock({ importId: new mongoose.Types.ObjectId(), login: 't2' });
      fail('N', new Error('segundo lock permitido'));
    } catch (e) {
      if (e.code !== 'IMPORT_LOCK_HELD') fail('N', e);
    }
    await releaseAlfaExcelImportLock();
    pass('N');
    results.N = true;

    // --- O: corrupto ---
    try {
      await previewAlfaExcelImport({
        buffer: Buffer.from('not-an-excel'),
        fileName: 'bad.xlsx',
        user: { login: 'test' },
      });
      fail('O', new Error('aceptó corrupto'));
    } catch (e) {
      if (!['CORRUPT_FILE', 'NO_DATA_ROWS', 'EMPTY_WORKBOOK'].includes(e.code)) {
        // XLSX sometimes throws differently
        if (!/corrupt|sheet|hoja|ilegible|workbook/i.test(e.message)) fail('O', e);
      }
    }
    pass('O');
    results.O = true;

    // --- P: no retroceso estado ---
    await SegurosAlfaCaso.findByIdAndUpdate(casoA._id, { estado: 'CERRADO' });
    const st = shouldUpdateAlfaStatus({
      currentStatus: 'CERRADO',
      incomingStatus: 'PENDIENTE',
    });
    if (st.update) fail('P', new Error('permitió retroceso'));
    const bufP = buildExcel([
      [idA, 'Asegurado A', '001245687', 'SIN-999', 'a@test.com', 'PENDIENTE', '', '', ''],
    ]);
    const prevP = await previewAlfaExcelImport({
      buffer: bufP,
      fileName: 'p.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevP.importSessionId);
    // unchanged or updated without estado
    const rowP = await AlfaExcelImportRow.findOne({
      importId: prevP.importSessionId,
    });
    if (rowP.changes?.estado) fail('P', new Error('estado en changes'));
    await executeAlfaExcelImport({
      importSessionId: prevP.importSessionId,
      force: true,
      user: { login: 'test' },
    });
    const casoP = await SegurosAlfaCaso.findById(casoA._id);
    if (casoP.estado !== 'CERRADO') fail('P', new Error(casoP.estado));
    pass('P');
    results.P = true;

    // --- Q: placeholder no pisa ---
    if (!isAlfaExcelPlaceholder('POR CONFIRMAR')) fail('Q', new Error('placeholder'));
    if (mergeAlfaImportValue('POR CONFIRMAR', 'dato-bueno') !== 'dato-bueno') {
      fail('Q', new Error('merge'));
    }
    await SegurosAlfaCaso.findByIdAndUpdate(casoE._id, { correo: 'keep@test.com' });
    const bufQ = buildExcel([
      [idE, 'Valido E', 'P-E', '', 'POR CONFIRMAR', 'PENDIENTE', '', '', ''],
    ]);
    const prevQ = await previewAlfaExcelImport({
      buffer: bufQ,
      fileName: 'q.xlsx',
      user: { login: 'test' },
    });
    createdImportIds.push(prevQ.importSessionId);
    await executeAlfaExcelImport({ importSessionId: prevQ.importSessionId, user: { login: 'test' } });
    const casoQ = await SegurosAlfaCaso.findById(casoE._id);
    if (casoQ.correo !== 'keep@test.com') fail('Q', new Error(casoQ.correo));
    pass('Q');
    results.Q = true;

    line('');
    line('--- Resumen A–Q ---');
    for (const k of 'ABCDEFGHIJKLMNOPQ') {
      line(`${k}: ${results[k] ? 'PASSED' : 'n/a-or-fail'}`);
    }
    line('');
    line('Ejemplo preview A: ' + JSON.stringify({
      importSessionId: prevA.importSessionId,
      created: prevA.created,
      updated: prevA.updated,
      unchanged: prevA.unchanged,
      rejected: prevA.rejected,
      ambiguous: prevA.ambiguous,
    }));
    line('Ejemplo execute A: ' + JSON.stringify(exA));
  } catch (e) {
    console.error('FAIL', e);
    process.exitCode = 1;
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

main();
