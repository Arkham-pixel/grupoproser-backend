import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import Responsable from '../models/Responsable.js';
import { DIAS_ENTRE_RECORDATORIOS_EMAIL } from './alertasService.js';
import { enviarEmailAlertasAlfa } from './emailService.js';
import { withRecipientLocale } from '../utils/resolveUserLocale.js';
import {
  getResponsableResolverIndex,
  resolverResponsableConIndice,
} from './responsableResolverService.js';

export const DIAS_RECORDATORIO_INACTIVIDAD_ALFA = 30;

/** Estados de cierre: no se recuerdan por inactividad. */
const ESTADOS_CERRADOS_ALFA = ['CERRADO', 'LIQUIDADO', 'ENVIADO ASEGURADORA'];

function normalizarEstadoAlfa(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function esEstadoAlfaCerrado(valorEstado) {
  const estado = normalizarEstadoAlfa(valorEstado);
  return ESTADOS_CERRADOS_ALFA.includes(estado);
}

function parseFechaAlfa(valor) {
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

function textoAlfa(valor) {
  return String(valor ?? '').trim();
}

/** Asegurado (persona) ≠ tomador (banco). Nunca usar el tomador como nombre del asegurado. */
export function nombreAseguradoAlfa(caso) {
  return textoAlfa(caso?.asegurado) || textoAlfa(caso?.tomador);
}

function empujarFechaActividad(lista, valor, origen) {
  const fecha = parseFechaAlfa(valor);
  if (!fecha) return;
  lista.push({ fecha, origen });
}

/**
 * Actividad más reciente (no la primera fecha que exista).
 * Evita que un `fechaUltimoDocumento` viejo del Excel pise llamadas, inspección o updatedAt.
 */
export function resolverActividadInactividadAlfa(caso) {
  const candidatas = [];
  empujarFechaActividad(candidatas, caso?.fechaUltimoDocumento, 'último documento');
  empujarFechaActividad(candidatas, caso?.fechaLlamada, 'última llamada');
  empujarFechaActividad(candidatas, caso?.fechaInspeccion, 'inspección');
  for (const archivo of caso?.archivos || []) {
    empujarFechaActividad(candidatas, archivo?.fechaSubida, 'último documento');
  }
  empujarFechaActividad(candidatas, caso?.updatedAt, 'última actualización del caso');
  empujarFechaActividad(candidatas, caso?.createdAt, 'creación del caso');
  if (!candidatas.length) return null;
  return candidatas.reduce((mejor, actual) =>
    actual.fecha.getTime() > mejor.fecha.getTime() ? actual : mejor
  );
}

/** Base de inactividad: la fecha de actividad más reciente. */
export function fechaBaseInactividadAlfa(caso) {
  return resolverActividadInactividadAlfa(caso)?.fecha || null;
}

export function evaluarAlertaInactividadAlfa(caso, ahora = new Date()) {
  if (!caso || esEstadoAlfaCerrado(caso.estado)) return null;

  const actividad = resolverActividadInactividadAlfa(caso);
  if (!actividad) return null;

  const dias = diasCalendarioEntreFechas(actividad.fecha, ahora);
  if (dias == null || dias < DIAS_RECORDATORIO_INACTIVIDAD_ALFA) return null;

  const retraso = dias - DIAS_RECORDATORIO_INACTIVIDAD_ALFA;
  const origen = actividad.origen;

  return {
    etapaId: 'recordatorioInactividadAlfa',
    nombre: 'Recordatorio inactividad / documentos',
    fase: 0,
    prioridad: dias >= DIAS_RECORDATORIO_INACTIVIDAD_ALFA * 2 ? 'ALTA' : 'MEDIA',
    mensaje: `Han pasado ${dias} días desde el ${origen} sin movimiento. Revisar documentación y estado del caso.`,
    transcurrido: dias,
    limite: DIAS_RECORDATORIO_INACTIVIDAD_ALFA,
    retraso: Math.max(0, retraso),
    horasLimite: DIAS_RECORDATORIO_INACTIVIDAD_ALFA * 24,
    horasTranscurridas: dias * 24,
    etiquetaLimite: `${DIAS_RECORDATORIO_INACTIVIDAD_ALFA} días calendario`,
    tipo: 'RECORDATORIO_INACTIVIDAD_ALFA',
    accion: 'Revisar el caso, subir documentos pendientes y actualizar el estado',
  };
}

function mapearArchivosCasoAlfa(caso) {
  const prefijo = textoAlfa(caso?.consecutivo) || textoAlfa(caso?.siniestro) || 'ALFA';
  return (caso?.archivos || [])
    .filter((a) => a?.ruta)
    .map((a) => {
      const base = a.nombreOriginal || a.nombreArchivo || 'documento';
      const yaPrefijado =
        String(base).startsWith(`${prefijo} `) || String(base).startsWith(`${prefijo} - `);
      return {
        nombre: yaPrefijado ? base : `${prefijo} - ${base}`,
        ruta: a.ruta,
        tamaño: a.tamaño || 0,
        tipoMime: a.tipoMime,
        casoId: caso._id,
        consecutivo: caso.consecutivo,
      };
    });
}

export function generarAlertasCasoAlfa(caso, ahora = new Date()) {
  if (!caso || esEstadoAlfaCerrado(caso.estado)) return [];
  const alerta = evaluarAlertaInactividadAlfa(caso, ahora);
  if (!alerta) return [];
  const asegurado = nombreAseguradoAlfa(caso);
  return [
    {
      ...alerta,
      casoId: caso._id,
      consecutivo: caso.consecutivo,
      numeroSiniestro: caso.siniestro,
      identificacion: caso.identificacion,
      aseguradora: 'Seguros Alfa',
      asegurado,
      tomador: textoAlfa(caso.tomador),
      responsable: caso.ajustador,
      estado: caso.estado,
      modulo: 'alfa',
    },
  ];
}

export function casoAlfaAFormatoEmail(caso) {
  const asegurado = nombreAseguradoAlfa(caso);
  const tomador = textoAlfa(caso.tomador);
  return {
    numeroAjuste: caso.consecutivo || caso.numeroSiniestro || caso.siniestro || String(caso.casoId || ''),
    consecutivo: caso.consecutivo,
    numeroSiniestro: caso.numeroSiniestro || caso.siniestro,
    identificacion: caso.identificacion || '',
    aseguradora: caso.aseguradora || 'Seguros Alfa',
    asegurado,
    tomador,
    ciudad: caso.ciudad || '',
    estado: caso.estado,
    totalAlertas: caso.totalAlertas,
    documentosFaltantes: [],
    alertas: caso.alertas || [],
    inactividad: caso.inactividad || null,
    archivos: caso.archivos || [],
    casoId: caso.casoId || caso._id,
  };
}

export async function obtenerTodasAlertasAlfa() {
  const casos = await SegurosAlfaCaso.find({
    estado: { $nin: ESTADOS_CERRADOS_ALFA },
  })
    .lean()
    .exec();

  const porCaso = [];
  let totalAlertas = 0;
  let alta = 0;
  let media = 0;
  const ahora = new Date();

  for (const caso of casos) {
    const alertas = generarAlertasCasoAlfa(caso, ahora);
    if (!alertas.length) continue;
    totalAlertas += alertas.length;
    for (const a of alertas) {
      if (a.prioridad === 'ALTA') alta += 1;
      else media += 1;
    }

    const actividad = resolverActividadInactividadAlfa(caso);
    const dias = actividad ? diasCalendarioEntreFechas(actividad.fecha, ahora) : null;
    const asegurado = nombreAseguradoAlfa(caso);

    porCaso.push({
      casoId: caso._id,
      consecutivo: caso.consecutivo,
      numeroSiniestro: caso.siniestro,
      siniestro: caso.siniestro,
      identificacion: caso.identificacion,
      aseguradora: 'Seguros Alfa',
      asegurado,
      tomador: textoAlfa(caso.tomador),
      ciudad: caso.ciudad,
      responsable: caso.ajustador,
      ajustador: caso.ajustador,
      estado: caso.estado,
      totalAlertas: alertas.length,
      alertas,
      archivos: mapearArchivosCasoAlfa(caso),
      inactividad:
        dias != null
          ? {
              actividad: actividad.origen,
              dias,
              estado: dias >= DIAS_RECORDATORIO_INACTIVIDAD_ALFA * 2 ? 'CRÍTICO' : 'ALTO',
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

export async function obtenerAlertasAlfaPorAjustadores() {
  const todas = await obtenerTodasAlertasAlfa();
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
    bucket.casos.push(casoAlfaAFormatoEmail(caso));
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

export async function obtenerAlertasAjustadorAlfa(codigoAjustador) {
  const agrupadas = await obtenerAlertasAlfaPorAjustadores();
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

export function debeEnviarRecordatorioEmailAlfa(responsable, ahora = new Date()) {
  const ultima = responsable?.fchaUltimoRecordatorioAlertasAlfa;
  if (!ultima) return true;
  const dias = diasCalendarioEntreFechas(ultima, ahora);
  if (dias == null) return true;
  return dias >= DIAS_ENTRE_RECORDATORIOS_EMAIL;
}

export async function enviarAlertasAlfaAjustador(codigoAjustador, opciones = {}) {
  const forzar = opciones.forzar === true;
  const codigo = String(codigoAjustador || '').trim();
  console.log('📧 Enviando alertas Seguros Alfa a:', codigo, forzar ? '(forzado)' : '');

  const alertas = await obtenerAlertasAjustadorAlfa(codigo);
  if (!alertas.casosConAlertas) {
    return { success: true, message: 'No hay alertas Alfa para enviar', omitido: false };
  }

  const responsable = await Responsable.findOne({ codiRespnsble: codigo });
  if (!responsable?.email) {
    return { success: false, message: 'Email del responsable no encontrado', omitido: false };
  }

  if (!forzar && !debeEnviarRecordatorioEmailAlfa(responsable)) {
    const diasDesde = diasCalendarioEntreFechas(responsable.fchaUltimoRecordatorioAlertasAlfa);
    return {
      success: true,
      omitido: true,
      message: `Recordatorio Alfa omitido: se reenvía cada ${DIAS_ENTRE_RECORDATORIOS_EMAIL} días`,
      diasDesdeUltimo: diasDesde,
    };
  }

  const datosEmail = {
    modulo: 'alfa',
    numeroCaso: `ALERTAS-ALFA-${codigo}`,
    nombreResponsable: responsable.nmbrRespnsble || codigo,
    emailResponsable: responsable.email,
    aseguradora: 'Seguros Alfa',
    asegurado: 'Ajustador Seguros Alfa',
    fechaAsignacion: new Date().toLocaleDateString('es-CO'),
    quienAsigna: 'Sistema Seguros Alfa',
    emailQuienAsigna: 'sistema@proserpuertos.com.co',
    observaciones: `Tienes ${alertas.casosConAlertas} casos Seguros Alfa con alertas pendientes`,
    alertas,
    archivosConRuta: alertas.archivosConRuta || [],
  };

  const resultado = await enviarEmailAlertasAlfa(
    await withRecipientLocale(datosEmail, {
      email: responsable.email,
      login: codigo,
    })
  );

  if (resultado?.success !== false) {
    await Responsable.updateOne(
      { _id: responsable._id },
      { $set: { fchaUltimoRecordatorioAlertasAlfa: new Date() } }
    );
  }

  return { success: true, omitido: false, resultado };
}

export async function enviarAlertasTodosAlfa(opciones = {}) {
  console.log('📧 Enviando alertas Seguros Alfa a todos los ajustadores...');
  const agrupadas = await obtenerAlertasAlfaPorAjustadores();
  const resultados = [];

  for (const item of agrupadas.ajustadores) {
    try {
      const resultado = await enviarAlertasAlfaAjustador(item.codigoResponsable, opciones);
      resultados.push({
        ajustador: item.codigoResponsable,
        success: resultado.success,
        omitido: Boolean(resultado.omitido),
        message: resultado.message,
      });
    } catch (error) {
      console.error(`❌ Error enviando alertas Alfa a ${item.codigoResponsable}:`, error);
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
    modulo: 'alfa',
    totalEnviados: resultados.filter((r) => r.success && !r.omitido).length,
    totalOmitidos: resultados.filter((r) => r.omitido).length,
    totalErrores: resultados.filter((r) => !r.success).length,
    ajustadoresConAlertas: agrupadas.ajustadoresConAlertas,
    responsablesConAlertas: agrupadas.ajustadoresConAlertas,
    resultados,
  };
}
