import ZurichCaso from '../models/ZurichCaso.js';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';

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

/**
 * Copia la metadata del archivo CAT al caso de listado (misma ruta S3/local).
 * Idempotente por ruta. No duplica el blob.
 */
export async function espejarArchivoZurichCatEnListado(casoListado, archivo) {
  const ruta = String(archivo?.ruta || '').trim();
  if (!ruta) return { ok: false, motivo: 'sin-ruta' };
  if (!casoListado) return { ok: false, motivo: 'sin-listado' };

  const doc =
    typeof casoListado.save === 'function'
      ? casoListado
      : await ZurichListadoCaso.findById(casoListado._id);
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

export async function espejarArchivosCasoZurichCatEnListado(casoCat, casoListado) {
  const resumen = { copiados: 0, duplicados: 0, errores: [] };
  const doc =
    typeof casoListado?.save === 'function'
      ? casoListado
      : await ZurichListadoCaso.findById(casoListado?._id);
  if (!doc) {
    resumen.errores.push({ motivo: 'sin-listado' });
    return resumen;
  }

  doc.archivos = doc.archivos || [];
  const rutas = new Set(doc.archivos.map((a) => String(a?.ruta || '')).filter(Boolean));
  let cambio = false;

  for (const archivo of casoCat?.archivos || []) {
    try {
      const ruta = String(archivo?.ruta || '').trim();
      if (!ruta) {
        resumen.errores.push({ archivo: archivo?.nombreOriginal, motivo: 'sin-ruta' });
        continue;
      }
      if (rutas.has(ruta)) {
        resumen.duplicados += 1;
        continue;
      }
      const copia = clonarMetaArchivo(archivo);
      copia.orden = doc.archivos.length;
      doc.archivos.push(copia);
      rutas.add(ruta);
      resumen.copiados += 1;
      cambio = true;
    } catch (err) {
      resumen.errores.push({
        archivo: archivo?.nombreOriginal,
        error: err.message,
      });
    }
  }

  if (cambio) await doc.save();
  resumen.listadoId = String(doc._id);
  resumen.consecutivo = doc.consecutivo;
  return resumen;
}

export const ESTADO_VERIFICADO_ZURICH = 'VERIFICADO';

const EVIDENCIA_LABEL_ZURICH = {
  fotoGeneral: 'Foto general',
  fotoDanos: 'Foto de daños',
  equiposCriticos: 'Equipos críticos',
  mitigacion: 'Mitigación',
  noAcceso: 'Sin acceso',
};

const textoItem = (item) => {
  if (!item || typeof item !== 'object') return '';
  return String(item.observacion ?? item.observaciones ?? '').trim();
};

export function textoObservacionesDesdeCatZurich(cat = {}) {
  const partes = [];
  const obsCat = String(cat.observacionesCat || '').trim();
  const obs = String(cat.observaciones || '').trim();
  if (obsCat) partes.push(obsCat);
  if (obs && obs !== obsCat) partes.push(obs);

  const niveles =
    cat.severidadCatNiveles && typeof cat.severidadCatNiveles === 'object'
      ? cat.severidadCatNiveles
      : {};
  for (let n = 1; n <= 6; n += 1) {
    const item = niveles[`nivel${n}`] || niveles[String(n)] || niveles[n] || {};
    const txt = textoItem(item);
    if (txt) partes.push(`Severidad ${n}: ${txt}`);
  }

  const evidencia =
    cat.evidenciaCat && typeof cat.evidenciaCat === 'object' ? cat.evidenciaCat : {};
  for (const [clave, label] of Object.entries(EVIDENCIA_LABEL_ZURICH)) {
    const txt = textoItem(evidencia[clave]);
    if (txt) partes.push(`${label}: ${txt}`);
  }

  const reserva = String(cat.observacionReserva || '').trim();
  if (reserva) partes.push(`Reserva: ${reserva}`);

  return partes.join('\n\n');
}

export function fusionarObservacionesZurich(existente, catTexto) {
  const a = String(existente || '').trim();
  const b = String(catTexto || '').trim();
  if (!b) return a;
  if (!a) return b;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n\n— Inspección CAT —\n${b}`;
}

export async function aplicarObservacionesYEstadoVerificadoZurich(casoCat, casoListado) {
  const doc =
    typeof casoListado?.save === 'function'
      ? casoListado
      : await ZurichListadoCaso.findById(casoListado?._id);
  if (!doc) return { ok: false, motivo: 'sin-listado' };

  const texto = textoObservacionesDesdeCatZurich(casoCat || {});
  const observaciones = fusionarObservacionesZurich(doc.observaciones, texto);
  const observacionesCat =
    String(casoCat?.observacionesCat || '').trim() || texto || String(doc.observacionesCat || '').trim();
  const yaVerificado = String(doc.estado || '') === ESTADO_VERIFICADO_ZURICH;
  const obsIgual = String(doc.observaciones || '').trim() === observaciones;
  const catIgual = String(doc.observacionesCat || '').trim() === observacionesCat;

  const set = {};
  if (!obsIgual) set.observaciones = observaciones || null;
  if (observacionesCat && !catIgual) set.observacionesCat = observacionesCat;
  if (!yaVerificado) {
    set.estado = ESTADO_VERIFICADO_ZURICH;
    if (!doc.fechaVerificado) set.fechaVerificado = new Date();
  } else if (!doc.fechaVerificado) {
    set.fechaVerificado = new Date();
  }

  if (!Object.keys(set).length) {
    return {
      ok: true,
      sinCambio: true,
      estado: String(doc.estado || ''),
      observacionesVacias: !texto,
    };
  }

  set.updatedAt = new Date();
  Object.assign(doc, set);
  await doc.save();
  return {
    ok: true,
    estadoCambiado: !yaVerificado,
    observacionesCopiadas: Boolean(texto) && !obsIgual,
    observacionesVacias: !texto,
    estado: ESTADO_VERIFICADO_ZURICH,
  };
}

/** Evita borrar el blob si CAT o listado todavía apuntan a la misma ruta. */
export async function rutaArchivoSigueEnUsoZurich(ruta, { coleccion, casoId } = {}) {
  const valor = String(ruta || '').trim();
  if (!valor) return false;

  const filtroOtro = { 'archivos.ruta': valor };
  if (coleccion === 'cat') {
    const enListado = await ZurichListadoCaso.exists(filtroOtro);
    if (enListado) return true;
    const enOtroCat = await ZurichCaso.exists({
      ...filtroOtro,
      ...(casoId ? { _id: { $ne: casoId } } : {}),
    });
    return Boolean(enOtroCat);
  }
  if (coleccion === 'listado') {
    const enCat = await ZurichCaso.exists(filtroOtro);
    if (enCat) return true;
    const enOtroListado = await ZurichListadoCaso.exists({
      ...filtroOtro,
      ...(casoId ? { _id: { $ne: casoId } } : {}),
    });
    return Boolean(enOtroListado);
  }
  const [cat, listado] = await Promise.all([
    ZurichCaso.exists(filtroOtro),
    ZurichListadoCaso.exists(filtroOtro),
  ]);
  return Boolean(cat || listado);
}
