/**
 * Conteo de listados: countDocuments({}) escanea toda la colección (ratio ~N:1).
 * estimatedDocumentCount lee metadatos (~O(1)) y basta para paginar.
 */
const CACHE_MS = 20_000;
const cache = new Map();

function filtroVacio(filtro) {
  if (filtro == null) return true;
  if (typeof filtro !== 'object') return false;
  return Object.keys(filtro).length === 0;
}

export async function contarDocumentosLista(Model, filtro = {}, { collation } = {}) {
  if (!filtroVacio(filtro)) {
    const q = Model.countDocuments(filtro);
    if (collation) q.collation(collation);
    return q;
  }
  const key = Model.collection?.collectionName || Model.modelName;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.exp) return hit.n;
  const n = await Model.estimatedDocumentCount();
  cache.set(key, { n, exp: Date.now() + CACHE_MS });
  return n;
}
