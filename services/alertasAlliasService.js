import AlliasCaso from '../models/AlliasCaso.js';
import Responsable from '../models/Responsable.js';
import { DIAS_ENTRE_RECORDATORIOS_EMAIL } from './alertasService.js';
import { enviarEmailAlertasAllias } from './emailService.js';
import { withRecipientLocale } from '../utils/resolveUserLocale.js';
import {
  getResponsableResolverIndex,
  resolverResponsableConIndice,
} from './responsableResolverService.js';

export const DIAS_RECORDATORIO_INACTIVIDAD_ALLIAS = 30;

/** Estados que cierran el caso para alertas (sin recordatorio). */
const ESTADOS_CERRADOS_ALLIAS = ['CERRADO'];

function normalizarEstadoAllias(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function esEstadoAlliasCerrado(valorEstado) {
  const estado = normalizarEstadoAllias(valorEstado);
  return ESTADOS_CERRADOS_ALLIAS.includes(estado);
}

function parseFechaAllias(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diasCalendarioEntreFechas(desde, hasta = new Date()) {
  if (!desde) return null;
  const a = new Date(desde);
  const b = new Date(hasta);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Base de inactividad: fechaUltimoDocumento → updatedAt → createdAt. */
export function fechaBaseInactividadAllias(caso) {
  return (
    parseFechaAllias(caso?.fechaUltimoDocumento) ||
    parseFechaAllias(caso?.updatedAt) ||
    parseFechaAllias(caso?.createdAt)
  );
}

export function evaluarAlertaInactividadAllias(caso, ahora = new Date()) {
  if (!caso || esEstadoAlliasCerrado(caso.estado)) return null;

  const base = fechaBaseInactividadAllias(caso);
  if (!base) return null;

  const dias = diasCalendarioEntreFechas(base, ahora);
  if (dias == null || dias < DIAS_RECORDATORIO_INACTIVIDAD_ALLIAS) return null;

  const retraso = dias - DIAS_RECORDATORIO_INACTIVIDAD_ALLIAS;
  const origen = parseFechaAllias(caso.fechaUltimoDocumento)
    ? 'último documento'
    : 'última actualización del caso';

  return {
    etapaId: 'recordatorioInactividadAllias',
    nombre: 'Recordatorio inactividad / documentos',
    fase: 0,
    prioridad: dias >= DIAS_RECORDATORIO_INACTIVIDAD_ALLIAS * 2 ? 'ALTA' : 'MEDIA',
    mensaje: `Han pasado ${dias} días desde el ${origen} sin movimiento. Revisar documentación y estado del caso.`,
    transcurrido: dias,
    limite: DIAS_RECORDATORIO_INACTIVIDAD_ALLIAS,
    retraso: Math.max(0, retraso),
    horasLimite: DIAS_RECORDATORIO_INACTIVIDAD_ALLIAS * 24,
    horasTranscurridas: dias * 24,
    etiquetaLimite: `${DIAS_RECORDATORIO_INACTIVIDAD_ALLIAS} días calendario`,
    tipo: 'RECORDATORIO_INACTIVIDAD_Allias',
    accion: 'Revisar el caso, subir documentos pendientes y actualizar el estado',
  };
}

function mapearArchivosCasoAllias(caso) {
  return (caso?.archivos || [])
    .filter((a) => a?.ruta)
    .map((a) => ({
      nombre: a.nombreOriginal || a.nombreArchivo || 'documento',
      ruta: a.ruta,
      tamaño: a.tamaño || 0,
      tipoMime: a.tipoMime,
      casoId: caso._id,
      consecutivo: caso.consecutivo,
    }));
}

export function generarAlertasCasoAllias(caso, ahora = new Date()) {
  if (!caso || esEstadoAlliasCerrado(caso.estado)) return [];
  const alerta = evaluarAlertaInactividadAllias(caso, ahora);
  if (!alerta) return [];
  return [
    {
      ...alerta,
      casoId: caso._id,
      consecutivo: caso.consecutivo,
      numeroSiniestro: caso.siniestro,
      aseguradora: 'Allias',
      asegurado: caso.tomador,
      responsable: caso.ajustador,
      estado: caso.estado,
      modulo: 'Allias',
    },
  ];
}

function casoAlliasAFormatoEmail(caso) {
  return {
    numeroAjuste: caso.consecutivo || caso.numeroSiniestro || String(caso.casoId || ''),
    consecutivo: caso.consecutivo,
    numeroSiniestro: caso.numeroSiniestro || caso.siniestro,
    aseguradora: caso.aseguradora || 'Allias',
    asegurado: caso.asegurado || caso.tomador,
    estado: caso.estado,
    totalAlertas: caso.totalAlertas,
    documentosFaltantes: [],
    alertas: caso.alertas || [],
    inactividad: caso.inactividad || null,
    archivos: caso.archivos || [],
    casoId: caso.casoId || caso._id,
  };
}

export async function obtenerTodasAlertasAllias() {
  const casos = await AlliasCaso.find({
    estado: { $nin: ESTADOS_CERRADOS_ALLIAS },
  })
    .lean()
    .exec();

  const porCaso = [];
  let totalAlertas = 0;
  let alta = 0;
  let media = 0;
  const ahora = new Date();

  for (const caso of casos) {
    const alertas = generarAlertasCasoAllias(caso, ahora);
    if (!alertas.length) continue;
    totalAlertas += alertas.length;
    for (const a of alertas) {
      if (a.prioridad === 'ALTA') alta += 1;
      else media += 1;
    }

    const base = fechaBaseInactividadAllias(caso);
    const dias = base ? diasCalendarioEntreFechas(base, ahora) : null;

    porCaso.push({
      casoId: caso._id,
      consecutivo: caso.consecutivo,
      numeroSiniestro: caso.siniestro,
      siniestro: caso.siniestro,
      aseguradora: 'Allias',
      asegurado: caso.tomador,
      tomador: caso.tomador,
      responsable: caso.ajustador,
      ajustador: caso.ajustador,
      estado: caso.estado,
      totalAlertas: alertas.length,
      alertas,
      archivos: mapearArchivosCasoAllias(caso),
      inactividad:
        dias != null
          ? {
              actividad: parseFechaAllias(caso.fechaUltimoDocumento)
                ? 'Último documento'
                : 'Última actualización',
              dias,
              estado: dias >= DIAS_RECORDATORIO_INACTIVIDAD_ALLIAS * 2 ? 'CRÍTICO' : 'ALTO',
            }
          : null,
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
  };
}

export async function obtenerAlertasAlliasPorAjustadores() {
  const todas = await obtenerTodasAlertasAllias();
  const index = await getResponsableResolverIndex();
  const porCodigo = new Map();

  for (const caso of todas.casos || []) {
    const codigo =
      resolverResponsableConIndice(caso.ajustador || caso.responsable, index) ||
      String(caso.ajustador || caso.responsable || '').trim() ||
      'SIN_RESPONSABLE';

    if (!porCodigo.has(codigo)) {
      porCodigo.set(codigo, {
        codigoResponsable: codigo,
        codigoAjustador: codigo,
        responsableRaw: caso.ajustador || caso.responsable,
        casos: [],
        totalAlertas: 0,
        casosCriticos: 0,
        archivosConRuta: [],
      });
    }
    const bucket = porCodigo.get(codigo);
    bucket.casos.push(casoAlliasAFormatoEmail(caso));
    bucket.totalAlertas += caso.totalAlertas || 0;
    bucket.casosCriticos += (caso.alertas || []).filter((a) => a.prioridad === 'ALTA').length;
    for (const archivo of caso.archivos || []) {
      bucket.archivosConRuta.push(archivo);
    }
  }

  const ajustadores = [...porCodigo.values()].filter(
    (r) => r.codigoResponsable && r.codigoResponsable !== 'SIN_RESPONSABLE'
  );

  return {
    success: true,
    ajustadoresConAlertas: ajustadores.length,
    responsablesConAlertas: ajustadores.length,
    resumenGeneral: {
      totalAlertas: todas.resumen?.totalAlertas || 0,
      totalCasosConAlertas: todas.totalCasosConAlertas || 0,
    },
    ajustadores,
    responsables: ajustadores,
  };
}

export async function obtenerAlertasAjustadorAllias(codigoAjustador) {
  const agrupadas = await obtenerAlertasAlliasPorAjustadores();
  const codigo = String(codigoAjustador || '').trim();
  const found = agrupadas.ajustadores.find(
    (r) => String(r.codigoResponsable) === codigo || String(r.codigoAjustador) === codigo
  );

  if (!found) {
    return {
      codigoResponsable: codigo,
      codigoAjustador: codigo,
      totalCasos: 0,
      casosConAlertas: 0,
      resumen: { documentosObligatorios: 0, casosCriticos: 0 },
      casos: [],
      archivosConRuta: [],
    };
  }

  return {
    codigoResponsable: codigo,
    codigoAjustador: codigo,
    totalCasos: found.casos.length,
    casosConAlertas: found.casos.length,
    resumen: {
      documentosObligatorios: found.totalAlertas,
      casosCriticos: found.casosCriticos,
    },
    casos: found.casos,
    archivosConRuta: found.archivosConRuta || [],
  };
}

export function debeEnviarRecordatorioEmailAllias(responsable, ahora = new Date()) {
  const ultima = responsable?.fchaUltimoRecordatorioAlertasAllias;
  if (!ultima) return true;
  const dias = diasCalendarioEntreFechas(ultima, ahora);
  if (dias == null) return true;
  return dias >= DIAS_ENTRE_RECORDATORIOS_EMAIL;
}

export async function enviarAlertasAlliasAjustador(codigoAjustador, opciones = {}) {
  const forzar = opciones.forzar === true;
  const codigo = String(codigoAjustador || '').trim();
  console.log('📧 Enviando alertas Allias a:', codigo, forzar ? '(forzado)' : '');

  const alertas = await obtenerAlertasAjustadorAllias(codigo);
  if (!alertas.casosConAlertas) {
    return { success: true, message: 'No hay alertas Allias para enviar', omitido: false };
  }

  const responsable = await Responsable.findOne({ codiRespnsble: codigo });
  if (!responsable?.email) {
    return { success: false, message: 'Email del responsable no encontrado', omitido: false };
  }

  if (!forzar && !debeEnviarRecordatorioEmailAllias(responsable)) {
    const diasDesde = diasCalendarioEntreFechas(responsable.fchaUltimoRecordatorioAlertasAllias);
    return {
      success: true,
      omitido: true,
      message: `Recordatorio Allias omitido: se reenvía cada ${DIAS_ENTRE_RECORDATORIOS_EMAIL} días`,
      diasDesdeUltimo: diasDesde,
    };
  }

  const datosEmail = {
    modulo: 'Allias',
    numeroCaso: `ALERTAS-ALLIAS-${codigo}`,
    nombreResponsable: responsable.nmbrRespnsble || codigo,
    emailResponsable: responsable.email,
    aseguradora: 'Allias',
    asegurado: 'Ajustador Allias',
    fechaAsignacion: new Date().toLocaleDateString('es-CO'),
    quienAsigna: 'Sistema Allias',
    emailQuienAsigna: 'sistema@proserpuertos.com.co',
    observaciones: `Tienes ${alertas.casosConAlertas} casos Allias con alertas pendientes`,
    alertas,
    archivosConRuta: alertas.archivosConRuta || [],
  };

  const resultado = await enviarEmailAlertasAllias(
    await withRecipientLocale(datosEmail, {
      email: responsable.email,
      login: codigo,
    })
  );

  if (resultado?.success !== false) {
    await Responsable.updateOne(
      { _id: responsable._id },
      { $set: { fchaUltimoRecordatorioAlertasAllias: new Date() } }
    );
  }

  return { success: true, omitido: false, resultado };
}

export async function enviarAlertasTodosAllias(opciones = {}) {
  console.log('📧 Enviando alertas Allias a todos los ajustadores...');
  const agrupadas = await obtenerAlertasAlliasPorAjustadores();
  const resultados = [];

  for (const item of agrupadas.ajustadores) {
    try {
      const resultado = await enviarAlertasAlliasAjustador(item.codigoResponsable, opciones);
      resultados.push({
        ajustador: item.codigoResponsable,
        success: resultado.success,
        omitido: Boolean(resultado.omitido),
        message: resultado.message,
      });
    } catch (error) {
      console.error(`❌ Error enviando alertas Allias a ${item.codigoResponsable}:`, error);
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
    modulo: 'Allias',
    totalEnviados: resultados.filter((r) => r.success && !r.omitido).length,
    totalOmitidos: resultados.filter((r) => r.omitido).length,
    totalErrores: resultados.filter((r) => !r.success).length,
    ajustadoresConAlertas: agrupadas.ajustadoresConAlertas,
    responsablesConAlertas: agrupadas.ajustadoresConAlertas,
    resultados,
  };
}
