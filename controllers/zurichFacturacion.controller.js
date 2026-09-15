import { enviarNotificacionControlHoras, enviarNotificacionGerencia } from '../services/emailService.js';
import {
  persistirEnvioFacturacionTrasCorreo,
  listarBandejaFacturacion,
  corregirDestinatarioEnvioFacturacion,
  eliminarRegistroEnvioFacturacion,
} from '../services/facturacionBandejaService.js';
import {
  normalizarClaveGerente,
  resolverGerenteDesdeLogin,
  puedeElegirGerenteEnBandeja,
  puedeAdministrarBandejaFacturacion,
  usuarioPuedeVerBandejaFacturacionZurich,
  esLiderZurichFacturacion,
  LOGIN_LIDER_ZURICH_FACTURACION,
  EMAIL_LIDER_ZURICH_FACTURACION,
} from '../config/gerentesFacturacion.js';
import { resolveFrontendUrl } from '../config/platformUrls.js';
import SecurUser from '../models/SecurUser.js';

function origenZurichDesdeReq(req, body = {}) {
  const raw = String(body.origen || req.baseUrl || req.originalUrl || '').toLowerCase();
  return raw.includes('listado') ? 'listado' : 'cat';
}

function urlCasoZurich(casoId, origen) {
  const frontendUrl = resolveFrontendUrl();
  const path = origen === 'listado' ? '/zurich/listado/caso' : '/zurich/caso';
  return casoId ? `${frontendUrl}${path}?casoId=${casoId}` : `${frontendUrl}${path}`;
}

function loginDesdeReq(req) {
  return String(
    req.usuario?.login || req.user?.login || req.query.login || req.body?.login || ''
  ).trim();
}

async function resolverCopiaLiderZurich() {
  const fallback = {
    gerente: 'ladys',
    nombre: 'Ladys Andrea Escalante',
    email: EMAIL_LIDER_ZURICH_FACTURACION,
  };
  try {
    const user = await SecurUser.findOne({ login: LOGIN_LIDER_ZURICH_FACTURACION })
      .select('name email')
      .lean();
    if (user?.email) {
      return {
        gerente: 'ladys',
        nombre: user.name || fallback.nombre,
        email: user.email,
      };
    }
  } catch (err) {
    console.warn('⚠️ No se pudo resolver el correo de Ladys Escalante:', err.message);
  }
  return fallback;
}

async function copiasLiderZurichSiAplica(gerenteNorm) {
  if (!gerenteNorm || gerenteNorm === 'ladys' || gerenteNorm === 'test') return [];
  const copia = await resolverCopiaLiderZurich();
  return copia?.email ? [copia] : [];
}

async function identidadBandejaZurich(req) {
  const login = loginDesdeReq(req);
  let name = String(req.query.nombre || req.body?.nombre || '').trim();
  let email = '';
  if (login) {
    try {
      const user = await SecurUser.findOne({ login }).select('login name email').lean();
      if (user) {
        name = user.name || name;
        email = user.email || '';
      }
    } catch {
      /* lookup opcional */
    }
  }
  return { login, name, email };
}

export const notificarControlHorasZurich = async (req, res) => {
  try {
    const {
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos = [],
      archivosConRuta = [],
      controlHoras,
      resumenControlHoras,
      usuario,
      gerente,
      casoId,
    } = req.body || {};

    const tieneArchivos = archivos.length > 0 || archivosConRuta.length > 0;
    const tieneControlHorasRegistrado = Boolean(controlHoras?.filas?.length);
    if (!tieneArchivos && !tieneControlHorasRegistrado) {
      return res.status(400).json({
        success: false,
        error: 'Debe registrar el control de horas en el sistema o adjuntar documentos para notificar',
      });
    }
    if (!gerente) {
      return res.status(400).json({ success: false, error: 'No se especificó el gerente destinatario' });
    }
    const gerenteNorm = normalizarClaveGerente(gerente);
    if (gerenteNorm === 'adriana') {
      return res.status(400).json({
        success: false,
        error:
          'Facturación no recibe el control de horas en esta fase. Envíe la evidencia en "Envío de Control de Horas" (fase 2) y seleccione a Adriana.',
      });
    }

    const origen = origenZurichDesdeReq(req, req.body);
    const copias = await copiasLiderZurichSiAplica(gerenteNorm);
    const copia = copias[0];

    const resultado = await enviarNotificacionControlHoras({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      archivosConRuta,
      controlHoras: tieneControlHorasRegistrado ? controlHoras : null,
      resumenControlHoras,
      usuario,
      gerente,
      casoId,
      urlCaso: urlCasoZurich(casoId, origen),
      emailsCopia: copia?.email ? [copia.email] : [],
      nombreCopia: copia ? `${copia.nombre} (líder Zurich)` : undefined,
    });

    let persistencia = null;
    if (resultado?.success !== false) {
      persistencia = await persistirEnvioFacturacionTrasCorreo({
        casoId,
        numeroCaso,
        tipo: 'control_horas',
        gerente,
        usuario,
        emailDestinatario: resultado.destinatarioPrincipal,
        nombreDestinatario: resultado.nombreDestinatario,
        copias,
        controlHoras: tieneControlHorasRegistrado ? controlHoras : null,
        resumenControlHoras,
      });
    }

    res.json({
      success: true,
      resultado,
      envioRegistrado: Boolean(persistencia?.ok),
      copiaLider: copia
        ? { nombre: copia.nombre, email: copia.email }
        : null,
      casoId: persistencia?.casoId || casoId || null,
      motivoNoRegistro: persistencia?.ok ? undefined : persistencia?.motivo,
    });
  } catch (error) {
    console.error('❌ Error enviando notificación de control de horas Zurich:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const notificarGerenciaZurich = async (req, res) => {
  try {
    const {
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos = [],
      archivosConRuta = [],
      usuario,
      gerente,
      casoId,
    } = req.body || {};

    if (!archivos.length && !archivosConRuta.length) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron archivos para notificar' });
    }
    if (!gerente) {
      return res.status(400).json({ success: false, error: 'No se especificó el gerente destinatario' });
    }

    const gerenteNorm = String(gerente || '').trim().toLowerCase();
    const esFacturacion =
      gerenteNorm === 'adriana' ||
      gerenteNorm.includes('adriana') ||
      gerenteNorm.includes('facturacion');
    const emailFacturacion =
      process.env.EMAIL_FACTURACION_AJUSTES?.trim() ||
      'facturacion.ajustes@proserpuertos.com.co';
    const clavePersist = esFacturacion ? 'adriana' : normalizarClaveGerente(gerente);
    const origen = origenZurichDesdeReq(req, req.body);
    const copias = await copiasLiderZurichSiAplica(clavePersist);
    const copia = copias[0];

    const resultado = await enviarNotificacionGerencia({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      archivosConRuta,
      usuario,
      gerente,
      casoId,
      urlCaso: urlCasoZurich(casoId, origen),
      emailsCopia: copia?.email ? [copia.email] : [],
      nombreCopia: copia ? `${copia.nombre} (líder Zurich)` : undefined,
      ...(esFacturacion && {
        emailDestinatario: emailFacturacion,
        nombreDestinatario: 'Adriana Angulo Funes',
      }),
    });

    let persistencia = null;
    if (resultado?.success !== false) {
      persistencia = await persistirEnvioFacturacionTrasCorreo({
        casoId,
        numeroCaso,
        tipo: 'gerencia',
        gerente: esFacturacion ? 'adriana' : gerente,
        usuario,
        emailDestinatario:
          resultado?.destinatarios?.[0] || resultado?.destinatarioPrincipal || emailFacturacion,
        nombreDestinatario:
          resultado?.nombreDestinatario || (esFacturacion ? 'Adriana Angulo Funes' : undefined),
        copias,
      });
    }

    res.json({
      success: true,
      resultado,
      emailEnviado: resultado?.destinatarios?.[0] || resultado?.destinatarioPrincipal,
      envioRegistrado: Boolean(persistencia?.ok),
      copiaLider: copia
        ? { nombre: copia.nombre, email: copia.email }
        : null,
      casoId: persistencia?.casoId || casoId || null,
      motivoNoRegistro: persistencia?.ok ? undefined : persistencia?.motivo,
    });
  } catch (error) {
    console.error('❌ Error enviando notificación de gerencia Zurich:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const obtenerBandejaFacturacionZurich = async (req, res) => {
  try {
    const identidad = await identidadBandejaZurich(req);
    if (!usuarioPuedeVerBandejaFacturacionZurich(identidad)) {
      return res.status(403).json({
        success: false,
        error: 'No tiene permiso para consultar la bandeja de facturación Zurich',
      });
    }

    const esLider = esLiderZurichFacturacion(identidad);
    const esSupervisor = puedeElegirGerenteEnBandeja(identidad.login);
    const gerentePropio = resolverGerenteDesdeLogin(identidad.login);
    const pideTodos =
      String(req.query.verTodos || '') === '1' ||
      String(req.query.gerente || '').toLowerCase() === 'todos';

    let verTodos = Boolean(esLider || (esSupervisor && pideTodos) || (esSupervisor && !req.query.gerente));
    if (!esLider && !esSupervisor) verTodos = false;

    let gerente = normalizarClaveGerente(req.query.gerente);
    if (!verTodos) {
      if (!gerente) gerente = gerentePropio;
      if (!gerente) {
        return res.status(403).json({
          success: false,
          error: 'Su usuario no está asociado a un jefe de facturación',
        });
      }
      if (gerentePropio && gerente !== gerentePropio) {
        return res.status(403).json({
          success: false,
          error: 'Solo puede consultar su propia bandeja',
        });
      }
    }

    const resultado = await listarBandejaFacturacion({
      gerente,
      tipo: req.query.tipo || 'todos',
      desde: req.query.desde,
      hasta: req.query.hasta,
      q: req.query.q,
      coleccion: 'zurich',
      verTodos,
    });

    res.json({ success: true, verTodos, esLider, ...resultado });
  } catch (error) {
    console.error('❌ Error obteniendo bandeja de facturación Zurich:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const corregirEnvioBandejaFacturacionZurich = async (req, res) => {
  try {
    const login = loginDesdeReq(req);
    if (!puedeAdministrarBandejaFacturacion(login)) {
      return res.status(403).json({
        success: false,
        error: 'Solo el supervisor autorizado puede corregir envíos de la bandeja',
      });
    }

    const { casoId, nuevoGerente, envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor } =
      req.body || {};

    const resultado = await corregirDestinatarioEnvioFacturacion({
      casoId,
      nuevoGerente,
      corregidoPor: login,
      selector: { envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor },
    });

    if (!resultado.ok) {
      const status =
        resultado.motivo === 'caso_no_encontrado' || resultado.motivo === 'envio_no_encontrado'
          ? 404
          : 400;
      const mensajes = {
        caso_no_encontrado: 'No se encontró el caso',
        envio_no_encontrado: 'No se encontró el registro de envío en ese caso',
        datos_invalidos: 'Datos incompletos para la corrección',
      };
      return res.status(status).json({
        success: false,
        error: mensajes[resultado.motivo] || resultado.motivo,
      });
    }

    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error corrigiendo envío bandeja Zurich:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const eliminarEnvioBandejaFacturacionZurich = async (req, res) => {
  try {
    const login = loginDesdeReq(req);
    if (!puedeAdministrarBandejaFacturacion(login)) {
      return res.status(403).json({
        success: false,
        error: 'Solo el supervisor autorizado puede eliminar registros de la bandeja',
      });
    }

    const { casoId, envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor } =
      req.body || {};

    const resultado = await eliminarRegistroEnvioFacturacion({
      casoId,
      eliminadoPor: login,
      selector: { envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor },
    });

    if (!resultado.ok) {
      const status =
        resultado.motivo === 'caso_no_encontrado' || resultado.motivo === 'envio_no_encontrado'
          ? 404
          : 400;
      const mensajes = {
        caso_no_encontrado: 'No se encontró el caso',
        envio_no_encontrado: 'No se encontró el registro de envío en ese caso',
        datos_invalidos: 'Datos incompletos',
      };
      return res.status(status).json({
        success: false,
        error: mensajes[resultado.motivo] || resultado.motivo,
      });
    }

    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error eliminando envío bandeja Zurich:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
