/**
 * Valida el payload de alertas Alfa: asegurado ≠ tomador, estados de cierre
 * e inactividad por fecha más reciente.
 * RESULT esperado: OK
 */
import {
  nombreAseguradoAlfa,
  casoAlfaAFormatoEmail,
  generarAlertasCasoAlfa,
  evaluarAlertaInactividadAlfa,
  resolverActividadInactividadAlfa,
  fechaBaseInactividadAlfa,
} from '../services/alertasAlfaService.js';

const errors = [];
const ahora = new Date('2026-08-28T15:00:00-05:00');

function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

const caso = {
  _id: 'id1',
  consecutivo: 'ALFA-2026-08-11',
  siniestro: 'SID-9988',
  identificacion: '66923951',
  asegurado: 'Yenny Rios Garcia',
  tomador: 'BANCO DE BOGOTA',
  ajustador: 'FABIAN BRAVO',
  estado: 'Solicitud de documentos',
  ciudad: 'Cali',
  fechaUltimoDocumento: new Date('2026-01-01T12:00:00Z'),
  fechaLlamada: new Date('2026-08-20T12:00:00Z'),
  updatedAt: new Date('2026-08-25T12:00:00Z'),
  createdAt: new Date('2026-08-01T12:00:00Z'),
};

assert(
  nombreAseguradoAlfa(caso) === 'Yenny Rios Garcia',
  `asegurado debía ser la persona, no el banco: ${nombreAseguradoAlfa(caso)}`
);

const email = casoAlfaAFormatoEmail({
  ...caso,
  numeroSiniestro: caso.siniestro,
  totalAlertas: 1,
  alertas: [],
});
assert(email.asegurado === 'Yenny Rios Garcia', 'email.asegurado incorrecto');
assert(email.tomador === 'BANCO DE BOGOTA', 'email.tomador incorrecto');
assert(email.numeroSiniestro === 'SID-9988', 'siniestro incorrecto');
assert(email.identificacion === '66923951', 'identificacion incorrecta');
assert(email.numeroAjuste === 'ALFA-2026-08-11', 'consecutivo incorrecto');

const actividad = resolverActividadInactividadAlfa(caso);
assert(actividad?.origen === 'última actualización del caso', `origen=${actividad?.origen}`);
assert(
  fechaBaseInactividadAlfa(caso)?.toISOString() === caso.updatedAt.toISOString(),
  'debía usar updatedAt (más reciente), no fechaUltimoDocumento del Excel'
);

const alertaVieja = evaluarAlertaInactividadAlfa(
  {
    ...caso,
    updatedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    fechaLlamada: null,
    fechaInspeccion: null,
  },
  ahora
);
assert(alertaVieja, 'debía alertar con 30+ días reales');
assert(
  !String(alertaVieja.mensaje).includes('BANCO'),
  'el mensaje no debe mezclar el tomador'
);

const alertaReciente = evaluarAlertaInactividadAlfa(caso, ahora);
assert(!alertaReciente, 'no debía alertar: updatedAt es de hace 3 días');

assert(
  generarAlertasCasoAlfa({ ...caso, estado: 'LIQUIDADO' }, ahora).length === 0,
  'LIQUIDADO no debe generar alerta'
);
assert(
  generarAlertasCasoAlfa({ ...caso, estado: 'ENVIADO ASEGURADORA' }, ahora).length === 0,
  'ENVIADO ASEGURADORA no debe generar alerta'
);
assert(
  generarAlertasCasoAlfa({ ...caso, estado: 'CERRADO' }, ahora).length === 0,
  'CERRADO no debe generar alerta'
);

const alertasAbiertas = generarAlertasCasoAlfa(
  {
    ...caso,
    updatedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    fechaLlamada: null,
    fechaInspeccion: null,
    fechaUltimoDocumento: null,
  },
  ahora
);
assert(alertasAbiertas.length === 1, 'caso abierto inactivo debía alertar');
assert(
  alertasAbiertas[0].asegurado === 'Yenny Rios Garcia',
  `alerta.asegurado=${alertasAbiertas[0].asegurado}`
);
assert(alertasAbiertas[0].tomador === 'BANCO DE BOGOTA', 'alerta.tomador incorrecto');
assert(alertasAbiertas[0].numeroSiniestro === 'SID-9988', 'alerta.siniestro incorrecto');

if (errors.length) {
  console.error('FAIL');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('OK');
