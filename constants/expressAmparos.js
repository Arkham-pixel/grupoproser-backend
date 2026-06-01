/** @deprecated Usar catálogo MongoDB vía /api/express-catalogos */
export {
  AMPAROS_EXPRESS_DEFAULT as AMPAROS_EXPRESS,
} from './expressCatalogoDefaults.js';

import { AMPAROS_EXPRESS_DEFAULT } from './expressCatalogoDefaults.js';

const normAmparo = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

export const normalizarAmparoExpress = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const objetivo = normAmparo(value);
  return AMPAROS_EXPRESS_DEFAULT.find((item) => normAmparo(item) === objetivo) ?? null;
};

export const resolverAmparoExpress = (value, fallback = 'RC PLO') => {
  const canon = normalizarAmparoExpress(value);
  if (canon) return canon;
  const texto = value === null || value === undefined || value === '' ? null : String(value).trim();
  return texto || fallback;
};
