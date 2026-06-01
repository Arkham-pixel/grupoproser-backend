import Complex from '../models/Complex.js';
import Responsable from '../models/Responsable.js';
import { enviarEmailAlertas } from './emailService.js';

// Fecha límite: Solo casos agregados desde octubre de 2025 en adelante recibirán alertas
const FECHA_LIMITE_ALERTAS = new Date('2025-10-01T00:00:00.000Z');

// Configuración de recordatorios por días de inactividad
// El sistema envía alertas en estos intervalos:
// - 5 días: Primera alerta
// - 7 días: Segunda alerta
// - 15 días: Tercera alerta
// - 30 días: Cuarta alerta
// - Después de 30 días: Insistir con alertas continuamente hasta que el caso se cierre
const DIAS_RECORDATORIOS = [5, 7, 15, 30];

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
    { campo: 'anxoHonorarios', nombre: 'Honorarios', obligatorio: false, campoFecha: null } // Honorarios no tiene fecha específica
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

    const tieneDocumento = caso[doc.campo] && caso[doc.campo].trim() !== '';
    // IMPORTANTE: Si tiene campoFecha, verificar si tiene fecha asignada
    // Si NO tiene campoFecha (como Honorarios), considerar que siempre tiene fecha (no genera alerta)
    const tieneFecha = doc.campoFecha ? (caso[doc.campoFecha] && caso[doc.campoFecha] !== null && caso[doc.campoFecha] !== '') : true;
    
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

// Función para calcular tiempos entre documentos según la nueva lógica
// Retorna alertas específicas para cada tipo de documento basándose en su fecha de referencia
export const calcularTiemposEntreDocumentos = (caso) => {
  const alertasTiempo = [];
  const ahora = new Date();
  
  // Función auxiliar para parsear fechas
  const parsearFecha = (fechaStr) => {
    if (!fechaStr) return null;
    if (fechaStr instanceof Date) return fechaStr;
    if (typeof fechaStr === 'string' && fechaStr.includes('T')) {
      const [fechaPart] = fechaStr.split('T');
      const [year, month, day] = fechaPart.split('-');
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    if (typeof fechaStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fechaStr)) {
      const [year, month, day] = fechaStr.split('-');
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    const fecha = new Date(fechaStr);
    return isNaN(fecha.getTime()) ? null : fecha;
  };

  // Función para obtener fecha de referencia según el tipo
  const obtenerFechaReferencia = (tipo) => {
    switch (tipo) {
      case 'contactoInicial':
      case 'inspeccion':
        return parsearFecha(caso.fchaAsgncion);
      case 'solicitudDocs':
      case 'informePreliminar':
        return parsearFecha(caso.fchaInspccion);
      case 'informeFinal':
        return parsearFecha(caso.fchaInfoPrelm);
      case 'ultimoDocumento':
        return parsearFecha(caso.fchaInfoFnal);
      case 'presentacionCifras':
      case 'envioFiniquito':
        return parsearFecha(caso.fchaRepoActi);
      default:
        return null;
    }
  };

  // Definición de documentos con sus tiempos límite
  const documentosConfig = [
    {
      tipo: 'contactoInicial',
      nombre: 'Contacto Inicial',
      campoFecha: 'fchaContIni',
      campoDoc: 'anexContIni',
      tiempoLimiteHoras: 12,
      tiempoLimiteDias: 0.5
    },
    {
      tipo: 'inspeccion',
      nombre: 'Inspección',
      campoFecha: 'fchaInspccion',
      campoDoc: 'anexActaInspccion',
      tiempoLimiteHoras: 12,
      tiempoLimiteDias: 0.5
    },
    {
      tipo: 'solicitudDocs',
      nombre: 'Solicitud de Documentos',
      campoFecha: 'fchaSoliDocu',
      campoDoc: 'anexSolDoc',
      tiempoLimiteHoras: 24,
      tiempoLimiteDias: 1
    },
    {
      tipo: 'informePreliminar',
      nombre: 'Informe Preliminar',
      campoFecha: 'fchaInfoPrelm',
      campoDoc: 'anxoInfPrelim',
      tiempoLimiteHoras: 24,
      tiempoLimiteDias: 1
    },
    {
      tipo: 'informeFinal',
      nombre: 'Informe Final',
      campoFecha: 'fchaInfoFnal',
      campoDoc: 'anxoInfoFnal',
      tiempoLimiteHoras: 72,
      tiempoLimiteDias: 3
    },
    {
      tipo: 'ultimoDocumento',
      nombre: 'Último Documento',
      campoFecha: 'fchaRepoActi',
      campoDoc: 'anxoRepoActi',
      tiempoLimiteHoras: 72,
      tiempoLimiteDias: 3
    },
    {
      tipo: 'presentacionCifras',
      nombre: 'Presentación de Cifras',
      campoFecha: 'fchaPresentacionCifras',
      campoDoc: 'anxoPresentacionCifras',
      tiempoLimiteHoras: 24,
      tiempoLimiteDias: 1
    },
    {
      tipo: 'envioFiniquito',
      nombre: 'Envío de Finiquito',
      campoFecha: 'fchaEnvioFiniquito',
      campoDoc: 'anxoEnvioFiniquito',
      tiempoLimiteHoras: 24,
      tiempoLimiteDias: 1
    }
  ];

  documentosConfig.forEach(doc => {
    if (informeFinalCompletoEtapaAjustador(caso) && (doc.tipo === 'presentacionCifras' || doc.tipo === 'envioFiniquito')) {
      return;
    }

    const fechaReferencia = obtenerFechaReferencia(doc.tipo);
    if (!fechaReferencia) return; // No hay fecha de referencia, no se puede calcular

    const fechaDocumento = parsearFecha(caso[doc.campoFecha]);
    const tieneDocumento = caso[doc.campoDoc] && caso[doc.campoDoc].trim() !== '';

    // IMPORTANTE: Si tiene fecha Y documento, no generar alerta (ya está completado)
    // Las alertas se detienen cuando se suben ambos (fecha y documento)
    if (fechaDocumento && tieneDocumento) {
      return; // Completado, no generar alerta
    }

    // Calcular tiempo transcurrido desde la fecha de referencia
    const fechaCalculo = ahora; // Siempre calcular desde ahora si no hay fecha de documento
    const diferenciaTiempo = fechaCalculo.getTime() - fechaReferencia.getTime();
    const diferenciaHoras = diferenciaTiempo / (1000 * 3600);
    const diferenciaDias = diferenciaHoras / 24;

    // Calcular retraso
    const horasRetraso = diferenciaHoras > doc.tiempoLimiteHoras ? diferenciaHoras - doc.tiempoLimiteHoras : 0;
    const diasRetraso = diferenciaDias > doc.tiempoLimiteDias ? diferenciaDias - doc.tiempoLimiteDias : 0;

    // Si hay retraso o está cerca del límite, generar alerta
    if (horasRetraso > 0 || diferenciaHoras >= doc.tiempoLimiteHoras * 0.8) {
      let prioridad = horasRetraso > 0 ? 'ALTA' : 'MEDIA';
      let mensaje = '';
      
      if (horasRetraso > 0) {
        if (doc.tiempoLimiteHoras <= 24) {
          mensaje = `🚨 Retraso: ${doc.nombre} debería haberse completado hace ${Math.round(horasRetraso)} horas`;
        } else {
          mensaje = `🚨 Retraso: ${doc.nombre} debería haberse completado hace ${Math.round(diasRetraso)} días`;
        }
      } else {
        const horasRestantes = doc.tiempoLimiteHoras - diferenciaHoras;
        if (doc.tiempoLimiteHoras <= 24) {
          mensaje = `⏰ Pendiente: ${doc.nombre} debe completarse en ${Math.round(horasRestantes)} horas`;
        } else {
          mensaje = `⏰ Pendiente: ${doc.nombre} debe completarse en ${Math.round((doc.tiempoLimiteDias - diferenciaDias) * 24)} horas`;
        }
      }

      alertasTiempo.push({
        tipo: `TIEMPO_${doc.tipo.toUpperCase()}`,
        nombre: doc.nombre,
        prioridad,
        mensaje,
        accion: `Completar ${doc.nombre} o asignar fecha`,
        horasTranscurridas: diferenciaHoras,
        horasLimite: doc.tiempoLimiteHoras,
        horasRetraso: horasRetraso,
        diasRetraso: diasRetraso,
        tieneFecha: !!fechaDocumento,
        tieneDocumento: tieneDocumento
      });
    }
  });

  return alertasTiempo;
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
  const fechasConDocumentos = [
    { campo: 'fchaContIni', nombre: 'Contacto Inicial', campoDoc: 'anexContIni' },
    { campo: 'fchaInspccion', nombre: 'Inspección', campoDoc: 'anexActaInspccion' },
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
  
  if (diasTranscurridos > 30) {
    // Después de 30 días, siempre enviar alerta (insistir continuamente)
    // Esto se ejecuta cada vez que el cron corre hasta que el caso se cierre
    debeEnviarAlerta = true;
    nivelRecordatorio = 'CONTINUO';
  } else if (diasTranscurridos === 30) {
    // Exactamente 30 días: Cuarto recordatorio
    debeEnviarAlerta = true;
    nivelRecordatorio = 4;
  } else if (diasTranscurridos === 15) {
    // Exactamente 15 días: Tercer recordatorio
    debeEnviarAlerta = true;
    nivelRecordatorio = 3;
  } else if (diasTranscurridos === 7) {
    // Exactamente 7 días: Segundo recordatorio
    debeEnviarAlerta = true;
    nivelRecordatorio = 2;
  } else if (diasTranscurridos === 5) {
    // Exactamente 5 días: Primer recordatorio
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
export const generarAlertasCaso = (caso) => {
  // Verificar si el caso debe recibir alertas (solo casos desde octubre 2025)
  if (!debeRecibirAlertas(caso)) {
    // Retornar objeto vacío para casos que no deben recibir alertas
    return {
      casoId: caso._id,
      numeroAjuste: caso.nmroAjste,
      numeroSiniestro: caso.nmroSinstro,
      aseguradora: caso.codiAsgrdra,
      asegurado: caso.asgrBenfcro,
      estado: caso.codiEstdo,
      fechaAsignacion: caso.fchaAsgncion,
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
        totalObligatoriosFaltantes: 0
      },
      intensidadAdicional: {
        documentosSubidos: [],
        totalDocumentosSubidos: 0,
        totalDocumentosObligatoriosSubidos: 0,
        porcentajeObligatoriosSubidos: 0,
        porcentajeTotalSubidos: 0,
        mensaje: 'Sin documentos verificados',
        reduceIntensidad: false
      },
      inactividad: { dias: null, actividad: 'Sin verificación', estado: 'NORMAL' },
      alertas: [],
      totalAlertas: 0,
      prioridadMaxima: 0
    };
  }
  
  const documentosInfo = verificarDocumentosFaltantes(caso);
  const documentosFaltantes = documentosInfo.faltantes;
  const documentosSubidos = documentosInfo.subidos;
  const inactividad = calcularDiasInactividad(caso);
  const alertasTiempoDocumentos = calcularTiemposEntreDocumentos(caso);
  
  const alertas = [];
  
  // Agregar alertas de tiempos entre documentos
  alertasTiempoDocumentos.forEach(alertaTiempo => {
    alertas.push({
      tipo: alertaTiempo.tipo,
      prioridad: alertaTiempo.prioridad,
      mensaje: alertaTiempo.mensaje,
      accion: alertaTiempo.accion,
      color: alertaTiempo.prioridad === 'ALTA' ? 'red' : 'orange',
      horasTranscurridas: alertaTiempo.horasTranscurridas,
      horasLimite: alertaTiempo.horasLimite,
      horasRetraso: alertaTiempo.horasRetraso
    });
  });

  // Calcular factor de reducción de intensidad basado en documentos subidos
  // Si todos los documentos obligatorios están subidos, reducir significativamente la intensidad
  const porcentajeObligatoriosSubidos = documentosInfo.totalObligatorios > 0 
    ? (documentosInfo.totalObligatoriosSubidos / documentosInfo.totalObligatorios) * 100 
    : 0;
  const porcentajeTotalSubidos = documentosInfo.totalRequeridos > 0
    ? (documentosInfo.totalSubidos / documentosInfo.totalRequeridos) * 100
    : 0;

  // Alertas por documentos faltantes (con intensidad reducida si hay documentos subidos)
  // IMPORTANTE: Solo generar alertas para documentos que NO tienen fecha asignada
  // Si un documento tiene fecha, se considera completado y NO genera alerta
  documentosFaltantes.forEach(doc => {
    // Verificar si tiene fecha asignada (si tiene campoFecha)
    const tieneFecha = doc.campoFecha && caso[doc.campoFecha] && caso[doc.campoFecha] !== null && caso[doc.campoFecha] !== '';
    
    // Si tiene fecha, NO generar alerta (el documento se considera completado)
    if (tieneFecha) {
      return; // Saltar este documento, no generar alerta
    }
    
    // Reducir prioridad si hay documentos subidos
    let prioridad = doc.obligatorio ? 'ALTA' : 'MEDIA';
    let color = doc.obligatorio ? 'red' : 'orange';
    
    // Si hay documentos obligatorios subidos, reducir la intensidad de las alertas
    if (documentosInfo.totalObligatoriosSubidos > 0) {
      if (porcentajeObligatoriosSubidos >= 80) {
        // Si el 80% o más de obligatorios están subidos, reducir prioridad
        if (prioridad === 'ALTA') prioridad = 'MEDIA';
        if (color === 'red') color = 'orange';
      } else if (porcentajeObligatoriosSubidos >= 50) {
        // Si el 50% o más están subidos, mantener pero con mensaje menos urgente
        if (prioridad === 'ALTA') prioridad = 'MEDIA';
      }
    }
    
    if (doc.obligatorio) {
      alertas.push({
        tipo: 'DOCUMENTO_OBLIGATORIO',
        prioridad,
        mensaje: `⚠️ Falta documento obligatorio: ${doc.nombre}`,
        accion: `Subir ${doc.nombre} o asignar fecha`,
        color,
        intensidadReducida: documentosInfo.totalObligatoriosSubidos > 0
      });
    } else {
      alertas.push({
        tipo: 'DOCUMENTO_OPCIONAL',
        prioridad,
        mensaje: `📄 Documento pendiente: ${doc.nombre}`,
        accion: `Considerar subir ${doc.nombre} o asignar fecha`,
        color,
        intensidadReducida: documentosInfo.totalSubidos > 0
      });
    }
  });

  // Alertas por inactividad según sistema de recordatorios
  // Solo enviar alerta si debeEnviarAlerta es true (según los umbrales de días)
  if (inactividad.debeEnviarAlerta) {
    let mensaje = '';
    let prioridad = 'MEDIA';
    let tipo = 'INACTIVIDAD';
    
    if (inactividad.nivelRecordatorio === 'CONTINUO') {
      // Después de 30 días: insistir continuamente
      mensaje = `🚨 URGENTE: Caso sin actividad por ${inactividad.dias} días. Se requiere atención inmediata.`;
      prioridad = 'ALTA';
      tipo = 'INACTIVIDAD_CRITICA_CONTINUA';
    } else if (inactividad.nivelRecordatorio === 1) {
      // Primer recordatorio: 5 días
      mensaje = `⏰ Recordatorio 1: Caso sin actividad por ${inactividad.dias} días`;
      prioridad = 'MEDIA';
      tipo = 'INACTIVIDAD_RECORDATORIO_1';
    } else if (inactividad.nivelRecordatorio === 2) {
      // Segundo recordatorio: 7 días
      mensaje = `⚠️ Recordatorio 2: Caso sin actividad por ${inactividad.dias} días`;
      prioridad = 'MEDIA';
      tipo = 'INACTIVIDAD_RECORDATORIO_2';
    } else if (inactividad.nivelRecordatorio === 3) {
      // Tercer recordatorio: 15 días
      mensaje = `🔔 Recordatorio 3: Caso sin actividad por ${inactividad.dias} días`;
      prioridad = 'ALTA';
      tipo = 'INACTIVIDAD_RECORDATORIO_3';
    } else if (inactividad.nivelRecordatorio === 4) {
      // Cuarto recordatorio: 30 días
      mensaje = `🚨 Recordatorio 4: Caso sin actividad por ${inactividad.dias} días`;
      prioridad = 'ALTA';
      tipo = 'INACTIVIDAD_RECORDATORIO_4';
    } else {
      // Fallback para casos sin actividad registrada
      mensaje = `🚨 Caso sin actividad registrada`;
      prioridad = 'ALTA';
      tipo = 'INACTIVIDAD_SIN_REGISTRO';
    }
    
    alertas.push({
      tipo,
      prioridad,
      mensaje,
      accion: inactividad.nivelRecordatorio === 'CONTINUO' 
        ? 'Actualizar caso inmediatamente - Recordatorio continuo activo'
        : 'Revisar y actualizar caso',
      color: inactividad.nivelRecordatorio === 'CONTINUO' || inactividad.nivelRecordatorio >= 3 ? 'red' : 'orange',
      diasInactividad: inactividad.dias,
      nivelRecordatorio: inactividad.nivelRecordatorio
    });
  }

  // Alertas por fechas vencidas (no insistir al ajustador si ya cerró etapa con informe final completo)
  const hoy = new Date();
  if (caso.fchaAsgncion && !informeFinalCompletoEtapaAjustador(caso)) {
    const fechaAsignacion = new Date(caso.fchaAsgncion);
    const diasDesdeAsignacion = Math.floor((hoy - fechaAsignacion) / (1000 * 60 * 60 * 24));
    if (diasDesdeAsignacion > 60) {
      alertas.push({
        tipo: 'CASO_ANTIGUO',
        prioridad: 'ALTA',
        mensaje: `📅 Caso asignado hace ${diasDesdeAsignacion} días`,
        accion: 'Revisar estado y prioridad',
        color: 'red'
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

  return {
    casoId: caso._id,
    numeroAjuste: caso.nmroAjste,
    numeroSiniestro: caso.nmroSinstro,
    aseguradora: caso.codiAsgrdra,
    asegurado: caso.asgrBenfcro,
    estado: caso.codiEstdo,
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
    
    // Obtener solo casos NO finalizados del ajustador
    // Estados finalizados: 4 (FINALIZADO), 5 (CANCELADO), 6 (ARCHIVADO)
    // Solo enviar alertas para casos que requieren seguimiento
    const todosLosCasos = await Complex.find({ 
      codiRespnsble: codigoResponsable,
      codiEstdo: { $nin: [4, 5, 6] } // Excluir estados finalizados
    });
    
    // IMPORTANTE: Filtrar solo casos creados desde octubre 2025
    // Los casos viejos no deben recibir alertas
    const casos = todosLosCasos.filter(caso => debeRecibirAlertas(caso));
    
    console.log(`📊 Casos activos encontrados para ${codigoResponsable}: ${todosLosCasos.length}`);
    console.log(`📅 Casos elegibles para alertas (desde octubre 2025): ${casos.length}`);
    console.log(`🚫 Casos finalizados excluidos (estados 4, 5, 6)`);
    console.log(`🚫 Casos viejos excluidos (anteriores a octubre 2025): ${todosLosCasos.length - casos.length}`);
    
    // Generar alertas para cada caso (la función generarAlertasCaso también verifica la fecha como doble verificación)
    const alertasGeneradas = casos.map(caso => generarAlertasCaso(caso));
    
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
    
    // Obtener todos los casos activos (no finalizados)
    const todosLosCasos = await Complex.find({ 
      codiEstdo: { $nin: [4, 5, 6] } // Solo casos NO finalizados
    });
    
    // IMPORTANTE: Filtrar solo casos creados desde octubre 2025
    // Los casos viejos no deben recibir alertas
    const casosElegibles = todosLosCasos.filter(caso => debeRecibirAlertas(caso));
    
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

// Función para enviar alertas por email a un ajustador
export const enviarAlertasEmail = async (codigoResponsable) => {
  try {
    console.log('📧 Enviando alertas por email a:', codigoResponsable);
    
    // Obtener alertas del ajustador
    const alertas = await obtenerAlertasAjustador(codigoResponsable);
    
    if (alertas.casosConAlertas === 0) {
      console.log('✅ No hay alertas para enviar');
      return { success: true, message: 'No hay alertas para enviar' };
    }
    
    // Obtener información del responsable
    const responsable = await Responsable.findOne({ codiRespnsble: codigoResponsable });
    if (!responsable || !responsable.email) {
      console.log('❌ No se encontró email del responsable');
      return { success: false, message: 'Email del responsable no encontrado' };
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
    
    console.log('✅ Alertas enviadas por email:', resultado);
    return { success: true, resultado };
    
  } catch (error) {
    console.error('❌ Error enviando alertas por email:', error);
    throw error;
  }
};

// Función para enviar alertas a todos los ajustadores
export const enviarAlertasTodosAjustadores = async () => {
  try {
    console.log('📧 Enviando alertas a todos los ajustadores...');
    
    const alertasGenerales = await obtenerAlertasTodosAjustadores();
    const resultados = [];
    
    for (const ajustador of alertasGenerales.ajustadores) {
      try {
        const resultado = await enviarAlertasEmail(ajustador.ajustador);
        resultados.push({
          ajustador: ajustador.ajustador,
          success: resultado.success,
          message: resultado.message
        });
      } catch (error) {
        console.error(`❌ Error enviando alertas a ${ajustador.ajustador}:`, error);
        resultados.push({
          ajustador: ajustador.ajustador,
          success: false,
          message: error.message
        });
      }
    }
    
    console.log('✅ Proceso de envío de alertas completado');
    return {
      success: true,
      totalEnviados: resultados.filter(r => r.success).length,
      totalErrores: resultados.filter(r => !r.success).length,
      resultados
    };
    
  } catch (error) {
    console.error('❌ Error enviando alertas a todos los ajustadores:', error);
    throw error;
  }
};
