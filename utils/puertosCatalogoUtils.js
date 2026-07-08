export function normCatalogoNombre(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function buildMapaCatalogo(items = []) {
  const mapa = new Map();
  for (const item of items) {
    const clave = normCatalogoNombre(item.nombre);
    if (clave && !mapa.has(clave)) {
      mapa.set(clave, item.nombre.trim());
    }
  }
  return mapa;
}

export function resolverDesdeMapa(mapa, value) {
  if (!value) return null;
  const clave = normCatalogoNombre(value);
  return mapa.get(clave) ?? String(value).trim();
}
