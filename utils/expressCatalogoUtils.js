export const normCatalogoNombre = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

export const esIntermediarioValidoSeed = (nombre) => {
  const v = String(nombre ?? '').trim();
  if (!v || v.length > 80) return false;
  if (/ARTÍCULO|CONTRATO|PRIMA|OBSERVACIONES|DATOS TÉCNICOS|FORMA DE PAGO|IVA|COP \d/i.test(v)) {
    return false;
  }
  return true;
};

export function buildMapaCatalogo(items = []) {
  const mapa = new Map();
  for (const item of items) {
    const nombre = item.nombre ?? item;
    const clave = normCatalogoNombre(nombre);
    if (clave && !mapa.has(clave)) {
      mapa.set(clave, typeof nombre === 'string' ? nombre.trim() : String(nombre));
    }
  }
  return mapa;
}

export function resolverDesdeMapa(mapa, value) {
  if (value === null || value === undefined || value === '') return null;
  const texto = String(value).trim();
  const canon = mapa.get(normCatalogoNombre(texto));
  return canon ?? null;
}
