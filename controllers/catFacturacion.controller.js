import { enviarNotificacionControlHoras, enviarNotificacionGerencia } from '../services/emailService.js';
import {
  persistirEnvioFacturacionTrasCorreo,
  listarBandejaFacturacion,
  corregirDestinatarioEnvioFacturacion,
  eliminarRegistroEnvioFacturacion,
} from '../services/facturacionBandejaService.js';
import {
  normalizarClaveGerente,
  puedeVerFacturacionPrevisora,
  puedeVerFacturacionAllianz,
  puedeAdministrarBandejaFacturacion,
} from '../config/gerentesFacturacion.js';
import { resolveFrontendUrl } from '../config/platformUrls.js';

const CONFIG_MODULO = {
  allianz: { pathCat: '/allianz/liquidador', pathListado: '/allianz/listado/caso' },
  'allianz-listado': { pathCat: '/allianz/listado/caso', pathListado: '/allianz/listado/caso' },
  previsora: { pathCat: '/previsora/liquidador', pathListado: '/previsora/listado/caso' },
  'previsora-listado': { pathCat: '/previsora/listado/caso', pathListado: '/previsora/listado/caso' },
};

function origenDesdeReq(req, body = {}) {
  const raw = String(body.origen || req.baseUrl || req.originalUrl || '').toLowerCase();
  return raw.includes('listado') ? 'listado' : 'cat';
}

function moduloDesdeReq(req) {
  const raw = String(req.baseUrl || req.originalUrl || '').toLowerCase();
  if (raw.includes('allianz-listado') || raw.includes('/allianz/listado')) return 'allianz-listado';
  if (raw.includes('allianz')) return 'allianz';
  if (raw.includes('previsora-listado') || raw.includes('/previsora/listado')) return 'previsora-listado';
  if (raw.includes('previsora')) return 'previsora';
  return 'allianz';
}

function urlCaso(casoId, req, body = {}) {
  const frontendUrl = resolveFrontendUrl();
  const modulo = moduloDesdeReq(req);
  const origen = origenDesdeReq(req, body);
  const cfg = CONFIG_MODULO[modulo] || CONFIG_MODULO.allianz;
  const path = origen === 'listado' ? cfg.pathListado : cfg.pathCat;
  return casoId ? `${frontendUrl}${path}?casoId=${casoId}` : `${frontendUrl}${path}`;
}

function loginDesdeReq(req) {
  return String(req.usuario?.login || req.user?.login || req.body?.usuario || '').trim();
}

function rechazarSiNoPuedeFacturarModulo(req, res) {
  const modulo = String(moduloDesdeReq(req) || '');
  const login = loginDesdeReq(req);
  if (modulo.startsWith('previsora') && !puedeVerFacturacionPrevisora(login)) {
    res.status(403).json({
      success: false,
      error: 'No tiene permiso para facturación de Previsora.',
    });
    return true;
  }
  if (modulo.startsWith('allianz') && !puedeVerFacturacionAllianz(login)) {
    res.status(403).json({
      success: false,
      error: 'No tiene permiso para facturación de Allianz.',
    });
    return true;
  }
  return false;
}

export const notificarControlHorasCat = async (req, res) => {
  try {
    if (rechazarSiNoPuedeFacturarModulo(req, res)) return;
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
      urlCaso: urlCaso(casoId, req, req.body),
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
        controlHoras: tieneControlHorasRegistrado ? controlHoras : null,
        resumenControlHoras,
      });
    }

    res.json({
      success: true,
      resultado,
      envioRegistrado: Boolean(persistencia?.ok),
      casoId: persistencia?.casoId || casoId || null,
      motivoNoRegistro: persistencia?.ok ? undefined : persistencia?.motivo,
    });
  } catch (error) {
    console.error('❌ Error enviando notificación de control de horas CAT:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const notificarGerenciaCat = async (req, res) => {
  try {
    if (rechazarSiNoPuedeFacturarModulo(req, res)) return;
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
      return res.status(400).json({
        success: false,
        error: 'Debe adjuntar evidencia para notificar a gerencia',
      });
    }
    if (!gerente) {
      return res.status(400).json({ success: false, error: 'No se especificó el gerente destinatario' });
    }

    const resultado = await enviarNotificacionGerencia({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      archivosConRuta,
      usuario,
      gerente,
      casoId,
      urlCaso: urlCaso(casoId, req, req.body),
    });

    let persistencia = null;
    if (resultado?.success !== false) {
      persistencia = await persistirEnvioFacturacionTrasCorreo({
        casoId,
        numeroCaso,
        tipo: 'gerencia',
        gerente,
        usuario,
        emailDestinatario: resultado.destinatarioPrincipal,
        nombreDestinatario: resultado.nombreDestinatario,
      });
    }

    res.json({
      success: true,
      resultado,
      emailEnviado: resultado?.destinatarioPrincipal || '',
      envioRegistrado: Boolean(persistencia?.ok),
      casoId: persistencia?.casoId || casoId || null,
      motivoNoRegistro: persistencia?.ok ? undefined : persistencia?.motivo,
    });
  } catch (error) {
    console.error('❌ Error enviando notificación de gerencia CAT:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

function coleccionBandejaDesdeReq(req) {
  return String(moduloDesdeReq(req) || '').startsWith('previsora') ? 'previsora' : 'allianz';
}

function puedeVerBandejaCat(req) {
  const modulo = String(moduloDesdeReq(req) || '');
  const login = loginDesdeReq(req);
  if (modulo.startsWith('previsora')) return puedeVerFacturacionPrevisora(login);
  if (modulo.startsWith('allianz')) return puedeVerFacturacionAllianz(login);
  return false;
}

export const obtenerBandejaFacturacionCat = async (req, res) => {
  try {
    const login = loginDesdeReq(req) || String(req.query.login || '').trim();
    if (!puedeVerBandejaCat({ ...req, usuario: { login } })) {
      return res.status(403).json({
        success: false,
        error: 'No tiene permiso para consultar la bandeja de facturación',
      });
    }

    const coleccion = coleccionBandejaDesdeReq(req);
    const pideTodos =
      String(req.query.verTodos || '') === '1' ||
      !req.query.gerente ||
      String(req.query.gerente || '').toLowerCase() === 'todos';
    const gerente = pideTodos ? null : normalizarClaveGerente(req.query.gerente);
    const verTodos = pideTodos || !gerente;

    const resultado = await listarBandejaFacturacion({
      gerente,
      tipo: req.query.tipo || 'todos',
      desde: req.query.desde,
      hasta: req.query.hasta,
      q: req.query.q,
      coleccion,
      verTodos,
    });

    res.json({ success: true, verTodos, ...resultado });
  } catch (error) {
    console.error('❌ Error obteniendo bandeja de facturación CAT:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const corregirEnvioBandejaFacturacionCat = async (req, res) => {
  try {
    const login = loginDesdeReq(req) || String(req.body?.login || req.query?.login || '').trim();
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
      return res.status(status).json({ success: false, error: resultado.motivo });
    }
    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error corrigiendo envío bandeja CAT:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const eliminarEnvioBandejaFacturacionCat = async (req, res) => {
  try {
    const login = loginDesdeReq(req) || String(req.body?.login || req.query?.login || '').trim();
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
      return res.status(status).json({ success: false, error: resultado.motivo });
    }
    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error eliminando envío bandeja CAT:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
