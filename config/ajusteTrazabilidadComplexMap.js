/**
 * Alineación entre documentos del formulario de Ajuste (historialDocs)
 * y campos de protocolo / trazabilidad en el caso Complex.
 */

/** tipo en historialDocs → campos del schema Complex */
export const MAPEO_TIPO_HISTORIAL_A_COMPLEX = {
  contactoInicial: {
    campoAnexo: 'anexContIni',
    campoFecha: 'fchaContIni',
  },
  inspeccion: {
    campoAnexo: 'anexActaInspccion',
    campoFecha: 'fchaInspccion',
  },
  solicitudDocs: {
    campoAnexo: 'anexSolDoc',
    campoFecha: 'fchaSoliDocu',
  },
  informePreliminar: {
    campoAnexo: 'anxoInfPrelim',
    campoFecha: 'fchaInfoPrelm',
  },
  ultimoDocumento: {
    campoAnexo: 'anxoRepoActi',
    campoFecha: 'fchaRepoActi',
  },
  informeFinal: {
    campoAnexo: 'anxoInfoFnal',
    campoFecha: 'fchaInfoFnal',
  },
  presentacionCifras: {
    campoAnexo: 'anxoPresentacionCifras',
    campoFecha: 'fchaPresentacionCifras',
  },
  envioFiniquito: {
    campoAnexo: 'anxoEnvioFiniquito',
    campoFecha: 'fchaEnvioFiniquito',
  },
};

/** estado del formulario de Ajuste → tipo en historialDocs */
export const MAPEO_ESTADO_AJUSTE_A_TIPO_HISTORIAL = {
  actaInspeccion: 'inspeccion',
  inicial: 'informePreliminar',
  preeliminar: 'informePreliminar',
  actualizacion: 'ultimoDocumento',
  informeFinal: 'informeFinal',
};

/** Campo de fecha en el formulario de Ajuste por tipo de historial */
export const CAMPOS_FECHA_FORMULARIO_AJUSTE_POR_TIPO = {
  inspeccion: 'fechaInspeccion',
  informePreliminar: 'fechaReporte',
  ultimoDocumento: 'fechaActualizacion',
  informeFinal: 'fechaInformeFinal',
};

/** campo anexo Complex → tipo historialDocs (alertas / protocolo) */
export const CAMPO_ANEXO_A_TIPO_HISTORIAL = Object.fromEntries(
  Object.entries(MAPEO_TIPO_HISTORIAL_A_COMPLEX)
    .filter(([, cfg]) => cfg.campoAnexo)
    .map(([tipo, cfg]) => [cfg.campoAnexo, tipo])
);

export function tipoHistorialDesdeEstadoAjuste(estado) {
  return MAPEO_ESTADO_AJUSTE_A_TIPO_HISTORIAL[estado] || 'informePreliminar';
}

function campoTieneValor(obj, campo) {
  if (!campo || !obj) return false;
  const valor = obj[campo];
  return valor != null && String(valor).trim() !== '';
}

function extraerFechaDocumento(doc) {
  if (!doc) return '';
  const cruda = doc.fecha || (doc.fechaSubida ? String(doc.fechaSubida).split('T')[0] : '');
  return String(cruda || '').trim();
}

function nombreDocumentoHistorial(doc) {
  if (!doc) return '';
  return String(doc.nombre || '').trim();
}

function obtenerUltimoDocumentoPorTipo(historialDocs, tipoHistorial) {
  if (!Array.isArray(historialDocs)) return null;
  const docs = historialDocs.filter((doc) => {
    if (!doc) return false;
    const tipo = String(doc.tipo || doc.categoria || '').trim();
    return tipo === tipoHistorial && Boolean(nombreDocumentoHistorial(doc) || doc.ruta || doc.url);
  });
  if (!docs.length) return null;
  return [...docs].sort((a, b) => {
    const fa = new Date(a.fechaSubida || a.fecha || 0).getTime();
    const fb = new Date(b.fechaSubida || b.fecha || 0).getTime();
    return fb - fa;
  })[0];
}

/**
 * Rellena anexos y fechas de protocolo desde historialDocs.
 * @param {object} datos - payload o caso a enriquecer
 * @param {object[]} historialDocs
 * @param {{ forzarTipos?: string[], soloSiVacio?: boolean }} [opciones]
 */
export function alinearCamposProtocoloDesdeHistorialDocs(
  datos,
  historialDocs,
  opciones = {}
) {
  const { forzarTipos = [], soloSiVacio = true } = opciones;
  const resultado = { ...datos };
  const forzarSet = new Set(forzarTipos);

  Object.entries(MAPEO_TIPO_HISTORIAL_A_COMPLEX).forEach(([tipoHistorial, cfg]) => {
    const ultimo = obtenerUltimoDocumentoPorTipo(historialDocs, tipoHistorial);
    if (!ultimo) return;

    const forzar = forzarSet.has(tipoHistorial);
    const nombre = nombreDocumentoHistorial(ultimo);
    const fecha = extraerFechaDocumento(ultimo);

    if (cfg.campoAnexo && nombre) {
      const puedeEscribir = forzar || !soloSiVacio || !campoTieneValor(resultado, cfg.campoAnexo);
      if (puedeEscribir) resultado[cfg.campoAnexo] = nombre;
    }

    if (cfg.campoFecha && fecha) {
      const puedeEscribir = forzar || !soloSiVacio || !campoTieneValor(resultado, cfg.campoFecha);
      if (puedeEscribir) resultado[cfg.campoFecha] = fecha;
    }
  });

  return resultado;
}

/**
 * Construye campos de protocolo para un guardado desde Ajuste (un tipo/versión).
 */
export function buildCamposProtocoloDesdeAjuste({
  tipoHistorial,
  nombreArchivo,
  fechaPreferida,
  fechaFallback,
}) {
  const cfg = MAPEO_TIPO_HISTORIAL_A_COMPLEX[tipoHistorial];
  if (!cfg || !nombreArchivo) return {};

  const fecha = String(fechaPreferida || fechaFallback || '').trim();
  const out = {};
  if (cfg.campoAnexo) out[cfg.campoAnexo] = String(nombreArchivo).trim();
  if (cfg.campoFecha && fecha) out[cfg.campoFecha] = fecha;
  return out;
}

export function resolverFechaFormularioAjuste(datosFormulario, tipoHistorial, fechaFallback) {
  const campo = CAMPOS_FECHA_FORMULARIO_AJUSTE_POR_TIPO[tipoHistorial];
  if (!campo || !datosFormulario) return fechaFallback || '';
  const valor = String(datosFormulario[campo] || '').trim();
  return valor || fechaFallback || '';
}
