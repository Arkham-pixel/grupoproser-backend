/**
 * Merge Excel ↔ ARNALD: vacío no borra lleno.
 *   node scripts/testAlfaExcelEmptyMerge.js
 */
import {
  decideAlfaExcelMerge,
  isAlfaOutboundEmptyValue,
  mergeAlfaImportValue,
} from '../utils/alfaExcelNormalize.js';
import { computeAlfaImportDiff } from '../services/alfaCasoService.js';
import { ALFA_EXCEL_UPDATABLE_FIELDS } from '../config/alfaExcelColumnMap.js';

function pass(k) {
  console.log(`${k}: PASSED`);
}
function fail(k, e) {
  throw new Error(`${k}: ${e?.message || e}`);
}

{
  const d = decideAlfaExcelMerge('', 'dato-arnald', { field: 'correo' });
  if (d.action !== 'KEEP_ARNALD_EXCEL_EMPTY' || d.value !== 'dato-arnald') {
    fail('A', new Error(JSON.stringify(d)));
  }
  pass('A_EXCEL_VACIO_ARNALD_LLENO');
}

{
  const d = decideAlfaExcelMerge('desde-excel', '', { field: 'correo' });
  if (d.action !== 'FILL_FROM_EXCEL' || d.value !== 'desde-excel') {
    fail('B', new Error(JSON.stringify(d)));
  }
  pass('B_EXCEL_LLENO_ARNALD_VACIO');
}

{
  const d = decideAlfaExcelMerge('nuevo', 'viejo', { field: 'correo', arnaldOwned: false });
  if (d.action !== 'UPDATE_FROM_EXCEL' || d.value !== 'nuevo') {
    fail('C', new Error(JSON.stringify(d)));
  }
  pass('C_VERDE_AMBOS_LLENOS_EXCEL_GANA');
}

{
  const d = decideAlfaExcelMerge('2026-08-01', '2026-07-01', {
    field: 'fechaInspeccion',
    arnaldOwned: true,
  });
  if (d.action !== 'KEEP_ARNALD_OWNED' || d.value !== '2026-07-01') {
    fail('D', new Error(JSON.stringify(d)));
  }
  pass('D_AMARILLO_AMBOS_LLENOS_ARNALD_GANA');
}

{
  const d = decideAlfaExcelMerge('POR CONFIRMAR', 'INC-008', { field: 'numeroPoliza' });
  if (d.value !== 'INC-008') {
    fail('E', new Error(JSON.stringify(d)));
  }
  pass('E_POLIZA_PLACEHOLDER');
}

{
  if (mergeAlfaImportValue('', 'keep@test.com') !== 'keep@test.com') {
    fail('F', new Error('merge vacío'));
  }
  pass('F_MERGE_COMPAT');
}

{
  const diff = computeAlfaImportDiff(
    { correo: '', fechaInspeccion: '2026-08-10', valorLiquidado: 1000 },
    { correo: 'keep@test.com', fechaInspeccion: '2026-07-01', valorLiquidado: null },
    ALFA_EXCEL_UPDATABLE_FIELDS
  );
  if (diff.patch.correo) fail('G_CORREO', new Error('no debe pisar correo'));
  if (diff.patch.fechaInspeccion) fail('G_FECHA', new Error('amarillo lleno no se pisa'));
  if (diff.patch.valorLiquidado !== 1000) fail('G_LIQ', new Error(JSON.stringify(diff.patch)));
  pass('G_DIFF_NO_BORRA');
}

{
  if (!isAlfaOutboundEmptyValue(null)) fail('H', new Error('null'));
  if (!isAlfaOutboundEmptyValue('')) fail('H', new Error('empty'));
  if (isAlfaOutboundEmptyValue('PENDIENTE')) fail('H', new Error('PENDIENTE es valor'));
  if (isAlfaOutboundEmptyValue(0)) fail('H', new Error('0 es valor'));
  pass('H_OUTBOUND_EMPTY');
}

{
  const d = decideAlfaExcelMerge(
    'MORALES POVEDA DANIELA',
    'DANIELA MORALES POVEDA',
    { field: 'asegurado' }
  );
  if (d.action !== 'UNCHANGED' || d.value !== 'DANIELA MORALES POVEDA') {
    fail('I', new Error(JSON.stringify(d)));
  }
  pass('I_NOMBRE_MISMO_ORDEN');
}

{
  const d = decideAlfaExcelMerge(
    'SOFIA ALEJANDRA ROPERO',
    'SOFIA ALEJANDRA ROPERO PAREDES',
    { field: 'asegurado' }
  );
  if (d.value !== 'SOFIA ALEJANDRA ROPERO PAREDES') {
    fail('J', new Error(JSON.stringify(d)));
  }
  pass('J_NOMBRE_SIN_APELLIDO_EXTRA');
}

{
  const d = decideAlfaExcelMerge(
    'Av 3 e # 52 norte - 25',
    'AV 3 E 52 NORTE 25',
    { field: 'direccionPredio' }
  );
  if (d.action !== 'UNCHANGED') fail('K', new Error(JSON.stringify(d)));
  pass('K_DIRECCION_FORMATO');
}

{
  const d = decideAlfaExcelMerge(
    'SOFIAROPERO@GMAIL.COM',
    'sofiaropero@gmail.com',
    { field: 'correo' }
  );
  if (d.action !== 'UNCHANGED') fail('L', new Error(JSON.stringify(d)));
  pass('L_CORREO_MAYUSCULAS');
}

{
  const d = decideAlfaExcelMerge('PEDRO GOMEZ', 'JUAN PEREZ', { field: 'asegurado' });
  if (d.action !== 'UPDATE_FROM_EXCEL' || d.value !== 'PEDRO GOMEZ') {
    fail('M', new Error(JSON.stringify(d)));
  }
  pass('M_NOMBRE_REAL_SI_CAMBIA');
}

console.log('--- merge Excel/ARNALD: vacío no borra lleno ---');
