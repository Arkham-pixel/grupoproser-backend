import Ciudad from '../models/Ciudad.js';

const TTL_MS = 15 * 60 * 1000;
const CAMPOS =
  'codiMunicipio descMunicipio descDepto codiPoblado descPoblado codiCpoblado descCpoblado';

let ciudades = null;
let mapa = null;
let loadedAt = 0;
let inflight = null;

function construirMapa(lista) {
  const mapaCiudades = {};
  for (const c of lista) {
    const datos = {
      nombre: c.descCpoblado || c.descPoblado || c.descMunicipio || '',
      municipio: c.descMunicipio || '',
      departamento: c.descDepto || '',
    };
    for (const key of ['codiPoblado', 'codiCpoblado', 'codiMunicipio']) {
      if (c[key]) mapaCiudades[String(c[key]).trim()] = datos;
    }
  }
  return mapaCiudades;
}

async function cargar() {
  const lista = await Ciudad.find().select(CAMPOS).lean();
  ciudades = lista;
  mapa = construirMapa(lista);
  loadedAt = Date.now();
  return { ciudades, mapa };
}

export async function getCiudadesCached() {
  if (ciudades && Date.now() - loadedAt < TTL_MS) {
    return { ciudades, mapa };
  }
  if (inflight) return inflight;
  inflight = cargar().finally(() => {
    inflight = null;
  });
  return inflight;
}
