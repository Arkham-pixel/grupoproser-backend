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
