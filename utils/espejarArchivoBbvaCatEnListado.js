import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';

const normClave = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const clavesDeCaso = (caso = {}) => {
  const set = new Set();
  for (const raw of [caso.zc, caso.siniestro]) {
    const texto = String(raw ?? '').trim();
    if (texto) set.add(texto);
    const k = normClave(raw);
    if (k) set.add(k);
  }
  return [...set];
};

const coincidenClaves = (caso, claves) => {
  if (!claves.length) return false;
  const propias = new Set(clavesDeCaso(caso));
  return claves.some((k) => propias.has(k));
};

const clonarMetaArchivo = (archivo) => {
  const obj = typeof archivo?.toObject === 'function' ? archivo.toObject() : { ...archivo };
  delete obj._id;
  return {
    nombreOriginal: obj.nombreOriginal,
    nombreArchivo: obj.nombreArchivo,
    ruta: obj.ruta,
    tamaño: obj.tamaño,
    tipoMime: obj.tipoMime,
    etiqueta: obj.etiqueta || 'GENERAL',
    descripcion: obj.descripcion != null ? String(obj.descripcion) : '',
    orden: Number.isFinite(Number(obj.orden)) ? Number(obj.orden) : 0,
    subidoPor: obj.subidoPor || undefined,
    fechaSubida: obj.fechaSubida || new Date(),
  };
};

export async function buscarCasoListadoPorCasoCat(casoCat) {
  const claves = clavesDeCaso(casoCat);
  if (!claves.length) return null;

  const candidatos = await BbvaCatListadoCaso.find({
    $or: claves.flatMap((k) => [{ zc: k }, { siniestro: k }]),
  });
  if (!candidatos.length) return null;
  return candidatos.find((c) => coincidenClaves(c, claves)) || candidatos[0];
}

/**
 * Copia la metadata del archivo CAT al caso de listado (misma ruta de almacenamiento).
 * Idempotente por ruta. No falla la subida CAT si no hay par en listado.
 */
export async function espejarArchivoCatEnListado(casoCat, archivo) {
  const ruta = String(archivo?.ruta || '').trim();
  if (!ruta) return { ok: false, motivo: 'sin-ruta' };

  const doc = await buscarCasoListadoPorCasoCat(casoCat);
  if (!doc) return { ok: false, motivo: 'sin-listado' };

  doc.archivos = doc.archivos || [];
  const yaEsta = doc.archivos.some((a) => String(a?.ruta || '') === ruta);
  if (yaEsta) return { ok: true, duplicado: true, listadoId: String(doc._id) };

  const copia = clonarMetaArchivo(archivo);
  copia.orden = doc.archivos.length;
  doc.archivos.push(copia);
  await doc.save();
  return { ok: true, listadoId: String(doc._id), consecutivo: doc.consecutivo };
}

export async function espejarArchivosCatExistentesEnListado() {
  const casos = await BbvaCatCaso.find({ 'archivos.0': { $exists: true } });
  const resumen = {
    casosCat: casos.length,
    archivos: 0,
    copiados: 0,
    duplicados: 0,
    sinListado: 0,
    errores: [],
  };
  for (const caso of casos) {
    for (const archivo of caso.archivos || []) {
      resumen.archivos += 1;
      try {
        const r = await espejarArchivoCatEnListado(caso, archivo);
        if (r.ok && r.duplicado) resumen.duplicados += 1;
        else if (r.ok) resumen.copiados += 1;
        else if (r.motivo === 'sin-listado') resumen.sinListado += 1;
      } catch (err) {
        resumen.errores.push({
          consecutivo: caso.consecutivo,
          archivo: archivo?.nombreOriginal,
          error: err.message,
        });
      }
    }
  }
  return resumen;
}

/** Evita borrar el blob si CAT o listado todavía apuntan a la misma ruta. */
export async function rutaArchivoSigueEnUsoBbvaCat(ruta, { coleccion, casoId } = {}) {
  const valor = String(ruta || '').trim();
  if (!valor) return false;

  const filtroOtro = { 'archivos.ruta': valor };
  if (coleccion === 'cat') {
    const enListado = await BbvaCatListadoCaso.exists(filtroOtro);
    if (enListado) return true;
    const enOtroCat = await BbvaCatCaso.exists({
      ...filtroOtro,
      ...(casoId ? { _id: { $ne: casoId } } : {}),
    });
    return Boolean(enOtroCat);
  }
  if (coleccion === 'listado') {
    const enCat = await BbvaCatCaso.exists(filtroOtro);
    if (enCat) return true;
    const enOtroListado = await BbvaCatListadoCaso.exists({
      ...filtroOtro,
      ...(casoId ? { _id: { $ne: casoId } } : {}),
    });
    return Boolean(enOtroListado);
  }
  const [cat, listado] = await Promise.all([
    BbvaCatCaso.exists(filtroOtro),
    BbvaCatListadoCaso.exists(filtroOtro),
  ]);
  return Boolean(cat || listado);
}
