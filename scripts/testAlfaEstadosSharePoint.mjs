/**
 * OBJETADO / DESISTIDO en ARNALD → CERRADO en SharePoint (ESTADO SINIESTRO).
 * Uso: node scripts/testAlfaEstadosSharePoint.mjs
 */
import {
  ALFA_ESTADOS_UNIFICADOS,
  estadoAlfaParaSharePoint,
  homologarEstadoAlfa,
  isAlfaEstadoDefinido,
  shouldUpdateAlfaStatus,
  estadoGestionDesdeEstadoAlfa,
} from '../config/alfaExcelStatuses.js';

const errors = [];
function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

assert(ALFA_ESTADOS_UNIFICADOS.includes('OBJETADO'), 'catálogo debe incluir OBJETADO');
assert(ALFA_ESTADOS_UNIFICADOS.includes('DESISTIDO'), 'catálogo debe incluir DESISTIDO');

assert(homologarEstadoAlfa('OBJETADO') === 'OBJETADO', 'ARNALD conserva OBJETADO');
assert(homologarEstadoAlfa('DESISTIDO') === 'DESISTIDO', 'ARNALD conserva DESISTIDO');
assert(homologarEstadoAlfa('objetado') === 'OBJETADO', 'alias objetado');
assert(homologarEstadoAlfa('desistimiento') === 'DESISTIDO', 'alias desistimiento');

assert(estadoAlfaParaSharePoint('OBJETADO') === 'CERRADO', 'SharePoint OBJETADO → CERRADO');
assert(estadoAlfaParaSharePoint('DESISTIDO') === 'CERRADO', 'SharePoint DESISTIDO → CERRADO');
assert(estadoAlfaParaSharePoint('CERRADO') === 'CERRADO', 'SharePoint CERRADO se mantiene');
assert(estadoAlfaParaSharePoint('LIQUIDADO') === 'LIQUIDADO', 'SharePoint LIQUIDADO no se altera');
assert(
  estadoAlfaParaSharePoint('Sin contactar') === 'Sin contactar',
  'SharePoint gestión no se altera'
);

assert(isAlfaEstadoDefinido('OBJETADO'), 'OBJETADO es cierre');
assert(isAlfaEstadoDefinido('DESISTIDO'), 'DESISTIDO es cierre');
assert(estadoGestionDesdeEstadoAlfa('OBJETADO') === 'Inspeccionado', 'Excel AD gestión');
assert(estadoGestionDesdeEstadoAlfa('DESISTIDO') === 'Inspeccionado', 'Excel AD gestión desistido');

const desiste = shouldUpdateAlfaStatus({
  currentStatus: 'Sin contactar',
  incomingStatus: 'DESISTIDO',
});
assert(desiste.update === true, `DESISTIDO no debe tratarse como placeholder: ${desiste.reason}`);

const placeholder = shouldUpdateAlfaStatus({
  currentStatus: 'Sin contactar',
  incomingStatus: 'DESISTE',
});
assert(placeholder.update === false && placeholder.reason === 'PLACEHOLDER_INCOMING', 'DESISTE sigue siendo placeholder');

if (errors.length) {
  console.error('FAIL');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('OK');
