import Cliente from '../models/Cliente.js';

export const normCatalogoTexto = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

export const buildClienteResolverIndex = (clientes = []) => {
  const porCodi = new Map();
  const porNorm = new Map();

  for (const cliente of clientes) {
    const codi = String(cliente.codiAsgrdra ?? cliente.codigo ?? cliente._id ?? '').trim();
    const nombre =
      cliente.rzonSocial ?? cliente.razonSocial ?? cliente.nombre ?? cliente.label ?? '';
    const norm = normCatalogoTexto(nombre);
    if (!codi && !norm) continue;

    const entry = { codi, nombre, norm };
    if (codi) porCodi.set(codi, entry);
    if (norm && codi && !porNorm.has(norm)) porNorm.set(norm, codi);
  }

  return { porCodi, porNorm };
};

export const resolverClienteConIndice = (valor, index) => {
  const raw = String(valor ?? '').trim();
  if (!raw || !index) return null;

  if (index.porCodi.has(raw)) return index.porCodi.get(raw).codi;

  const norm = normCatalogoTexto(raw);
  if (!norm) return null;

  if (index.porNorm.has(norm)) return index.porNorm.get(norm);

  return null;
};

let cachedIndex = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

export const getClienteResolverIndex = async ({ refresh = false } = {}) => {
  const now = Date.now();
  if (!refresh && cachedIndex && now - cachedAt < CACHE_TTL_MS) {
    return cachedIndex;
  }

  const clientes = await Cliente.find().lean();
  cachedIndex = buildClienteResolverIndex(clientes);
  cachedAt = now;
  return cachedIndex;
};

export const normalizarAseguradora = async (valor) => {
  const raw = String(valor ?? '').trim();
  if (!raw) return null;

  const index = await getClienteResolverIndex();
  return resolverClienteConIndice(raw, index) ?? raw;
};
