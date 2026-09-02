import {
  esIdentidadEra,
  esIdentidadLiderEra,
  esIdentidadLiderProserAjustes,
  casoMarcadoFirmaEra,
  LIDER_ERA,
} from '../utils/jerarquiaEra.js';
import { construirFiltroMongoPoolEra, casoPerteneceAPoolEra } from '../utils/alcanceEra.js';
import {
  modoEdicionEraDelCaso,
  filtrarPayloadCasoPorRol,
  puedeEditarTodoElCaso,
  rolConVistaRestringidaAsignacion,
} from '../utils/permisosCasoPorRol.js';
import { destinatariosMovimientoEra, construirContenidoNotificacion } from '../utils/notificacionesOperativasCore.js';

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};

const erick = {
  rol: 'contractor_era',
  role: 'contractor_era',
  login: LIDER_ERA.login,
  cedula: LIDER_ERA.login,
  name: 'Erick Aramis Quevedo Gonzalez (ERA)',
  empresa: 'ERA',
};
const cesar = {
  rol: 'contractor_era',
  login: '2272085666324',
  name: 'César Rodríguez Gutiérrez (ERA)',
  empresa: 'ERA',
};
const silvia = {
  rol: 'ajustador_lider',
  name: 'Silvia Rodriguez',
  login: 'silvia1',
};

assert(esIdentidadEra(erick), 'erick es ERA');
assert(esIdentidadLiderEra(erick), 'erick es lider ERA por login');
assert(!esIdentidadLiderEra(cesar), 'cesar no es lider ERA');
assert(esIdentidadLiderProserAjustes(silvia), 'silvia es lider proser ajustes');
assert(casoMarcadoFirmaEra({ firmaAjuste: 'ERA' }), 'sello firma ERA');
assert(!casoMarcadoFirmaEra({ firmaAjuste: '' }), 'sin sello no es pool por marca');

assert(puedeEditarTodoElCaso('contractor_era', erick), 'lider ERA edita todo');
assert(!puedeEditarTodoElCaso('contractor_era', cesar), 'ajustador ERA no edita todo');
assert(rolConVistaRestringidaAsignacion('contractor_era', cesar), 'ERA vista restringida');

assert(modoEdicionEraDelCaso({ ajustador: 'César Rodríguez Gutiérrez' }, cesar) === 'ajustador', 'cesar modo ajustador');
assert(
  modoEdicionEraDelCaso({ inspector: 'César Rodríguez Gutiérrez', ajustador: 'Otro' }, cesar) === 'inspector',
  'cesar modo inspector'
);
assert(modoEdicionEraDelCaso({ ajustador: 'Otro', inspector: 'Otro' }, cesar) === null, 'cesar sin asignacion');
assert(modoEdicionEraDelCaso({ ajustador: 'Otro' }, erick) === 'lider', 'erick siempre lider');

const { denegado } = filtrarPayloadCasoPorRol(
  'contractor_era',
  { estado: 'X', liquidador: { a: 1 } },
  { estado: 'Y', ajustador: 'Otro' },
  cesar
);
assert(denegado, 'ERA sin asignacion no edita');

const { payload: payAj, soloEstado: soloAj } = filtrarPayloadCasoPorRol(
  'contractor_era',
  { estado: 'Nuevo', ajustador: 'Hack' },
  { estado: 'Viejo', ajustador: 'César Rodríguez Gutiérrez' },
  cesar
);
assert(!soloAj && payAj.ajustador === 'César Rodríguez Gutiérrez', 'ajustador ERA no cambia asignacion');
assert(payAj.estado === 'Nuevo', 'ajustador ERA si cambia estado');

const { soloEstado } = filtrarPayloadCasoPorRol(
  'contractor_era',
  { estado: 'Nuevo', liquidador: { x: 1 } },
  { estado: 'Viejo', inspector: 'César Rodríguez Gutiérrez', ajustador: 'Otro' },
  cesar
);
assert(soloEstado, 'inspector ERA solo estado');

const personas = [erick, cesar];
assert(
  casoPerteneceAPoolEra({ ajustador: 'César Rodríguez Gutiérrez' }, personas),
  'caso de cesar entra al pool ERA'
);
assert(!casoPerteneceAPoolEra({ ajustador: 'Silvia Rodriguez' }, personas), 'caso de silvia no es pool ERA');
assert(casoPerteneceAPoolEra({ firmaAjuste: 'ERA', ajustador: 'Nadie' }, personas), 'sello ERA entra al pool');

const filtro = construirFiltroMongoPoolEra(personas);
assert(filtro.$or && filtro.$or.length > 2, 'filtro mongo pool tiene or');

const usuarios = [
  { _id: 's', login: 'silvia1', name: 'Silvia Rodriguez', role: 'ajustador_lider' },
  { _id: 'e', login: LIDER_ERA.login, name: 'Erick Aramis Quevedo Gonzalez', role: 'contractor_era', empresa: 'ERA' },
  { _id: 'c', login: '2272085666324', name: 'César Rodríguez Gutiérrez', role: 'contractor_era', empresa: 'ERA' },
];
const destEstado = destinatariosMovimientoEra(
  usuarios,
  { inspector: 'César Rodríguez Gutiérrez', ajustador: 'César Rodríguez Gutiérrez' },
  { login: '2272085666324', name: 'César Rodríguez Gutiérrez' }
);
assert(destEstado.some((u) => u.login === 'silvia1'), 'movimiento avisa a lider proser');
assert(destEstado.some((u) => u.login === LIDER_ERA.login), 'movimiento avisa a lider ERA');
assert(!destEstado.some((u) => u.login === '2272085666324'), 'no se avisa al actor');

const destInsp = destinatariosMovimientoEra(
  usuarios,
  { inspector: 'César Rodríguez Gutiérrez', ajustador: 'Erick Aramis Quevedo Gonzalez' },
  { login: '2272085666324', name: 'César Rodríguez Gutiérrez' }
);
assert(
  destInsp.some((u) => u.login === LIDER_ERA.login),
  'inspector ERA avisa al ajustador/lider del caso'
);

const msg = construirContenidoNotificacion({
  tipo: 'estado',
  modulo: 'alfa',
  actorNombre: 'César Rodríguez',
  detalle: 'Sin contactar → Contactado',
  casos: [{ id: '1', etiqueta: 'ALFA-1' }],
});
assert(msg.titulo.includes('estado') && msg.titulo.includes('Alfa'), 'titulo estado ERA');
assert(msg.mensaje.includes('César') && msg.mensaje.includes('ALFA-1'), 'mensaje trae actor y caso');

const msgLiq = construirContenidoNotificacion({
  tipo: 'liquidador',
  modulo: 'alfa',
  casos: [{ id: '1', etiqueta: 'ALFA-1' }],
});
assert(msgLiq.titulo.includes('liquidador'), 'titulo liquidador');

console.log(process.exitCode ? 'RESULTADO: fallos' : 'RESULTADO: ok');
