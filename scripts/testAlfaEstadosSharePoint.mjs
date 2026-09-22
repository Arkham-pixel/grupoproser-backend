/**
 * Estados Alfa duales → SharePoint (gestión + siniestro independientes).
 * Uso: node scripts/testAlfaEstadosSharePoint.mjs
 */
import {
  ALFA_ESTADOS_GESTION,
  ALFA_ESTADOS_SINIESTRO,
  estadoAlfaParaSharePoint,
  estadoGestionAlfaParaSharePoint,
  homologarEstadoGestionAlfa,
  homologarEstadoSiniestroAlfa,
  sincronizarGestionConCierreSiniestroAlfa,
} from '../config/alfaExcelStatuses.js';

const errors = [];
function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

assert(!ALFA_ESTADOS_GESTION.includes('EN GESTIÓN'), 'EN GESTIÓN ya no en catálogo');
assert(ALFA_ESTADOS_GESTION.includes('PTE CONTACTO'), 'gestión PTE CONTACTO');
assert(ALFA_ESTADOS_GESTION.includes('CONTACTADO Y PROGRAMADO'), 'gestión CONTACTADO Y PROGRAMADO');
assert(ALFA_ESTADOS_GESTION.includes('SIN PÓLIZA'), 'gestión SIN PÓLIZA');
assert(ALFA_ESTADOS_SINIESTRO.includes('PENDIENTE'), 'siniestro PENDIENTE');
assert(ALFA_ESTADOS_SINIESTRO.includes('PENDIENTE ACEPTACION CIFRAS'), 'siniestro cifras');

assert(homologarEstadoGestionAlfa('EN GESTIÓN') === 'PTE CONTACTO', 'EN GESTIÓN→PTE CONTACTO');
assert(homologarEstadoGestionAlfa('Sin contactar') === 'PTE CONTACTO', 'legacy→PTE CONTACTO');
assert(
  homologarEstadoGestionAlfa('Contactado y programado') === 'CONTACTADO Y PROGRAMADO',
  'legacy→CONTACTADO Y PROGRAMADO'
);
assert(homologarEstadoGestionAlfa('Solicitud de documentos') === 'SOLICITUD DTOS', 'legacy docs→SOLICITUD DTOS');
assert(homologarEstadoGestionAlfa('Sin respuesta') === 'SIN RESPUESTA EFECTIVA', 'legacy sin respuesta');
assert(homologarEstadoGestionAlfa('CERRADO') === 'SIN PÓLIZA', 'gestión CERRADO→SIN PÓLIZA');
assert(
  sincronizarGestionConCierreSiniestroAlfa('OBJETADO', 'INSPECCIONADO') === 'LIQUIDADO',
  'objetado→gestión LIQUIDADO'
);
assert(
  sincronizarGestionConCierreSiniestroAlfa('DESISTIDO', 'PTE CONTACTO') === 'INSPECCIONADO',
  'desistido→INSPECCIONADO'
);
assert(estadoGestionAlfaParaSharePoint('EN GESTIÓN') === 'PTE CONTACTO', 'SP gestión');
assert(estadoAlfaParaSharePoint('PROCESO DE PAGO') === 'PROCESO DE PAGO', 'SP pago');
assert(homologarEstadoSiniestroAlfa('LIQUIDADO') === 'PENDIENTE ACEPTACION CIFRAS', 'liq→cifras');

if (errors.length) {
  console.error('FAIL', errors);
  process.exit(1);
}
console.log('OK testAlfaEstadosSharePoint');
