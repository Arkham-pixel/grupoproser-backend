/**
 * Adjunta medias de videoperitaje al caso CAT (archivos → informe).
 * Módulos: bbva-cat, bbva-cat-listado, seguros-alfa (+ zurich/allianz/previsora/equidad).
 */
import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import ZurichCaso from '../models/ZurichCaso.js';
import AllianzCaso from '../models/AllianzCaso.js';
import PrevisoraCaso from '../models/PrevisoraCaso.js';
import EquidadCatCaso from '../models/EquidadCatCaso.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { videoperitajeAdjuntoInmediatoHabilitado } from '../config/arnaldFeatures.js';

export const MODULOS_CASO = Object.freeze({
  'bbva-cat': BbvaCatCaso,
  'bbva-cat-listado': BbvaCatListadoCaso,
  'seguros-alfa': SegurosAlfaCaso,
  alfa: SegurosAlfaCaso,
  zurich: ZurichCaso,
  allianz: AllianzCaso,
  previsora: PrevisoraCaso,
  'equidad-cat': EquidadCatCaso,
});

export function normalizarModulo(modulo = '') {
  const m = String(modulo || '')
    .trim()
    .toLowerCase();
  if (m === 'bbvacat' || m === 'bbva') return 'bbva-cat';
  if (m === 'bbva-cat-listado' || m === 'bbvacatlistado') return 'bbva-cat-listado';
  if (m === 'equidadcat') return 'equidad-cat';
  if (m === 'segurosalfa' || m === 'seguros-alfa' || m === 'alfa') return 'seguros-alfa';
  return m;
}

export function sesionDebeAdjuntarAlCaso(sesion) {
  if (!sesion?.casoId || !sesion?.modulo) return false;
  return videoperitajeAdjuntoInmediatoHabilitado();
}

export async function cargarCasoVinculado(modulo, casoId) {
  const key = normalizarModulo(modulo);
  const Model = MODULOS_CASO[key];
  if (!Model || !casoId || !mongoose.Types.ObjectId.isValid(casoId)) return null;
  return Model.findById(casoId);
}

export function datosContactoDesdeCaso(caso = {}) {
  const email = String(
    caso.correoAsegurado || caso.correo || caso.email || ''
  ).trim();
  const celular = String(
    caso.celular || caso.telefonoAsegurado || caso.telefono || caso.informacionContacto || ''
  )
    .replace(/[^\d+]/g, ' ')
    .trim()
    .split(/\s+/)
    .find((p) => p.replace(/\D/g, '').length >= 7) || String(caso.celular || '').trim();
  return {
    expediente: String(caso.consecutivo || caso.siniestro || caso.zc || '').trim(),
    siniestro: String(caso.siniestro || '').trim(),
    aseguradoNombre: String(caso.asegurado || caso.nombreAsegurado || '').trim(),
    email,
    celular: String(celular || '').trim(),
  };
}

/**
 * Empuja la foto también a informeUnico.fotosInspeccion para que el Word/informe
 * la vea de inmediato (además de caso.archivos, que fotosInformeDesdeCaso ya fusiona).
 */
function empujarAInformeUnico(caso, archivoMeta) {
  if (!caso.informeUnico || typeof caso.informeUnico !== 'object') {
    caso.informeUnico = {};
  }
  const lista = Array.isArray(caso.informeUnico.fotosInspeccion)
    ? caso.informeUnico.fotosInspeccion
    : [];
  const ruta = String(archivoMeta.ruta || '');
  if (ruta && lista.some((f) => String(f?.ruta || '') === ruta)) return;
  lista.push({
    ruta,
    nombre: archivoMeta.nombreOriginal || 'Foto videoperitaje',
    nombreOriginal: archivoMeta.nombreOriginal || 'Foto videoperitaje',
    descripcion: archivoMeta.descripcion || 'Videoperitaje',
    tipoMime: archivoMeta.tipoMime || 'image/jpeg',
    etiqueta: 'FOTOS',
    orden: lista.length,
    origen: 'videoperitaje',
  });
  caso.informeUnico.fotosInspeccion = lista;
  caso.markModified?.('informeUnico');
}

export async function adjuntarMediasAlCaso(sesion, medias = []) {
  if (!sesion?.casoId || !sesion?.modulo) {
    return { ok: false, motivo: 'sin-caso' };
  }
  const caso = await cargarCasoVinculado(sesion.modulo, sesion.casoId);
  if (!caso) return { ok: false, motivo: 'caso-no-encontrado' };

  caso.archivos = caso.archivos || [];
  let orden = -1;
  for (const a of caso.archivos) {
    const n = Number(a.orden);
    if (Number.isFinite(n) && n > orden) orden = n;
  }

  const existentes = new Set(
    caso.archivos.map((a) => String(a.ruta || '')).filter(Boolean)
  );

  let agregados = 0;
  for (const media of medias) {
    const ruta = String(media.ruta || '');
    if (!ruta || existentes.has(ruta)) continue;
    // Videos de la llamada van al archivero; solo fotos al informe fotográfico.
    const esVideo =
      String(media.tipo || '') === 'video' || String(media.tipoMime || '').startsWith('video/');
    orden += 1;
    const archivo = {
      nombreOriginal: media.nombreOriginal || media.nombreArchivo || 'foto-videoperitaje.jpg',
      nombreArchivo: media.nombreArchivo || '',
      ruta,
      tamaño: media.tamaño,
      tipoMime: media.tipoMime || (esVideo ? 'video/webm' : 'image/jpeg'),
      etiqueta: esVideo ? 'VIDEOPERITAJE' : 'FOTOS',
      descripcion: media.descripcion || media.pasoId || 'Videoperitaje',
      orden,
      subidoPor: {
        id: sesion.peritoUserId || '',
        login: sesion.peritoLogin || '',
        nombre: sesion.peritoNombre || 'Videoperitaje',
      },
      fechaSubida: media.fechaSubida || new Date(),
    };
    caso.archivos.push(archivo);
    existentes.add(ruta);
    agregados += 1;
    if (!esVideo) empujarAInformeUnico(caso, archivo);
  }

  if (agregados > 0) {
    if (caso.fechaUltimoDocumento !== undefined) {
      caso.fechaUltimoDocumento = new Date();
    }
    await caso.save();
  }

  return { ok: true, agregados };
}

const CAMPOS_BUSQUEDA_CASO = [
  'consecutivo',
  'siniestro',
  'zc',
  'asegurado',
  'nombreAsegurado',
  'placa',
  'poliza',
];

/**
 * Busca casos de un módulo por texto (expediente / siniestro / asegurado).
 * @returns {Promise<Array<{_id, etiqueta, consecutivo, siniestro, asegurado}>>}
 */
export async function buscarCasosParaVideoperitaje(modulo, q = '', limit = 20) {
  const key = normalizarModulo(modulo);
  const Model = MODULOS_CASO[key];
  if (!Model) return [];
  const texto = String(q || '').trim();
  if (texto.length < 2) return [];

  const rx = new RegExp(texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const or = CAMPOS_BUSQUEDA_CASO.map((campo) => ({ [campo]: rx }));
  // También por ObjectId exacto
  if (mongoose.Types.ObjectId.isValid(texto) && String(texto).length === 24) {
    or.push({ _id: texto });
  }

  const rows = await Model.find({ $or: or })
    .select('consecutivo siniestro zc asegurado nombreAsegurado placa poliza')
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(Math.min(40, Math.max(1, Number(limit) || 20)))
    .lean();

  return rows.map((c) => {
    const consecutivo = String(c.consecutivo || c.siniestro || c.zc || '').trim();
    const asegurado = String(c.asegurado || c.nombreAsegurado || '').trim();
    const siniestro = String(c.siniestro || '').trim();
    const partes = [consecutivo, siniestro && siniestro !== consecutivo ? `Sin. ${siniestro}` : '', asegurado].filter(
      Boolean
    );
    return {
      _id: String(c._id),
      consecutivo,
      siniestro,
      asegurado,
      placa: String(c.placa || '').trim(),
      etiqueta: partes.join(' · ') || String(c._id),
    };
  });
}

/**
 * Vincula una sesión (creada sin caso) a un caso de módulo y adjunta medias.
 */
export async function vincularSesionACaso(sesion, modulo, casoId) {
  const key = normalizarModulo(modulo);
  if (!key || key === 'independiente' || !MODULOS_CASO[key]) {
    const err = new Error('Módulo de caso inválido');
    err.status = 400;
    err.code = 'MODULO_INVALIDO';
    throw err;
  }
  if (!casoId || !mongoose.Types.ObjectId.isValid(casoId)) {
    const err = new Error('casoId inválido');
    err.status = 400;
    err.code = 'CASO_INVALIDO';
    throw err;
  }

  const caso = await cargarCasoVinculado(key, casoId);
  if (!caso) {
    const err = new Error('Caso no encontrado en ese módulo');
    err.status = 404;
    err.code = 'CASO_NO_ENCONTRADO';
    throw err;
  }

  if (sesion.casoId && String(sesion.casoId) !== String(casoId)) {
    const err = new Error('Esta sesión ya está asignada a otro caso');
    err.status = 409;
    err.code = 'YA_ASIGNADA';
    throw err;
  }

  const contacto = datosContactoDesdeCaso(caso);
  sesion.modulo = key;
  sesion.casoId = caso._id;
  if (!sesion.expediente && contacto.expediente) sesion.expediente = contacto.expediente;
  if (!sesion.siniestro && contacto.siniestro) sesion.siniestro = contacto.siniestro;
  if (!sesion.aseguradoNombre && contacto.aseguradoNombre) {
    sesion.aseguradoNombre = contacto.aseguradoNombre;
  }
  if (!sesion.celular && contacto.celular) sesion.celular = contacto.celular;
  if (!sesion.email && contacto.email) sesion.email = contacto.email;

  await sesion.save();

  const adjunto = await adjuntarMediasAlCaso(sesion, sesion.medias || []);
  if (adjunto?.ok) {
    sesion.adjuntadoAlCaso = true;
    await sesion.save();
  }

  return {
    sesion,
    caso: {
      _id: String(caso._id),
      expediente: contacto.expediente,
      asegurado: contacto.aseguradoNombre,
    },
    adjunto,
  };
}
