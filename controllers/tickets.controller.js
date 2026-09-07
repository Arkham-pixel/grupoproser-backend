import Ticket from '../models/Ticket.js';
import SecurUser from '../models/SecurUser.js';
import { despacharAvisosTicketCreado } from '../services/ticketsDispatchService.js';
import { notificarTicketEstadoCambiado } from '../services/notificacionesOperativasService.js';
import {
  getPersistedForArrayIndex,
  STORAGE_CATEGORIES,
} from '../services/fileStorageService.js';

const ESTADOS_VALIDOS = ['abierto', 'en_progreso', 'resuelto', 'cerrado'];
const TIPOS_VALIDOS = ['queja', 'bug', 'mejora', 'otro'];
const PRIORIDADES_VALIDAS = ['baja', 'media', 'alta'];

function esAdminOSoporte(req) {
  const rol = String(req.usuario?.role || req.user?.role || '').toLowerCase();
  return rol === 'admin' || rol === 'soporte';
}

function usuarioDesdeReq(req) {
  return {
    id: String(req.usuario?.id || req.user?.id || ''),
    login: String(req.usuario?.login || req.user?.login || ''),
    role: String(req.usuario?.role || req.user?.role || ''),
  };
}

function mapAdjuntosDesdeReq(req) {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    return files.map((file, index) => {
      const persisted = getPersistedForArrayIndex(req, index);
      const ruta =
        persisted?.publicPath ||
        `/uploads/${STORAGE_CATEGORIES.TICKETS}/${file.filename}`;
      return {
        nombre: file.originalname || file.filename || 'adjunto',
        ruta,
        tipoMime: file.mimetype || '',
        tamaño: file.size || persisted?.size || 0,
      };
    });
  } catch (err) {
    console.warn('⚠️ [tickets] no se mapearon adjuntos:', err.message);
    return [];
  }
}

async function generarNumeroTicket() {
  const fecha = new Date();
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  const prefijo = `TKT-${y}${m}${d}`;
  const aleatorio = Math.floor(Math.random() * 9000) + 1000;
  let count = 0;
  try {
    count = await Ticket.countDocuments({ numero: { $regex: `^${prefijo}` } });
  } catch {
    count = Date.now() % 10000;
  }
  return `${prefijo}-${String(count + 1).padStart(4, '0')}-${aleatorio}`;
}

async function crearTicketConReintento(datos, intentos = 3) {
  let ultimoError = null;
  for (let i = 0; i < intentos; i += 1) {
    try {
      const numero = await generarNumeroTicket();
      return await Ticket.create({ ...datos, numero });
    } catch (err) {
      ultimoError = err;
      // Colisión de número único u otro error transitorio de escritura
      if (err?.code === 11000 || /duplicate/i.test(err?.message || '')) {
        continue;
      }
      throw err;
    }
  }
  throw ultimoError || new Error('No se pudo crear el ticket');
}

export async function crearTicket(req, res) {
  try {
    const user = usuarioDesdeReq(req);
    if (!user.id || !user.login) {
      return res.status(401).json({ success: false, mensaje: 'Usuario no autenticado' });
    }

    const titulo = String(req.body?.titulo || '').trim();
    const descripcion = String(req.body?.descripcion || '').trim();
    let tipo = String(req.body?.tipo || 'queja').toLowerCase();
    const modulo = String(req.body?.modulo || 'plataforma').trim().slice(0, 120) || 'plataforma';
    let prioridad = String(req.body?.prioridad || 'media').toLowerCase();

    if (!titulo || !descripcion) {
      return res.status(400).json({
        success: false,
        mensaje: 'Título y descripción son obligatorios',
      });
    }
    if (!TIPOS_VALIDOS.includes(tipo)) tipo = 'queja';
    if (!PRIORIDADES_VALIDAS.includes(prioridad)) prioridad = 'media';

    let nombre = String(req.body?.nombre || '').trim();
    let email = String(req.body?.email || '').trim();

    try {
      const dbUser = await SecurUser.findById(user.id).select('name email').lean();
      if (dbUser) {
        if (!nombre) nombre = dbUser.name || '';
        if (!email) email = dbUser.email || '';
      }
    } catch {
      // continuar con datos del body/token
    }

    const adjuntos = mapAdjuntosDesdeReq(req);

    const ticket = await crearTicketConReintento({
      titulo: titulo.slice(0, 200),
      descripcion: descripcion.slice(0, 5000),
      tipo,
      modulo,
      prioridad,
      estado: 'abierto',
      creadoPorUserId: user.id,
      creadoPorLogin: user.login,
      creadoPorNombre: nombre || user.login,
      creadoPorEmail: email,
      creadoPorRol: user.role,
      adjuntos,
    });

    // Avisos fuera del request: el ticket ya quedó guardado sí o sí
    despacharAvisosTicketCreado(ticket, {
      id: user.id,
      login: user.login,
      role: user.role,
    });

    const avisoAdjuntos = req.ticketAdjuntosOmitidos
      ? ' (el texto se guardó; uno o más adjuntos no se pudieron subir)'
      : '';

    return res.status(201).json({
      success: true,
      mensaje: `Ticket creado correctamente. Los avisos se envían en segundo plano.${avisoAdjuntos}`,
      data: ticket,
      meta: {
        adjuntosOmitidos: Boolean(req.ticketAdjuntosOmitidos),
        detalleAdjuntos: req.ticketAdjuntosOmitidos || null,
      },
    });
  } catch (error) {
    console.error('❌ Error creando ticket:', error);
    return res.status(500).json({
      success: false,
      mensaje: 'Error interno al crear el ticket',
      error: error.message,
    });
  }
}

export async function listarTickets(req, res) {
  try {
    const user = usuarioDesdeReq(req);
    if (!user.id || !user.login) {
      return res.status(401).json({ success: false, mensaje: 'Usuario no autenticado' });
    }

    const admin = esAdminOSoporte(req);
    const vista = String(req.query?.vista || 'mios').toLowerCase();
    const estado = String(req.query?.estado || '').toLowerCase();
    const filtro = {};

    if (vista === 'todos' && admin) {
      // bandeja completa
    } else {
      filtro.creadoPorLogin = user.login;
    }

    if (estado && ESTADOS_VALIDOS.includes(estado)) {
      filtro.estado = estado;
    }

    const tickets = await Ticket.find(filtro).sort({ createdAt: -1 }).limit(200).lean();

    return res.json({
      success: true,
      data: tickets,
      meta: { admin, vista: admin && vista === 'todos' ? 'todos' : 'mios' },
    });
  } catch (error) {
    console.error('❌ Error listando tickets:', error);
    return res.status(500).json({
      success: false,
      mensaje: 'Error interno al listar tickets',
      error: error.message,
    });
  }
}

export async function obtenerTicket(req, res) {
  try {
    const user = usuarioDesdeReq(req);
    if (!user.id || !user.login) {
      return res.status(401).json({ success: false, mensaje: 'Usuario no autenticado' });
    }

    const ticket = await Ticket.findById(req.params.id).lean();
    if (!ticket) {
      return res.status(404).json({ success: false, mensaje: 'Ticket no encontrado' });
    }

    const admin = esAdminOSoporte(req);
    if (!admin && ticket.creadoPorLogin !== user.login) {
      return res.status(403).json({ success: false, mensaje: 'No tienes acceso a este ticket' });
    }

    return res.json({ success: true, data: ticket, meta: { admin } });
  } catch (error) {
    console.error('❌ Error obteniendo ticket:', error);
    return res.status(500).json({
      success: false,
      mensaje: 'Error interno al obtener el ticket',
      error: error.message,
    });
  }
}

export async function actualizarTicket(req, res) {
  try {
    const user = usuarioDesdeReq(req);
    if (!user.id || !user.login) {
      return res.status(401).json({ success: false, mensaje: 'Usuario no autenticado' });
    }
    if (!esAdminOSoporte(req)) {
      return res.status(403).json({
        success: false,
        mensaje: 'Solo admin/soporte pueden actualizar tickets',
      });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, mensaje: 'Ticket no encontrado' });
    }

    const { estado, prioridad, asignadoALogin, comentario } = req.body || {};
    const estadoAnterior = ticket.estado;

    if (estado !== undefined) {
      const nuevoEstado = String(estado).toLowerCase();
      if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
        return res.status(400).json({ success: false, mensaje: 'Estado inválido' });
      }
      ticket.estado = nuevoEstado;
      if (nuevoEstado === 'cerrado' || nuevoEstado === 'resuelto') {
        ticket.cerradoEn = ticket.cerradoEn || new Date();
      } else {
        ticket.cerradoEn = null;
      }
    }

    if (prioridad !== undefined) {
      const nuevaPrioridad = String(prioridad).toLowerCase();
      if (!PRIORIDADES_VALIDAS.includes(nuevaPrioridad)) {
        return res.status(400).json({ success: false, mensaje: 'Prioridad inválida' });
      }
      ticket.prioridad = nuevaPrioridad;
    }

    if (asignadoALogin !== undefined) {
      ticket.asignadoALogin = String(asignadoALogin || '').trim();
    }

    const textoComentario = String(comentario || '').trim();
    if (textoComentario) {
      let autorNombre = user.login;
      try {
        const dbUser = await SecurUser.findById(user.id).select('name').lean();
        if (dbUser?.name) autorNombre = dbUser.name;
      } catch {
        // ignore
      }
      ticket.comentarios.push({
        autorUserId: user.id,
        autorLogin: user.login,
        autorNombre,
        texto: textoComentario,
        creadoEn: new Date(),
      });
    }

    await ticket.save();

    // Aviso en campana al autor (progreso), sin bloquear la respuesta
    const estadoCambio = String(estadoAnterior || '') !== String(ticket.estado || '');
    if (estadoCambio) {
      const payload = ticket.toObject ? ticket.toObject() : ticket;
      const actor = { id: user.id, login: user.login, role: user.role };
      const nota = textoComentario;
      setImmediate(() => {
        notificarTicketEstadoCambiado(payload, estadoAnterior, actor, {
          comentario: nota,
        }).catch((err) => {
          console.error('⚠️ Error notificación local de estado ticket:', err.message);
        });
      });
    }

    return res.json({
      success: true,
      mensaje: 'Ticket actualizado',
      data: ticket,
    });
  } catch (error) {
    console.error('❌ Error actualizando ticket:', error);
    return res.status(500).json({
      success: false,
      mensaje: 'Error interno al actualizar el ticket',
      error: error.message,
    });
  }
}

export async function agregarComentario(req, res) {
  try {
    const user = usuarioDesdeReq(req);
    if (!user.id || !user.login) {
      return res.status(401).json({ success: false, mensaje: 'Usuario no autenticado' });
    }

    const texto = String(req.body?.texto || '').trim();
    if (!texto) {
      return res.status(400).json({ success: false, mensaje: 'El comentario es obligatorio' });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, mensaje: 'Ticket no encontrado' });
    }

    const admin = esAdminOSoporte(req);
    if (!admin && ticket.creadoPorLogin !== user.login) {
      return res.status(403).json({ success: false, mensaje: 'No tienes acceso a este ticket' });
    }

    let autorNombre = user.login;
    try {
      const dbUser = await SecurUser.findById(user.id).select('name').lean();
      if (dbUser?.name) autorNombre = dbUser.name;
    } catch {
      // ignore
    }

    ticket.comentarios.push({
      autorUserId: user.id,
      autorLogin: user.login,
      autorNombre,
      texto,
      creadoEn: new Date(),
    });
    await ticket.save();

    return res.json({
      success: true,
      mensaje: 'Comentario agregado',
      data: ticket,
    });
  } catch (error) {
    console.error('❌ Error agregando comentario:', error);
    return res.status(500).json({
      success: false,
      mensaje: 'Error interno al agregar comentario',
      error: error.message,
    });
  }
}
