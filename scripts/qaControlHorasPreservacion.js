/**
 * QA estático: lógica de preservación de control_horas (sin BD).
 * Ejecutar: node scripts/qaControlHorasPreservacion.js
 */
import { controlHorasTieneDatos } from '../utils/controlHorasUtils.js';

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}`);
  }
}

function simularPreservacionBackend(anteriorCH, incomingCH) {
  const datos = { control_horas: incomingCH };
  if (datos.control_horas !== undefined) {
    if (datos.control_horas === null) {
      delete datos.control_horas;
    } else if (!controlHorasTieneDatos(datos.control_horas) && controlHorasTieneDatos(anteriorCH)) {
      delete datos.control_horas;
    }
  }
  return datos.control_horas;
}

function simularPreservacionFrontend(payloadCH, initialCH) {
  const resultado = { control_horas: payloadCH };
  if (!controlHorasTieneDatos(resultado.control_horas) && controlHorasTieneDatos(initialCH)) {
    resultado.control_horas = initialCH;
  } else if (!controlHorasTieneDatos(resultado.control_horas)) {
    delete resultado.control_horas;
  }
  return resultado.control_horas;
}

const chConDatos = {
  filas: [{ horas_viaje: 2, horas_campo: 0, horas_oficina: 0, horas_secretaria: 0, descripcion: 'Visita' }],
};
const chVacio = { filas: [] };
const chFilasSinHoras = { filas: [{ horas_viaje: 0, horas_campo: 0, descripcion: '' }] };
const chSoloDescripcion = { filas: [{ descripcion: 'Nota sin horas' }] };

console.log('\n=== QA controlHorasTieneDatos ===\n');
assert('null → false', !controlHorasTieneDatos(null));
assert('filas vacías → false', !controlHorasTieneDatos(chVacio));
assert('filas con horas → true', controlHorasTieneDatos(chConDatos));
assert('solo descripción → true', controlHorasTieneDatos(chSoloDescripcion));
assert('filas sin datos → false', !controlHorasTieneDatos(chFilasSinHoras));

console.log('\n=== QA preservación backend (actualizarComplex) ===\n');
assert(
  'payload vacío + anterior con datos → no sobrescribe (undefined)',
  simularPreservacionBackend(chConDatos, chVacio) === undefined
);
assert(
  'payload null → ignorado',
  simularPreservacionBackend(chConDatos, null) === undefined
);
assert(
  'payload con datos → se acepta',
  controlHorasTieneDatos(simularPreservacionBackend(chVacio, chConDatos))
);

console.log('\n=== QA preservación frontend (prepararPayload) ===\n');
assert(
  'payload vacío + initial con datos → restaura initial',
  simularPreservacionFrontend(chVacio, chConDatos) === chConDatos
);
assert(
  'payload vacío sin initial → elimina campo',
  simularPreservacionFrontend(chVacio, null) === undefined
);
assert(
  'payload con datos → conserva payload',
  simularPreservacionFrontend(chConDatos, chVacio) === chConDatos
);

console.log('\n=== QA buildFormAutoSaveKey ===\n');
function buildKey(base, id) {
  if (id && id !== 'nuevo') return `${base}-${id}`;
  return `${base}-nuevo`;
}
assert('con id → clave única', buildKey('complex', 'abc123') === 'complex-abc123');
assert('sin id → borrador nuevo', buildKey('complex', null) === 'complex-nuevo');
assert('id nuevo → borrador', buildKey('complex', 'nuevo') === 'complex-nuevo');

console.log(`\n--- Resultado: ${passed} OK, ${failed} FALLIDOS ---\n`);
process.exit(failed > 0 ? 1 : 0);
