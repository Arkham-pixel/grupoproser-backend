import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';
import Complex from '../models/Complex.js';
import ComplexSubtarea from '../models/ComplexSubtarea.js';
import Responsable from '../models/Responsable.js';
import SecurUser from '../models/SecurUser.js';
import { getPublicPathForSingle } from '../services/fileStorageService.js';
import {
  enviarNotificacionSubtareaInterna,
  enviarNotificacionSubtareaExterna,
  enviarNotificacionSubtareaCompletada,
  enviarNotificacionSubtareaReabierta,
} from '../services/emailService.js';
import {
  enriquecerSubtarea,
  esAsignadoInterno,
  loginDesdeUsuario,
  loginsDesdeUsuario,
  puedeGestionarSubtareasCaso,
  puedeTrabajarSubtareaInterna,
} from '../utils/permisosSubtareasComplex.js';

const DIAS_TOKEN_DEFAULT = 30;
const ESTADOS_ASIGNADO = new Set(['pendiente', 'en_progreso', 'completada']);
const ESTADOS_GESTION = new Set(['pendiente', 'en_progreso', 'completada', 'cancelada']);

/** Etapas cuyo entregable es un formato (informe); exigen adjuntarlo para completar. */
const ETAPAS_REQUIEREN_FORMATO = new Set([
  'informePreliminar',
  'informeFinal',
  'presentacionCifras',
]);

function subtareaRequiereFormato(subtarea) {
  return ETAPAS_REQUIEREN_FORMATO.has(String(subtarea?.etapaTrazabilidad || '').trim());
}

function tieneFormatoAdjunto(subtarea) {
  return (subtarea?.archivos || []).some((a) => a.tipoArchivo === 'formato');
}

/**
 * Origen del front que hizo la petición (localhost en dev, Arnald en producción),
 * para que los enlaces de los correos apunten al entorno correcto.
 */
function frontendUrlDesdeReq(req) {
  const candidatos = [req.headers.origin, req.headers.referer];
  for (const valor of candidatos) {
    const s = String(valor || '').trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return `${u.protocol}//${u.host}`;
      }
    } catch {
      /* siguiente candidato */
    }
  }
  return '';
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function generarTokenAcceso() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

function usuarioDesdeReq(req) {
  const fromJwt = req.usuario || {};
  // Preferir cabecera del front (localStorage.login = codi usado al asignar).
  // Si el JWT trae email u otro valor, no debe tapar la cédula/codi del header.
  const headerLogin = String(req.headers['x-usuario-login'] || '').trim();
  const loginJwt = String(fromJwt.login || '').trim();
  const cedulaJwt = String(fromJwt.cedula || '').trim();
  return {
    ...fromJwt,
    login: headerLogin || loginJwt || cedulaJwt,
    cedula: cedulaJwt || headerLogin || loginJwt,
    rol: fromJwt.rol || fromJwt.role || fromJwt.tipoUsuario || req.headers['x-usuario-rol'],
    nombre:
      fromJwt.nombre ||
      fromJwt.name ||
      req.headers['x-usuario-nombre'] ||
      '',
  };
}

/** Logins con los que puede coincidir codiAsignado (header + JWT + SecurUser). */
async function resolverLoginsAsignado(req) {
  const usuario = usuarioDesdeReq(req);
  const set = new Set(loginsDesdeUsuario(usuario));
  const id = usuario.id || usuario._id;
  if (id) {
    try {
      const u = await SecurUser.findById(id).select('login cedula').lean();
      if (u?.login) set.add(String(u.login).trim());
      if (u?.cedula) set.add(String(u.cedula).trim());
    } catch {
      /* ignore */
    }
  }
  const primario = loginDesdeUsuario(usuario);
  if (primario) {
    try {
      const u = await SecurUser.findOne({
        $or: [{ login: primario }, { cedula: primario }, { email: primario }],
      })
        .select('login cedula')
        .lean();
      if (u?.login) set.add(String(u.login).trim());
      if (u?.cedula) set.add(String(u.cedula).trim());
    } catch {
      /* ignore */
    }
  }
  return [...set].filter(Boolean);
}

function normalizarObjectId(valor) {
  if (!valor) return null;
  if (typeof valor === 'object' && valor.$oid) return String(valor.$oid);
  const str = String(valor).trim();
  if (!/^[a-fA-F0-9]{24}$/.test(str)) return null;
  return str;
}

async function cargarCaso(casoId) {
  const id = normalizarObjectId(casoId);
  if (!id) return null;
  return Complex.findById(id).lean();
}

function normalizarTipoArchivo(valor) {
  return String(valor || '').trim().toLowerCase() === 'formato' ? 'formato' : 'documento';
}

/** Guarda el archivo también en historialDocs del caso Complex. */
async function sincronizarArchivoEnCaso({ casoId, subtarea, archivo }) {
  const casoDoc = await Complex.findById(casoId);
  if (!casoDoc) return;

  const esFormato = archivo.tipoArchivo === 'formato';
  const tipoHist = esFormato ? 'formatoSubtarea' : 'subtarea';
  const ahora = new Date().toISOString();
  const entrada = {
    tipo: tipoHist,
    categoria: tipoHist,
    nombre: archivo.nombre,
    filename: archivo.filename,
    url: archivo.url,
    ruta: archivo.url,
    fecha: ahora,
    fechaSubida: ahora,
    fechaCreacion: ahora,
    subidoPor: archivo.subidoPor || '',
    subtareaId: String(subtarea._id),
    subtareaTitulo: subtarea.titulo || '',
    origen: 'subtarea',
  };

  const historial = Array.isArray(casoDoc.historialDocs) ? [...casoDoc.historialDocs] : [];
  historial.push(entrada);
  casoDoc.historialDocs = historial;
  if (typeof casoDoc.markModified === 'function') {
    casoDoc.markModified('historialDocs');
  }
  await casoDoc.save();
}

async function resolverEmailResponsable(codi) {
  const codigo = String(codi || '').trim();
  if (!codigo) return '';
  const resp = await Responsable.findOne({ codiRespnsble: codigo }).lean();
  if (resp?.email?.trim()) return resp.email.trim();
  const user = await SecurUser.findOne({
    $or: [{ login: codigo }, { cedula: codigo }],
  }).lean();
  return user?.email?.trim() || '';
}

/** Nombre legible del usuario (para correos); cae al login si no hay registro. */
async function resolverNombreUsuario(usuario) {
  const nombreDirecto = String(usuario?.nombre || '').trim();
  if (nombreDirecto) return nombreDirecto;
  const login = loginDesdeUsuario(usuario);
  if (!login) return '';
  try {
    const user = await SecurUser.findOne({
      $or: [{ login }, { cedula: login }, { email: login }],
    })
      .select('name nombre')
      .lean();
    if (user?.name?.trim()) return user.name.trim();
    if (user?.nombre?.trim()) return user.nombre.trim();
    const resp = await Responsable.findOne({ codiRespnsble: login })
      .select('nmbrRespnsble')
      .lean();
    if (resp?.nmbrRespnsble?.trim()) return resp.nmbrRespnsble.trim();
  } catch {
    /* fallback al login */
  }
  return login;
}

async function notificarAsignacion(subtarea, caso, tokenRaw = null, frontendUrl = '') {
  if (subtarea.tipoAsignado === 'interno') {
    const email =
      subtarea.emailAsignado || (await resolverEmailResponsable(subtarea.codiAsignado));
    if (!email) return { success: false, message: 'Sin email del asignado interno' };
    return enviarNotificacionSubtareaInterna({
      emailDestino: email,
      casoId: String(caso._id),
      subtareaId: String(subtarea._id),
      nmroAjste: caso.nmroAjste || subtarea.nmroAjste,
      titulo: subtarea.titulo,
      descripcion: subtarea.descripcion,
      instrucciones: subtarea.instrucciones,
      fechaLimite: subtarea.fechaLimite,
      creadoPorNombre: subtarea.creadoPorNombre,
      creadoPorLogin: subtarea.creadoPorLogin,
      frontendUrl,
    });
  }

  const email = subtarea.emailExterno;
  if (!email || !tokenRaw) {
    return { success: false, message: 'Sin email externo o token' };
  }
  return enviarNotificacionSubtareaExterna({
    emailDestino: email,
    nombreDestino: subtarea.nombreExterno,
    token: tokenRaw,
    casoId: String(caso._id),
    nmroAjste: caso.nmroAjste || subtarea.nmroAjste,
    titulo: subtarea.titulo,
    descripcion: subtarea.descripcion,
    instrucciones: subtarea.instrucciones,
    fechaLimite: subtarea.fechaLimite,
    creadoPorNombre: subtarea.creadoPorNombre,
    frontendUrl,
  });
}

async function notificarCompletada(subtarea, caso, completoPor) {
  const destinos = new Set();
  if (subtarea.creadoPorLogin) {
    const emailCreador = await resolverEmailResponsable(subtarea.creadoPorLogin);
    if (emailCreador) destinos.add(emailCreador);
  }
  if (caso.codiRespnsble) {
    const emailResp = await resolverEmailResponsable(caso.codiRespnsble);
    if (emailResp) destinos.add(emailResp);
  }

  const resultados = [];
  for (const email of destinos) {
    try {
      resultados.push(
        await enviarNotificacionSubtareaCompletada({
          emailDestino: email,
          casoId: String(caso._id),
          nmroAjste: caso.nmroAjste || subtarea.nmroAjste,
          titulo: subtarea.titulo,
          observacionesAsignado: subtarea.observacionesAsignado,
          nombreCompletoPor: completoPor,
        })
      );
    } catch (err) {
      resultados.push({ success: false, error: err.message });
    }
  }
  return resultados;
}

function marcarInicioTrabajo(subtarea, cuando = new Date()) {
  if (!subtarea.fechaInicioTrabajo) {
    subtarea.fechaInicioTrabajo = cuando;
  }
}

/** Avisa al asignado (interno o externo) que la subtarea fue reabierta con el motivo. */
async function notificarReapertura(subtarea, caso, reabiertaPorNombre, motivo, frontendUrl = '') {
  let email = '';
  if (subtarea.tipoAsignado === 'interno') {
    email =
      subtarea.emailAsignado || (await resolverEmailResponsable(subtarea.codiAsignado));
  } else {
    email = subtarea.emailExterno;
  }
  if (!email) return { success: false, message: 'Sin email del asignado' };

  return enviarNotificacionSubtareaReabierta({
    emailDestino: email,
    subtareaId: String(subtarea._id),
    nmroAjste: caso?.nmroAjste || subtarea.nmroAjste,
    titulo: subtarea.titulo,
    fechaLimite: subtarea.fechaLimite,
    reabiertaPorNombre,
    motivo,
    frontendUrl,
  });
}

function aplicarCambioEstado(subtarea, nuevoEstado, por, nota = '') {
  if (subtarea.estado === nuevoEstado) return;
  const ahora = new Date();
  subtarea.estado = nuevoEstado;
  subtarea.historialEstados.push({
    estado: nuevoEstado,
    fecha: ahora,
    por: por || 'sistema',
    nota,
  });

  if (nuevoEstado === 'en_progreso') {
    marcarInicioTrabajo(subtarea, ahora);
  }

  if (nuevoEstado === 'completada') {
    marcarInicioTrabajo(subtarea, ahora);
    subtarea.fechaCompletada = ahora;
    const inicio = subtarea.fechaInicioTrabajo
      ? new Date(subtarea.fechaInicioTrabajo)
      : subtarea.createdAt
        ? new Date(subtarea.createdAt)
        : ahora;
    const creacion = subtarea.createdAt ? new Date(subtarea.createdAt) : inicio;
    subtarea.duracionTrabajoMs = Math.max(0, ahora.getTime() - inicio.getTime());
    subtarea.duracionAsignacionMs = Math.max(0, ahora.getTime() - creacion.getTime());
  }

  if (nuevoEstado === 'pendiente' || nuevoEstado === 'en_progreso') {
    // Reabrir: limpia cierre pero conserva fechaInicioTrabajo e historial
    if (nuevoEstado === 'pendiente' && subtarea.fechaCompletada) {
      subtarea.fechaCompletada = undefined;
      subtarea.duracionTrabajoMs = undefined;
      subtarea.duracionAsignacionMs = undefined;
    }
  }
}

export async function listarPorCaso(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    if (!normalizarObjectId(req.params.casoId)) {
      return res.status(400).json({ error: 'Identificador de caso inválido' });
    }
    const caso = await cargarCaso(req.params.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });

    if (!puedeGestionarSubtareasCaso(usuario, caso)) {
      const logins = await resolverLoginsAsignado(req);
      const subtareas = await ComplexSubtarea.find({
        casoId: caso._id,
        tipoAsignado: 'interno',
        codiAsignado: { $in: logins.length ? logins : ['__none__'] },
      })
        .sort({ createdAt: -1 })
        .lean();
      return res.json(subtareas.map(enriquecerSubtarea));
    }

    const subtareas = await ComplexSubtarea.find({ casoId: caso._id })
      .sort({ createdAt: -1 })
      .lean();
    return res.json(subtareas.map(enriquecerSubtarea));
  } catch (error) {
    console.error('❌ listarPorCaso subtareas:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function listarMias(req, res) {
  try {
    const logins = await resolverLoginsAsignado(req);
    if (!logins.length) return res.status(401).json({ error: 'Usuario no autenticado' });

    const filtroAsignado = {
      tipoAsignado: 'interno',
      codiAsignado: { $in: logins },
    };

    const subtareas = await ComplexSubtarea.find({
      ...filtroAsignado,
      estado: { $in: ['pendiente', 'en_progreso'] },
    })
      .sort({ fechaLimite: 1, createdAt: -1 })
      .lean();

    // Completadas se conservan (no “desaparecen”) para evidencia, seguimiento y control de horas
    const completadas = await ComplexSubtarea.find({
      ...filtroAsignado,
      estado: 'completada',
    })
      .sort({ fechaCompletada: -1, updatedAt: -1 })
      .limit(300)
      .lean();

    const enriquecidas = subtareas.map(enriquecerSubtarea);
    const completadasEnr = completadas.map(enriquecerSubtarea);
    const conteo = { verde: 0, amarillo: 0, rojo: 0, gris: 0, total: enriquecidas.length };
    for (const s of enriquecidas) {
      if (conteo[s.semaforo] !== undefined) conteo[s.semaforo] += 1;
    }

    return res.json({
      total: enriquecidas.length,
      totalCompletadas: completadasEnr.length,
      conteo,
      subtareas: enriquecidas,
      completadas: completadasEnr,
    });
  } catch (error) {
    console.error('❌ listarMias subtareas:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function obtenerUna(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    if (!normalizarObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Identificador inválido' });
    }
    const subtarea = await ComplexSubtarea.findById(req.params.id);
    if (!subtarea) return res.status(404).json({ error: 'Subtarea no encontrada' });
    const caso = await cargarCaso(subtarea.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    if (!puedeTrabajarSubtareaInterna(usuario, caso, subtarea) && !puedeGestionarSubtareasCaso(usuario, caso)) {
      return res.status(403).json({ error: 'Sin permiso para ver esta subtarea' });
    }
    if (esAsignadoInterno(usuario, subtarea) && !subtarea.leidoEnPlataforma) {
      subtarea.leidoEnPlataforma = new Date();
      await subtarea.save();
    }
    return res.json({
      subtarea: enriquecerSubtarea(subtarea),
      caso: {
        _id: caso._id,
        nmroAjste: caso.nmroAjste,
        nmroSinstro: caso.nmroSinstro,
        codiRespnsble: caso.codiRespnsble,
        asgrBenfcro: caso.asgrBenfcro,
        descripcionCiudad: caso.descripcionCiudad || caso.ciudadSiniestro,
      },
    });
  } catch (error) {
    console.error('❌ obtenerUna subtarea:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function crearSubtarea(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    if (!normalizarObjectId(req.params.casoId)) {
      return res.status(400).json({ error: 'Identificador de caso inválido' });
    }
    const caso = await cargarCaso(req.params.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    if (!puedeGestionarSubtareasCaso(usuario, caso)) {
      return res.status(403).json({ error: 'No tiene permiso para crear subtareas en este caso' });
    }

    const {
      titulo,
      descripcion = '',
      instrucciones = '',
      tipoAsignado,
      codiAsignado = '',
      nombreAsignado = '',
      emailAsignado = '',
      nombreExterno = '',
      emailExterno = '',
      fechaLimite,
      etapaTrazabilidad = '',
      etapaProtocoloId = '',
    } = req.body || {};

    if (!titulo?.trim()) {
      return res.status(400).json({ error: 'El título es obligatorio' });
    }
    if (!['interno', 'externo'].includes(tipoAsignado)) {
      return res.status(400).json({ error: 'tipoAsignado debe ser interno o externo' });
    }

    let tokenRaw = null;
    let tokenHash = undefined;
    let tokenExpira = undefined;

    const payload = {
      casoId: caso._id,
      nmroAjste: caso.nmroAjste || '',
      titulo: titulo.trim(),
      etapaTrazabilidad: String(etapaTrazabilidad || '').trim(),
      etapaProtocoloId: String(etapaProtocoloId || '').trim(),
      descripcion: String(descripcion || ''),
      instrucciones: String(instrucciones || ''),
      tipoAsignado,
      fechaLimite: fechaLimite ? new Date(fechaLimite) : undefined,
      creadoPorLogin: loginDesdeUsuario(usuario),
      creadoPorNombre:
        usuario?.nombre ||
        usuario?.name ||
        req.headers['x-usuario-nombre'] ||
        loginDesdeUsuario(usuario),
      estado: 'pendiente',
      historialEstados: [
        {
          estado: 'pendiente',
          fecha: new Date(),
          por: loginDesdeUsuario(usuario) || 'sistema',
          nota: 'Creación',
        },
      ],
      archivos: [],
    };

    if (tipoAsignado === 'interno') {
      if (!codiAsignado?.trim()) {
        return res.status(400).json({ error: 'Debe indicar el ajustador interno' });
      }
      let nombre = nombreAsignado;
      let email = emailAsignado;
      if (!nombre || !email) {
        const resp = await Responsable.findOne({
          codiRespnsble: String(codiAsignado).trim(),
        }).lean();
        if (resp) {
          nombre = nombre || resp.nmbrRespnsble || '';
          email = email || resp.email || '';
        }
      }
      if (!email) email = await resolverEmailResponsable(codiAsignado);
      payload.codiAsignado = String(codiAsignado).trim();
      payload.nombreAsignado = nombre || '';
      payload.emailAsignado = email || '';
    } else {
      if (!emailExterno?.trim()) {
        return res.status(400).json({ error: 'El email del externo es obligatorio' });
      }
      const gen = generarTokenAcceso();
      tokenRaw = gen.raw;
      tokenHash = gen.hash;
      tokenExpira = new Date(Date.now() + DIAS_TOKEN_DEFAULT * 24 * 60 * 60 * 1000);
      payload.nombreExterno = String(nombreExterno || '').trim();
      payload.emailExterno = String(emailExterno).trim().toLowerCase();
      payload.tokenHash = tokenHash;
      payload.tokenExpira = tokenExpira;
    }

    const creada = await ComplexSubtarea.create(payload);

    let notificacion = null;
    try {
      notificacion = await notificarAsignacion(creada, caso, tokenRaw, frontendUrlDesdeReq(req));
      creada.notificadoEn = new Date();
      await creada.save();
    } catch (err) {
      console.error('⚠️ Error notificando subtarea:', err.message);
      notificacion = { success: false, error: err.message };
    }

    const response = enriquecerSubtarea(creada);
    if (tokenRaw) {
      response.enlaceExterno = `/complex/subtarea/${tokenRaw}`;
      response.tokenUnaVez = tokenRaw;
    }

    return res.status(201).json({ subtarea: response, notificacion });
  } catch (error) {
    console.error('❌ crearSubtarea:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function actualizarSubtarea(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    const subtarea = await ComplexSubtarea.findById(req.params.id);
    if (!subtarea) return res.status(404).json({ error: 'Subtarea no encontrada' });

    const caso = await cargarCaso(subtarea.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });

    const gestiona = puedeGestionarSubtareasCaso(usuario, caso);
    const trabaja = puedeTrabajarSubtareaInterna(usuario, caso, subtarea);
    if (!gestiona && !trabaja) {
      return res.status(403).json({ error: 'Sin permiso sobre esta subtarea' });
    }

    const {
      titulo,
      descripcion,
      instrucciones,
      fechaLimite,
      estado,
      observacionesAsignado,
      marcarLeida,
      motivoReapertura,
    } = req.body || {};

    const esAsignado = esAsignadoInterno(usuario, subtarea);
    const esReapertura =
      subtarea.estado === 'completada' &&
      (estado === 'pendiente' || estado === 'en_progreso');

    // Reabrir exige motivo: el asignado debe saber por qué vuelve a su bandeja
    if (esReapertura && !String(motivoReapertura || '').trim()) {
      return res.status(400).json({
        error: 'Debe indicar el motivo de la reapertura para notificar al asignado',
      });
    }
    const nombreReabre = esReapertura ? await resolverNombreUsuario(usuario) : '';

    if (marcarLeida) {
      subtarea.leidoEnPlataforma = new Date();
      if (esAsignado) {
        marcarInicioTrabajo(subtarea);
        if (subtarea.estado === 'pendiente') {
          aplicarCambioEstado(subtarea, 'en_progreso', loginDesdeUsuario(usuario), 'Abierta por asignado');
        }
      }
    }

    // Solo la persona asignada puede cerrar/completar la subtarea
    if (estado === 'completada' && !esAsignado) {
      return res.status(403).json({
        error: 'Solo la persona asignada puede completar y cerrar la subtarea',
      });
    }

    // Etapas de informe: exigen el formato adjunto antes de cerrar
    if (
      estado === 'completada' &&
      subtareaRequiereFormato(subtarea) &&
      !tieneFormatoAdjunto(subtarea)
    ) {
      return res.status(400).json({
        error:
          'Esta etapa exige el formato (informe) antes de completarla: genérelo en el formulario de ajuste; quedará adjunto a la subtarea.',
      });
    }

    if (gestiona) {
      if (titulo !== undefined) subtarea.titulo = String(titulo).trim() || subtarea.titulo;
      if (descripcion !== undefined) subtarea.descripcion = String(descripcion);
      if (instrucciones !== undefined) subtarea.instrucciones = String(instrucciones);
      if (fechaLimite !== undefined) {
        subtarea.fechaLimite = fechaLimite ? new Date(fechaLimite) : undefined;
      }
      if (estado !== undefined) {
        if (!ESTADOS_GESTION.has(estado)) {
          return res.status(400).json({ error: 'Estado inválido' });
        }
        // Gestor: cancelar o reabrir; completar solo si también es el asignado
        if (estado === 'completada' && !esAsignado) {
          return res.status(403).json({
            error: 'Solo la persona asignada puede completar y cerrar la subtarea',
          });
        }
        aplicarCambioEstado(
          subtarea,
          estado,
          loginDesdeUsuario(usuario),
          esReapertura ? `Reabierta: ${String(motivoReapertura).trim()}` : ''
        );
      }
    } else if (estado !== undefined) {
      if (!ESTADOS_ASIGNADO.has(estado) || estado === 'cancelada') {
        return res.status(400).json({ error: 'Estado no permitido para el asignado' });
      }
      if (!esAsignado) {
        return res.status(403).json({ error: 'Sin permiso para cambiar el estado' });
      }
      aplicarCambioEstado(subtarea, estado, loginDesdeUsuario(usuario));
    }

    if (esReapertura) {
      subtarea.motivoReapertura = String(motivoReapertura).trim();
      subtarea.motivoReaperturaPor = nombreReabre;
      // Vuelve a bandeja: resetear lectura para que el aviso in-app reaparezca
      subtarea.leidoEnPlataforma = undefined;
    }

    if (observacionesAsignado !== undefined && trabaja) {
      subtarea.observacionesAsignado = String(observacionesAsignado);
    }

    await subtarea.save();

    if (estado === 'completada') {
      try {
        await notificarCompletada(
          subtarea,
          caso,
          subtarea.nombreAsignado || loginDesdeUsuario(usuario)
        );
      } catch (err) {
        console.error('⚠️ Error notificando completada:', err.message);
      }
    }

    let notificacionReapertura = null;
    if (esReapertura) {
      try {
        notificacionReapertura = await notificarReapertura(
          subtarea,
          caso,
          nombreReabre,
          subtarea.motivoReapertura,
          frontendUrlDesdeReq(req)
        );
      } catch (err) {
        console.error('⚠️ Error notificando reapertura:', err.message);
        notificacionReapertura = { success: false, error: err.message };
      }
    }

    const respuesta = enriquecerSubtarea(subtarea);
    if (notificacionReapertura) {
      respuesta.notificacionReapertura = notificacionReapertura;
    }
    return res.json(respuesta);
  } catch (error) {
    console.error('❌ actualizarSubtarea:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function cancelarSubtarea(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    const subtarea = await ComplexSubtarea.findById(req.params.id);
    if (!subtarea) return res.status(404).json({ error: 'Subtarea no encontrada' });
    const caso = await cargarCaso(subtarea.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    if (!puedeGestionarSubtareasCaso(usuario, caso)) {
      return res.status(403).json({ error: 'Sin permiso para cancelar' });
    }
    aplicarCambioEstado(subtarea, 'cancelada', loginDesdeUsuario(usuario), 'Cancelada');
    await subtarea.save();
    return res.json(enriquecerSubtarea(subtarea));
  } catch (error) {
    console.error('❌ cancelarSubtarea:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function reenviarNotificacion(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    const subtarea = await ComplexSubtarea.findById(req.params.id);
    if (!subtarea) return res.status(404).json({ error: 'Subtarea no encontrada' });
    const caso = await cargarCaso(subtarea.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    if (!puedeGestionarSubtareasCaso(usuario, caso)) {
      return res.status(403).json({ error: 'Sin permiso' });
    }

    let tokenRaw = null;
    if (subtarea.tipoAsignado === 'externo') {
      const gen = generarTokenAcceso();
      tokenRaw = gen.raw;
      subtarea.tokenHash = gen.hash;
      subtarea.tokenExpira = new Date(
        Date.now() + DIAS_TOKEN_DEFAULT * 24 * 60 * 60 * 1000
      );
      await subtarea.save();
    }

    const notificacion = await notificarAsignacion(
      subtarea,
      caso,
      tokenRaw,
      frontendUrlDesdeReq(req)
    );
    subtarea.notificadoEn = new Date();
    await subtarea.save();

    const response = enriquecerSubtarea(subtarea);
    if (tokenRaw) {
      response.enlaceExterno = `/complex/subtarea/${tokenRaw}`;
      response.tokenUnaVez = tokenRaw;
    }
    return res.json({ subtarea: response, notificacion });
  } catch (error) {
    console.error('❌ reenviarNotificacion:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function subirArchivoAutenticado(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    const subtarea = await ComplexSubtarea.findById(req.params.id);
    if (!subtarea) return res.status(404).json({ error: 'Subtarea no encontrada' });
    const caso = await cargarCaso(subtarea.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    if (!puedeTrabajarSubtareaInterna(usuario, caso, subtarea)) {
      return res.status(403).json({ error: 'Sin permiso para adjuntar' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se subió archivo' });

    const tipoArchivo = normalizarTipoArchivo(req.body?.tipoArchivo || req.query?.tipoArchivo);
    const url = getPublicPathForSingle(req, (f) => `/uploads/${f.filename}`);
    const archivo = {
      nombre: req.file.originalname,
      url,
      filename: req.file.filename || req.file.originalname,
      tipoArchivo,
      subidoPor:
        usuario?.nombre || loginDesdeUsuario(usuario) || 'usuario',
      subidoPorTipo: puedeGestionarSubtareasCaso(usuario, caso)
        ? 'creador'
        : 'interno',
      fechaSubida: new Date(),
    };
    subtarea.archivos.push(archivo);
    if (subtarea.estado === 'pendiente') {
      aplicarCambioEstado(subtarea, 'en_progreso', loginDesdeUsuario(usuario), 'Archivo subido');
    }
    await subtarea.save();
    try {
      await sincronizarArchivoEnCaso({ casoId: subtarea.casoId, subtarea, archivo });
    } catch (syncErr) {
      console.error('⚠️ No se pudo sincronizar archivo en historialDocs:', syncErr.message);
    }
    return res.json({ archivo, subtarea: enriquecerSubtarea(subtarea) });
  } catch (error) {
    console.error('❌ subirArchivoAutenticado:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function encontrarPorToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 20) return null;
  const subtarea = await ComplexSubtarea.findOne({ tokenHash: hashToken(raw) });
  if (!subtarea) return null;
  if (subtarea.tokenExpira && new Date(subtarea.tokenExpira) < new Date()) {
    return { expirada: true, subtarea };
  }
  return { expirada: false, subtarea };
}

function payloadPublico(subtarea, caso) {
  return {
    id: subtarea._id,
    titulo: subtarea.titulo,
    descripcion: subtarea.descripcion,
    instrucciones: subtarea.instrucciones,
    estado: subtarea.estado,
    etapaTrazabilidad: subtarea.etapaTrazabilidad || '',
    requiereFormato: subtareaRequiereFormato(subtarea),
    fechaLimite: subtarea.fechaLimite,
    observacionesAsignado: subtarea.observacionesAsignado,
    archivos: (subtarea.archivos || []).map((a) => ({
      nombre: a.nombre,
      url: a.url,
      tipoArchivo: a.tipoArchivo || 'documento',
      subidoPor: a.subidoPor,
      subidoPorTipo: a.subidoPorTipo,
      fechaSubida: a.fechaSubida,
    })),
    semaforo: enriquecerSubtarea(subtarea).semaforo,
    nmroAjste: subtarea.nmroAjste || caso?.nmroAjste || '',
    ciudadSiniestro: caso?.descripcionCiudad || caso?.ciudadSiniestro || '',
    nombreExterno: subtarea.nombreExterno,
    creadoPorNombre: subtarea.creadoPorNombre,
    expira: subtarea.tokenExpira,
  };
}

export async function obtenerPublica(req, res) {
  try {
    const found = await encontrarPorToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'Enlace inválido o inexistente' });
    if (found.expirada) {
      return res.status(410).json({ error: 'El enlace ha vencido. Solicite uno nuevo al ajustador.' });
    }
    if (found.subtarea.estado === 'cancelada') {
      return res.status(410).json({ error: 'Esta subtarea fue cancelada.' });
    }
    const caso = await cargarCaso(found.subtarea.casoId);
    return res.json(payloadPublico(found.subtarea, caso));
  } catch (error) {
    console.error('❌ obtenerPublica:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function actualizarPublica(req, res) {
  try {
    const found = await encontrarPorToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'Enlace inválido o inexistente' });
    if (found.expirada) {
      return res.status(410).json({ error: 'El enlace ha vencido' });
    }
    const subtarea = found.subtarea;
    if (subtarea.estado === 'cancelada') {
      return res.status(410).json({ error: 'Subtarea cancelada' });
    }

    const { estado, observacionesAsignado } = req.body || {};
    if (observacionesAsignado !== undefined) {
      subtarea.observacionesAsignado = String(observacionesAsignado);
    }
    if (estado !== undefined) {
      if (!ESTADOS_ASIGNADO.has(estado)) {
        return res.status(400).json({ error: 'Estado no permitido' });
      }
      if (
        estado === 'completada' &&
        subtareaRequiereFormato(subtarea) &&
        !tieneFormatoAdjunto(subtarea)
      ) {
        return res.status(400).json({
          error:
            'Debe diligenciar y guardar el formulario de ajuste (informe) antes de marcar la tarea como completada.',
        });
      }
      aplicarCambioEstado(
        subtarea,
        estado,
        subtarea.nombreExterno || subtarea.emailExterno || 'externo'
      );
    } else if (subtarea.estado === 'pendiente') {
      aplicarCambioEstado(
        subtarea,
        'en_progreso',
        subtarea.nombreExterno || 'externo',
        'Actualización por portal externo'
      );
    }

    await subtarea.save();

    if (estado === 'completada') {
      const caso = await cargarCaso(subtarea.casoId);
      if (caso) {
        try {
          await notificarCompletada(
            subtarea,
            caso,
            subtarea.nombreExterno || subtarea.emailExterno
          );
        } catch (err) {
          console.error('⚠️ Error notificando completada externa:', err.message);
        }
      }
    }

    const caso = await cargarCaso(subtarea.casoId);
    return res.json(payloadPublico(subtarea, caso));
  } catch (error) {
    console.error('❌ actualizarPublica:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Sesión limitada para que el asignado externo diligencie el formulario de
 * ajuste real de la plataforma. Emite un JWT con rol "externo" atado a la
 * subtarea; el middleware restringirExterno limita qué APIs puede usar.
 */
export async function crearSesionAjusteExterna(req, res) {
  try {
    const found = await encontrarPorToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'Enlace inválido o inexistente' });
    if (found.expirada) return res.status(410).json({ error: 'El enlace ha vencido' });
    const subtarea = found.subtarea;
    if (subtarea.estado === 'cancelada') {
      return res.status(410).json({ error: 'Subtarea cancelada' });
    }
    if (subtarea.tipoAsignado !== 'externo') {
      return res.status(403).json({ error: 'Enlace no válido para esta subtarea' });
    }

    const caso = await cargarCaso(subtarea.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });

    const nombre = subtarea.nombreExterno || subtarea.emailExterno || 'Externo';
    const sesion = jwt.sign(
      {
        id: `externo-subtarea-${subtarea._id}`,
        login: `externo:${subtarea._id}`,
        role: 'externo',
        externo: true,
        subtareaId: String(subtarea._id),
        casoId: String(caso._id),
        nmroAjste: caso.nmroAjste || subtarea.nmroAjste || '',
        nombre,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    if (subtarea.estado === 'pendiente') {
      aplicarCambioEstado(subtarea, 'en_progreso', nombre, 'Abrió el formulario de ajuste');
      await subtarea.save();
    }

    return res.json({
      token: sesion,
      nombre,
      subtarea: {
        id: String(subtarea._id),
        titulo: subtarea.titulo,
        etapaTrazabilidad: subtarea.etapaTrazabilidad || '',
        estado: subtarea.estado,
      },
      caso,
    });
  } catch (error) {
    console.error('❌ crearSesionAjusteExterna:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function subirArchivoPublico(req, res) {
  try {
    const found = await encontrarPorToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'Enlace inválido o inexistente' });
    if (found.expirada) return res.status(410).json({ error: 'El enlace ha vencido' });
    const subtarea = found.subtarea;
    if (['cancelada', 'completada'].includes(subtarea.estado)) {
      return res.status(400).json({ error: 'No se pueden adjuntar archivos en este estado' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se subió archivo' });

    const tipoArchivo = normalizarTipoArchivo(req.body?.tipoArchivo || req.query?.tipoArchivo);
    const url = getPublicPathForSingle(req, (f) => `/uploads/${f.filename}`);
    const archivo = {
      nombre: req.file.originalname,
      url,
      filename: req.file.filename || req.file.originalname,
      tipoArchivo,
      subidoPor: subtarea.nombreExterno || subtarea.emailExterno || 'externo',
      subidoPorTipo: 'externo',
      fechaSubida: new Date(),
    };
    subtarea.archivos.push(archivo);
    if (subtarea.estado === 'pendiente') {
      aplicarCambioEstado(
        subtarea,
        'en_progreso',
        subtarea.nombreExterno || 'externo',
        'Archivo subido'
      );
    }
    await subtarea.save();
    try {
      await sincronizarArchivoEnCaso({ casoId: subtarea.casoId, subtarea, archivo });
    } catch (syncErr) {
      console.error('⚠️ No se pudo sincronizar archivo público en historialDocs:', syncErr.message);
    }
    const caso = await cargarCaso(subtarea.casoId);
    return res.json({ archivo, subtarea: payloadPublico(subtarea, caso) });
  } catch (error) {
    console.error('❌ subirArchivoPublico:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function resumenCaso(req, res) {
  try {
    const usuario = usuarioDesdeReq(req);
    if (!normalizarObjectId(req.params.casoId)) {
      return res.status(400).json({ error: 'Identificador de caso inválido' });
    }
    const caso = await cargarCaso(req.params.casoId);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });

    const filtro = { casoId: caso._id };
    if (!puedeGestionarSubtareasCaso(usuario, caso)) {
      const logins = await resolverLoginsAsignado(req);
      filtro.tipoAsignado = 'interno';
      filtro.codiAsignado = { $in: logins.length ? logins : ['__none__'] };
    }

    const subtareas = await ComplexSubtarea.find(filtro).lean();
    const enriquecidas = subtareas.map(enriquecerSubtarea);
    const conteo = { verde: 0, amarillo: 0, rojo: 0, gris: 0, total: enriquecidas.length };
    for (const s of enriquecidas) {
      if (conteo[s.semaforo] !== undefined) conteo[s.semaforo] += 1;
    }

    return res.json({
      casoId: caso._id,
      nmroAjste: caso.nmroAjste,
      puedeGestionar: puedeGestionarSubtareasCaso(usuario, caso),
      conteo,
      subtareas: enriquecidas,
    });
  } catch (error) {
    console.error('❌ resumenCaso subtareas:', error);
    return res.status(500).json({ error: error.message });
  }
}
