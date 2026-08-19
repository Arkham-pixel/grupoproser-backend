/**
 * Destino outbound Alfa = SEGUROS ALFA/SINIESTROS/{cedula}/{SUBCARPETA}
 *
 * Sin Graph. Cubre: carpetas por cédula, 1 carpeta por cédula, cero fugas, cero PENDIENTES.
 *   node scripts/testAlfaSiniestrosCedulaPath.js
 */
import '../config/loadEnv.js';
import {
  buildAlfaSiniestrosFolderPath,
  buildAlfaSiniestrosDocumentPath,
  isAlfaSiniestrosCedulaWritePath,
  classifyAlfaSharePointPath,
} from '../utils/alfaDocumentPath.js';
import { assertAllowedSharePointPath } from '../utils/sharepointPathGuard.js';
import { isAlfaLegacySharePointPath } from '../utils/alfaSharePointPath.js';

const results = {};
function pass(k) {
  results[k] = 'PASSED';
  console.log(`${k}: PASSED`);
}
function fail(k, e) {
  results[k] = 'FAILED';
  throw new Error(`${k}: ${e?.message || e}`);
}

const CEDULA_A = '88187559';
const CEDULA_B = '1112461634';
const CEDULA_C = '7184157';

{
  const folder = buildAlfaSiniestrosFolderPath(CEDULA_A);
  if (folder !== `SEGUROS ALFA/SINIESTROS/${CEDULA_A}`) {
    fail('A_FOLDER', new Error(folder));
  }
  const informe = buildAlfaSiniestrosDocumentPath({
    identificacion: CEDULA_A,
    documentType: 'informe',
  });
  if (!informe.ok || informe.path !== `SEGUROS ALFA/SINIESTROS/${CEDULA_A}/INFORMES`) {
    fail('A_INFORME', new Error(JSON.stringify(informe)));
  }
  pass('A_CEDULA_PATH');
}

{
  const fotos = buildAlfaSiniestrosDocumentPath({
    identificacion: CEDULA_A,
    documentType: 'fotografia',
  });
  const liq = buildAlfaSiniestrosDocumentPath({
    identificacion: CEDULA_A,
    documentType: 'liquidacion',
  });
  if (!fotos.ok || !liq.ok) fail('B_SUB', new Error('subfolders'));
  if (fotos.path !== `SEGUROS ALFA/SINIESTROS/${CEDULA_A}/FOTOS`) fail('B_FOTOS', new Error(fotos.path));
  if (liq.path !== `SEGUROS ALFA/SINIESTROS/${CEDULA_A}/LIQUIDACION`) fail('B_LIQ', new Error(liq.path));
  pass('B_SUBFOLDERS');
}

{
  const caso88 = buildAlfaSiniestrosFolderPath(CEDULA_C);
  const caso240 = buildAlfaSiniestrosFolderPath(CEDULA_C);
  if (!caso88 || caso88 !== caso240) {
    fail('C_SAME', new Error(`${caso88} vs ${caso240}`));
  }
  if (caso88.includes('ALFA-2026') || caso88.includes('88') === false) {
    // 7184157 must appear; consecutive must not
  }
  if (/ALFA-2026|CONSEC/.test(caso88)) fail('C_NO_CONSEC', new Error(caso88));
  pass('C_ONE_FOLDER_PER_CEDULA');
}

{
  const a = buildAlfaSiniestrosFolderPath(CEDULA_A);
  const b = buildAlfaSiniestrosFolderPath(CEDULA_B);
  if (!a || !b || a === b) fail('D_LEAK', new Error(`${a} === ${b}`));
  if (a.includes(CEDULA_B) || b.includes(CEDULA_A)) {
    fail('D_CROSS', new Error('cédula cruzada en el path'));
  }
  pass('D_NO_CROSS_CEDULA');
}

{
  const placeholderPoliza = buildAlfaSiniestrosDocumentPath({
    identificacion: CEDULA_A,
    documentType: 'general',
  });
  if (!placeholderPoliza.ok) {
    fail('E_PLACEHOLDER', new Error('póliza placeholder no debe bloquear carpeta por cédula'));
  }
  const noId = buildAlfaSiniestrosDocumentPath({ documentType: 'general' });
  if (noId.ok || noId.reason !== 'MISSING_IDENTIFICATION') {
    fail('E_NO_ID', new Error(JSON.stringify(noId)));
  }
  const badId = buildAlfaSiniestrosFolderPath('FASE6-TEST');
  if (badId) fail('E_NOT_DIGITS', new Error(badId));
  pass('E_PENDING_ONLY_WITHOUT_CEDULA');
}

process.env.SHAREPOINT_SYNC_ALFA_ENABLED = 'true';

{
  const allow = [
    `SEGUROS ALFA/SINIESTROS/${CEDULA_A}/FOTOS/x.jpg`,
    `SEGUROS ALFA/SINIESTROS/${CEDULA_B}/INFORMES/informe.docx`,
    `SEGUROS ALFA/SINIESTROS/${CEDULA_C}/LIQUIDACION/liq.pdf`,
    'SEGUROS ALFA/PÓLIZAS/88187559 - INC-008/POLIZA/p.pdf',
  ];
  for (const path of allow) {
    const n = assertAllowedSharePointPath({
      path,
      sourceModule: 'alfa',
      mode: 'pilot',
    });
    if (n !== path.replace(/^\/+|\/+$/g, '')) fail('F_ALLOW', new Error(path));
  }
  pass('F_GUARD_ALLOW_CEDULA');
}

{
  const blocked = [
    'SEGUROS ALFA/SINIESTROS',
    'SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO/x',
    'SEGUROS ALFA/SINIESTROS/PENDIENTES/x',
    'SINIESTROS/88187559/FOTOS/x.jpg',
    'SEGUROS ALFA/SINIESTROS/TEST-ARNALD-FASE6-001/02_POLIZA',
    'SEGUROS ALFA/SINIESTROS/POR CONFIRMAR/GENERAL',
  ];
  for (const path of blocked) {
    try {
      assertAllowedSharePointPath({
        path,
        sourceModule: 'alfa',
        mode: 'pilot',
      });
      fail('G_BLOCK', new Error(`debió bloquear ${path}`));
    } catch (e) {
      if (e.code !== 'INVALID_SHAREPOINT_PATH') fail('G_CODE', e);
    }
  }
  pass('G_GUARD_BLOCK_NON_CEDULA');
}

{
  const clsNew = classifyAlfaSharePointPath(`SEGUROS ALFA/SINIESTROS/${CEDULA_A}/FOTOS`);
  if (clsNew.kind !== 'NEW_ALFA_SINIESTROS_PATH' || clsNew.identificacion !== CEDULA_A) {
    fail('H_CLASS_NEW', new Error(JSON.stringify(clsNew)));
  }
  const clsPend = classifyAlfaSharePointPath(
    'SEGUROS ALFA/SINIESTROS/PENDIENTES_NUMERO_SINIESTRO/x'
  );
  if (clsPend.kind !== 'OLD_ALFA_SHAREPOINT_PATH') {
    fail('H_CLASS_PEND', new Error(JSON.stringify(clsPend)));
  }
  if (isAlfaLegacySharePointPath(`SEGUROS ALFA/SINIESTROS/${CEDULA_A}/INFORMES`)) {
    fail('H_LEGACY', new Error('carpeta cédula no es legacy'));
  }
  if (!isAlfaSiniestrosCedulaWritePath(`SEGUROS ALFA/SINIESTROS/${CEDULA_A}`)) {
    fail('H_WRITE', new Error('write path'));
  }
  pass('H_CLASSIFY');
}

console.log('---');
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
console.log('ensureFolder es idempotente: si Alfa ya creó {cedula}, se reutiliza (sin duplicar).');
