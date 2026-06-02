import Responsable from '../models/Responsable.js';

export const normNombreResponsable = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const tokensNombre = (nombreNorm) => nombreNorm.split(' ').filter(Boolean);

const variantesNombre = (nombreNorm) => {
  const variants = new Set([nombreNorm]);
  const parts = tokensNombre(nombreNorm);
  if (!parts.length) return [...variants];

  const last = parts[parts.length - 1];
  if (last.endsWith('S') && last.length > 2) {
    const copy = [...parts];
    copy[copy.length - 1] = last.slice(0, -1);
    variants.add(copy.join(' '));
  } else if (last.length > 2) {
    const copy = [...parts];
    copy[copy.length - 1] = `${last}S`;
    variants.add(copy.join(' '));
  }

  return [...variants];
};

export const buildResponsableResolverIndex = (responsables = []) => {
  const porCodi = new Map();
  const porNorm = new Map();
  const catalogEntries = [];

  for (const responsable of responsables) {
    const codi = String(responsable.codiRespnsble ?? responsable._id ?? '').trim();
    const nombre =
      responsable.nmbrRespnsble ?? responsable.nombre ?? responsable.label ?? '';
    const norm = normNombreResponsable(nombre);
    if (!codi && !norm) continue;

    const entry = { codi, nombre, norm, tokens: tokensNombre(norm) };
    catalogEntries.push(entry);

    if (codi) porCodi.set(codi, entry);
    if (norm) {
      for (const variant of variantesNombre(norm)) {
        if (!porNorm.has(variant)) porNorm.set(variant, codi || norm);
      }
    }
  }

  return { porCodi, porNorm, catalogEntries };
};

export const resolverResponsableConIndice = (valor, index) => {
  const raw = String(valor ?? '').trim();
  if (!raw || !index) return null;

  if (index.porCodi.has(raw)) return index.porCodi.get(raw).codi;

  const norm = normNombreResponsable(raw);
  if (!norm) return null;

  if (index.porNorm.has(norm)) return index.porNorm.get(norm);

  for (const variant of variantesNombre(norm)) {
    if (index.porNorm.has(variant)) return index.porNorm.get(variant);
  }

  const inputTokens = tokensNombre(norm);
  if (inputTokens.length >= 2) {
    const matches = index.catalogEntries.filter((entry) =>
      inputTokens.every((token) => entry.tokens.includes(token))
    );
    if (matches.length === 1) return matches[0].codi;
  }

  return null;
};

let cachedIndex = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

export const getResponsableResolverIndex = async ({ refresh = false } = {}) => {
  const now = Date.now();
  if (!refresh && cachedIndex && now - cachedAt < CACHE_TTL_MS) {
    return cachedIndex;
  }

  const responsables = await Responsable.find().lean();
  cachedIndex = buildResponsableResolverIndex(responsables);
  cachedAt = now;
  return cachedIndex;
};

export const normalizarResponsable = async (valor) => {
  const raw = String(valor ?? '').trim();
  if (!raw) return null;

  const index = await getResponsableResolverIndex();
  return resolverResponsableConIndice(raw, index) ?? raw;
};
