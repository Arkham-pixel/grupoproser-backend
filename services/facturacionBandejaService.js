import mongoose from 'mongoose';
import crypto from 'crypto';
import Complex from '../models/Complex.js';
import Siniestro from '../models/CasoComplex.js';
import {
  normalizarClaveGerente,
  nombreGerente,
  emailGerente,
} from '../config/gerentesFacturacion.js';
import {
  controlHorasTieneDatos,
  resolverControlHorasDesdeEnvios,
  buildCamposPersistenciaControlHoras,
} from '../utils/controlHorasUtils.js';

const TIPOS_ENVIO = new Set(['control_horas', 'gerencia']);
const MAX_CASOS_BANDEJA = 500;
const QUERY_TIMEOUT_MS = 20000;

function crearRegistroEnvio({
  tipo,
  gerente,
  usuario,
  numeroCaso,
  nombreDestinatario,
  emailDestinatario,
  rolEnvio = 'principal',
  controlHoras,
  resumenControlHoras,
}) {
  const gerenteNorm = normalizarClaveGerente(gerente);
  if (!gerenteNorm || !TIPOS_ENVIO.has(tipo)) {
    return null;
  }
  return {
    id: crypto.randomUUID(),
    tipo,
    gerente: gerenteNorm,
    usuario: String(usuario || 'desconocido').trim(),
    fecha: new Date(),
    numeroCaso: numeroCaso ? String(numeroCaso).trim() : '',
    nombreDestinatario: nombreDestinatario || nombreGerente(gerenteNorm),
    emailDestinatario: emailDestinatario ? String(emailDestinatario).trim() : '',
    rolEnvio: rolEnvio === 'copia' ? 'copia' : 'principal',
    ...(controlHoras ? { controlHoras } : {}),
    ...(resumenControlHoras ? { resumenControlHoras } : {}),
  };
}

function camposResumenPorTipo(tipo, registro) {
  if (!registro) return {};
  const gerenteNorm = registro.gerente;
  const fecha = registro.fecha;
  if (tipo === 'control_horas') {
    return {
      gerente_ultimo_envio_control_horas: gerenteNorm,
      fcha_ultima_notificacion_control_horas: fecha,
      ultimo_envio_control_horas: registro,
    };
  }
  if (tipo === 'gerencia') {
    return {
      gerente_ultimo_envio_gerencia: gerenteNorm,
      fcha_ultima_notificacion_gerencia: fecha,
      ultimo_envio_gerencia: registro,
    };
  }
  return {};
}

/** Busca el _id del caso por id o número de ajuste. */
export async function resolverCasoIdFacturacion({ casoId, numeroCaso }) {
  if (casoId && mongoose.Types.ObjectId.isValid(String(casoId))) {
    const id = String(casoId);
    const existe = await Complex.exists({ _id: id });
    if (existe) return id;
    const existeSin = await Siniestro.exists({ _id: id });
    if (existeSin) return id;
  }

  const num = String(numeroCaso || '').trim();
  if (!num || num === 'Sin número') return null;

  const porNumero = await Complex.findOne({ nmroAjste: num }).select('_id').lean();
  if (porNumero?._id) return String(porNumero._id);

  const porNumeroSin = await Siniestro.findOne({ nmroAjste: num }).select('_id').lean();
  if (porNumeroSin?._id) return String(porNumeroSin._id);

  return null;
}

/** Persiste un envío en el historial del caso. */
export async function registrarEnvioFacturacion(casoId, datos) {
  const registro = crearRegistroEnvio(datos);
  if (!registro || !casoId) {
    return { ok: false, motivo: 'datos_invalidos' };
  }

  const update = {
    $push: { envios_facturacion: registro },
    $set: {
      ultimo_envio_facturacion: registro,
      ...camposResumenPorTipo(datos.tipo, registro),
      ...(datos.tipo === 'control_horas'
        ? buildCamposPersistenciaControlHoras(datos.controlHoras, datos.resumenControlHoras)
        : {}),
    },
  };

  let actualizado = await Complex.findByIdAndUpdate(casoId, update, { new: true });

  if (!actualizado) {
    actualizado = await Siniestro.findByIdAndUpdate(casoId, update, { new: true });
  }

  return { ok: Boolean(actualizado), registro, casoId: String(casoId) };
}

/**
 * Tras enviar el correo: guarda a qué jefe llegó (principal y copias).
 * Resuelve el caso por id o número de ajuste.
 */
export async function persistirEnvioFacturacionTrasCorreo({
  casoId,
  numeroCaso,
  tipo,
  gerente,
  usuario,
  nombreDestinatario,
  emailDestinatario,
  copias = [],
  controlHoras,
  resumenControlHoras,
}) {
  const idResuelto = await resolverCasoIdFacturacion({ casoId, numeroCaso });

  if (!idResuelto) {
    console.warn(
      '⚠️ [facturación] Correo enviado pero no se guardó destinatario: caso no encontrado',
      { casoId, numeroCaso }
    );
    return { ok: false, motivo: 'caso_no_encontrado', casoId: null };
  }

  const numero = numeroCaso || '';
  const registros = [];

  const principal = await registrarEnvioFacturacion(idResuelto, {
    tipo,
    gerente,
    usuario,
    numeroCaso: numero,
    nombreDestinatario,
    emailDestinatario,
    rolEnvio: 'principal',
    controlHoras,
    resumenControlHoras,
  });
  registros.push(principal);

  for (const copia of copias) {
    if (!copia?.gerente) continue;
    const regCopia = await registrarEnvioFacturacion(idResuelto, {
      tipo,
      gerente: copia.gerente,
      usuario,
      numeroCaso: numero,
      nombreDestinatario: copia.nombre,
      emailDestinatario: copia.email,
      rolEnvio: 'copia',
    });
    registros.push(regCopia);
  }

  const ok = registros.some((r) => r.ok);
  console.log('✅ [facturación] Envío registrado en bandeja:', {
    casoId: idResuelto,
    numeroCaso: numero,
    tipo,
    gerente: normalizarClaveGerente(gerente),
    copias: copias.length,
    ok,
  });

  return { ok, casoId: idResuelto, registros };
}

function filtrarEnvios(envios, { gerente, tipo, desde, hasta }) {
  const gerenteNorm = normalizarClaveGerente(gerente);
  if (!gerenteNorm) return [];

  const desdeMs = desde ? new Date(desde).getTime() : null;
  const hastaMs = hasta ? new Date(hasta).getTime() : null;

  return (Array.isArray(envios) ? envios : []).filter((e) => {
    if (!e || typeof e !== 'object') return false;
    if (normalizarClaveGerente(e.gerente) !== gerenteNorm) return false;
    if (tipo && tipo !== 'todos' && e.tipo !== tipo) return false;
    const t = e.fecha ? new Date(e.fecha).getTime() : NaN;
    if (desdeMs && (!Number.isFinite(t) || t < desdeMs)) return false;
    if (hastaMs && (!Number.isFinite(t) || t > hastaMs + 86400000)) return false;
    return true;
  });
}

function textoCoincide(caso, q, mapaAseg = {}) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return true;
  const campos = [
    caso.nmroAjste,
    caso.nmroSinstro,
    caso.asgrBenfcro,
    caso.codiAsgrdra,
    resolverNombreAseguradora(caso.codiAsgrdra, mapaAseg),
    caso.codiRespnsble,
    caso.descripcionEstado,
  ];
  return campos.some((c) => String(c || '').toLowerCase().includes(term));
}

function mapaResponsables(responsables) {
  const mapa = {};
  (responsables || []).forEach((r) => {
    if (!r.codiRespnsble) return;
    const codigo = String(r.codiRespnsble).trim().toUpperCase();
    mapa[codigo] = r.nmbrRespnsble;
  });
  return mapa;
}

function registrarClaveAseguradora(mapa, cod, nombre) {
  if (cod === undefined || cod === null) return;
  const clave = String(cod).trim();
  if (!clave) return;
  mapa[clave] = nombre;
  mapa[clave.toUpperCase()] = nombre;
  if (/^\d+$/.test(clave)) {
    const sinCeros = String(Number(clave));
    if (sinCeros && sinCeros !== clave) mapa[sinCeros] = nombre;
  }
}

function mapaAseguradoras(clientes) {
  const mapa = {};
  (clientes || []).forEach((c) => {
    const nombre = (c.rzonSocial || c.nombre || '').trim();
    if (!nombre) return;
    for (const cod of [c.codiAsgrdra, c.cod1Asgrdra]) {
      registrarClaveAseguradora(mapa, cod, nombre);
    }
    registrarClaveAseguradora(mapa, nombre, nombre);
  });
  return mapa;
}

function codigoAseguradoraCaso(doc) {
  return (
    doc?.codiAsgrdra ??
    doc?.codi_asgrdra ??
    doc?.cod1Asgrdra ??
    null
  );
}

function resolverNombreAseguradora(codiAsgrdra, mapaAseg) {
  const cod = String(codiAsgrdra || '').trim();
  if (!cod) return '—';
  const nombre =
    mapaAseg[cod] ||
    mapaAseg[cod.toUpperCase()] ||
    (/^\d+$/.test(cod) ? mapaAseg[String(Number(cod))] : null);
  if (nombre) return nombre;
  if (!/^\d+$/.test(cod)) return cod;
  return '—';
}

function mapaEstadosCatalogo(estados) {
  const porCodigo = {};
  const porNombre = {};
  (estados || []).forEach((e) => {
    const cod = e.codiEstdo ?? e.codiEstado;
    const desc = (e.descEstdo ?? e.descEstado ?? e.descripcion ?? '').trim();
    if (cod === undefined || cod === null || !desc) return;

    const claves = new Set([String(cod).trim()]);
    const num = Number(cod);
    if (!Number.isNaN(num)) {
      claves.add(String(num));
      claves.add(String(Math.floor(num)));
    }
    claves.forEach((k) => {
      if (k && k !== 'NaN') porCodigo[k] = desc;
    });
    porNombre[desc.toUpperCase()] = desc;
  });
  return { porCodigo, porNombre };
}

function esSoloCodigoNumerico(valor) {
  return /^\d+$/.test(String(valor || '').trim());
}

function buscarNombrePorCodigo(valor, porCodigo) {
  const clave = String(valor).trim();
  if (!clave) return null;
  return (
    porCodigo[clave] ??
    porCodigo[String(Number(clave))] ??
    porCodigo[String(Math.floor(Number(clave)))] ??
    null
  );
}

function resolverNombreEstado(caso, mapasEst) {
  const { porCodigo, porNombre } = mapasEst || { porCodigo: {}, porNombre: {} };

  const candidatos = [];
  for (const v of [
    caso.codiEstdo,
    caso.codi_estado,
    caso.estado,
    caso.codEstado,
    caso.descripcionEstado,
    caso.descripcion_estado,
  ]) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      candidatos.push(String(v).trim());
    }
  }

  const unicos = [...new Set(candidatos)];

  for (const valor of unicos) {
    if (esSoloCodigoNumerico(valor)) {
      const nombre = buscarNombrePorCodigo(valor, porCodigo);
      if (nombre) return nombre;
    }
  }

  for (const valor of unicos) {
    if (esSoloCodigoNumerico(valor)) continue;
    const upper = valor.toUpperCase();
    if (porNombre[upper]) return porNombre[upper];
    if (valor.length > 1) return valor;
  }

  for (const valor of unicos) {
    if (esSoloCodigoNumerico(valor)) return valor;
  }

  return '—';
}

function normalizarCasoLean(doc) {
  if (!doc) return null;
  const codiEstdo =
    doc.codiEstdo ?? doc.codi_estado ?? doc.estado ?? doc.codEstado ?? null;
  const descripcionEstado =
    doc.descripcionEstado ?? doc.descripcion_estado ?? null;

  return {
    _id: doc._id,
    nmroAjste: doc.nmroAjste,
    nmroSinstro: doc.nmroSinstro,
    codiAsgrdra: codigoAseguradoraCaso(doc),
    asgrBenfcro: doc.asgrBenfcro,
    codiRespnsble: doc.codiRespnsble,
    codiEstdo,
    codi_estado: doc.codi_estado,
    estado: doc.estado,
    codEstado: doc.codEstado,
    descripcionEstado,
    descripcion_estado: doc.descripcion_estado,
    envios_facturacion: Array.isArray(doc.envios_facturacion) ? doc.envios_facturacion : [],
    fcha_envio_control_horas: doc.fcha_envio_control_horas,
    fcha_recibido_control_horas: doc.fcha_recibido_control_horas,
    control_horas: doc.control_horas,
  };
}

/** Lista filas de bandeja: un registro por cada envío que coincide con el gerente. */
export async function listarBandejaFacturacion({
  gerente,
  tipo = 'todos',
  desde,
  hasta,
  q,
  responsables = [],
  estados = [],
  aseguradoras = [],
}) {
  const gerenteNorm = normalizarClaveGerente(gerente);
  if (!gerenteNorm) {
    return { items: [], total: 0 };
  }

  const mapaResp = mapaResponsables(responsables);
  const mapaEst = mapaEstadosCatalogo(estados);
  const mapaAseg = mapaAseguradoras(aseguradoras);
  const filtro = { 'envios_facturacion.gerente': gerenteNorm };
  const proyeccion = {
    nmroAjste: 1,
    nmroSinstro: 1,
    codiAsgrdra: 1,
    asgrBenfcro: 1,
    codiRespnsble: 1,
    codiEstdo: 1,
    codi_estado: 1,
    estado: 1,
    codEstado: 1,
    descripcionEstado: 1,
    descripcion_estado: 1,
    envios_facturacion: 1,
    fcha_envio_control_horas: 1,
    fcha_recibido_control_horas: 1,
    control_horas: 1,
  };

  let docs = [];
  try {
    docs = await Complex.collection
      .find(filtro)
      .project(proyeccion)
      .sort({ 'ultimo_envio_facturacion.fecha': -1 })
      .limit(MAX_CASOS_BANDEJA)
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .toArray();
  } catch (error) {
    console.error('❌ [bandeja] Error en consulta nativa, reintento con mongoose:', error.message);
    docs = await Complex.find(filtro)
      .select(Object.keys(proyeccion).join(' '))
      .sort({ 'ultimo_envio_facturacion.fecha': -1 })
      .limit(MAX_CASOS_BANDEJA)
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .lean();
  }

  const filas = [];

  for (const raw of docs) {
    const caso = normalizarCasoLean(raw);
    if (!caso) continue;

    const enviosArr = Array.isArray(caso.envios_facturacion) ? caso.envios_facturacion : [];

    enviosArr.forEach((envio, envioIndice) => {
      if (!envio || typeof envio !== 'object') return;
      const coincideGerente =
        normalizarClaveGerente(envio.gerente) === gerenteNorm;
      if (!coincideGerente) return;

      const enviosFiltrados = filtrarEnvios([envio], {
        gerente: gerenteNorm,
        tipo,
        desde,
        hasta,
      });
      if (!enviosFiltrados.length) return;
      if (!textoCoincide(caso, q, mapaAseg)) return;

      const codResp = String(caso.codiRespnsble || '').trim().toUpperCase();
      const nombreAseguradora = resolverNombreAseguradora(caso.codiAsgrdra, mapaAseg);
      filas.push({
        casoId: String(caso._id),
        envioId: envio.id || null,
        envioIndice,
        nmroAjste: caso.nmroAjste,
        nmroSinstro: caso.nmroSinstro,
        codiAsgrdra: caso.codiAsgrdra,
        nombreAseguradora,
        asgrBenfcro: caso.asgrBenfcro,
        codiRespnsble: caso.codiRespnsble,
        nombreResponsable: mapaResp[codResp] || caso.codiRespnsble,
        codiEstdo: caso.codiEstdo,
        nombreEstado: resolverNombreEstado(caso, mapaEst),
        descripcionEstado: resolverNombreEstado(caso, mapaEst),
        tipoEnvio: envio.tipo,
        gerente: envio.gerente,
        nombreGerente: nombreGerente(envio.gerente),
        fechaEnvio: envio.fecha,
        enviadoPor: envio.usuario,
        emailDestinatario: envio.emailDestinatario,
        nombreDestinatario: envio.nombreDestinatario,
        rolEnvio: envio.rolEnvio || 'principal',
        fchaEnvioControlHoras: caso.fcha_envio_control_horas,
        fchaRecibidoControlHoras: caso.fcha_recibido_control_horas,
        tieneControlHoras: controlHorasTieneDatos(resolverControlHorasDesdeEnvios(caso)),
      });
    });
  }

  filas.sort((a, b) => new Date(b.fechaEnvio) - new Date(a.fechaEnvio));

  return { items: filas, total: filas.length, gerente: gerenteNorm };
}

function esObjectIdValido(id) {
  const s = String(id || '').trim();
  return /^[a-fA-F0-9]{24}$/.test(s);
}

async function cargarCasoConEnvios(casoId) {
  const id = String(casoId || '').trim();
  if (!esObjectIdValido(id)) return null;
  let doc = await Complex.findById(id).lean();
  if (!doc) doc = await Siniestro.findById(id).lean();
  return doc;
}

async function guardarEnviosFacturacion(casoId, envios, resumenes) {
  const payload = {
    envios_facturacion: envios,
    ...resumenes,
  };
  let actualizado = await Complex.findByIdAndUpdate(casoId, { $set: payload }, { new: true });
  if (!actualizado) {
    actualizado = await Siniestro.findByIdAndUpdate(casoId, { $set: payload }, { new: true });
  }
  return Boolean(actualizado);
}

function asegurarIdsEnEnvios(envios) {
  return (Array.isArray(envios) ? envios : []).map((e) => {
    if (!e || typeof e !== 'object') return e;
    return e.id ? e : { ...e, id: crypto.randomUUID() };
  });
}

function ubicarIndiceEnvio(envios, selector = {}) {
  const lista = Array.isArray(envios) ? envios : [];
  const { envioId, envioIndice } = selector;

  if (envioId) {
    const idx = lista.findIndex((e) => e?.id === envioId);
    if (idx >= 0) return idx;
  }

  if (envioIndice !== undefined && envioIndice !== null) {
    const idx = Number(envioIndice);
    if (Number.isInteger(idx) && idx >= 0 && idx < lista.length) return idx;
  }

  const fechaMs = selector.fechaEnvio ? new Date(selector.fechaEnvio).getTime() : NaN;
  const gerente = normalizarClaveGerente(selector.gerente);
  const tipo = selector.tipoEnvio;
  const usuario = selector.enviadoPor ? String(selector.enviadoPor).trim() : '';

  return lista.findIndex((e) => {
    if (!e) return false;
    if (gerente && normalizarClaveGerente(e.gerente) !== gerente) return false;
    if (tipo && e.tipo !== tipo) return false;
    if (usuario && String(e.usuario || '').trim() !== usuario) return false;
    if (Number.isFinite(fechaMs)) {
      const t = e.fecha ? new Date(e.fecha).getTime() : NaN;
      if (!Number.isFinite(t) || Math.abs(t - fechaMs) > 2000) return false;
    }
    return true;
  });
}

function recalcularResumenesEnvios(envios) {
  const lista = Array.isArray(envios) ? envios : [];
  const ultimo = lista.reduce((acc, e) => {
    if (!e?.fecha) return acc;
    if (!acc?.fecha) return e;
    return new Date(e.fecha) > new Date(acc.fecha) ? e : acc;
  }, null);

  const resumenes = { ultimo_envio_facturacion: ultimo || null };

  const ultimoControl = lista
    .filter((e) => e?.tipo === 'control_horas')
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
  const ultimoGerencia = lista
    .filter((e) => e?.tipo === 'gerencia')
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];

  if (ultimoControl) {
    Object.assign(resumenes, camposResumenPorTipo('control_horas', ultimoControl));
  } else {
    resumenes.gerente_ultimo_envio_control_horas = null;
    resumenes.fcha_ultima_notificacion_control_horas = null;
    resumenes.ultimo_envio_control_horas = null;
  }

  if (ultimoGerencia) {
    Object.assign(resumenes, camposResumenPorTipo('gerencia', ultimoGerencia));
  } else {
    resumenes.gerente_ultimo_envio_gerencia = null;
    resumenes.fcha_ultima_notificacion_gerencia = null;
    resumenes.ultimo_envio_gerencia = null;
  }

  return resumenes;
}

/**
 * Corrige el jefe destinatario de un envío ya registrado (sin duplicar ni borrar el caso).
 */
export async function corregirDestinatarioEnvioFacturacion({
  casoId,
  selector,
  nuevoGerente,
  corregidoPor,
}) {
  const gerenteNuevo = normalizarClaveGerente(nuevoGerente);
  if (!casoId || !gerenteNuevo) {
    return { ok: false, motivo: 'datos_invalidos' };
  }

  const doc = await cargarCasoConEnvios(casoId);
  if (!doc) return { ok: false, motivo: 'caso_no_encontrado' };

  let envios = asegurarIdsEnEnvios(doc.envios_facturacion);
  const idx = ubicarIndiceEnvio(envios, selector);
  if (idx < 0) return { ok: false, motivo: 'envio_no_encontrado' };

  const anterior = envios[idx];
  const gerenteAnterior = normalizarClaveGerente(anterior.gerente);

  if (gerenteAnterior === gerenteNuevo) {
    return { ok: true, motivo: 'sin_cambios', casoId: String(casoId), envio: anterior };
  }

  envios = [...envios];
  envios[idx] = {
    ...anterior,
    gerente: gerenteNuevo,
    nombreDestinatario: nombreGerente(gerenteNuevo),
    emailDestinatario: emailGerente(gerenteNuevo) || anterior.emailDestinatario,
    corregido_por: String(corregidoPor || '').trim(),
    corregido_en: new Date(),
    gerente_anterior: gerenteAnterior,
  };

  const resumenes = recalcularResumenesEnvios(envios);
  const guardado = await guardarEnviosFacturacion(casoId, envios, resumenes);

  return {
    ok: guardado,
    casoId: String(casoId),
    envio: envios[idx],
    gerenteAnterior,
    gerenteNuevo,
  };
}

/**
 * Elimina un registro de envío del historial del caso (no elimina el caso Complex).
 */
export async function eliminarRegistroEnvioFacturacion({ casoId, selector, eliminadoPor }) {
  if (!casoId) return { ok: false, motivo: 'datos_invalidos' };

  const doc = await cargarCasoConEnvios(casoId);
  if (!doc) return { ok: false, motivo: 'caso_no_encontrado' };

  let envios = asegurarIdsEnEnvios(doc.envios_facturacion);
  const idx = ubicarIndiceEnvio(envios, selector);
  if (idx < 0) return { ok: false, motivo: 'envio_no_encontrado' };

  const eliminado = envios[idx];
  envios = envios.filter((_, i) => i !== idx);

  const resumenes = recalcularResumenesEnvios(envios);
  const guardado = await guardarEnviosFacturacion(casoId, envios, resumenes);

  console.log('🗑️ [facturación] Registro de envío eliminado:', {
    casoId,
    eliminadoPor,
    gerente: eliminado?.gerente,
    tipo: eliminado?.tipo,
  });

  return { ok: guardado, casoId: String(casoId), eliminado };
}
