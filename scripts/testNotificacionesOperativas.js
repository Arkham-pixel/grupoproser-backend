import {
  asignacionCambio,
  asignacionQuitada,
  coincidenPorId,
  construirContenidoNotificacion,
  destinatariosAsignacion,
  destinatariosCasoNuevo,
  esMismoActor,
  etiquetaCaso,
  needlesLiderModulo,
  usuarioCoincideNombre,
  valorAsignacionVacio,
} from '../utils/notificacionesOperativasCore.js';
import { instanteBogota } from '../utils/agendaCatastrofico.js';

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};

assert(valorAsignacionVacio(''), 'vacio');
assert(valorAsignacionVacio('PENDIENTE'), 'pendiente');
assert(!valorAsignacionVacio('Alexander Escalante'), 'nombre real');
assert(asignacionCambio('', 'Alexander Escalante'), 'nueva asignacion');
assert(!asignacionCambio('Alexander Escalante', 'Alexander Escalante'), 'misma persona');
assert(asignacionCambio('Otro', 'Alexander Escalante'), 'cambio de persona');
assert(!asignacionCambio('Alexander Escalante', ''), 'vaciar no es asignacion');
assert(!asignacionCambio('Alexander Escalante', 'PENDIENTE'), 'pendiente no es asignacion');
assert(asignacionQuitada('Alexander Escalante', ''), 'vaciar es desasignacion');
assert(asignacionQuitada('Alexander Escalante', 'PENDIENTE'), 'pendiente es desasignacion');
assert(asignacionQuitada('Alexander Escalante', 'Otro'), 'reemplazo quita al anterior');
assert(!asignacionQuitada('', 'Alexander Escalante'), 'alta no es desasignacion');
assert(!asignacionQuitada('Alexander Escalante', 'Alexander Escalante'), 'misma persona no quita');

assert(etiquetaCaso({ consecutivo: 'EQUIDAD-CAT-2026-09-1', siniestro: 'S-1' }).includes('S-1'), 'etiqueta');

assert(needlesLiderModulo('zurich').includes('LADYS'), 'needle zurich');
assert(needlesLiderModulo('alfa').includes('SILVIA'), 'needle alfa');

const usuarios = [
  { _id: '1', login: 'l1', name: 'Ladys Andrea Escalante', role: 'ajustador' },
  { _id: '2', login: 'l2', name: 'Silvia Perez', role: 'ajustador_lider' },
  { _id: '3', login: 'l3', name: 'Inspector Uno', role: 'inspector' },
  { _id: '4', login: 'l4', name: 'Bernardo Sojo', role: 'ajustador_lider' },
  { _id: '5', login: '72288319', name: 'Mario Pinilla', role: 'ajustador' },
];

const lideresZurich = destinatariosCasoNuevo(usuarios, 'zurich', {}, { login: 'admin' });
assert(
  lideresZurich.some((u) => u.login === 'l1') && lideresZurich.some((u) => u.login === 'l2'),
  'lideres zurich incluyen ladys y rol lider'
);

const lideresSura = destinatariosCasoNuevo(usuarios, 'sura', {}, null);
assert(lideresSura.some((u) => u.login === '72288319'), 'mario lider sura');
assert(lideresSura.some((u) => u.login === 'l4'), 'bernardo lider sura');

const asignados = destinatariosAsignacion(usuarios, 'inspector', 'Inspector Uno', { login: 'l2' });
assert(asignados.length === 1 && asignados[0].login === 'l3', 'asigna inspector');

const autoAsignado = destinatariosAsignacion(usuarios, 'inspector', 'Inspector Uno', {
  login: 'l3',
});
assert(autoAsignado.some((u) => u.login === 'l3'), 'autoasignacion notifica al actor');

const externo = {
  _id: '9',
  login: '22588713',
  name: 'Kimberlys Aguilar Arias',
  role: 'contractor_solo_equidad_cat',
  cedula: '22588713',
  email: 'kimberly3018@gmail.com',
};
const catalogoAj = [
  { nombre: 'Kimberlys Aguilar Arias', codigo: 'AJU-22588713', email: 'kimberly3018@gmail.com' },
];
assert(
  destinatariosAsignacion([externo], 'ajustador', 'Kimberlys Aguilar Arias', { login: 'admin' }, catalogoAj)
    .some((u) => u.login === '22588713'),
  'asignado desde otro usuario por nombre/catalogo'
);

assert(esMismoActor(usuarios[1], { login: 'l2', id: '2' }), 'excluye actor');
assert(!usuarioCoincideNombre(usuarios[2], 'Otro'), 'no match ajeno');

const oscar = {
  _id: 'oscar',
  login: '1065012991',
  name: 'Oscar Javier Atencia Oliva',
  role: 'admin',
  cedula: '1065012991',
};
assert(
  usuarioCoincideNombre(oscar, 'Oscar Atencia'),
  'Oscar Javier Atencia Oliva coincide con Oscar Atencia'
);
assert(
  destinatariosAsignacion([oscar], 'ajustador', 'Oscar Atencia', { login: '1041899782' }).some(
    (u) => u.login === '1065012991'
  ),
  'Ladys asigna a Oscar (admin) y le llega notificación'
);

assert(
  coincidenPorId(
    { _id: 'u1', login: '1065012991', cedula: '1065012991' },
    { _id: 'cat1', codigo: 'AJU-1065012991' }
  ),
  'usuario y ajustador se cruzan por cédula/codigo'
);
assert(
  coincidenPorId(
    { _id: '64a1b2c3d4e5f678901234ab', login: 'x' },
    { usuarioId: '64a1b2c3d4e5f678901234ab', codigo: 'AJU-99' }
  ),
  'usuario y catálogo se cruzan por _id/usuarioId'
);
assert(
  !coincidenPorId({ login: '111', cedula: '111' }, { codigo: 'AJU-222' }),
  'ids distintos no cruzan'
);

const oscarSoloId = {
  _id: '64a1b2c3d4e5f678901234ab',
  login: '1065012991',
  cedula: '1065012991',
  name: 'Nombre distinto al catálogo',
  role: 'admin',
};
const catalogoOscar = [
  {
    _id: 'cat-oscar',
    nombre: 'Oscar Atencia',
    codigo: 'AJU-1065012991',
    usuarioId: '64a1b2c3d4e5f678901234ab',
  },
];
assert(
  destinatariosAsignacion(
    [oscarSoloId],
    'ajustador',
    'Oscar Atencia',
    { login: '1041899782' },
    catalogoOscar
  ).some((u) => u.login === '1065012991'),
  'asigna por nombre de catálogo y resuelve usuario por codigo/id'
);
assert(
  destinatariosAsignacion(
    [oscarSoloId],
    'ajustador',
    'AJU-1065012991',
    { login: '1041899782' },
    catalogoOscar
  ).some((u) => u.login === '1065012991'),
  'asigna por codigo de ajustador'
);
assert(
  destinatariosAsignacion(
    [{ _id: 'u9', login: '999', name: 'Sin id comun', role: 'ajustador', email: 'a@x.com' }],
    'ajustador',
    'Otra Persona',
    { login: 'admin' },
    [{ nombre: 'Otra Persona', codigo: 'AJU-000', email: 'a@x.com' }]
  ).some((u) => u.login === '999'),
  'sin id comun usa email'
);

const msg = construirContenidoNotificacion({
  tipo: 'asignacion',
  modulo: 'equidadCat',
  campo: 'ajustador',
  casos: [{ id: 'abc', etiqueta: 'EQ-1 · S-9' }],
});
assert(msg.titulo.includes('Equidad CAT'), 'titulo modulo');
assert(msg.titulo.includes('ajustador'), 'titulo dice ajustador');
assert(msg.ruta.includes('/equidad-cat/reporte') && msg.ruta.includes('casoId=abc'), 'ruta caso al reporte');

const msgInsp = construirContenidoNotificacion({
  tipo: 'asignacion',
  modulo: 'zurichListado',
  campo: 'inspector',
  casos: [{ id: 'z1', etiqueta: 'Z-1' }],
});
assert(msgInsp.titulo.includes('inspector'), 'titulo dice inspector');
assert(msgInsp.ruta.includes('/zurich/listado/reporte'), 'zurich listado va al reporte');

const msgQuita = construirContenidoNotificacion({
  tipo: 'desasignacion',
  modulo: 'zurichListado',
  campo: 'ajustador',
  casos: [{ id: 'z2', etiqueta: 'ZURICH-LST-2026-08-170 · 183185' }],
});
assert(msgQuita.titulo.includes('desasignaron'), 'titulo dice desasignaron');
assert(msgQuita.titulo.includes('ajustador'), 'desasignacion dice rol');
assert(msgQuita.titulo.includes('Zurich'), 'desasignacion dice modulo');
assert(msgQuita.ruta.includes('/zurich/listado/reporte') && msgQuita.ruta.includes('casoId=z2'), 'desasignacion va al reporte');

const msgLote = construirContenidoNotificacion({
  tipo: 'caso_nuevo',
  modulo: 'alfa',
  casos: [
    { id: '1', etiqueta: 'A' },
    { id: '2', etiqueta: 'B' },
  ],
});
assert(msgLote.cantidad === 2 && msgLote.ruta.includes('/seguros-alfa/reporte'), 'lote va al reporte');

const msgEstadoEra = construirContenidoNotificacion({
  tipo: 'estado',
  modulo: 'alfa',
  actorNombre: 'César Rodríguez',
  detalle: 'A → B',
  casos: [{ id: 'a1', etiqueta: 'ALFA-1' }],
});
assert(msgEstadoEra.titulo.includes('estado'), 'titulo movimiento estado');
assert(msgEstadoEra.mensaje.includes('César'), 'mensaje movimiento trae actor');

const msgVisita = construirContenidoNotificacion({
  tipo: 'visita',
  modulo: 'zurichListado',
  campo: 'ajustador',
  anticipacionMin: 15,
  casos: [
    {
      id: 'v1',
      etiqueta: 'ZURICH-LST-2026-08-170 · 183185',
      fecha: '2026-09-02',
      horaInicio: '10:00',
      horaFin: '11:00',
    },
  ],
});
assert(msgVisita.titulo.includes('15 min'), 'visita avisa minutos');
assert(msgVisita.titulo.includes('Zurich'), 'visita dice modulo');
assert(msgVisita.mensaje.includes('ajustador'), 'visita dice rol');
assert(msgVisita.ruta.includes('/agenda-catastrofico?fecha=2026-09-02'), 'visita abre el calendario');

const instante = instanteBogota('2026-09-02', '10:00');
assert(instante && instante.toISOString() === '2026-09-02T15:00:00.000Z', 'instante bogota 10:00 = 15:00 UTC');
assert(!instanteBogota('2026-09-02', ''), 'sin hora no hay instante');

if (process.exitCode) {
  console.error('testNotificacionesOperativas: hay fallos');
} else {
  console.log('testNotificacionesOperativas: ok');
}
