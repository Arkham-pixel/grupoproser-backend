/**
 * Utilidades para evaluar plazos del protocolo de siniestros COMPLEX.
 */

import {
  GRACIA_ESPERA_EXTERNA_DIAS_HABILES,
  ALERTAS_ESPERA_EXTERNA_DEFAULT,
} from '../config/protocoloSiniestrosDefaults.js';
import { diasHabilesColombiaEntre, esDiaHabilColombia } from '../utils/festivosColombia.js';
import { MAPEO_TIPO_HISTORIAL_A_COMPLEX } from '../config/ajusteTrazabilidadComplexMap.js';

export function parsearFechaProtocolo(valor) {
  return parsearFechaHoraProtocolo(valor);
}

export function parsearFechaSoloDiaProtocolo(valor) {
  const fecha = parsearFechaHoraProtocolo(valor);
  if (!fecha) return null;
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

export function parsearFechaHoraProtocolo(valor) {
  if (!valor) return null;

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return new Date(valor.getTime());
  }

  const str = String(valor).trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
    const [datePart, timePart] = str.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    if (year && month && day) {
      return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
    }
  }

  if (str.includes('T')) {
    const fecha = new Date(str);
    if (!Number.isNaN(fecha.getTime())) return fecha;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [year, month, day] = str.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [year, month, day] = str.split('-').map(Number);
    if (year && month && day) {
      return new Date(year, month - 1, day, 12, 0, 0, 0);
    }
  }

  const fecha = new Date(str);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export function esDiaHabil(fecha) {
  return esDiaHabilColombia(fecha);
}

export function diasHabilesEntre(inicio, fin) {
  return diasHabilesColombiaEntre(inicio, fin);
}

export function diasCalendarioEntre(inicio, fin) {
  const a = parsearFechaProtocolo(inicio);
  const b = parsearFechaProtocolo(fin);
  if (!a || !b) return null;
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

export function horasEntre(inicio, fin) {
  const a = parsearFechaProtocolo(inicio);
  const b = parsearFechaProtocolo(fin);
  if (!a || !b) return null;
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60);
}

export function limiteAHoras(limite) {
  if (!limite || limite.valor == null) return null;
  switch (limite.unidad) {
    case 'horas':
      return limite.valor;
    case 'dias':
      return limite.valor * 24;
    case 'dias_habiles':
      return limite.valor * 24;
    default:
      return limite.valor * 24;
  }
}

export function etiquetaLimite(limite) {
  if (!limite) return '';
  const { valor, unidad } = limite;
  if (unidad === 'mismo_dia') return 'mismo día de la inspección';
  if (unidad === 'horas') return `${valor} hora${valor !== 1 ? 's' : ''}`;
  if (unidad === 'dias_habiles') return `${valor} día${valor !== 1 ? 's' : ''} hábil${valor !== 1 ? 'es' : ''}`;
  return `${valor} día${valor !== 1 ? 's' : ''}`;
}

function mismoDiaCalendario(a, b) {
  const inicio = parsearFechaSoloDiaProtocolo(a);
  const fin = parsearFechaSoloDiaProtocolo(b);
  if (!inicio || !fin) return null;
  return (
    inicio.getFullYear() === fin.getFullYear() &&
    inicio.getMonth() === fin.getMonth() &&
    inicio.getDate() === fin.getDate()
  );
}

function campoTieneValor(caso, campo) {
  if (!campo) return false;
  const valor = caso[campo];
  return valor != null && String(valor).trim() !== '';
}

/** Tipo en historialDocs que satisface el entregable de cada etapa del protocolo. */
const ETAPA_ID_A_TIPO_HISTORIAL = {
  contactoInicial: 'contactoInicial',
  inspeccion: 'inspeccion',
  actaInspeccion: 'inspeccion',
  solicitudDocs: 'solicitudDocs',
  informePreliminar: 'informePreliminar',
  acreditacion: 'ultimoDocumento',
  informeFinal: 'informeFinal',
  autorizacionCifras: 'seguimientoAutorizacionCompania',
  presentacionCifras: 'presentacionCifras',
  envioFiniquito: 'envioFiniquito',
};

export { MAPEO_TIPO_HISTORIAL_A_COMPLEX };

export function tieneDocumentoEnHistorialDocs(caso, tipoHistorial) {
  if (!tipoHistorial || !Array.isArray(caso?.historialDocs)) return false;
  return caso.historialDocs.some((doc) => {
    if (!doc) return false;
    const tipo = String(doc.tipo || doc.categoria || '').trim();
    if (tipo !== tipoHistorial) return false;
    return Boolean(String(doc.ruta || doc.url || doc.nombre || '').trim());
  });
}

function casoTieneDocumentoEtapa(caso, etapa) {
  if (etapa.campoDoc && campoTieneValor(caso, etapa.campoDoc)) return true;
  const tipoHistorial = ETAPA_ID_A_TIPO_HISTORIAL[etapa.id];
  return tieneDocumentoEnHistorialDocs(caso, tipoHistorial);
}

/** Inspección y acta pueden omitirse cuando el ajustador deja constancia. */
function etapaOmitidaPorNoAplica(caso, etapa) {
  if (!etapa?.id) return false;
  if (caso?.inspeccionNoAplica === true || caso?.inspeccionNoAplica === 'true') {
    if (etapa.id === 'inspeccion' || etapa.id === 'actaInspeccion') return true;
  }
  if (caso?.actaInspeccionNoAplica === true || caso?.actaInspeccionNoAplica === 'true') {
    if (etapa.id === 'actaInspeccion') return true;
  }
  return false;
}

/**
 * La inspección de campo se completa con la fecha del hito.
 * El acta es etapa aparte (y puede marcarse no aplica).
 * El resto sigue exigiendo documento si el protocolo lo define.
 */
function etapaRequiereDocumento(etapa) {
  if (!etapa?.campoDoc) return false;
  if (etapa.id === 'inspeccion') return false;
  return true;
}

function etapaCompletaPorCriterio(caso, etapa) {
  switch (etapa.criterioCompletitud) {
    case 'codiRespnsble':
      return campoTieneValor(caso, 'codiRespnsble');
    case 'presentacionYFiniquito': {
      const presentacion =
        campoTieneValor(caso, 'fchaPresentacionCifras') &&
        campoTieneValor(caso, 'anxoPresentacionCifras');
      const finiquito =
        campoTieneValor(caso, 'fchaEnvioFiniquito') &&
        campoTieneValor(caso, 'anxoEnvioFiniquito');
      return presentacion && finiquito;
    }
    default:
      return null;
  }
}

export function etapaEstaCompleta(caso, etapa) {
  if (etapaOmitidaPorNoAplica(caso, etapa)) return true;

  const porCriterio = etapaCompletaPorCriterio(caso, etapa);
  if (porCriterio != null) return porCriterio;

  if (!etapa.campoFecha) return false;
  const tieneFecha = campoTieneValor(caso, etapa.campoFecha);
  if (!tieneFecha) return false;
  if (!etapaRequiereDocumento(etapa)) return true;
  return casoTieneDocumentoEtapa(caso, etapa);
}

/**
 * Avance de una etapa posterior: basta con la fecha del hito
 * (en varios casos solo radican fecha y no adjuntan soporte).
 */
function etapaTieneAvanceRegistrado(caso, etapa) {
  if (!etapa) return false;
  if (etapaOmitidaPorNoAplica(caso, etapa)) return true;
  if (etapaEstaCompleta(caso, etapa)) return true;
  if (etapa.campoFecha && campoTieneValor(caso, etapa.campoFecha)) return true;
  return false;
}

/**
 * Si el caso ya avanzó a una etapa posterior (aunque solo tenga fecha),
 * no se alertan hitos anteriores (contacto, acta, inspección, etc.).
 */
function etapaSuperadaPorAvance(caso, etapa, protocolo) {
  if (!etapa?.id) return false;
  const fases = Number(etapa.fase);
  if (!Number.isFinite(fases)) return false;

  const etapas = protocolo?.etapas || [];
  return etapas.some((otra) => {
    if (!otra || otra.id === etapa.id) return false;
    const faseOtra = Number(otra.fase);
    if (!Number.isFinite(faseOtra) || faseOtra <= fases) return false;
    if (otra.dependenciaExterna) return false;
    if (otra.alertaVencimiento === false && !otra.campoFecha) return false;
    return etapaTieneAvanceRegistrado(caso, otra);
  });
}

function etapaTieneFechaHito(caso, etapa) {
  if (!etapa?.campoFecha) return false;
  return campoTieneValor(caso, etapa.campoFecha);
}

function etapaAplicaAlcance(etapa, alcance = 'todos') {
  if (alcance === 'todos') return true;
  const etapaAlcance = etapa.alcance || 'ajustador';
  if (alcance === 'ajustador') return etapaAlcance === 'ajustador' || etapaAlcance === 'todos';
  if (alcance === 'soporte') return etapaAlcance === 'soporte' || etapaAlcance === 'todos';
  return true;
}

function medirTranscurrido(referencia, hasta, unidad) {
  if (unidad === 'mismo_dia') {
    return mismoDiaCalendario(referencia, hasta) ? 0 : 1;
  }
  if (unidad === 'dias_habiles') {
    return diasHabilesEntre(referencia, hasta);
  }
  if (unidad === 'horas') {
    return horasEntre(referencia, hasta);
  }
  return diasCalendarioEntre(referencia, hasta);
}

function medirLimite(limite) {
  return limite.valor;
}

function obtenerGraciaDiasHabiles(protocolo, item) {
  if (item?.graciaDiasHabiles != null) return item.graciaDiasHabiles;
  if (protocolo?.graciaEsperaExternaDiasHabiles != null) {
    return protocolo.graciaEsperaExternaDiasHabiles;
  }
  return GRACIA_ESPERA_EXTERNA_DIAS_HABILES;
}

function resolverFechaReferenciaEtapa(caso, etapa) {
  const principal = parsearFechaProtocolo(caso[etapa.referencia]);
  if (principal) return principal;
  if (etapa.referenciaAlternativa) {
    return parsearFechaProtocolo(caso[etapa.referenciaAlternativa]);
  }
  return null;
}

function esperaExternaEstaCompleta(caso, espera) {
  if (Array.isArray(espera.camposCompletitud)) {
    return espera.camposCompletitud.some((campo) => campoTieneValor(caso, campo));
  }
  return false;
}

export function evaluarEsperaExterna(caso, espera, ahora = new Date(), protocolo = null) {
  if (!espera) return null;
  if (espera.requiereCampo && !campoTieneValor(caso, espera.requiereCampo)) return null;

  const fechaReferencia = parsearFechaProtocolo(caso[espera.referencia]);
  if (!fechaReferencia) return null;
  if (esperaExternaEstaCompleta(caso, espera)) return null;

  const gracia = obtenerGraciaDiasHabiles(protocolo, espera);
  const diasHabiles = diasHabilesEntre(fechaReferencia, ahora);
  if (diasHabiles == null || diasHabiles < gracia) return null;

  const prioridad = diasHabiles >= gracia * 2 ? 'ALTA' : 'MEDIA';

  return {
    esperaExternaId: espera.id,
    etapaId: espera.id,
    nombre: espera.nombre,
    fase: espera.fase,
    prioridad,
    mensaje: espera.mensaje || `Espera externa: ${espera.nombre}`,
    accion: espera.accion || `Registrar avance en ${espera.nombre}`,
    diasHabilesTranscurridos: diasHabiles,
    graciaDiasHabiles: gracia,
    etiquetaLimite: `${gracia} días hábiles`,
    tipo: `ESPERA_${String(espera.id).toUpperCase()}`,
  };
}

export function evaluarEtapaProtocolo(caso, etapa, ahora = new Date(), alcance = 'todos', protocolo = null) {
  if (!etapa?.limite || etapa.alertaVencimiento === false) return null;
  if (!etapaAplicaAlcance(etapa, alcance)) return null;
  if (etapaOmitidaPorNoAplica(caso, etapa)) return null;
  if (etapaSuperadaPorAvance(caso, etapa, protocolo)) return null;

  const fechaReferencia = resolverFechaReferenciaEtapa(caso, etapa);
  if (!fechaReferencia) return null;

  if (etapaEstaCompleta(caso, etapa)) return null;

  // Fecha ya radicada pero falta anexo: no inventar "miles de horas de retraso".
  // El plazo de tiempo se midió al registrar el hito; lo pendiente es el soporte.
  if (etapaTieneFechaHito(caso, etapa) && etapaRequiereDocumento(etapa)) {
    return {
      etapaId: etapa.id,
      nombre: etapa.nombre,
      fase: etapa.fase,
      prioridad: 'MEDIA',
      mensaje: `Falta soporte documental de ${etapa.nombre} (fecha ya registrada)`,
      transcurrido: 0,
      limite: 0,
      retraso: 0,
      horasLimite: limiteAHoras(etapa.limite),
      horasTranscurridas: 0,
      etiquetaLimite: etiquetaLimite(etapa.limite),
      tipo: `FALTA_SOPORTE_${String(etapa.id).toUpperCase()}`,
      accion:
        etapa.id === 'actaInspeccion'
          ? 'Adjuntar el acta o marcar «Acta no aplica» en trazabilidad'
          : `Adjuntar soporte de ${etapa.nombre}`,
    };
  }

  const transcurrido = medirTranscurrido(fechaReferencia, ahora, etapa.limite.unidad);
  const limite = medirLimite(etapa.limite);

  if (etapa.dependenciaExterna) {
    const gracia = obtenerGraciaDiasHabiles(protocolo, etapa);
    const diasHabiles = diasHabilesEntre(fechaReferencia, ahora);
    if (diasHabiles == null || diasHabiles < gracia) return null;

    const prioridad = diasHabiles >= gracia * 2 ? 'ALTA' : 'MEDIA';
    return {
      etapaId: etapa.id,
      nombre: etapa.nombre,
      fase: etapa.fase,
      prioridad,
      mensaje: `Espera externa en ${etapa.nombre}: ${diasHabiles} días hábiles sin avance (gracia ${gracia} días hábiles)`,
      transcurrido: diasHabiles,
      limite: gracia,
      retraso: Math.max(0, diasHabiles - gracia),
      horasLimite: gracia * 24,
      horasTranscurridas: horasEntre(fechaReferencia, ahora) || 0,
      etiquetaLimite: `${gracia} días hábiles`,
      tipo: `TIEMPO_${etapa.id.toUpperCase()}`,
      accion: `Dar seguimiento — ${etapa.nombre} (depende de terceros)`,
    };
  }

  const excedeLimite = transcurrido > limite;

  let excedeMaximo = false;
  let transcurridoMax = null;
  let limiteMax = null;
  if (etapa.limiteMaximo) {
    transcurridoMax = medirTranscurrido(fechaReferencia, ahora, etapa.limiteMaximo.unidad);
    limiteMax = medirLimite(etapa.limiteMaximo);
    excedeMaximo = transcurridoMax > limiteMax;
  }

  const enVentanaPrevia = !excedeLimite && transcurrido >= limite * 0.8;
  if (!excedeLimite && !excedeMaximo && !enVentanaPrevia) return null;

  let prioridad = 'MEDIA';
  if (excedeMaximo || excedeLimite) prioridad = 'ALTA';
  else if (enVentanaPrevia) prioridad = 'MEDIA';

  const unidadEtiqueta =
    etapa.limite.unidad === 'horas'
      ? 'horas'
      : etapa.limite.unidad === 'mismo_dia'
        ? 'día(s)'
        : 'días';
  const retraso = excedeLimite ? transcurrido - limite : 0;
  const mensaje = excedeLimite
    ? `Retraso en ${etapa.nombre}: excede el plazo de ${etiquetaLimite(etapa.limite)} (${Math.round(retraso)} ${unidadEtiqueta} de más)`
    : excedeMaximo
      ? `Retraso crítico en ${etapa.nombre}: supera el máximo de ${etiquetaLimite(etapa.limiteMaximo)}`
      : `Próximo vencimiento: ${etapa.nombre} (${etiquetaLimite(etapa.limite)})`;

  return {
    etapaId: etapa.id,
    nombre: etapa.nombre,
    fase: etapa.fase,
    prioridad,
    mensaje,
    transcurrido,
    limite,
    retraso: excedeLimite ? retraso : excedeMaximo ? transcurridoMax - limiteMax : 0,
    horasLimite: limiteAHoras(etapa.limite),
    horasTranscurridas: horasEntre(fechaReferencia, ahora) || 0,
    etiquetaLimite: etiquetaLimite(etapa.limite),
    tipo: `TIEMPO_${etapa.id.toUpperCase()}`,
    accion: `Completar ${etapa.nombre} o registrar fecha y soporte`,
  };
}

export function evaluarSeguimientoRecurrente(caso, seguimiento, ahora = new Date(), protocolo = null) {
  const fechaHasta = seguimiento.campoFechaHasta
    ? parsearFechaProtocolo(caso[seguimiento.campoFechaHasta])
    : null;
  if (fechaHasta) return null;

  const fechaRef = parsearFechaProtocolo(caso[seguimiento.referencia]);
  if (!fechaRef) return null;

  const gracia = obtenerGraciaDiasHabiles(protocolo, seguimiento);
  const usaGraciaExterna = seguimiento.dependenciaExterna !== false;
  const diasHabilesDesdeRef = diasHabilesEntre(fechaRef, ahora);

  if (usaGraciaExterna && (diasHabilesDesdeRef == null || diasHabilesDesdeRef < gracia)) {
    return null;
  }

  const historialTipo = seguimiento.historialTipo || null;
  let fechaUltimoSeguimiento = null;

  if (historialTipo && Array.isArray(caso.historialDocs)) {
    const fechasHistorial = caso.historialDocs
      .filter((d) => d.tipo === historialTipo || d.categoria === historialTipo)
      .map((d) => parsearFechaProtocolo(d.fecha || d.fechaSubida))
      .filter(Boolean);
    if (fechasHistorial.length) {
      fechaUltimoSeguimiento = new Date(
        Math.max(...fechasHistorial.map((f) => f.getTime()))
      );
    }
  }

  if (!fechaUltimoSeguimiento && seguimiento.id === 'seguimientoDocumentos') {
    fechaUltimoSeguimiento = parsearFechaProtocolo(caso.fchaUltSegui);
  }

  if (!fechaUltimoSeguimiento && usaGraciaExterna && diasHabilesDesdeRef >= gracia) {
    return {
      seguimientoId: seguimiento.id,
      nombre: seguimiento.nombre,
      fase: seguimiento.fase,
      prioridad: diasHabilesDesdeRef >= gracia * 2 ? 'ALTA' : 'MEDIA',
      mensaje: `Seguimiento pendiente: ${seguimiento.nombre} (${diasHabilesDesdeRef} días hábiles sin avance; gracia ${gracia} días hábiles)`,
      diasTranscurridos: diasHabilesDesdeRef,
      intervaloDias: seguimiento.intervaloDias,
      tipo: `SEGUIMIENTO_${seguimiento.id.toUpperCase()}`,
      accion: seguimiento.descripcion || `Registrar seguimiento de ${seguimiento.nombre}`,
      etiquetaLimite: `${gracia} días hábiles + cada ${seguimiento.intervaloDias} días calendario`,
    };
  }

  const puntoConteo =
    fechaUltimoSeguimiento && fechaUltimoSeguimiento > fechaRef
      ? fechaUltimoSeguimiento
      : fechaRef;

  const dias = diasCalendarioEntre(puntoConteo, ahora);
  if (dias == null || dias < seguimiento.intervaloDias) return null;

  return {
    seguimientoId: seguimiento.id,
    nombre: seguimiento.nombre,
    fase: seguimiento.fase,
    prioridad: dias >= seguimiento.intervaloDias * 2 ? 'ALTA' : 'MEDIA',
    mensaje: `Seguimiento pendiente: ${seguimiento.nombre} (han pasado ${Math.floor(dias)} días calendario, intervalo ${seguimiento.intervaloDias} días)`,
    diasTranscurridos: Math.floor(dias),
    intervaloDias: seguimiento.intervaloDias,
    tipo: `SEGUIMIENTO_${seguimiento.id.toUpperCase()}`,
    accion: seguimiento.descripcion || `Registrar seguimiento de ${seguimiento.nombre}`,
    etiquetaLimite: `cada ${seguimiento.intervaloDias} días calendario`,
  };
}

export function evaluarProtocoloCaso(caso, protocolo, ahora = new Date(), alcance = 'todos') {
  const alertas = [];
  const esperasExternas =
    protocolo?.esperasExternas?.length > 0
      ? protocolo.esperasExternas
      : ALERTAS_ESPERA_EXTERNA_DEFAULT;

  esperasExternas.forEach((espera) => {
    const resultado = evaluarEsperaExterna(caso, espera, ahora, protocolo);
    if (resultado) alertas.push(resultado);
  });

  (protocolo.etapas || []).forEach((etapa) => {
    const resultado = evaluarEtapaProtocolo(caso, etapa, ahora, alcance, protocolo);
    if (resultado) alertas.push(resultado);
  });

  (protocolo.seguimientosRecurrentes || []).forEach((seg) => {
    const resultado = evaluarSeguimientoRecurrente(caso, seg, ahora, protocolo);
    if (resultado) alertas.push(resultado);
  });

  return alertas;
}

/** Mapa tipo-etapa → límite en días (aprox.) para UI de trazabilidad legacy */
export function mapaTiemposLimiteDias(etapas) {
  const mapa = {
    coordinacionInspeccion: null,
    ultimoDocumento: null,
  };

  etapas.forEach((etapa) => {
    if (etapa.limite.unidad === 'horas') {
      mapa[etapa.id] = etapa.limite.valor / 24;
    } else if (etapa.limite.unidad === 'dias_habiles') {
      mapa[etapa.id] = etapa.limite.valor;
    } else {
      mapa[etapa.id] = etapa.limite.valor;
    }
  });

  return mapa;
}
