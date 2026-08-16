import {
  construirFiltroVistaAsignacion,
  casoVisibleParaIdentidad,
  rolConVistaRestringidaAsignacion,
  coincidenPersonas,
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
console.log(process.exitCode ? 'RESULTADO: fallos' : 'RESULTADO: ok');
