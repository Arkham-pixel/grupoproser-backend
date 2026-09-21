import mongoose from 'mongoose';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import ZurichCaso from '../models/ZurichCaso.js';
import AllianzCaso from '../models/AllianzCaso.js';
import PrevisoraCaso from '../models/PrevisoraCaso.js';
import EquidadCatCaso from '../models/EquidadCatCaso.js';

export const MODULOS_CASO = Object.freeze({
  'bbva-cat': BbvaCatCaso,
  'bbva-cat-listado': BbvaCatListadoCaso,
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
  return m;
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
    caso.celular || caso.telefonoAsegurado || caso.telefono || ''
  ).trim();
  return {
    expediente: String(caso.consecutivo || caso.siniestro || caso.zc || '').trim(),
    siniestro: String(caso.siniestro || '').trim(),
    aseguradoNombre: String(caso.asegurado || caso.nombreAsegurado || '').trim(),
    email,
    celular,
  };
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
    orden += 1;
    caso.archivos.push({
      nombreOriginal: media.nombreOriginal || media.nombreArchivo || 'foto-videoperitaje.jpg',
      nombreArchivo: media.nombreArchivo || '',
      ruta,
      tamaño: media.tamaño,
      tipoMime: media.tipoMime || 'image/jpeg',
      etiqueta: 'VIDEOPERITAJE',
      descripcion: media.descripcion || media.pasoId || 'Videoperitaje',
      orden,
      subidoPor: {
        id: sesion.peritoUserId || '',
        login: sesion.peritoLogin || '',
        nombre: sesion.peritoNombre || 'Videoperitaje',
      },
      fechaSubida: media.fechaSubida || new Date(),
    });
    existentes.add(ruta);
    agregados += 1;
  }

  if (agregados > 0) {
    if (caso.fechaUltimoDocumento !== undefined) {
      caso.fechaUltimoDocumento = new Date();
    }
    await caso.save();
  }

  return { ok: true, agregados };
}
