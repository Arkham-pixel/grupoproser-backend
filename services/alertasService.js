import Complex from '../models/Complex.js';
import Estado from '../models/Estado.js';
import Responsable from '../models/Responsable.js';
import { enviarEmailAlertas } from './emailService.js';
import { obtenerProtocoloActivo } from './protocoloConfigService.js';
import { evaluarProtocoloCaso, horasEntre, tieneDocumentoEnHistorialDocs } from './protocoloSiniestrosUtils.js';
import { CAMPO_ANEXO_A_TIPO_HISTORIAL, alinearCamposProtocoloDesdeHistorialDocs } from '../config/ajusteTrazabilidadComplexMap.js';

// Fecha límite: Solo casos agregados desde octubre de 2025 en adelante recibirán alertas
const FECHA_LIMITE_ALERTAS = new Date('2025-10-01T00:00:00.000Z');

/**
 * Estados sin seguimiento por correo/UI de alertas.
 * codiEstdo en Complex es String; se incluyen también números por seguridad de query.
 * 4 FINALIZADO · 5 DESISTIDO · 6 LIQUIDAR SINIESTRO · 11 OBJETADO · 14 ANULADO · 17 FACTURADO
 */
export const CODIGOS_ESTADO_SIN_ALERTAS = ['4', '5', '6', '11', '14', '17', 4, 5, 6, 11, 14, 17];

const FILTRO_CASOS_ACTIVOS_ALERTAS = {
  codiEstdo: { $nin: CODIGOS_ESTADO_SIN_ALERTAS },
};

/** Catálogo código → descripción (Complex guarda solo codiEstdo). */
async function cargarMapaEstados() {
  const estados = await Estado.find()
    .select('codiEstdo codiEstado descEstdo descEstado descripcion')
    .lean();
  const mapa = {};
  for (const e of estados) {
    const cod = e.codiEstdo ?? e.codiEstado;
    const desc = String(e.descEstdo ?? e.descEstado ?? e.descripcion ?? '').trim();
    if (cod == null || cod === '' || !desc) continue;
    const claves = new Set([String(cod).trim()]);
    const num = Number(cod);
    if (!Number.isNaN(num)) claves.add(String(num));
    for (const k of claves) {
      if (k && k !== 'NaN') mapa[k] = desc;
    }
  }
  return mapa;
}

function resolverEstadoAlerta(caso, mapaEstados = {}) {
  const codigo = String(caso?.codiEstdo ?? '').trim();
  if (!codigo) {
    return { estadoCodigo: null, estado: 'N/A' };
  }
  const nombre =
    mapaEstados[codigo] ||
    mapaEstados[String(Number(codigo))] ||
    codigo;
  return { estadoCodigo: codigo, estado: nombre };
}

/** Enriquece el caso en memoria: historialDocs (Ajuste) → anexos/fechas de protocolo. */
function casoNormalizadoParaProtocolo(caso) {
  const base = caso?.toObject ? caso.toObject() : { ...(caso || {}) };
  if (!Array.isArray(base.historialDocs) || base.historialDocs.length === 0) return base;
  return alinearCamposProtocoloDesdeHistorialDocs(base, base.historialDocs, { soloSiVacio: true });
}

/** Caso cerrado / no operable: no debe generar ni enviar alertas. */
export function casoExcluidoDeAlertas(caso) {
  const codigo = String(caso?.codiEstdo ?? '').trim();
  if (!codigo) return false;
  if (['4', '5', '6', '11', '14', '17'].includes(codigo)) return true;
  const desc = String(
    caso?.descEstdo || caso?.descripcionEstado || caso?.nombreEstado || ''
  )
    .trim()
    .toUpperCase();
  if (!desc) return false;
  return (
    desc.includes('FACTURADO') ||
    desc.includes('FINALIZADO') ||
    desc.includes('DESISTIDO') ||
    desc.includes('OBJETADO') ||
    desc.includes('ANULADO') ||
    desc.includes('LIQUIDAR SINIESTRO')
  );
}

function respuestaSinAlertas(caso, mapaEstados = {}) {
  const { estadoCodigo, estado } = resolverEstadoAlerta(caso, mapaEstados);
  return {
    casoId: caso?._id,
    numeroAjuste: caso?.nmroAjste,
    numeroSiniestro: caso?.nmroSinstro,
    aseguradora: caso?.codiAsgrdra,
    asegurado: caso?.asgrBenfcro,
    estadoCodigo,
    estado,
    fechaAsignacion: caso?.fchaAsgncion,
    documentosFaltantes: [],
    documentosSubidos: [],
    documentosInfo: {
      faltantes: [],
      subidos: [],
      totalRequeridos: 0,
      totalObligatorios: 0,
      totalSubidos: 0,
      totalObligatoriosSubidos: 0,
      totalFaltantes: 0,
      totalObligatoriosFaltantes: 0,
    },
    intensidadAdicional: {
      documentosSubidos: [],
      totalDocumentosSubidos: 0,
      totalDocumentosObligatoriosSubidos: 0,
      porcentajeObligatoriosSubidos: 0,
      porcentajeTotalSubidos: 0,
      mensaje: 'Sin documentos verificados',
      reduceIntensidad: false,
    },
    inactividad: { dias: null, actividad: 'Sin verificación', estado: 'NORMAL' },
    alertas: [],
    totalAlertas: 0,
    prioridadMaxima: 0,
  };
}

// Recordatorios por inactividad en hitos: 5, 7, 15 y luego cada 30 días.
/** Intervalo entre correos automáticos de alertas Complex una vez hay vencimientos. */
export const DIAS_ENTRE_RECORDATORIOS_EMAIL = 30;

function diasCalendarioEntreFechas(desde, hasta = new Date()) {
  if (!desde) return null;
  const a = new Date(desde);
  const b = new Date(hasta);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** ¿Corresponde enviar correo automático? (cada 30 días desde el último envío). */
export function debeEnviarRecordatorioEmail(responsable, ahora = new Date()) {
  const ultima = responsable?.fchaUltimoRecordatorioAlertas;
  if (!ultima) return true;
  const dias = diasCalendarioEntreFechas(ultima, ahora);
  if (dias == null) return true;
  return dias >= DIAS_ENTRE_RECORDATORIOS_EMAIL;
}

// Función para verificar si un caso debe recibir alertas (solo casos desde octubre 2025)
const debeRecibirAlertas = (caso) => {
  // Si tiene fecha de asignación, usar esa fecha
  if (caso.fchaAsgncion) {
    const fechaAsignacion = new Date(caso.fchaAsgncion);
    return fechaAsignacion >= FECHA_LIMITE_ALERTAS;
  }
  
  // Si no tiene fecha de asignación, usar el timestamp del _id de MongoDB
  // Los ObjectId de MongoDB contienen un timestamp de creación
  if (caso._id) {
    const timestamp = caso._id.getTimestamp();
    return timestamp >= FECHA_LIMITE_ALERTAS;
  }
  
  // Si no tiene ninguna fecha, no recibir alertas (caso muy viejo)
  return false;
};

// Informe final completo (fecha + adjunto): la etapa operativa del ajustador terminó.
// No se envían alertas posteriores por presentación de cifras, envío de finiquito ni inactividad por esas etapas.
const informeFinalCompletoEtapaAjustador = (caso) => {
  const f = caso.fchaInfoFnal;
  const tieneFecha = f != null && String(f).trim() !== '';
  const adj = caso.anxoInfoFnal;
  const tieneDoc = adj != null && String(adj).trim() !== '';
  return Boolean(tieneFecha && tieneDoc);
};

// Función para verificar documentos faltantes y subidos en un caso
// IMPORTANTE: Un documento solo se considera "completo" si tiene documento subido Y fecha asociada
export const verificarDocumentosFaltantes = (caso) => {
  const casoEval = casoNormalizadoParaProtocolo(caso);
  const documentosFaltantes = [];
  const documentosSubidos = [];
  const documentosRequeridos = [
    { campo: 'anexContIni', nombre: 'Contacto Inicial', obligatorio: true, campoFecha: 'fchaContIni' },
    { campo: 'anexActaInspccion', nombre: 'Acta de Inspección', obligatorio: true, campoFecha: 'fchaInspccion' },
    { campo: 'anexSolDoc', nombre: 'Solicitud de Documentos', obligatorio: true, campoFecha: 'fchaSoliDocu' },
    { campo: 'anxoInfPrelim', nombre: 'Informe Preliminar', obligatorio: true, campoFecha: 'fchaInfoPrelm' },
    { campo: 'anxoInfoFnal', nombre: 'Informe Final', obligatorio: true, campoFecha: 'fchaInfoFnal' },
    { campo: 'anxoRepoActi', nombre: 'Reporte de Actividades', obligatorio: false, campoFecha: 'fchaRepoActi' },
    { campo: 'anxoPresentacionCifras', nombre: 'Presentación de Cifras', obligatorio: false, campoFecha: 'fchaPresentacionCifras' },
    { campo: 'anxoEnvioFiniquito', nombre: 'Envío de Finiquito', obligatorio: false, campoFecha: 'fchaEnvioFiniquito' },
    { campo: 'anxoFactra', nombre: 'Factura', obligatorio: false, campoFecha: 'fchaFactra' },
    { campo: 'anxoHonorarios', nombre: 'Honorarios', obligatorio: false, campoFecha: null },
  ];

  const postInformeSinAlertaAjustador = informeFinalCompletoEtapaAjustador(caso);

  documentosRequeridos.forEach(doc => {
    if (postInformeSinAlertaAjustador && (doc.campo === 'anxoPresentacionCifras' || doc.campo === 'anxoEnvioFiniquito')) {
      documentosSubidos.push({
        nombre: doc.nombre,
        obligatorio: doc.obligatorio,
        campo: doc.campo,
        tieneDocumento: true,
        tieneFecha: true
      });
      return;
    }

    const historialTipo = CAMPO_ANEXO_A_TIPO_HISTORIAL[doc.campo] || null;
    const tieneDocumento =
      (casoEval[doc.campo] && casoEval[doc.campo].trim() !== '') ||
      (historialTipo && tieneDocumentoEnHistorialDocs(casoEval, historialTipo));
    // IMPORTANTE: Si tiene campoFecha, verificar si tiene fecha asignada
    // Si NO tiene campoFecha (como Honorarios), considerar que siempre tiene fecha (no genera alerta)
    const tieneFecha = doc.campoFecha ? (casoEval[doc.campoFecha] && casoEval[doc.campoFecha] !== null && casoEval[doc.campoFecha] !== '') : true;
    
    // IMPORTANTE: Un documento se considera "completo" si tiene fecha Y documento
    // Si solo tiene fecha pero no documento, aún puede generar alerta (depende de la configuración)
    // Si tiene fecha Y documento, se considera completado y NO genera alerta
    const documentoCompleto = tieneFecha && tieneDocumento;
    
    if (documentoCompleto) {
      // Si tiene fecha Y documento, se considera completamente completado
      documentosSubidos.push({
        nombre: doc.nombre,
        obligatorio: doc.obligatorio,
        campo: doc.campo,
        tieneDocumento: true,
        tieneFecha: true
      });
    } else {
      // Solo generar alerta si NO tiene fecha O NO tiene documento
      // Si tiene documento pero no fecha, aún genera alerta (falta fecha)
      // Si tiene fecha pero no documento, aún genera alerta (falta documento)
      documentosFaltantes.push({
        nombre: doc.nombre,
        obligatorio: doc.obligatorio,
        prioridad: doc.obligatorio ? 'ALTA' : 'MEDIA',
        campo: doc.campo,
        campoFecha: doc.campoFecha,
        tieneDocumento,
        tieneFecha,
        razonFalta: tieneDocumento && !tieneFecha 
          ? 'Falta fecha (tiene documento)' 
          : !tieneDocumento && tieneFecha
          ? 'Falta documento (tiene fecha)'
          : 'Falta documento y fecha'
      });
    }
  });

  return {
    faltantes: documentosFaltantes,
    subidos: documentosSubidos,
    totalRequeridos: documentosRequeridos.length,
    totalObligatorios: documentosRequeridos.filter(d => d.obligatorio).length,
    totalSubidos: documentosSubidos.length,
    totalObligatoriosSubidos: documentosSubidos.filter(d => d.obligatorio).length,
    totalFaltantes: documentosFaltantes.length,
    totalObligatoriosFaltantes: documentosFaltantes.filter(d => d.obligatorio).length
  };
};

/** Fase 1 protocolo: caso recién asignado sin contacto inicial */
function evaluarAlertaAsignacionReciente(caso) {
  if (!caso?.codiRespnsble || !caso?.fchaAsgncion) return null;
  if (caso.fchaContIni) return null;

  const horas = horasEntre(caso.fchaAsgncion, new Date());
  if (horas == null || horas > 72) return null;

  return {
    tipo: 'ASIGNACION_RECIBIDA',
    categoria: 'protocolo',
    prioridad: horas >= 10 ? 'ALTA' : 'MEDIA',
    mensaje: `Nuevo siniestro asignado — Caso ${caso.nmroAjste || '—'} · Siniestro ${caso.nmroSinstro || '—'}`,
    accion: 'Registrar contacto inicial en ARNALD (plazo: 12 h desde asignación)',
    color: horas >= 10 ? 'red' : 'orange',
  };
}

// Función para calcular alertas de tiempos según el protocolo parametrizado
export const calcularTiemposEntreDocumentos = (caso, protocolo, alcance = 'todos') => {
  if (!protocolo) return [];

  const casoEval = casoNormalizadoParaProtocolo(caso);
  const alertasProtocolo = evaluarProtocoloCaso(casoEval, protocolo, new Date(), alcance);

  return alertasProtocolo.map((alerta) => ({
    tipo: alerta.tipo,
    nombre: alerta.nombre,
    prioridad: alerta.prioridad,
    mensaje: alerta.prioridad === 'ALTA' ? `🚨 ${alerta.mensaje}` : `⏰ ${alerta.mensaje}`,
    accion: alerta.accion,
    horasTranscurridas: alerta.horasTranscurridas || 0,
    horasLimite: alerta.horasLimite || 0,
    horasRetraso: alerta.retraso || 0,
    diasRetraso: alerta.retraso || 0,
    tieneFecha: false,
    tieneDocumento: false,
    etapaId: alerta.etapaId || alerta.seguimientoId,
    etiquetaLimite: alerta.etiquetaLimite,
  }));
};

// Función para calcular días transcurridos desde la última actividad
// IMPORTANTE: Solo considera fechas que tienen documento asociado subido
export const calcularDiasInactividad = (caso) => {
  if (informeFinalCompletoEtapaAjustador(caso)) {
    return {
      dias: 0,
      actividad: 'Informe final completado',
      fecha: caso.fchaInfoFnal,
      estado: 'NORMAL',
      debeEnviarAlerta: false,
      nivelRecordatorio: null
    };
  }

  // Mapeo de fechas a sus documentos asociados
  // Inspección cuenta con fecha sola; el acta es entregable aparte.
  const fechasConDocumentos = [
    { campo: 'fchaContIni', nombre: 'Contacto Inicial', campoDoc: 'anexContIni' },
    { campo: 'fchaInspccion', nombre: 'Inspección', campoDoc: null },
    { campo: 'fchaSoliDocu', nombre: 'Solicitud de Documentos', campoDoc: 'anexSolDoc' },
    { campo: 'fchaInfoPrelm', nombre: 'Informe Preliminar', campoDoc: 'anxoInfPrelim' },
    { campo: 'fchaInfoFnal', nombre: 'Informe Final', campoDoc: 'anxoInfoFnal' },
    { campo: 'fchaRepoActi', nombre: 'Reporte de Actividades', campoDoc: 'anxoRepoActi' },
    { campo: 'fchaPresentacionCifras', nombre: 'Presentación de Cifras', campoDoc: 'anxoPresentacionCifras' },
    { campo: 'fchaEnvioFiniquito', nombre: 'Envío de Finiquito', campoDoc: 'anxoEnvioFiniquito' },
    { campo: 'fchaUltSegui', nombre: 'Último Seguimiento', campoDoc: null } // Seguimiento no requiere documento
  ];

  let ultimaActividad = null;
  let nombreUltimaActividad = '';

  fechasConDocumentos.forEach(fecha => {
    const tieneFecha = caso[fecha.campo] && caso[fecha.campo] !== null && caso[fecha.campo] !== '';
    
    // IMPORTANTE: Si tiene fecha, se considera actividad válida (aunque no tenga documento)
    // Esto permite que al poner fecha, se actualice la última actividad y se detengan alertas de inactividad
    if (tieneFecha && (!ultimaActividad || caso[fecha.campo] > ultimaActividad)) {
      ultimaActividad = caso[fecha.campo];
      nombreUltimaActividad = fecha.nombre;
    }
  });

  if (!ultimaActividad) {
    return {
      dias: null,
      actividad: 'Sin actividad registrada',
      estado: 'CRÍTICO',
      debeEnviarAlerta: true // Sin actividad, siempre enviar alerta
    };
  }

  // Usar zona horaria de Colombia para cálculos consistentes
  const ahora = new Date();
  const fechaUltimaActividad = new Date(ultimaActividad);
  const diasTranscurridos = Math.floor((ahora - fechaUltimaActividad) / (1000 * 60 * 60 * 24));
  
  // Determinar si debe enviar alerta según los días de recordatorio
  let debeEnviarAlerta = false;
  let nivelRecordatorio = null;
  
  if (diasTranscurridos >= 30) {
    // Desde el día 30: recordatorio cada 30 días (30, 60, 90...), no diario
    if (diasTranscurridos % 30 === 0) {
      debeEnviarAlerta = true;
      nivelRecordatorio = diasTranscurridos === 30 ? 4 : 'CADA_30';
    }
  } else if (diasTranscurridos === 15) {
    debeEnviarAlerta = true;
    nivelRecordatorio = 3;
  } else if (diasTranscurridos === 7) {
    debeEnviarAlerta = true;
    nivelRecordatorio = 2;
  } else if (diasTranscurridos === 5) {
    debeEnviarAlerta = true;
    nivelRecordatorio = 1;
  }
  
  let estado = 'NORMAL';
  if (diasTranscurridos > 30) estado = 'CRÍTICO';
  else if (diasTranscurridos > 15) estado = 'ALTO';
  else if (diasTranscurridos > 7) estado = 'MEDIO';

  return {
    dias: diasTranscurridos,
    actividad: nombreUltimaActividad,
    fecha: ultimaActividad,
    estado,
    debeEnviarAlerta,
    nivelRecordatorio
  };
};

// Función para generar alertas para un caso específico
export const generarAlertasCaso = (caso, protocolo, opciones = {}) => {
  const alcance = opciones.alcance || 'todos';
  const mapaEstados = opciones.mapaEstados || {};
  // Solo casos desde octubre 2025; excluir facturados / cerrados / anulados
  if (!debeRecibirAlertas(caso) || casoExcluidoDeAlertas(caso)) {
    return respuestaSinAlertas(caso, mapaEstados);
  }
  
  const documentosInfo = verificarDocumentosFaltantes(caso);
  const documentosFaltantes = documentosInfo.faltantes;
  const documentosSubidos = documentosInfo.subidos;
  const inactividad = calcularDiasInactividad(caso);
  const alertasTiempoDocumentos = calcularTiemposEntreDocumentos(caso, protocolo, alcance);

  const alertas = alertasTiempoDocumentos.map((alertaTiempo) => ({
    tipo: alertaTiempo.tipo,
    categoria: alertaTiempo.tipo?.startsWith('SEGUIMIENTO_') ? 'seguimiento' : 'protocolo',
    prioridad: alertaTiempo.prioridad,
    mensaje: alertaTiempo.mensaje,
    accion: alertaTiempo.accion,
    color: alertaTiempo.prioridad === 'ALTA' ? 'red' : 'orange',
    horasTranscurridas: alertaTiempo.horasTranscurridas,
    horasLimite: alertaTiempo.horasLimite,
    horasRetraso: alertaTiempo.horasRetraso,
    etapaId: alertaTiempo.etapaId,
    etiquetaLimite: alertaTiempo.etiquetaLimite,
  }));

  const alertaAsignacion = evaluarAlertaAsignacionReciente(caso);
  if (alertaAsignacion) {
    alertas.unshift(alertaAsignacion);
  }

  const porcentajeObligatoriosSubidos = documentosInfo.totalObligatorios > 0 
    ? (documentosInfo.totalObligatoriosSubidos / documentosInfo.totalObligatorios) * 100 
    : 0;
  const porcentajeTotalSubidos = documentosInfo.totalRequeridos > 0
    ? (documentosInfo.totalSubidos / documentosInfo.totalRequeridos) * 100
    : 0;

  // Caso con mucho tiempo abierto (control gerencial)
  const hoy = new Date();
  if (caso.fchaAsgncion && !informeFinalCompletoEtapaAjustador(caso)) {
    const fechaAsignacion = new Date(caso.fchaAsgncion);
    const diasDesdeAsignacion = Math.floor((hoy - fechaAsignacion) / (1000 * 60 * 60 * 24));
    if (diasDesdeAsignacion > 60) {
      alertas.push({
        tipo: 'CASO_ANTIGUO',
        categoria: 'gerencial',
        prioridad: 'ALTA',
        mensaje: `Caso asignado hace ${diasDesdeAsignacion} días sin cierre operativo`,
        accion: 'Revisar estado y prioridad del caso',
        color: 'red',
      });
    }
  }

  // Calcular intensidad adicional basada en documentos subidos
  const intensidadAdicional = {
    documentosSubidos: documentosSubidos.map(doc => doc.nombre),
    totalDocumentosSubidos: documentosInfo.totalSubidos,
    totalDocumentosObligatoriosSubidos: documentosInfo.totalObligatoriosSubidos,
    porcentajeObligatoriosSubidos: Math.round(porcentajeObligatoriosSubidos),
    porcentajeTotalSubidos: Math.round(porcentajeTotalSubidos),
    mensaje: documentosSubidos.length > 0 
      ? `✅ Documentos subidos: ${documentosSubidos.map(d => d.nombre).join(', ')}`
      : '⚠️ No hay documentos subidos',
    reduceIntensidad: porcentajeObligatoriosSubidos >= 50
  };

  // Ajustar prioridad máxima si hay documentos subidos que reducen la intensidad
  let prioridadMaxima = alertas.length > 0 
    ? Math.max(...alertas.map(a => a.prioridad === 'ALTA' ? 3 : a.prioridad === 'MEDIA' ? 2 : 1)) 
    : 0;
  
  // Reducir prioridad máxima si hay documentos subidos
  if (intensidadAdicional.reduceIntensidad && prioridadMaxima > 0) {
    prioridadMaxima = Math.max(1, prioridadMaxima - 1);
  }

  const { estadoCodigo, estado } = resolverEstadoAlerta(caso, mapaEstados);

  return {
    casoId: caso._id,
    numeroAjuste: caso.nmroAjste,
    numeroSiniestro: caso.nmroSinstro,
    aseguradora: caso.codiAsgrdra,
    asegurado: caso.asgrBenfcro,
    estadoCodigo,
    estado,
    fechaAsignacion: caso.fchaAsgncion,
    documentosFaltantes,
    documentosSubidos,
    documentosInfo,
    intensidadAdicional,
    inactividad,
    alertas,
    totalAlertas: alertas.length,
    prioridadMaxima
  };
};

// Función para obtener todas las alertas de un ajustador
export const obtenerAlertasAjustador = async (codigoResponsable) => {
  try {
    console.log('🔍 Obteniendo alertas para ajustador:', codigoResponsable);
    console.log(`📅 Filtro de fecha: Solo casos desde ${FECHA_LIMITE_ALERTAS.toLocaleDateString('es-CO')} recibirán alertas`);
    
    // Excluir cerrados: FINALIZADO, DESISTIDO, LIQUIDAR, ANULADO, FACTURADO
    const todosLosCasos = await Complex.find({
      codiRespnsble: codigoResponsable,
      ...FILTRO_CASOS_ACTIVOS_ALERTAS,
    });
    
    // IMPORTANTE: Filtrar solo casos creados desde octubre 2025
    // Los casos viejos no deben recibir alertas
    const casos = todosLosCasos.filter(
      (caso) => debeRecibirAlertas(caso) && !casoExcluidoDeAlertas(caso)
    );
    
    console.log(`📊 Casos activos encontrados para ${codigoResponsable}: ${todosLosCasos.length}`);
    console.log(`📅 Casos elegibles para alertas (desde octubre 2025): ${casos.length}`);
    console.log(`🚫 Excluidos estados sin alerta: 4, 5, 6, 11, 14, 17 (OBJETADO/FACTURADO)`);
    console.log(`🚫 Casos viejos excluidos (anteriores a octubre 2025): ${todosLosCasos.length - casos.length}`);
    
    const protocolo = await obtenerProtocoloActivo();
    const mapaEstados = await cargarMapaEstados();
    const alertasGeneradas = casos.map((caso) =>
      generarAlertasCaso(caso, protocolo, { mapaEstados })
    );
    
    // Filtrar solo casos con alertas
    const casosConAlertas = alertasGeneradas.filter(caso => caso.totalAlertas > 0);
    
    // Ordenar por prioridad (más críticos primero)
    casosConAlertas.sort((a, b) => b.prioridadMaxima - a.prioridadMaxima);
    
    console.log(`🚨 Casos con alertas para ${codigoResponsable}:`, casosConAlertas.length);
    
    return {
      ajustador: codigoResponsable,
      totalCasos: casos.length,
      casosConAlertas: casosConAlertas.length,
      casos: casosConAlertas,
      resumen: {
        documentosObligatorios: casosConAlertas.reduce((sum, caso) => 
          sum + caso.documentosFaltantes.filter(d => d.obligatorio).length, 0),
        casosCriticos: casosConAlertas.filter(caso => 
          caso.inactividad.estado === 'CRÍTICO').length,
        casosAntiguos: casosConAlertas.filter(caso => 
          caso.alertas.some(a => a.tipo === 'CASO_ANTIGUO')).length
      }
    };
  } catch (error) {
    console.error('❌ Error obteniendo alertas del ajustador:', error);
    throw error;
  }
};

// Función para obtener alertas de todos los ajustadores
export const obtenerAlertasTodosAjustadores = async () => {
  try {
    console.log('🔍 Obteniendo alertas de todos los ajustadores...');
    console.log(`📅 Filtro de fecha: Solo casos desde ${FECHA_LIMITE_ALERTAS.toLocaleDateString('es-CO')} recibirán alertas`);
    
    // Casos activos (sin FACTURADO / ANULADO / FINALIZADO / DESISTIDO / LIQUIDAR)
    const todosLosCasos = await Complex.find(FILTRO_CASOS_ACTIVOS_ALERTAS);
    
    // IMPORTANTE: Filtrar solo casos creados desde octubre 2025
    // Los casos viejos no deben recibir alertas
    const casosElegibles = todosLosCasos.filter(
      (caso) => debeRecibirAlertas(caso) && !casoExcluidoDeAlertas(caso)
    );
    
    // Obtener responsables únicos solo de casos elegibles
    const casos = [...new Set(casosElegibles.map(caso => caso.codiRespnsble).filter(Boolean))];
    
    console.log(`📊 Total casos activos encontrados: ${todosLosCasos.length}`);
    console.log(`📅 Casos elegibles para alertas (desde octubre 2025): ${casosElegibles.length}`);
    console.log(`🚫 Casos viejos excluidos: ${todosLosCasos.length - casosElegibles.length}`);
    console.log('📊 Responsables únicos con casos elegibles:', casos.length);
    
    // Obtener alertas para cada ajustador
    const alertasPorAjustador = await Promise.all(
      casos.map(codigo => obtenerAlertasAjustador(codigo))
    );
    
    // Filtrar solo ajustadores con alertas
    const ajustadoresConAlertas = alertasPorAjustador.filter(ajustador => 
      ajustador.casosConAlertas > 0
    );
    
    console.log('🚨 Ajustadores con alertas:', ajustadoresConAlertas.length);
    
    return {
      totalAjustadores: casos.length,
      ajustadoresConAlertas: ajustadoresConAlertas.length,
      ajustadores: ajustadoresConAlertas,
      resumenGeneral: {
        totalCasos: ajustadoresConAlertas.reduce((sum, a) => sum + a.totalCasos, 0),
        totalAlertas: ajustadoresConAlertas.reduce((sum, a) => 
          sum + a.casos.reduce((sum2, c) => sum2 + c.totalAlertas, 0), 0),
        casosCriticos: ajustadoresConAlertas.reduce((sum, a) => 
          sum + a.resumen.casosCriticos, 0)
      }
    };
  } catch (error) {
    console.error('❌ Error obteniendo alertas de todos los ajustadores:', error);
    throw error;
  }
};

/** Evalúa alertas de un caso (para UI en formulario / mis alertas). */
export const evaluarAlertasDeCaso = async (caso) => {
  const protocolo = await obtenerProtocoloActivo();
  const mapaEstados = await cargarMapaEstados();
  return generarAlertasCaso(caso, protocolo, { mapaEstados });
};

/** Alertas del ajustador logueado (login = cédula/código en codiRespnsble). */
export const obtenerMisAlertasPorLogin = async (login, nombreUsuario = '') => {
  const protocolo = await obtenerProtocoloActivo();
  const mapaEstados = await cargarMapaEstados();
  const loginNorm = String(login || '').trim();
  const nombreNorm = String(nombreUsuario || '').trim().toLowerCase();

  const todosLosCasos = await Complex.find(FILTRO_CASOS_ACTIVOS_ALERTAS);

  const casos = todosLosCasos.filter((caso) => {
    if (!debeRecibirAlertas(caso) || casoExcluidoDeAlertas(caso)) return false;
    const codigo = String(caso.codiRespnsble || '').trim();
    if (loginNorm && codigo === loginNorm) return true;
    const nombreCaso = String(caso.nombreResponsable || caso.responsable || '').trim().toLowerCase();
    if (nombreNorm && nombreCaso && nombreCaso === nombreNorm) return true;
    return false;
  });

  const casosConAlertas = casos
    .map((caso) => generarAlertasCaso(caso, protocolo, { alcance: 'ajustador', mapaEstados }))
    .filter((c) => c.totalAlertas > 0)
    .sort((a, b) => b.prioridadMaxima - a.prioridadMaxima);

  return {
    login: loginNorm,
    totalCasos: casos.length,
    casosConAlertas: casosConAlertas.length,
    totalAlertas: casosConAlertas.reduce((sum, c) => sum + c.totalAlertas, 0),
    casos: casosConAlertas,
  };
};

/** Alertas de un caso por número de ajuste o _id */
export const obtenerAlertasDeCaso = async (identificador) => {
  const protocolo = await obtenerProtocoloActivo();
  const mapaEstados = await cargarMapaEstados();
  let caso = await Complex.findOne({ nmroAjste: identificador });
  if (!caso && identificador?.length === 24) {
    caso = await Complex.findById(identificador);
  }
  if (!caso) return null;
  return generarAlertasCaso(caso, protocolo, { mapaEstados });
};

// Función para enviar alertas por email a un ajustador
// opciones.forzar = true → envío manual (pruebas / botón UI), ignora intervalo de 30 días
export const enviarAlertasEmail = async (codigoResponsable, opciones = {}) => {
  try {
    const forzar = opciones.forzar === true;
    console.log('📧 Enviando alertas por email a:', codigoResponsable, forzar ? '(forzado)' : '');
    
    // Obtener alertas del ajustador
    const alertas = await obtenerAlertasAjustador(codigoResponsable);
    
    if (alertas.casosConAlertas === 0) {
      console.log('✅ No hay alertas para enviar');
      return { success: true, message: 'No hay alertas para enviar', omitido: false };
    }
    
    // Obtener información del responsable
    const responsable = await Responsable.findOne({ codiRespnsble: codigoResponsable });
    if (!responsable || !responsable.email) {
      console.log('❌ No se encontró email del responsable');
      return { success: false, message: 'Email del responsable no encontrado' };
    }

    if (!forzar && !debeEnviarRecordatorioEmail(responsable)) {
      const diasDesde = diasCalendarioEntreFechas(responsable.fchaUltimoRecordatorioAlertas);
      console.log(
        `⏭️ Omitiendo correo a ${codigoResponsable}: último recordatorio hace ${diasDesde} día(s) (mínimo ${DIAS_ENTRE_RECORDATORIOS_EMAIL})`
      );
      return {
        success: true,
        omitido: true,
        message: `Recordatorio omitido: se reenvía cada ${DIAS_ENTRE_RECORDATORIOS_EMAIL} días`,
        diasDesdeUltimo: diasDesde,
      };
    }
    
    // Preparar datos para el email
    // IMPORTANTE: Los recordatorios SOLO se envían al responsable asignado
    // Los campos emailQuienAsigna y otros son solo informativos, NO se usan para enviar emails
    const datosEmail = {
      numeroCaso: `ALERTAS-${codigoResponsable}`,
      nombreResponsable: responsable.nmbrRespnsble || codigoResponsable,
      emailResponsable: responsable.email, // SOLO este email recibirá el recordatorio
      aseguradora: 'Sistema de Alertas',
      asegurado: 'Ajustador',
      fechaAsignacion: new Date().toLocaleDateString(),
      quienAsigna: 'Sistema de Alertas',
      emailQuienAsigna: 'sistema@proserpuertos.com.co', // Solo informativo, NO se envía email aquí
      observaciones: `Tienes ${alertas.casosConAlertas} casos con alertas pendientes`,
      alertas: alertas
    };
    
    // Enviar email
    const resultado = await enviarEmailAlertas(datosEmail);

    if (resultado?.success !== false) {
      await Responsable.updateOne(
        { _id: responsable._id },
        { $set: { fchaUltimoRecordatorioAlertas: new Date() } }
      );
    }
    
    console.log('✅ Alertas enviadas por email:', resultado);
    return { success: true, omitido: false, resultado };
    
  } catch (error) {
    console.error('❌ Error enviando alertas por email:', error);
    throw error;
  }
};

// Función para enviar alertas a todos los ajustadores (cron automático: respeta cada 30 días)
export const enviarAlertasTodosAjustadores = async (opciones = {}) => {
  try {
    console.log('📧 Enviando alertas a todos los ajustadores...');
    
    const alertasGenerales = await obtenerAlertasTodosAjustadores();
    const resultados = [];
    
    for (const ajustador of alertasGenerales.ajustadores) {
      try {
        const resultado = await enviarAlertasEmail(ajustador.ajustador, opciones);
        resultados.push({
          ajustador: ajustador.ajustador,
          success: resultado.success,
          omitido: Boolean(resultado.omitido),
          message: resultado.message
        });
      } catch (error) {
        console.error(`❌ Error enviando alertas a ${ajustador.ajustador}:`, error);
        resultados.push({
          ajustador: ajustador.ajustador,
          success: false,
          omitido: false,
          message: error.message
        });
      }
    }
    
    console.log('✅ Proceso de envío de alertas completado');
    return {
      success: true,
      totalEnviados: resultados.filter(r => r.success && !r.omitido).length,
      totalOmitidos: resultados.filter(r => r.omitido).length,
      totalErrores: resultados.filter(r => !r.success).length,
      resultados
    };
    
  } catch (error) {
    console.error('❌ Error enviando alertas a todos los ajustadores:', error);
    throw error;
  }
};
