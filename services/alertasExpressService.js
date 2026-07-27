import mongoose from 'mongoose';
import SiniestroExpress from '../models/SiniestroExpress.js';
import EstadoExpress from '../models/EstadoExpress.js';
import Responsable from '../models/Responsable.js';
import {
  CODIGOS_ESTADO_EXPRESS_SIN_ALERTAS,
  obtenerProtocoloExpressPorDefecto,
} from '../config/protocoloExpressDefaults.js';
import { evaluarProtocoloCaso } from './protocoloSiniestrosUtils.js';
import { DIAS_ENTRE_RECORDATORIOS_EMAIL } from './alertasService.js';
import { enviarEmailAlertas } from './emailService.js';
import {
  getResponsableResolverIndex,
  resolverResponsableConIndice,
} from './responsableResolverService.js';

const FECHA_LIMITE_ALERTAS_EXPRESS = new Date('2026-07-01T00:00:00.000Z');

async function cargarMapaEstadosExpress() {
  const estados = await EstadoExpress.find()
    .select('codiEstdo codiEstado descEstdo descEstado')
    .lean();
  const mapa = {};
  for (const e of estados) {
    const cod = e.codiEstdo ?? e.codiEstado;
    const desc = String(e.descEstdo ?? e.descEstado ?? '').trim();
    if (cod == null || cod === '' || !desc) continue;
    mapa[String(cod).trim()] = desc;
  }
  return mapa;
}

function resolverEstadoExpress(caso, mapaEstados = {}) {
  const codigo = String(caso?.estadoProceso ?? '').trim();
  if (!codigo) return { estadoCodigo: null, estado: 'N/A' };
  const nombre = mapaEstados[codigo] || mapaEstados[String(Number(codigo))] || codigo;
  return { estadoCodigo: codigo, estado: nombre };
}

export function casoExpressExcluidoDeAlertas(caso) {
  if (caso?.fechaCierre) return true;
  const codigo = String(caso?.estadoProceso ?? '').trim();
  if (CODIGOS_ESTADO_EXPRESS_SIN_ALERTAS.map(String).includes(codigo)) return true;

  const desc = String(caso?.descEstdo || caso?.descripcionEstado || '')
    .trim()
    .toUpperCase();
  if (!desc) return false;
  return desc.includes('DESISTIDO') || desc.includes('TRAMITADO A COMPLEX');
}

function casoDentroDeVentanaAlertas(caso) {
  const fecha =
    caso?.createdAt ||
    caso?.avisoSiniestro ||
    caso?.avisoSiniestroCompania ||
    caso?.fechaSiniestro;
  if (!fecha) return true;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return true;
  return d >= FECHA_LIMITE_ALERTAS_EXPRESS;
}

function mapearAlertaExpress(alerta, caso, mapaEstados = {}) {
  const { estadoCodigo, estado } = resolverEstadoExpress(caso, mapaEstados);
  return {
    ...alerta,
    casoId: caso?._id,
    consecutivo: caso?.consecutivo,
    numeroSiniestro: caso?.numeroSiniestro,
    aseguradora: caso?.aseguradora,
    asegurado: caso?.aseguradoBeneficiario,
    responsable: caso?.responsable,
    estadoCodigo,
    estado,
    avisoSiniestro: caso?.avisoSiniestro,
    modulo: 'express',
  };
}

export function generarAlertasCasoExpress(caso, protocolo = null, mapaEstados = {}) {
  if (!caso || casoExpressExcluidoDeAlertas(caso) || !casoDentroDeVentanaAlertas(caso)) {
    return [];
  }
  const proto = protocolo || obtenerProtocoloExpressPorDefecto();
  const alertas = evaluarProtocoloCaso(caso, proto, new Date(), 'todos');
  return alertas.map((a) => mapearAlertaExpress(a, caso, mapaEstados));
}

const PROTOCOLO_EXPRESS_META = {
  version: obtenerProtocoloExpressPorDefecto().version,
  documento: obtenerProtocoloExpressPorDefecto().documento,
};

export async function obtenerAlertasCasoExpress(idOConsecutivo) {
  const mapaEstados = await cargarMapaEstadosExpress();
  const or = [{ consecutivo: idOConsecutivo }, { numeroSiniestro: idOConsecutivo }];
  if (mongoose.Types.ObjectId.isValid(idOConsecutivo)) {
    or.unshift({ _id: idOConsecutivo });
  }
  const caso = await SiniestroExpress.findOne({ $or: or }).lean();

  if (!caso) {
    return { success: false, error: 'Caso Express no encontrado', totalAlertas: 0, alertas: [] };
  }

  const alertas = generarAlertasCasoExpress(caso, null, mapaEstados);
  const { estadoCodigo, estado } = resolverEstadoExpress(caso, mapaEstados);

  return {
    success: true,
    casoId: caso._id,
    consecutivo: caso.consecutivo,
    numeroSiniestro: caso.numeroSiniestro,
    responsable: caso.responsable,
    estadoCodigo,
    estado,
    totalAlertas: alertas.length,
    alertas,
    protocolo: {
      version: PROTOCOLO_EXPRESS_META.version,
      documento: PROTOCOLO_EXPRESS_META.documento,
    },
  };
}

export async function obtenerTodasAlertasExpress() {
  const mapaEstados = await cargarMapaEstadosExpress();
  const protocolo = obtenerProtocoloExpressPorDefecto();

  const casos = await SiniestroExpress.find({
    estadoProceso: { $nin: CODIGOS_ESTADO_EXPRESS_SIN_ALERTAS },
    $or: [{ fechaCierre: null }, { fechaCierre: { $exists: false } }],
  })
    .lean()
    .exec();

  const porCaso = [];
  let totalAlertas = 0;
  let alta = 0;
  let media = 0;

  for (const caso of casos) {
    if (!casoDentroDeVentanaAlertas(caso)) continue;
    const alertas = generarAlertasCasoExpress(caso, protocolo, mapaEstados);
    if (!alertas.length) continue;
    totalAlertas += alertas.length;
    for (const a of alertas) {
      if (a.prioridad === 'ALTA') alta += 1;
      else media += 1;
    }
    const { estadoCodigo, estado } = resolverEstadoExpress(caso, mapaEstados);
    porCaso.push({
      casoId: caso._id,
      consecutivo: caso.consecutivo,
      numeroSiniestro: caso.numeroSiniestro,
      aseguradora: caso.aseguradora,
      asegurado: caso.aseguradoBeneficiario,
      responsable: caso.responsable,
      estadoCodigo,
      estado,
      totalAlertas: alertas.length,
      alertas,
    });
  }

  porCaso.sort((a, b) => b.totalAlertas - a.totalAlertas);

  return {
    success: true,
    totalCasosConAlertas: porCaso.length,
    resumen: {
      totalAlertas,
      prioridadAlta: alta,
      prioridadMedia: media,
      casosEvaluados: casos.length,
    },
    casos: porCaso,
    protocolo: PROTOCOLO_EXPRESS_META,
  };
}

export async function obtenerResumenAlertasExpress() {
  const data = await obtenerTodasAlertasExpress();
  return {
    success: true,
    ...data.resumen,
    totalCasosConAlertas: data.totalCasosConAlertas,
    protocolo: data.protocolo,
  };
}

export function obtenerProtocoloExpress() {
  return obtenerProtocoloExpressPorDefecto();
}

function diasCalendarioEntreFechas(desde, hasta = new Date()) {
  if (!desde) return null;
  const a = new Date(desde);
  const b = new Date(hasta);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function debeEnviarRecordatorioEmailExpress(responsable, ahora = new Date()) {
  const ultima = responsable?.fchaUltimoRecordatorioAlertasExpress;
  if (!ultima) return true;
  const dias = diasCalendarioEntreFechas(ultima, ahora);
  if (dias == null) return true;
  return dias >= DIAS_ENTRE_RECORDATORIOS_EMAIL;
}

function casoExpressAFormatoEmail(caso) {
  return {
    numeroAjuste: caso.consecutivo || caso.numeroSiniestro || String(caso.casoId || ''),
    consecutivo: caso.consecutivo,
    numeroSiniestro: caso.numeroSiniestro,
    aseguradora: caso.aseguradora,
    asegurado: caso.asegurado,
    estado: caso.estado,
    totalAlertas: caso.totalAlertas,
    documentosFaltantes: [],
    alertas: caso.alertas || [],
    inactividad: null,
  };
}

export async function obtenerAlertasExpressPorResponsables() {
  const todas = await obtenerTodasAlertasExpress();
  const index = await getResponsableResolverIndex();
  const porCodigo = new Map();

  for (const caso of todas.casos || []) {
    const codigo =
      resolverResponsableConIndice(caso.responsable, index) ||
      String(caso.responsable || '').trim() ||
      'SIN_RESPONSABLE';

    if (!porCodigo.has(codigo)) {
      porCodigo.set(codigo, {
        codigoResponsable: codigo,
        responsableRaw: caso.responsable,
        casos: [],
        totalAlertas: 0,
        casosCriticos: 0,
      });
    }
    const bucket = porCodigo.get(codigo);
    bucket.casos.push(casoExpressAFormatoEmail(caso));
    bucket.totalAlertas += caso.totalAlertas || 0;
    bucket.casosCriticos += (caso.alertas || []).filter((a) => a.prioridad === 'ALTA').length;
  }

  const responsables = [...porCodigo.values()].filter(
    (r) => r.codigoResponsable && r.codigoResponsable !== 'SIN_RESPONSABLE'
  );

  return {
    success: true,
    responsablesConAlertas: responsables.length,
    resumenGeneral: {
      totalAlertas: todas.resumen?.totalAlertas || 0,
      totalCasosConAlertas: todas.totalCasosConAlertas || 0,
    },
    responsables,
  };
}

export async function obtenerAlertasResponsableExpress(codigoResponsable) {
  const agrupadas = await obtenerAlertasExpressPorResponsables();
  const codigo = String(codigoResponsable || '').trim();
  const found = agrupadas.responsables.find((r) => String(r.codigoResponsable) === codigo);

  if (!found) {
    return {
      codigoResponsable: codigo,
      totalCasos: 0,
      casosConAlertas: 0,
      resumen: { documentosObligatorios: 0, casosCriticos: 0 },
      casos: [],
    };
  }

  return {
    codigoResponsable: codigo,
    totalCasos: found.casos.length,
    casosConAlertas: found.casos.length,
    resumen: {
      documentosObligatorios: found.totalAlertas,
      casosCriticos: found.casosCriticos,
    },
    casos: found.casos,
  };
}

export async function enviarAlertasEmailExpress(codigoResponsable, opciones = {}) {
  const forzar = opciones.forzar === true;
  const codigo = String(codigoResponsable || '').trim();
  console.log('📧 Enviando alertas ANS Express a:', codigo, forzar ? '(forzado)' : '');

  const alertas = await obtenerAlertasResponsableExpress(codigo);
  if (!alertas.casosConAlertas) {
    return { success: true, message: 'No hay alertas Express para enviar', omitido: false };
  }

  const responsable = await Responsable.findOne({ codiRespnsble: codigo });
  if (!responsable?.email) {
    return { success: false, message: 'Email del responsable no encontrado', omitido: false };
  }

  if (!forzar && !debeEnviarRecordatorioEmailExpress(responsable)) {
    const diasDesde = diasCalendarioEntreFechas(responsable.fchaUltimoRecordatorioAlertasExpress);
    return {
      success: true,
      omitido: true,
      message: `Recordatorio Express omitido: se reenvía cada ${DIAS_ENTRE_RECORDATORIOS_EMAIL} días`,
      diasDesdeUltimo: diasDesde,
    };
  }

  const datosEmail = {
    modulo: 'express',
    numeroCaso: `ALERTAS-EXPRESS-${codigo}`,
    nombreResponsable: responsable.nmbrRespnsble || codigo,
    emailResponsable: responsable.email,
    aseguradora: 'ANS Express',
    asegurado: 'Responsable Express',
    fechaAsignacion: new Date().toLocaleDateString('es-CO'),
    quienAsigna: 'Sistema ANS Express',
    emailQuienAsigna: 'sistema@proserpuertos.com.co',
    observaciones: `Tienes ${alertas.casosConAlertas} casos Express con alertas ANS pendientes`,
    alertas,
  };

  const resultado = await enviarEmailAlertas(datosEmail);

  if (resultado?.success !== false) {
    await Responsable.updateOne(
      { _id: responsable._id },
      { $set: { fchaUltimoRecordatorioAlertasExpress: new Date() } }
    );
  }

  return { success: true, omitido: false, resultado };
}

export async function enviarAlertasTodosExpress(opciones = {}) {
  console.log('📧 Enviando alertas ANS Express a todos los responsables...');
  const agrupadas = await obtenerAlertasExpressPorResponsables();
  const resultados = [];

  for (const item of agrupadas.responsables) {
    try {
      const resultado = await enviarAlertasEmailExpress(item.codigoResponsable, opciones);
      resultados.push({
        ajustador: item.codigoResponsable,
        success: resultado.success,
        omitido: Boolean(resultado.omitido),
        message: resultado.message,
      });
    } catch (error) {
      console.error(`❌ Error enviando alertas Express a ${item.codigoResponsable}:`, error);
      resultados.push({
        ajustador: item.codigoResponsable,
        success: false,
        omitido: false,
        message: error.message,
      });
    }
  }

  return {
    success: true,
    modulo: 'express',
    totalEnviados: resultados.filter((r) => r.success && !r.omitido).length,
    totalOmitidos: resultados.filter((r) => r.omitido).length,
    totalErrores: resultados.filter((r) => !r.success).length,
    responsablesConAlertas: agrupadas.responsablesConAlertas,
    resultados,
  };
}
