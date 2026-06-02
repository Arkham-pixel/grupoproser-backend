import EstadoExpress from '../models/EstadoExpress.js';

export const normCatalogoTexto = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

/** Variantes legacy del Excel → código de catálogo o texto canónico */
export const ALIAS_ESTADO_EXPRESS = {
  'ANALISIS SINIESTRO': '1',
  DESISTIDO: '2',
  'EN ESPERA DE DOCUMENTOS': '3',
  'PENDIENTE DOCUMENTOS': '3',
  'LIQUIDAR SINIESTRO': '4',
  'OBJETADO POR INDEMNIZACIONES': '5',
  'LIQUIDAR SINIESTRO - OBJETADO POR INDEMNIZACIONES': '5',
  'PENDIENTE ACEPTACION CLIENTE': '6',
  'PENDIENTE ACEPACTION CLIENTE': '6',
  'PENDIENTE AUTORIZACION DELEGADA RESERVA': '7',
  'PENDIENTE AUTORIDAD DELEGADA RESERVA': '7',
  'PENDIENTE AUTORIDAD DELEGADA': '7',
  'TRAMITADO A COMPLEX': '8',
  COMPLEX: '8',
  'SINIESTRO COMPLEX': '8',
  'NO RESPONSABILIDAD ASEGURADO': 'NO RESPONSABILIDAD DEL ASEGURADO',
  'NO RESPONSABILIDAD DEL ASEGURADO': 'NO RESPONSABILIDAD DEL ASEGURADO',
  ANULAR: 'ANULADO',
  ANULADO: 'ANULADO',
  CERRADO: 'CASO CERRADO',
  'CASO CERRADO': 'CASO CERRADO',
  'EN ESPERA DE DESISTIMIENTO': 'EN ESPERA DE DESISTIMIENTO',
  PRESCRITO: 'PRESCRITO',
  SIN_ESTADO: 'SIN_ESTADO',
};

export const buildEstadoExpressResolverIndex = (estados = []) => {
  const porCodi = new Map();
  const porNorm = new Map();

  for (const estado of estados) {
    const codi = String(estado.codiEstdo ?? estado.codiEstado ?? '').trim();
    const nombre =
      estado.descEstdo ?? estado.descEstado ?? estado.descripcion ?? estado.label ?? '';
    const norm = normCatalogoTexto(nombre);
    if (!codi && !norm) continue;

    const entry = { codi, nombre, norm };
    if (codi) porCodi.set(codi, entry);
    if (norm && codi) porNorm.set(norm, codi);
  }

  for (const [alias, destino] of Object.entries(ALIAS_ESTADO_EXPRESS)) {
    const norm = normCatalogoTexto(alias);
    if (!porNorm.has(norm)) porNorm.set(norm, destino);
  }

  return { porCodi, porNorm };
};

export const resolverEstadoExpressConIndice = (valor, index) => {
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

export const getEstadoExpressResolverIndex = async ({ refresh = false } = {}) => {
  const now = Date.now();
  if (!refresh && cachedIndex && now - cachedAt < CACHE_TTL_MS) {
    return cachedIndex;
  }

  const estados = await EstadoExpress.find().lean();
  cachedIndex = buildEstadoExpressResolverIndex(estados);
  cachedAt = now;
  return cachedIndex;
};

export const normalizarEstadoExpress = async (valor) => {
  const raw = String(valor ?? '').trim();
  if (!raw) return null;

  const index = await getEstadoExpressResolverIndex();
  return resolverEstadoExpressConIndice(raw, index) ?? raw;
};

export const esCodigoEstadoCatalogo = (valor, index) => {
  const raw = String(valor ?? '').trim();
  return Boolean(raw && index?.porCodi?.has(raw));
};
