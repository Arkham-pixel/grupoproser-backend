/**
 * Parseo COP Alfa: puntos de miles vs decimales.
 * node scripts/testAlfaCopMoney.mjs
 */
import { parseCopMoney, normalizeMoney, pesosOficialesAlfa, pareceIdentificacionComoMontoAlfa } from '../utils/alfaExcelNormalize.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(parseCopMoney(36_208_706.98) === 36_208_706.98, 'number with cents');
assert(parseCopMoney('36.208.707') === 36_208_707, 'CO thousands');
assert(parseCopMoney('36.208.706,98') === 36_208_706.98, 'CO thousands+decimal');
assert(parseCopMoney('36208706.98') === 36_208_706.98, 'JS decimal string');
assert(parseCopMoney('$ 36.208.707') === 36_208_707, 'currency text');
assert(normalizeMoney('3.620.870.698') === 3_620_870_698, 'already-grouped digits');
assert(parseCopMoney('36.208.707') !== 36.208707, 'must not treat dots as decimals');
assert(Number.isNaN(Number('36.208.707')), 'sanity: Number() fails on CO format');
assert(pesosOficialesAlfa(3_668_964_288) === 36_689_643, 'concatenated cents .88');
assert(pesosOficialesAlfa(36_689_642.88) === 36_689_643, 'round hidden cents');
assert(pesosOficialesAlfa(36_689_642) === 36_689_642, 'already pesos');
assert(
  pesosOficialesAlfa(1_118_293_088, '1118293088') == null,
  'cédula no se divide como centavos'
);
assert(
  pareceIdentificacionComoMontoAlfa(11_182_931, '1118293088'),
  '11.182.931 es cédula/100'
);
assert(
  pareceIdentificacionComoMontoAlfa(796_486, '796486'),
  'cédula de 6 dígitos pegada como reclamado'
);
assert(
  !pareceIdentificacionComoMontoAlfa(352_092, '16379822'),
  'daño real no es la cédula'
);
assert(pesosOficialesAlfa(759_781_212) === 759_781_212, 'sin liquidador no divide < 1e9');

console.log('OK testAlfaCopMoney');
