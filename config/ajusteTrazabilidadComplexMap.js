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

/**
 * Fechas de hito de trazabilidad: una vez guardadas solo pueden cambiarse
 * con edición manual explícita en el caso Complex (ajustador / admin / quien asigna).
 */
export const CAMPOS_FECHA_HITOS_TRAZABILIDAD = [
  'fchaAsgncion',
  'fchaContIni',
  'fchaCoordInspeccion',
  'fchaProgInspeccion',
  'fchaInspccion',
  'fchaSoliDocu',
  'fchaInfoPrelm',
  'fchaRepoActi',
  'fchaInfoFnal',
  'fchaPresentacionCifras',
  'fchaAceptacionCifrasAseguradora',
  'fchaEnvioFiniquito',
];

function campoTieneValorFecha(valor) {
  return valor != null && String(valor).trim() !== '';
}

function normalizarClaveDiaFecha(valor) {
  if (!campoTieneValorFecha(valor)) return '';
  const str = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const d = valor instanceof Date ? valor : new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Protege fechas de hito ya persistidas.
 * Solo permite cambiarlas si vienen en `fechasHitoEditadasManualmente` o `forzarFechasProtocolo`.
 * Nunca borra una fecha existente con un valor vacío.
 */
export function protegerFechasHitosTrazabilidad(casoAnterior, updateData, opciones = {}) {
  if (!updateData || typeof updateData !== 'object') return updateData || {};

  const forzar = opciones.forzarFechasProtocolo === true || updateData.forzarFechasProtocolo === true;
  const editadas = new Set(
    [
      ...(Array.isArray(opciones.fechasHitoEditadasManualmente)
        ? opciones.fechasHitoEditadasManualmente
        : []),
      ...(Array.isArray(updateData.fechasHitoEditadasManualmente)
        ? updateData.fechasHitoEditadasManualmente
        : []),
    ]
      .map((c) => String(c || '').trim())
      .filter(Boolean)
  );

  const resultado = { ...updateData };
  delete resultado.fechasHitoEditadasManualmente;
  delete resultado.forzarFechasProtocolo;
  delete resultado._origenGuardado;

  CAMPOS_FECHA_HITOS_TRAZABILIDAD.forEach((campo) => {
    if (!Object.prototype.hasOwnProperty.call(resultado, campo)) return;

    const anterior = casoAnterior?.[campo];
    const nuevo = resultado[campo];
    const tieneAnterior = campoTieneValorFecha(anterior);

    if (!tieneAnterior) return; // primera vez: se permite llenar

    if (!campoTieneValorFecha(nuevo)) {
      // No permitir borrar una fecha de hito ya puesta.
      delete resultado[campo];
      return;
    }

    const mismoDia =
      normalizarClaveDiaFecha(anterior) === normalizarClaveDiaFecha(nuevo);
    if (mismoDia) return;

    if (forzar || editadas.has(campo)) return;

    // Cambio automático / spillover (ajuste, historial, autosave sucio): conservar la original.
    delete resultado[campo];
  });

  return resultado;
}


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
 * Rellena anexos (y opcionalmente fechas) de protocolo desde historialDocs.
 * Por defecto SOLO alinea anexos: las fechas de hito no se tocan desde documentos.
 * @param {object} datos
 * @param {object[]} historialDocs
 * @param {{ forzarTipos?: string[], soloSiVacio?: boolean, alinearFechas?: boolean }} [opciones]
 */
export function alinearCamposProtocoloDesdeHistorialDocs(
  datos,
  historialDocs,
  opciones = {}
) {
  const { forzarTipos = [], soloSiVacio = true, alinearFechas = false } = opciones;
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

    if (alinearFechas && cfg.campoFecha && fecha) {
      const puedeEscribir = forzar || !soloSiVacio || !campoTieneValor(resultado, cfg.campoFecha);
      if (puedeEscribir) resultado[cfg.campoFecha] = fecha;
    }
  });

  return resultado;
}

/**
 * Construye campos de protocolo para un guardado desde Ajuste (un tipo/versión).
 * Por defecto NO sobrescribe la fecha del hito si el caso ya la tiene.
 */
export function buildCamposProtocoloDesdeAjuste({
  tipoHistorial,
  nombreArchivo,
  fechaPreferida,
  fechaFallback,
  fechaExistenteCaso = '',
  soloSiVacioFecha = true,
}) {
  const cfg = MAPEO_TIPO_HISTORIAL_A_COMPLEX[tipoHistorial];
  if (!cfg || !nombreArchivo) return {};

  const out = {};
  if (cfg.campoAnexo) out[cfg.campoAnexo] = String(nombreArchivo).trim();
  // El acta/ajuste no escribe ni mueve fechas de hito; solo el caso Complex a mano.
  return out;
}

export function resolverFechaFormularioAjuste(datosFormulario, tipoHistorial, fechaFallback) {
  const campo = CAMPOS_FECHA_FORMULARIO_AJUSTE_POR_TIPO[tipoHistorial];
  if (!campo || !datosFormulario) return fechaFallback || '';
  const valor = String(datosFormulario[campo] || '').trim();
  return valor || fechaFallback || '';
}

export function obtenerFechaProtocoloCaso(caso, tipoHistorial) {
  const cfg = MAPEO_TIPO_HISTORIAL_A_COMPLEX[tipoHistorial];
  if (!cfg?.campoFecha || !caso) return '';
  return String(caso[cfg.campoFecha] || '').trim();
}
