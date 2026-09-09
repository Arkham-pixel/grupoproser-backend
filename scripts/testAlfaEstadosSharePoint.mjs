/**
 * Estados Alfa duales → SharePoint (gestión + siniestro independientes).
 * Uso: node scripts/testAlfaEstadosSharePoint.mjs
 */
import {
  ALFA_ESTADOS_GESTION,
  ALFA_ESTADOS_SINIESTRO,
  aplicarObservacionAutoCierreAlfa,
  estadoAlfaParaSharePoint,
  estadoGestionAlfaParaSharePoint,
  homologarEstadoAlfa,
  homologarEstadoGestionAlfa,
  homologarEstadoSiniestroAlfa,
  isAlfaEstadoDefinido,
} from '../config/alfaExcelStatuses.js';

const errors = [];
function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

assert(ALFA_ESTADOS_GESTION.includes('EN GESTIÓN'), 'gestión EN GESTIÓN');
assert(ALFA_ESTADOS_GESTION.includes('CONTACTADO/PROGRAMADO'), 'gestión CONTACTADO/PROGRAMADO');
assert(ALFA_ESTADOS_SINIESTRO.includes('PENDIENTE'), 'siniestro PENDIENTE');
assert(ALFA_ESTADOS_SINIESTRO.includes('PENDIENTE ACEPTACION CIFRAS'), 'siniestro cifras');

assert(homologarEstadoGestionAlfa('Sin contactar') === 'EN GESTIÓN', 'legacy→EN GESTIÓN');
assert(
  homologarEstadoGestionAlfa('Contactado y programado') === 'CONTACTADO/PROGRAMADO',
  'legacy→CONTACTADO/PROGRAMADO'
);
assert(homologarEstadoSiniestroAlfa('ENVIADO ASEGURADORA') === 'PROCESO DE PAGO', 'enviado→pago');
assert(homologarEstadoSiniestroAlfa('OBJETADO') === 'OBJETADO', 'objetado real');
assert(homologarEstadoSiniestroAlfa('DESISTIDO') === 'DESISTIDO', 'desistido real');
assert(homologarEstadoAlfa('CERRADO') === 'CERRADO', 'cerrado');

assert(estadoAlfaParaSharePoint('OBJETADO') === 'OBJETADO', 'SP objetado libre');
assert(estadoAlfaParaSharePoint('DESISTIDO') === 'DESISTIDO', 'SP desistido libre');
assert(estadoAlfaParaSharePoint('PROCESO DE PAGO') === 'PROCESO DE PAGO', 'SP pago');
assert(
  estadoGestionAlfaParaSharePoint('SIN RESPUESTA EFECTIVA') === 'SIN RESPUESTA EFECTIVA',
  'SP gestión'
);
assert(isAlfaEstadoDefinido('CERRADO'), 'cerrado definido');
assert(!isAlfaEstadoDefinido('PENDIENTE'), 'pendiente no definido');

assert(
  aplicarObservacionAutoCierreAlfa('OBJETADO', '') === 'Caso objetado.',
  'obs objetado'
);
assert(
  aplicarObservacionAutoCierreAlfa('DESISTIDO', '') === 'Caso desistido.',
  'obs desistido'
);

if (errors.length) {
  console.error('FAIL');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('OK');
