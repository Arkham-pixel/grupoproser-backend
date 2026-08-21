import PrevisoraCaso from '../models/PrevisoraCaso.js';
import Responsable from '../models/Responsable.js';
import { DIAS_ENTRE_RECORDATORIOS_EMAIL } from './alertasService.js';
import { enviarEmailAlertasPrevisora } from './emailService.js';
import { withRecipientLocale } from '../utils/resolveUserLocale.js';
import {
  getResponsableResolverIndex,
  resolverResponsableConIndice,
} from './responsableResolverService.js';

export const DIAS_RECORDATORIO_INACTIVIDAD_PREVISORA = 30;

/** Estados que cierran el caso para alertas (sin recordatorio). */
const ESTADOS_CERRADOS_PREVISORA = ['CASO PARA PAGO', 'OBJECION', 'CERRADO'];

function normalizarEstadoPrevisora(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function esEstadoPrevisoraCerrado(valorEstado) {
  const estado = normalizarEstadoPrevisora(valorEstado);
  return ESTADOS_CERRADOS_PREVISORA.includes(estado);
}

function parseFechaPrevisora(valor) {
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
export function fechaBaseInactividadPrevisora(caso) {
  return (
    parseFechaPrevisora(caso?.fechaUltimoDocumento) ||
    parseFechaPrevisora(caso?.updatedAt) ||
    parseFechaPrevisora(caso?.createdAt)
  );
}

export function evaluarAlertaInactividadPrevisora(caso, ahora = new Date()) {
  if (!caso || esEstadoPrevisoraCerrado(caso.estado)) return null;

  const base = fechaBaseInactividadPrevisora(caso);
  if (!base) return null;

  const dias = diasCalendarioEntreFechas(base, ahora);
  if (dias == null || dias < DIAS_RECORDATORIO_INACTIVIDAD_PREVISORA) return null;

  const retraso = dias - DIAS_RECORDATORIO_INACTIVIDAD_PREVISORA;
  const origen = parseFechaPrevisora(caso.fechaUltimoDocumento)
    ? 'último documento'
    : 'última actualización del caso';

  return {
    etapaId: 'recordatorioInactividadPrevisora',
    nombre: 'Recordatorio inactividad / documentos',
    fase: 0,
    prioridad: dias >= DIAS_RECORDATORIO_INACTIVIDAD_PREVISORA * 2 ? 'ALTA' : 'MEDIA',
    mensaje: `Han pasado ${dias} días desde el ${origen} sin movimiento. Revisar documentación y estado del caso.`,
    transcurrido: dias,
    limite: DIAS_RECORDATORIO_INACTIVIDAD_PREVISORA,
    retraso: Math.max(0, retraso),
    horasLimite: DIAS_RECORDATORIO_INACTIVIDAD_PREVISORA * 24,
    horasTranscurridas: dias * 24,
    etiquetaLimite: `${DIAS_RECORDATORIO_INACTIVIDAD_PREVISORA} días calendario`,
    tipo: 'RECORDATORIO_INACTIVIDAD_Previsora',
    accion: 'Revisar el caso, subir documentos pendientes y actualizar el estado',
  };
}

function mapearArchivosCasoPrevisora(caso) {
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

export function generarAlertasCasoPrevisora(caso, ahora = new Date()) {
  if (!caso || esEstadoPrevisoraCerrado(caso.estado)) return [];
  const alerta = evaluarAlertaInactividadPrevisora(caso, ahora);
  if (!alerta) return [];
  return [
    {
      ...alerta,
      casoId: caso._id,
      consecutivo: caso.consecutivo,
      numeroSiniestro: caso.siniestro,
      aseguradora: 'Previsora',
      asegurado: caso.tomador,
      responsable: caso.ajustador,
      estado: caso.estado,
      modulo: 'Previsora',
    },
  ];
}

function casoPrevisoraAFormatoEmail(caso) {
  return {
    numeroAjuste: caso.consecutivo || caso.numeroSiniestro || String(caso.casoId || ''),
    consecutivo: caso.consecutivo,
    numeroSiniestro: caso.numeroSiniestro || caso.siniestro,
    aseguradora: caso.aseguradora || 'Previsora',
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

export async function obtenerTodasAlertasPrevisora() {
  const casos = await PrevisoraCaso.find({
    estado: { $nin: ESTADOS_CERRADOS_PREVISORA },
  })
    .lean()
    .exec();

  const porCaso = [];
  let totalAlertas = 0;
  let alta = 0;
  let media = 0;
  const ahora = new Date();

  for (const caso of casos) {
    const alertas = generarAlertasCasoPrevisora(caso, ahora);
    if (!alertas.length) continue;
    totalAlertas += alertas.length;
    for (const a of alertas) {
      if (a.prioridad === 'ALTA') alta += 1;
      else media += 1;
    }

    const base = fechaBaseInactividadPrevisora(caso);
    const dias = base ? diasCalendarioEntreFechas(base, ahora) : null;

    porCaso.push({
      casoId: caso._id,
      consecutivo: caso.consecutivo,
      numeroSiniestro: caso.siniestro,
      siniestro: caso.siniestro,
      aseguradora: 'Previsora',
      asegurado: caso.tomador,
      tomador: caso.tomador,
      responsable: caso.ajustador,
      ajustador: caso.ajustador,
      estado: caso.estado,
      totalAlertas: alertas.length,
      alertas,
      archivos: mapearArchivosCasoPrevisora(caso),
      inactividad:
        dias != null
          ? {
              actividad: parseFechaPrevisora(caso.fechaUltimoDocumento)
                ? 'Último documento'
                : 'Última actualización',
              dias,
              estado: dias >= DIAS_RECORDATORIO_INACTIVIDAD_PREVISORA * 2 ? 'CRÍTICO' : 'ALTO',
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

export async function obtenerAlertasPrevisoraPorAjustadores() {
  const todas = await obtenerTodasAlertasPrevisora();
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
    bucket.casos.push(casoPrevisoraAFormatoEmail(caso));
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

export async function obtenerAlertasAjustadorPrevisora(codigoAjustador) {
  const agrupadas = await obtenerAlertasPrevisoraPorAjustadores();
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

export function debeEnviarRecordatorioEmailPrevisora(responsable, ahora = new Date()) {
  const ultima = responsable?.fchaUltimoRecordatorioAlertasPrevisora;
  if (!ultima) return true;
  const dias = diasCalendarioEntreFechas(ultima, ahora);
  if (dias == null) return true;
  return dias >= DIAS_ENTRE_RECORDATORIOS_EMAIL;
}

export async function enviarAlertasPrevisoraAjustador(codigoAjustador, opciones = {}) {
  const forzar = opciones.forzar === true;
  const codigo = String(codigoAjustador || '').trim();
  console.log('📧 Enviando alertas Previsora a:', codigo, forzar ? '(forzado)' : '');

  const alertas = await obtenerAlertasAjustadorPrevisora(codigo);
  if (!alertas.casosConAlertas) {
    return { success: true, message: 'No hay alertas Previsora para enviar', omitido: false };
  }

  const responsable = await Responsable.findOne({ codiRespnsble: codigo });
  if (!responsable?.email) {
    return { success: false, message: 'Email del responsable no encontrado', omitido: false };
  }

  if (!forzar && !debeEnviarRecordatorioEmailPrevisora(responsable)) {
    const diasDesde = diasCalendarioEntreFechas(responsable.fchaUltimoRecordatorioAlertasPrevisora);
    return {
      success: true,
      omitido: true,
      message: `Recordatorio Previsora omitido: se reenvía cada ${DIAS_ENTRE_RECORDATORIOS_EMAIL} días`,
      diasDesdeUltimo: diasDesde,
    };
  }

  const datosEmail = {
    modulo: 'Previsora',
    numeroCaso: `ALERTAS-PREVISORA-${codigo}`,
    nombreResponsable: responsable.nmbrRespnsble || codigo,
    emailResponsable: responsable.email,
    aseguradora: 'Previsora',
    asegurado: 'Ajustador Previsora',
    fechaAsignacion: new Date().toLocaleDateString('es-CO'),
    quienAsigna: 'Sistema Previsora',
    emailQuienAsigna: 'sistema@proserpuertos.com.co',
    observaciones: `Tienes ${alertas.casosConAlertas} casos Previsora con alertas pendientes`,
    alertas,
    archivosConRuta: alertas.archivosConRuta || [],
  };

  const resultado = await enviarEmailAlertasPrevisora(
    await withRecipientLocale(datosEmail, {
      email: responsable.email,
      login: codigo,
    })
  );

  if (resultado?.success !== false) {
    await Responsable.updateOne(
      { _id: responsable._id },
      { $set: { fchaUltimoRecordatorioAlertasPrevisora: new Date() } }
    );
  }

  return { success: true, omitido: false, resultado };
}

export async function enviarAlertasTodosPrevisora(opciones = {}) {
  console.log('📧 Enviando alertas Previsora a todos los ajustadores...');
  const agrupadas = await obtenerAlertasPrevisoraPorAjustadores();
  const resultados = [];

  for (const item of agrupadas.ajustadores) {
    try {
      const resultado = await enviarAlertasPrevisoraAjustador(item.codigoResponsable, opciones);
      resultados.push({
        ajustador: item.codigoResponsable,
        success: resultado.success,
        omitido: Boolean(resultado.omitido),
        message: resultado.message,
      });
    } catch (error) {
      console.error(`❌ Error enviando alertas Previsora a ${item.codigoResponsable}:`, error);
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
    modulo: 'Previsora',
    totalEnviados: resultados.filter((r) => r.success && !r.omitido).length,
    totalOmitidos: resultados.filter((r) => r.omitido).length,
    totalErrores: resultados.filter((r) => !r.success).length,
    ajustadoresConAlertas: agrupadas.ajustadoresConAlertas,
    responsablesConAlertas: agrupadas.ajustadoresConAlertas,
    resultados,
  };
}
