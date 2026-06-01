import mongoose from 'mongoose';
import Complex from '../models/Complex.js';
import Siniestro from '../models/CasoComplex.js';
import { normalizarClaveGerente, nombreGerente } from '../config/gerentesFacturacion.js';

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
}) {
  const gerenteNorm = normalizarClaveGerente(gerente);
  if (!gerenteNorm || !TIPOS_ENVIO.has(tipo)) {
    return null;
  }
  return {
    tipo,
    gerente: gerenteNorm,
    usuario: String(usuario || 'desconocido').trim(),
    fecha: new Date(),
    numeroCaso: numeroCaso ? String(numeroCaso).trim() : '',
    nombreDestinatario: nombreDestinatario || nombreGerente(gerenteNorm),
    emailDestinatario: emailDestinatario ? String(emailDestinatario).trim() : '',
    rolEnvio: rolEnvio === 'copia' ? 'copia' : 'principal',
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

function textoCoincide(caso, q) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return true;
  const campos = [
    caso.nmroAjste,
    caso.nmroSinstro,
    caso.asgrBenfcro,
    caso.codiAsgrdra,
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

function normalizarCasoLean(doc) {
  if (!doc) return null;
  return {
    _id: doc._id,
    nmroAjste: doc.nmroAjste,
    nmroSinstro: doc.nmroSinstro,
    codiAsgrdra: doc.codiAsgrdra,
    asgrBenfcro: doc.asgrBenfcro,
    codiRespnsble: doc.codiRespnsble,
    codiEstdo: doc.codiEstdo,
    descripcionEstado: doc.descripcionEstado,
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
}) {
  const gerenteNorm = normalizarClaveGerente(gerente);
  if (!gerenteNorm) {
    return { items: [], total: 0 };
  }

  const mapaResp = mapaResponsables(responsables);
  const filtro = { 'envios_facturacion.gerente': gerenteNorm };
  const proyeccion = {
    nmroAjste: 1,
    nmroSinstro: 1,
    codiAsgrdra: 1,
    asgrBenfcro: 1,
    codiRespnsble: 1,
    codiEstdo: 1,
    descripcionEstado: 1,
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

    const envios = filtrarEnvios(caso.envios_facturacion, {
      gerente: gerenteNorm,
      tipo,
      desde,
      hasta,
    });

    for (const envio of envios) {
      if (!textoCoincide(caso, q)) continue;
      const codResp = String(caso.codiRespnsble || '').trim().toUpperCase();
      filas.push({
        casoId: String(caso._id),
        nmroAjste: caso.nmroAjste,
        nmroSinstro: caso.nmroSinstro,
        codiAsgrdra: caso.codiAsgrdra,
        asgrBenfcro: caso.asgrBenfcro,
        codiRespnsble: caso.codiRespnsble,
        nombreResponsable: mapaResp[codResp] || caso.codiRespnsble,
        codiEstdo: caso.codiEstdo,
        descripcionEstado: caso.descripcionEstado,
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
        tieneControlHoras: Boolean(caso.control_horas?.filas?.length),
      });
    }
  }

  filas.sort((a, b) => new Date(b.fechaEnvio) - new Date(a.fechaEnvio));

  return { items: filas, total: filas.length, gerente: gerenteNorm };
}
