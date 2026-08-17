import {
  construirFiltroVistaAsignacion,
  casoVisibleParaIdentidad,
  rolConVistaRestringidaAsignacion,
  coincidenPersonas,
  puedeEditarTodoElCaso,
  filtrarPayloadCasoPorRol,
  esLoginConPermisoLiderSura,
} from '../utils/permisosCasoPorRol.js';

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};

assert(rolConVistaRestringidaAsignacion('ajustador'), 'ajustador restringido');
assert(rolConVistaRestringidaAsignacion('inspector'), 'inspector restringido');
assert(!rolConVistaRestringidaAsignacion('ajustador_lider'), 'lider libre');
assert(!rolConVistaRestringidaAsignacion('admin'), 'admin libre');

const idAj = { rol: 'ajustador', name: 'Alexander Escalante', login: '1048210029' };
const f = construirFiltroVistaAsignacion(idAj);
assert(f && Array.isArray(f.$or), 'filtro mongo tiene or');

assert(casoVisibleParaIdentidad({ ajustador: 'Alexander Escalante' }, idAj), 've su caso');
assert(!casoVisibleParaIdentidad({ ajustador: 'Otro' }, idAj), 'no ve ajeno');
assert(
  casoVisibleParaIdentidad({ inspector: 'X' }, { rol: 'admin', name: 'A', login: 'a' }),
  'admin ve todo'
);

const idIns = { rol: 'inspector', name: 'Pedro Inspector', login: 'insp1' };
assert(casoVisibleParaIdentidad({ inspector: 'Pedro Inspector' }, idIns), 'inspector ve su caso');
assert(
  !casoVisibleParaIdentidad({ inspector: 'Otro', ajustador: 'Pedro Inspector' }, idIns),
  'inspector no usa campo ajustador'
);

assert(coincidenPersonas('José Pérez', 'Jose Perez'), 'acentos');

// Mario Pinilla (72288319): poderes de líder SOLO en SURA
assert(esLoginConPermisoLiderSura('72288319', 'sura'), 'mario es lider sura');
assert(!esLoginConPermisoLiderSura('72288319', 'alfa'), 'mario no es lider alfa');
assert(!esLoginConPermisoLiderSura('72288319', ''), 'mario sin modulo no');
assert(
  !rolConVistaRestringidaAsignacion('ajustador', { login: '72288319', modulo: 'sura' }),
  'mario sin vista restringida en sura'
);
assert(
  rolConVistaRestringidaAsignacion('ajustador', { login: '72288319', modulo: 'alfa' }),
  'mario restringido en alfa si es ajustador'
);
assert(
  puedeEditarTodoElCaso('ajustador', { login: '72288319', modulo: 'sura' }),
  'mario edita todo en sura'
);
assert(
  !puedeEditarTodoElCaso('ajustador', { login: '72288319', modulo: 'alfa' }),
  'mario no edita todo en alfa como ajustador'
);
assert(
  construirFiltroVistaAsignacion(
    { rol: 'ajustador', name: 'Mario', login: '72288319' },
    { modulo: 'sura' }
  ) === null,
  'mario sin filtro mongo en sura'
);
assert(
  casoVisibleParaIdentidad(
    { ajustador: 'Otro' },
    { rol: 'ajustador', name: 'Mario', login: '72288319' },
    { modulo: 'sura' }
  ),
  'mario ve caso ajeno en sura'
);
const { payload: payMario } = filtrarPayloadCasoPorRol(
  'ajustador',
  { ajustador: 'Nuevo', estado: 'X' },
  { ajustador: 'Viejo', estado: 'Y' },
  { login: '72288319', modulo: 'sura' }
);
assert(payMario.ajustador === 'Nuevo', 'mario puede cambiar asignacion en sura');

const { payload: payOtro } = filtrarPayloadCasoPorRol(
  'ajustador',
  { ajustador: 'Nuevo', estado: 'X' },
  { ajustador: 'Viejo', estado: 'Y' },
  { login: '999', modulo: 'sura' }
);
assert(payOtro.ajustador === 'Viejo', 'otro ajustador no cambia asignacion');

console.log(process.exitCode ? 'RESULTADO: fallos' : 'RESULTADO: ok');
