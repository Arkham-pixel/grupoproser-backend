import crypto from 'crypto';
import mongoose from 'mongoose';
import VideoperitajeSesion from '../models/VideoperitajeSesion.js';
import VideoperitajePlantilla from '../models/VideoperitajePlantilla.js';
import { resolveVideoperitajePublicUrl } from '../config/platformUrls.js';
import { isS3StorageEnabled } from '../config/storage.js';
import {
  STORAGE_CATEGORIES,
  buildKeyForUpload,
  getDownloadUrl,
} from '../services/fileStorageService.js';
import { getSignedUploadUrl, headObject } from '../services/s3StorageService.js';
import { sanitizeStorageSegment } from '../utils/storageKeyBuilder.js';
import {
  cargarCasoVinculado,
  datosContactoDesdeCaso,
  adjuntarMediasAlCaso,
  normalizarModulo,
} from '../services/videoperitajeCasoService.js';
import {
  cerrarSalaLivekit,
  crearTokenLivekit,
  livekitConfig,
  nombreSalaLivekit,
} from '../services/videoperitajeLivekitService.js';
import { notificarInvitacionSesion } from '../services/videoperitajeNotifyService.js';

const ESTADOS_ABIERTOS = new Set(['pendiente', 'en_proceso']);

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function generarTokenAcceso() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

function pasoId() {
  return crypto.randomBytes(6).toString('hex');
}

function sanitizarPasos(pasos = []) {
  return (Array.isArray(pasos) ? pasos : [])
    .map((p, i) => ({
      id: String(p.id || pasoId()),
      titulo: String(p.titulo || `Paso ${i + 1}`).trim(),
      instruccion: String(p.instruccion || '').trim(),
      minFotos: Math.max(0, Number(p.minFotos) || 0),
      maxFotos: Math.max(1, Number(p.maxFotos) || 3),
      obligatorio: p.obligatorio !== false,
    }))
    .filter((p) => p.titulo);
}

function buildMediaFromUpload(req, extra = {}) {
  const file = req.file;
  if (!file) return null;
  if (req.fileStorage?.driver === 's3') {
    return {
      nombreOriginal: file.originalname,
      nombreArchivo: req.fileStorage.filename,
      ruta: req.fileStorage.publicPath,
      tamaño: req.fileStorage.size,
      tipoMime: req.fileStorage.mimetype,
      ...extra,
    };
  }
  return {
    nombreOriginal: file.originalname,
    nombreArchivo: file.filename,
    ruta: `/uploads/videoperitaje/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
    ...extra,
  };
}

function tipoMediaDeArchivo(req, extraTipo) {
  const mime = String(req.fileStorage?.mimetype || req.file?.mimetype || '');
  if (mime.startsWith('video/') || String(extraTipo || '') === 'video') return 'video';
  return 'foto';
}

function tipoDesdeMime(contentType, extraTipo) {
  if (String(extraTipo || '') === 'video' || String(contentType || '').startsWith('video/')) {
    return 'video';
  }
  return 'foto';
}

function claveVideoperitajeValida(key, ownerId) {
  const k = String(key || '');
  const owner = sanitizeStorageSegment(ownerId, '');
  return Boolean(owner) && k.includes(`/${owner}/`) && k.includes('/videoperitaje/');
}

function mimePermitidoVideoperitaje(contentType) {
  const mime = String(contentType || '').toLowerCase();
  return mime.startsWith('image/') || mime.startsWith('video/');
}

async function presignMediaSesion(req, sesion, ownerId, extra = {}) {
  if (!ESTADOS_ABIERTOS.has(sesion.estado)) {
    const err = new Error('La sesión no admite más fotos');
    err.status = 409;
    throw err;
  }
  const filename = String(extra.filename || extra.nombreOriginal || `captura-${Date.now()}.jpg`);
  const contentType = String(extra.contentType || extra.tipoMime || 'image/jpeg');
  if (!mimePermitidoVideoperitaje(contentType)) {
    const err = new Error('Solo se permiten fotos o videos');
    err.status = 400;
    throw err;
  }
  if (!isS3StorageEnabled()) {
    return { modo: 'proxy' };
  }
  const { key, filename: storedName } = buildKeyForUpload(req, {
    category: STORAGE_CATEGORIES.VIDEOPERITAJE,
    originalName: filename,
    ownerId: String(ownerId),
  });
  const uploadUrl = await getSignedUploadUrl(key, contentType, 900);
  return {
    modo: 's3',
    uploadUrl,
    key,
    headers: { 'Content-Type': contentType },
    storedName,
    expiresIn: 900,
  };
}

async function registrarMediaPresign(sesion, ownerId, body, rol) {
  const contentType = String(body?.contentType || body?.tipoMime || 'application/octet-stream');
  const tipo = tipoDesdeMime(contentType, body?.tipo);
  if (rol === 'perito') {
    if (!sesionAceptaMediaPerito(sesion, tipo)) {
      const err = new Error('La sesión no admite más fotos');
      err.status = 409;
      throw err;
    }
  } else if (!ESTADOS_ABIERTOS.has(sesion.estado)) {
    const err = new Error('La sesión no admite más fotos');
    err.status = 409;
    throw err;
  }
  const key = String(body?.key || '').replace(/^s3:/, '');
  if (!claveVideoperitajeValida(key, ownerId)) {
    const err = new Error('Clave S3 inválida');
    err.status = 400;
    throw err;
  }
  if (!mimePermitidoVideoperitaje(contentType)) {
    const err = new Error('Solo se permiten fotos o videos');
    err.status = 400;
    throw err;
  }
  try {
    await headObject(key);
  } catch {
    const err = new Error('El archivo aún no está en S3');
    err.status = 400;
    throw err;
  }
  const media = {
    nombreOriginal: String(body?.filename || body?.nombreOriginal || key.split('/').pop()),
    nombreArchivo: key.split('/').pop(),
    ruta: `s3:${key}`,
    tamaño: Number(body?.tamaño || body?.size || 0),
    tipoMime: contentType,
    tipo,
    pasoId: String(body?.pasoId || ''),
    descripcion: String(body?.descripcion || ''),
    subidoPorRol: rol,
  };
  if (media.pasoId) {
    const paso = (sesion.pasos || []).find((p) => p.id === media.pasoId);
    if (paso) {
      const ya = (sesion.medias || []).filter((m) => m.pasoId === media.pasoId).length;
      if (ya >= (paso.maxFotos || 99)) {
        const err = new Error(`Este paso admite máximo ${paso.maxFotos} fotos`);
        err.status = 400;
        throw err;
      }
    }
  }
  if (rol === 'perito') return persistirMediaPerito(sesion, media);
  sesion.medias.push(media);
  if (sesion.estado === 'pendiente') {
    sesion.estado = 'en_proceso';
    sesion.inicio = sesion.inicio || new Date();
  }
  await sesion.save();
  const creado = sesion.medias[sesion.medias.length - 1];
  const [hidratada] = await hidratarMedias([creado]);
  return hidratada;
}

function errorHttp(res, error) {
  const status = Number(error?.status) || 500;
  return res.status(status).json({ success: false, error: error.message });
}

function sesionAceptaMediaPerito(sesion, tipo) {
  if (!sesion || sesion.estado === 'cancelada') return false;
  if (ESTADOS_ABIERTOS.has(sesion.estado)) return true;
  return sesion.estado === 'finalizada' && String(tipo) === 'video';
}

async function persistirMediaPerito(sesion, media) {
  const ya = (sesion.medias || []).some(
    (m) => m.ruta && media.ruta && String(m.ruta) === String(media.ruta)
  );
  if (!ya) sesion.medias.push(media);
  if (sesion.estado === 'pendiente') {
    sesion.estado = 'en_proceso';
    sesion.inicio = sesion.inicio || new Date();
  }
  await sesion.save();
  if (sesion.estado === 'finalizada' && sesion.casoId) {
    const adjunto = await adjuntarMediasAlCaso(sesion, [media]);
    if (adjunto?.ok) {
      sesion.adjuntadoAlCaso = true;
      await sesion.save();
    }
  }
  const creado = sesion.medias[sesion.medias.length - 1];
  const [hidratada] = await hidratarMedias([creado]);
  return hidratada;
}

async function hidratarMedias(medias = []) {
  const list = [];
  for (const m of medias || []) {
    const plain = typeof m.toObject === 'function' ? m.toObject() : { ...m };
    let url = '';
    try {
      url = (await getDownloadUrl(plain.ruta)) || '';
    } catch {
      url = '';
    }
    list.push({ ...plain, url });
  }
  return list;
}

async function marcarAseguradoEnLinea(sesion) {
  if (!sesion || !ESTADOS_ABIERTOS.has(sesion.estado)) return sesion;
  sesion.aseguradoVistaAt = new Date();
  await sesion.save();
  return sesion;
}

function sesionPublicaBase(sesion) {
  return {
    id: sesion._id,
    tipo: sesion.tipo,
    estado: sesion.estado,
    expediente: sesion.expediente,
    siniestro: sesion.siniestro,
    aseguradoNombre: sesion.aseguradoNombre,
    peritoNombre: sesion.peritoNombre,
    plantillaTitulo: sesion.plantillaTitulo,
    pasos: sesion.pasos || [],
    pasosCumplidos: sesion.pasosCumplidos || [],
    geo: sesion.geo || null,
    livekitConfigured: livekitConfig().configured,
  };
}

async function buscarPorTokenPublico(tokenRaw) {
  const hash = hashToken(tokenRaw);
  const sesion = await VideoperitajeSesion.findOne({ tokenHash: hash });
  return sesion;
}

function usuarioDesdeReq(req) {
  const u = req.usuario || req.user || {};
  return {
    id: String(u.id || u._id || ''),
    login: String(u.login || u.usuario || ''),
    nombre: String(u.nombre || u.name || u.login || ''),
  };
}

export async function crearSesion(req, res) {
  try {
    const body = req.body || {};
    const tipo = body.tipo === 'guided' ? 'guided' : 'live';
    const usuario = usuarioDesdeReq(req);
    const modulo = normalizarModulo(body.modulo);
    let contacto = {
      expediente: String(body.expediente || '').trim(),
      siniestro: String(body.siniestro || '').trim(),
      aseguradoNombre: String(body.aseguradoNombre || '').trim(),
      email: String(body.email || '').trim(),
      celular: String(body.celular || '').trim(),
    };

    if (body.casoId) {
      const caso = await cargarCasoVinculado(modulo, body.casoId);
      if (!caso) {
        return res.status(404).json({ success: false, error: 'Caso no encontrado' });
      }
      const desdeCaso = datosContactoDesdeCaso(caso);
      contacto = {
        expediente: contacto.expediente || desdeCaso.expediente,
        siniestro: contacto.siniestro || desdeCaso.siniestro,
        aseguradoNombre: contacto.aseguradoNombre || desdeCaso.aseguradoNombre,
        email: contacto.email || desdeCaso.email,
        celular: contacto.celular || desdeCaso.celular,
      };
    }

    let pasos = [];
    let plantillaTitulo = '';
    let plantillaId = null;
    if (tipo === 'guided') {
      if (body.plantillaId && mongoose.Types.ObjectId.isValid(body.plantillaId)) {
        const plantilla = await VideoperitajePlantilla.findById(body.plantillaId);
        if (!plantilla || plantilla.archivada) {
          return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });
        }
        pasos = sanitizarPasos(plantilla.pasos);
        plantillaTitulo = plantilla.titulo;
        plantillaId = plantilla._id;
      } else {
        pasos = sanitizarPasos(body.pasos);
      }
      if (!pasos.length) {
        return res.status(400).json({
          success: false,
          error: 'La autoinspección necesita una plantilla o pasos',
        });
      }
    }

    const { raw, hash } = generarTokenAcceso();
    const sesion = await VideoperitajeSesion.create({
      tipo,
      estado: 'pendiente',
      modulo,
      casoId: body.casoId || null,
      expediente: contacto.expediente,
      siniestro: contacto.siniestro,
      aseguradoNombre: contacto.aseguradoNombre,
      celular: contacto.celular,
      email: contacto.email,
      peritoUserId: usuario.id,
      peritoNombre: usuario.nombre,
      peritoLogin: usuario.login,
      tokenHash: hash,
      tokenExpira: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      plantillaId,
      plantillaTitulo,
      pasos,
    });
    sesion.livekitRoom = nombreSalaLivekit(sesion._id);
    await sesion.save();

    const aviso = await notificarInvitacionSesion({
      sesion,
      tokenRaw: raw,
      frontendUrl: resolveVideoperitajePublicUrl(),
    });
    sesion.invitacion = {
      emailEnviado: aviso.emailEnviado,
      emailError: aviso.emailError,
      whatsappUrl: aviso.whatsappUrl,
      whatsappEnviado: aviso.whatsappEnviado,
      whatsappError: aviso.whatsappError,
    };
    await sesion.save();

    res.status(201).json({
      success: true,
      data: sesion,
      tokenAsegurado: raw,
      urlPublica: aviso.urlPublica,
      whatsappUrl: aviso.whatsappUrl,
      emailEnviado: aviso.emailEnviado,
      emailError: aviso.emailError,
      whatsappEnviado: aviso.whatsappEnviado,
      whatsappError: aviso.whatsappError,
    });
  } catch (error) {
    console.error('❌ crearSesion videoperitaje:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function listarSesiones(req, res) {
  try {
    const { estado, tipo, modulo, casoId, q, page = 1, limit = 40 } = req.query;
    const filtro = {};
    if (estado) filtro.estado = String(estado);
    if (tipo) filtro.tipo = String(tipo);
    if (modulo) filtro.modulo = normalizarModulo(modulo);
    if (casoId && mongoose.Types.ObjectId.isValid(casoId)) filtro.casoId = casoId;
    if (q) {
      const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filtro.$or = [
        { expediente: rx },
        { siniestro: rx },
        { aseguradoNombre: rx },
        { celular: rx },
        { peritoNombre: rx },
      ];
    }
    const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
    const [data, total] = await Promise.all([
      VideoperitajeSesion.find(filtro).sort({ createdAt: -1 }).skip(skip).limit(Math.max(1, Number(limit))),
      VideoperitajeSesion.countDocuments(filtro),
    ]);
    res.json({ success: true, data, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error('❌ listarSesiones videoperitaje:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function obtenerSesion(req, res) {
  try {
    const sesion = await VideoperitajeSesion.findById(req.params.id);
    if (!sesion) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    const medias = await hidratarMedias(sesion.medias);
    res.json({
      success: true,
      data: { ...sesion.toObject(), medias },
      livekitConfigured: livekitConfig().configured,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function tokenLivekitPerito(req, res) {
  try {
    const sesion = await VideoperitajeSesion.findById(req.params.id);
    if (!sesion) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    if (sesion.tipo !== 'live') {
      return res.status(400).json({ success: false, error: 'Esta sesión no es una videollamada' });
    }
    if (!ESTADOS_ABIERTOS.has(sesion.estado) && sesion.estado !== 'en_proceso') {
      return res.status(409).json({ success: false, error: 'La sesión ya no está activa' });
    }
    const usuario = usuarioDesdeReq(req);
    if (sesion.estado === 'pendiente') {
      sesion.estado = 'en_proceso';
      sesion.inicio = sesion.inicio || new Date();
      await sesion.save();
    }
    const room = sesion.livekitRoom || nombreSalaLivekit(sesion._id);
    const tk = await crearTokenLivekit({
      room,
      identity: `perito-${usuario.id || sesion._id}`,
      name: usuario.nombre || 'Perito',
      canPublish: true,
      canSubscribe: true,
    });
    res.json({ success: true, ...tk, sessionId: sesion._id, estado: sesion.estado });
  } catch (error) {
    if (error.code === 'LIVEKIT_NOT_CONFIGURED' || error.code === 'LIVEKIT_SDK_MISSING') {
      return res.json({
        success: true,
        token: null,
        url: null,
        configured: false,
        sessionId: sesion._id,
        estado: sesion.estado,
      });
    }
    res.status(500).json({ success: false, error: error.message, code: error.code });
  }
}

export async function finalizarSesion(req, res) {
  try {
    const sesion = await VideoperitajeSesion.findById(req.params.id);
    if (!sesion) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    if (sesion.estado === 'cancelada') {
      return res.status(409).json({ success: false, error: 'La sesión está cancelada' });
    }
    sesion.estado = 'finalizada';
    sesion.fin = new Date();
    if (sesion.inicio) {
      sesion.duracionSeg = Math.max(
        0,
        Math.round((sesion.fin.getTime() - new Date(sesion.inicio).getTime()) / 1000)
      );
    }
    if (req.body?.notas) sesion.notas = String(req.body.notas);
    const adjunto = await adjuntarMediasAlCaso(sesion, sesion.medias);
    sesion.adjuntadoAlCaso = Boolean(adjunto.ok && adjunto.agregados >= 0);
    await sesion.save();
    await cerrarSalaLivekit(sesion.livekitRoom || nombreSalaLivekit(sesion._id));
    res.json({ success: true, data: sesion, adjunto });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function cancelarSesion(req, res) {
  try {
    const sesion = await VideoperitajeSesion.findById(req.params.id);
    if (!sesion) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    if (sesion.estado === 'finalizada') {
      return res.status(409).json({ success: false, error: 'No se puede cancelar una sesión finalizada' });
    }
    sesion.estado = 'cancelada';
    sesion.fin = new Date();
    await sesion.save();
    await cerrarSalaLivekit(sesion.livekitRoom || nombreSalaLivekit(sesion._id));
    res.json({ success: true, data: sesion });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function reenviarInvitacion(req, res) {
  try {
    const sesion = await VideoperitajeSesion.findById(req.params.id);
    if (!sesion) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    if (!ESTADOS_ABIERTOS.has(sesion.estado)) {
      return res.status(409).json({ success: false, error: 'La sesión ya no admite reenvío' });
    }
    const { raw, hash } = generarTokenAcceso();
    sesion.tokenHash = hash;
    sesion.tokenExpira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const aviso = await notificarInvitacionSesion({
      sesion,
      tokenRaw: raw,
      frontendUrl: resolveVideoperitajePublicUrl(),
    });
    sesion.invitacion = {
      emailEnviado: aviso.emailEnviado,
      emailError: aviso.emailError,
      whatsappUrl: aviso.whatsappUrl,
      whatsappEnviado: aviso.whatsappEnviado,
      whatsappError: aviso.whatsappError,
    };
    await sesion.save();
    res.json({
      success: true,
      tokenAsegurado: raw,
      urlPublica: aviso.urlPublica,
      whatsappUrl: aviso.whatsappUrl,
      emailEnviado: aviso.emailEnviado,
      emailError: aviso.emailError,
      whatsappEnviado: aviso.whatsappEnviado,
      whatsappError: aviso.whatsappError,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function obtenerPublica(req, res) {
  try {
    const sesion = await buscarPorTokenPublico(req.params.token);
    if (!sesion) return res.status(404).json({ success: false, error: 'Enlace inválido o vencido' });
    if (sesion.tokenExpira && sesion.tokenExpira < new Date()) {
      return res.status(410).json({ success: false, error: 'Este enlace ya venció' });
    }
    await marcarAseguradoEnLinea(sesion);
    const medias = await hidratarMedias(sesion.medias);
    res.json({
      success: true,
      data: { ...sesionPublicaBase(sesion), medias },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function joinPublico(req, res) {
  try {
    const sesion = await buscarPorTokenPublico(req.params.token);
    if (!sesion) return res.status(404).json({ success: false, error: 'Enlace inválido o vencido' });
    if (sesion.tokenExpira && sesion.tokenExpira < new Date()) {
      return res.status(410).json({ success: false, error: 'Este enlace ya venció' });
    }
    if (!ESTADOS_ABIERTOS.has(sesion.estado)) {
      return res.status(409).json({
        success: false,
        error: sesion.estado === 'finalizada' ? 'La sesión ya finalizó' : 'La sesión no está disponible',
        estado: sesion.estado,
      });
    }

    const geo = req.body?.geo;
    if (geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lng))) {
      sesion.geo = {
        lat: Number(geo.lat),
        lng: Number(geo.lng),
        accuracy: Number(geo.accuracy) || undefined,
        at: new Date(),
      };
    }
    if (sesion.estado === 'pendiente') {
      sesion.estado = 'en_proceso';
      sesion.inicio = sesion.inicio || new Date();
    }
    sesion.aseguradoVistaAt = new Date();
    await sesion.save();

    let livekit = null;
    if (sesion.tipo === 'live' && livekitConfig().configured) {
      try {
        livekit = await crearTokenLivekit({
          room: sesion.livekitRoom || nombreSalaLivekit(sesion._id),
          identity: `aseg-${sesion._id}`,
          name: sesion.aseguradoNombre || 'Asegurado',
          canPublish: true,
          canSubscribe: true,
        });
      } catch (err) {
        livekit = err.code === 'LIVEKIT_NOT_CONFIGURED' ? null : { error: err.message, code: err.code };
      }
    }

    const medias = await hidratarMedias(sesion.medias);
    res.json({
      success: true,
      data: { ...sesionPublicaBase(sesion), medias },
      livekit,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function subirFotoPublica(req, res) {
  try {
    const sesion = await buscarPorTokenPublico(req.params.token);
    if (!sesion) return res.status(404).json({ success: false, error: 'Enlace inválido o vencido' });
    if (!ESTADOS_ABIERTOS.has(sesion.estado)) {
      return res.status(409).json({ success: false, error: 'La sesión no admite más fotos' });
    }
    const media = buildMediaFromUpload(req, {
      tipo: tipoMediaDeArchivo(req, req.body?.tipo),
      pasoId: String(req.body?.pasoId || ''),
      descripcion: String(req.body?.descripcion || ''),
      subidoPorRol: 'asegurado',
    });
    if (!media) {
      return res.status(400).json({ success: false, error: 'No se recibió archivo' });
    }
    if (media.pasoId) {
      const paso = (sesion.pasos || []).find((p) => p.id === media.pasoId);
      if (paso) {
        const ya = (sesion.medias || []).filter((m) => m.pasoId === media.pasoId).length;
        if (ya >= (paso.maxFotos || 99)) {
          return res.status(400).json({
            success: false,
            error: `Este paso admite máximo ${paso.maxFotos} fotos`,
          });
        }
      }
    }
    sesion.medias.push(media);
    if (sesion.estado === 'pendiente') {
      sesion.estado = 'en_proceso';
      sesion.inicio = sesion.inicio || new Date();
    }
    await sesion.save();
    const creado = sesion.medias[sesion.medias.length - 1];
    const [hidratada] = await hidratarMedias([creado]);
    res.status(201).json({ success: true, data: hidratada });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function completarPasoPublico(req, res) {
  try {
    const sesion = await buscarPorTokenPublico(req.params.token);
    if (!sesion) return res.status(404).json({ success: false, error: 'Enlace inválido o vencido' });
    const pasoIdBody = String(req.body?.pasoId || '');
    const paso = (sesion.pasos || []).find((p) => p.id === pasoIdBody);
    if (!paso) return res.status(404).json({ success: false, error: 'Paso no encontrado' });
    const fotos = (sesion.medias || []).filter((m) => m.pasoId === pasoIdBody).length;
    if (paso.obligatorio && fotos < (paso.minFotos || 0)) {
      return res.status(400).json({
        success: false,
        error: `Faltan fotos en este paso (mínimo ${paso.minFotos})`,
      });
    }
    if (!sesion.pasosCumplidos.includes(pasoIdBody)) {
      sesion.pasosCumplidos.push(pasoIdBody);
    }
    const pendientes = (sesion.pasos || []).filter(
      (p) => p.obligatorio && !sesion.pasosCumplidos.includes(p.id)
    );
    if (!pendientes.length) {
      sesion.estado = 'finalizada';
      sesion.fin = new Date();
      if (sesion.inicio) {
        sesion.duracionSeg = Math.max(
          0,
          Math.round((sesion.fin.getTime() - new Date(sesion.inicio).getTime()) / 1000)
        );
      }
      await adjuntarMediasAlCaso(sesion, sesion.medias);
      sesion.adjuntadoAlCaso = true;
    }
    await sesion.save();
    res.json({ success: true, data: sesionPublicaBase(sesion) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function subirFotoPerito(req, res) {
  try {
    const sesion = await VideoperitajeSesion.findById(req.params.id);
    if (!sesion) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    const media = buildMediaFromUpload(req, {
      tipo: tipoMediaDeArchivo(req, req.body?.tipo),
      pasoId: String(req.body?.pasoId || ''),
      descripcion: String(req.body?.descripcion || 'Captura del perito'),
      subidoPorRol: 'perito',
    });
    if (!media) {
      return res.status(400).json({ success: false, error: 'No se recibió archivo' });
    }
    if (!sesionAceptaMediaPerito(sesion, media.tipo)) {
      return res.status(409).json({ success: false, error: 'La sesión no admite más fotos' });
    }
    const hidratada = await persistirMediaPerito(sesion, media);
    res.status(201).json({ success: true, data: hidratada });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function presignUploadPublico(req, res) {
  try {
    const sesion = await buscarPorTokenPublico(req.params.token);
    if (!sesion) return res.status(404).json({ success: false, error: 'Enlace inválido o vencido' });
    const data = await presignMediaSesion(req, sesion, req.params.token, req.body || {});
    res.json({ success: true, ...data });
  } catch (error) {
    errorHttp(res, error);
  }
}

export async function completarUploadPublico(req, res) {
  try {
    const sesion = await buscarPorTokenPublico(req.params.token);
    if (!sesion) return res.status(404).json({ success: false, error: 'Enlace inválido o vencido' });
    const data = await registrarMediaPresign(sesion, req.params.token, req.body || {}, 'asegurado');
    res.status(201).json({ success: true, data });
  } catch (error) {
    errorHttp(res, error);
  }
}

export async function presignUploadPerito(req, res) {
  try {
    const sesion = await VideoperitajeSesion.findById(req.params.id);
    if (!sesion) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    const data = await presignMediaSesion(req, sesion, sesion._id.toString(), req.body || {});
    res.json({ success: true, ...data });
  } catch (error) {
    errorHttp(res, error);
  }
}

export async function completarUploadPerito(req, res) {
  try {
    const sesion = await VideoperitajeSesion.findById(req.params.id);
    if (!sesion) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    const data = await registrarMediaPresign(
      sesion,
      sesion._id.toString(),
      req.body || {},
      'perito'
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    errorHttp(res, error);
  }
}

export async function listarPlantillas(req, res) {
  try {
    const archivadas = String(req.query.archivadas || '') === '1';
    const filtro = archivadas ? { archivada: true } : { archivada: { $ne: true } };
    let data = await VideoperitajePlantilla.find(filtro).sort({ updatedAt: -1 });
    if (!archivadas && data.length === 0) {
      const usuario = usuarioDesdeReq(req);
      await VideoperitajePlantilla.create({
        titulo: 'Vivienda — recorrido básico',
        descripcion: 'Fachada, daños interiores y documentos del predio.',
        activa: true,
        pasos: sanitizarPasos([
          { titulo: 'Fachada y acceso', instruccion: 'Foto de la fachada completa y del acceso al predio.', minFotos: 1, maxFotos: 4, obligatorio: true },
          { titulo: 'Daños principales', instruccion: 'Fotografíe los daños más evidentes (techo, muros, pisos).', minFotos: 2, maxFotos: 8, obligatorio: true },
          { titulo: 'Entorno / documentos', instruccion: 'Si puede, una foto de cédula o carta y del entorno inmediato.', minFotos: 0, maxFotos: 4, obligatorio: false },
        ]),
        creadoPor: usuario,
      });
      data = await VideoperitajePlantilla.find(filtro).sort({ updatedAt: -1 });
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function crearPlantilla(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    const pasos = sanitizarPasos(req.body?.pasos);
    if (!String(req.body?.titulo || '').trim()) {
      return res.status(400).json({ success: false, error: 'El título es obligatorio' });
    }
    if (!pasos.length) {
      return res.status(400).json({ success: false, error: 'Agregue al menos un paso' });
    }
    const plantilla = await VideoperitajePlantilla.create({
      titulo: String(req.body.titulo).trim(),
      descripcion: String(req.body.descripcion || '').trim(),
      activa: req.body.activa !== false,
      pasos,
      creadoPor: usuario,
    });
    res.status(201).json({ success: true, data: plantilla });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function actualizarPlantilla(req, res) {
  try {
    const plantilla = await VideoperitajePlantilla.findById(req.params.id);
    if (!plantilla) return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });
    if (req.body.titulo != null) plantilla.titulo = String(req.body.titulo).trim();
    if (req.body.descripcion != null) plantilla.descripcion = String(req.body.descripcion);
    if (req.body.activa != null) plantilla.activa = Boolean(req.body.activa);
    if (req.body.archivada != null) plantilla.archivada = Boolean(req.body.archivada);
    if (Array.isArray(req.body.pasos)) plantilla.pasos = sanitizarPasos(req.body.pasos);
    await plantilla.save();
    res.json({ success: true, data: plantilla });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function archivarPlantilla(req, res) {
  try {
    const plantilla = await VideoperitajePlantilla.findById(req.params.id);
    if (!plantilla) return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });
    plantilla.archivada = true;
    plantilla.activa = false;
    await plantilla.save();
    res.json({ success: true, data: plantilla });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
