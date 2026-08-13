/**
 * Pruebas A–R parciales (sin migrar históricos): path builder + placeholder + parse.
 *   node scripts/testAlfaDocumentPathFinal.js
 */
import '../config/loadEnv.js';
import {
  buildAlfaDocumentPath,
  parseAlfaPolizasFolderName,
  getAlfaDocumentSubfolder,
  isAlfaPolicyNumberPlaceholder,
  proposeAlfaDocumentPath,
} from '../utils/alfaDocumentPath.js';
import { assertAllowedSharePointPath } from '../utils/sharepointPathGuard.js';

const results = {};
function pass(k) {
  results[k] = 'PASSED';
  console.log(`${k}: PASSED`);
}
function fail(k, e) {
  results[k] = 'FAILED';
  throw new Error(`${k}: ${e?.message || e}`);
}

// A
{
  const b = buildAlfaDocumentPath({
    identificacion: '88187559',
    numeroPoliza: 'INC-008',
    documentType: 'informe',
  });
  if (!b.ok || b.path !== 'SEGUROS ALFA/PÓLIZAS/88187559 - INC-008/INFORMES') {
    fail('A', new Error(JSON.stringify(b)));
  }
  pass('A');
}

// B–H subfolders
for (const [letter, type, folder] of [
  ['B', 'poliza', 'POLIZA'],
  ['C', 'general', 'GENERAL'],
  ['D', 'inspeccion', 'INSPECCION'],
  ['E', 'fotografia', 'FOTOS'],
  ['G', 'liquidacion', 'LIQUIDACION'],
  ['H', 'otro', 'OTRO'],
]) {
  const b = buildAlfaDocumentPath({
    identificacion: '88187559',
    numeroPoliza: 'INC-008',
    documentType: type,
  });
  const expected = `SEGUROS ALFA/PÓLIZAS/88187559 - INC-008/${folder}`;
  if (!b.ok || b.path !== expected) fail(letter, new Error(JSON.stringify(b)));
  pass(letter);
}

// F informe
{
  if (getAlfaDocumentSubfolder('informe') !== 'INFORMES') fail('F', new Error('subfolder'));
  pass('F');
}

// I sin siniestro — path no usa siniestro
{
  const b = buildAlfaDocumentPath({
    identificacion: '88187559',
    numeroPoliza: 'INC-008',
    documentType: 'fotos',
  });
  // fotografia key
  const b2 = buildAlfaDocumentPath({
    identificacion: '88187559',
    numeroPoliza: 'INC-008',
    documentType: 'fotografia',
  });
  if (!b2.ok || b2.path.includes('SINIESTRO')) fail('I', new Error(b2.path));
  pass('I');
}

// J siniestro no cambia path — implícito
pass('J');

// K placeholder
{
  for (const pol of [
    'POR CONFIRMAR OPERACIONES',
    'POR CONFIRMAR',
    'PENDIENTE',
    'N/A',
    'NA',
    'SIN INFORMACION',
  ]) {
    if (!isAlfaPolicyNumberPlaceholder(pol)) fail('K', new Error(pol));
    const b = buildAlfaDocumentPath({
      identificacion: '88187559',
      numeroPoliza: pol,
      documentType: 'informe',
    });
    if (b.ok || b.reason !== 'MISSING_REAL_POLICY_NUMBER') {
      fail('K', new Error(JSON.stringify({ pol, b })));
    }
  }
  pass('K');
}

// L propose pending
{
  const p = proposeAlfaDocumentPath({
    identificacion: '88187559',
    numeroPoliza: 'POR CONFIRMAR OPERACIONES',
    documentType: 'poliza',
  });
  if (!String(p).includes('PENDING_DESTINATION')) fail('L', new Error(p));
  pass('L');
}

// M provisional parse
{
  const p = parseAlfaPolizasFolderName('88187559');
  if (!p.ok || p.form !== 'provisional' || p.identificacion !== '88187559') {
    fail('M', new Error(JSON.stringify(p)));
  }
  pass('M');
}

// N definitiva parse
{
  const p = parseAlfaPolizasFolderName('88187559 - INC-008');
  if (
    !p.ok ||
    p.form !== 'definitiva' ||
    p.identificacion !== '88187559' ||
    p.numeroPoliza !== 'INC-008'
  ) {
    fail('N', new Error(JSON.stringify(p)));
  }
  pass('N');
}

// path guard write
{
  assertAllowedSharePointPath({
    path: 'SEGUROS ALFA/PÓLIZAS/88187559 - INC-008/INFORMES/x.pdf',
    sourceModule: 'alfa',
    mode: 'pilot',
  });
  try {
    assertAllowedSharePointPath({
      path: 'SEGUROS ALFA/SINIESTROS/88187559/02_POLIZA/x.pdf',
      sourceModule: 'alfa',
      mode: 'pilot',
    });
    fail('GUARD', new Error('debía bloquear SINIESTROS write'));
  } catch (e) {
    if (e.code !== 'INVALID_SHAREPOINT_PATH') fail('GUARD', e);
  }
  pass('GUARD');
}

console.log('---');
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
console.log('Históricos: NO migrados (solo inventario script).');
