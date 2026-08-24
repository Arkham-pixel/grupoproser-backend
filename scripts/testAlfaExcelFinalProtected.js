/**
 * Blindaje: consolidado *_Final.xlsx nunca es el archivo operativo ARNALD.
 * Uso: node scripts/testAlfaExcelFinalProtected.js
 */
import {
  isAlfaExcelFinalProtectedName,
  toAlfaExcelOperationalFileName,
  assertAlfaExcelNotFinalProtected,
} from '../utils/alfaExcelSharePointPath.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const FINAL = 'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali_Final.xlsx';
const OP = 'CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';

assert(isAlfaExcelFinalProtectedName(FINAL), 'detect Final');
assert(!isAlfaExcelFinalProtectedName(OP), 'operativo no es Final');
assert(toAlfaExcelOperationalFileName(FINAL) === OP, 'strip _Final');
assert(toAlfaExcelOperationalFileName(OP) === OP, 'noop operativo');

let threw = false;
try {
  assertAlfaExcelNotFinalProtected(FINAL);
} catch (e) {
  threw = e.code === 'ALFA_EXCEL_FINAL_PROTECTED';
}
assert(threw, 'assert bloquea Final');

console.log('OK testAlfaExcelFinalProtected — ARNALD solo opera sin _Final');
