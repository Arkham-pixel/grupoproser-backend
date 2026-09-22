import { normalizarEstadoSura } from './estadosSura.js';
import SuraFacilitadorCaso from '../models/SuraFacilitadorCaso.js';

export const PROVEEDOR_FACILITADORES_SURA = 'PROSER AJUSTES S.A.S';

export const COLUMNAS_FACILITADORES_SURA = [
  'RECLAMACION',
  'PROVEEDOR_ASSIGNADO_A_SERVICIO',
  'FECHA_ASIGNACION',
  'FECHA_PRIMER_CONTACTO',
  'VISITA_REALIZADA',
  'FECHA_VISITA',
  'CRITERIO_DETALLE',
  'ULTIMO_COMENTARIO',
  'INFORME_PRELIMINAR_ENVIADO',
  'FECHA_INFORME_PRELIMINAR',
  'INFORME_FINAL_ENVIADO',
  'FECHA_INFORME_FINAL',
  'DOCUMENTACION_COMPLETA',
  'FECHA_DOCUMENTACION_COMPLETA',
  'CASO_CERRADO',
  'FECHA_CIERRE',
  'ESTADO_SINIESTRO',
  'TIPO_VIVIENDA',
];

export const SINO_NA = ['SI', 'NO', 'N/A'];
export const SINO = ['SI', 'NO'];
export const CRITERIOS_FACILITADOR = ['Critico', 'Medio', 'Bajo'];
export const ESTADOS_FACILITADOR = [
  'Abierto',
  'Tramitado',
  'Anulado',
  'Desistido',
  'Objetado',
  'Cancelado Sura',
];
export const TIPOS_VIVIENDA_FACILITADOR = ['URBANA', 'RURAL'];

export function digitsReclamacion(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

export function reclamacionTexto13(valor) {
  const d = digitsReclamacion(valor);
  return d.length === 13 ? d : d;
}

function clave(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
}

export function normalizarSinoNa(valor, { permitirNA = true } = {}) {
  const k = clave(valor);
  if (!k) return '';
  if (k === 'SI' || k === 'S' || k === 'YES' || k === 'TRUE' || k === '1') return 'SI';
  if (k === 'NO' || k === 'N' || k === 'FALSE' || k === '0') return 'NO';
  if (permitirNA && (k === 'N/A' || k === 'NA' || k === 'N A')) return 'N/A';
  return '';
}

/** SI/NO/N/A; vacío → NO. */
export function sinoConDefault(valor, { permitirNA = true, defecto = 'NO' } = {}) {
  return normalizarSinoNa(valor, { permitirNA }) || defecto;
}

export function normalizarCriterioFacilitador(valor) {
  const k = clave(valor);
  if (k.startsWith('CRIT')) return 'Critico';
  if (k.startsWith('MED')) return 'Medio';
  if (k.startsWith('BAJ')) return 'Bajo';
  return '';
}

/** Criterio vacío → Medio (regla operativa Facilitadores). */
export function criterioConDefault(valor, defecto = 'Medio') {
  return normalizarCriterioFacilitador(valor) || defecto;
}

export function normalizarEstadoFacilitador(valor) {
  const k = clave(valor);
  if (k.startsWith('ABIER')) return 'Abierto';
  if (k.startsWith('TRAM')) return 'Tramitado';
  if (k.startsWith('ANUL')) return 'Anulado';
  if (k.startsWith('DESIST')) return 'Desistido';
  if (k.startsWith('OBJET')) return 'Objetado';
  if (k.includes('CANCELADO')) return 'Cancelado Sura';
  return '';
}

/** Tipo vivienda plantilla SURA: URBANA | RURAL. */
export function normalizarTipoViviendaFacilitador(valor) {
  const k = clave(valor);
  if (k.startsWith('RUR')) return 'RURAL';
  if (k.startsWith('URB')) return 'URBANA';
  return '';
}

export function tipoViviendaConDefault(valor, defecto = 'URBANA') {
  return normalizarTipoViviendaFacilitador(valor) || defecto;
}

function parseFecha(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate(), 12, 0, 0);
  }
  const s = String(valor).trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  // datetime-local / ISO: usar solo el día calendario (evita desfases por hora/TZ).
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split(/[/\s]/).map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 12, 0, 0);
}

function fechaSiMarca(marca, fecha) {
  return marca === 'SI' ? parseFecha(fecha) : null;
}

export function filaDesdePlantillaSura(raw = {}) {
  const reclamacion = reclamacionTexto13(raw.RECLAMACION ?? raw.reclamacion);
  const visita = sinoConDefault(raw.VISITA_REALIZADA ?? raw.visitaRealizada, { permitirNA: false });
  const informePrelim = sinoConDefault(
    raw.INFORME_PRELIMINAR ?? raw.informePreliminarEnviado ?? raw.INFORME_PRELIMINAR_ENVIADO,
    { permitirNA: false }
  );
  const informe = sinoConDefault(
    raw.INFORME_FINAL_ENVIADO ??
      raw.INFORME_ENVIADO ??
      raw.informeEnviado ??
      raw.INFORME_FINAL ??
      raw.informeFinalEnviado,
    { permitirNA: false }
  );
  const docs = sinoConDefault(raw.DOCUMENTACION_COMPLETA ?? raw.documentacionCompleta, {
    permitirNA: false,
  });
  const cerrado = sinoConDefault(raw.CASO_CERRADO ?? raw.casoCerrado, { permitirNA: false });
  return {
    reclamacion,
    proveedor: String(raw.PROVEEDOR_ASSIGNADO_A_SERVICIO ?? raw.proveedor ?? PROVEEDOR_FACILITADORES_SURA).trim()
      || PROVEEDOR_FACILITADORES_SURA,
    informacion: String(raw['INFORMACIÓN'] ?? raw.INFORMACION ?? raw.informacion ?? '').trim() || '0',
    fechaAsignacion: parseFecha(raw.FECHA_ASIGNACION ?? raw.fechaAsignacion),
    fechaPrimerContacto: parseFecha(raw.FECHA_PRIMER_CONTACTO ?? raw.fechaPrimerContacto),
    visitaRealizada: visita,
    fechaVisita: fechaSiMarca(visita, raw.FECHA_VISITA ?? raw.fechaVisita),
    criterioDetalle: criterioConDefault(raw.CRITERIO_DETALLE ?? raw.criterioDetalle),
    ultimoComentario: String(raw.ULTIMO_COMENTARIO ?? raw.ultimoComentario ?? '').trim(),
    informePreliminarEnviado: informePrelim,
    fechaInformePreliminar: fechaSiMarca(
      informePrelim,
      raw.FECHA_INFORME_PRELIMINAR ?? raw.fechaInformePreliminar
    ),
    informeEnviado: informe,
    fechaInforme: fechaSiMarca(informe, raw.FECHA_INFORME ?? raw.fechaInforme ?? raw.FECHA_INFORME_FINAL),
    documentacionCompleta: docs,
    fechaDocumentacionCompleta: fechaSiMarca(
      docs,
      raw.FECHA_DOCUMENTACION_COMPLETA ?? raw.fechaDocumentacionCompleta
    ),
    casoCerrado: cerrado,
    fechaCierre: fechaSiMarca(cerrado, raw.FECHA_CIERRE ?? raw.fechaCierre),
    estadoSiniestro:
      normalizarEstadoFacilitador(raw.ESTADO_SINIESTRO ?? raw.estadoSiniestro) || 'Abierto',
    tipoVivienda: tipoViviendaConDefault(raw.TIPO_VIVIENDA ?? raw.tipoVivienda),
  };
}

export function aplicarPatchFacilitador(base = {}, patch = {}) {
  const next = { ...base, ...patch };
  const visita = sinoConDefault(next.visitaRealizada, { permitirNA: false });
  const informePrelim = sinoConDefault(next.informePreliminarEnviado, { permitirNA: false });
  const informe = sinoConDefault(next.informeEnviado, { permitirNA: false });
  const docs = sinoConDefault(next.documentacionCompleta, { permitirNA: false });
  const cerrado = sinoConDefault(next.casoCerrado, { permitirNA: false });
  next.visitaRealizada = visita;
  next.informePreliminarEnviado = informePrelim;
  next.informeEnviado = informe;
  next.documentacionCompleta = docs;
  next.casoCerrado = cerrado;
  next.criterioDetalle = criterioConDefault(next.criterioDetalle);
  next.estadoSiniestro =
    normalizarEstadoFacilitador(next.estadoSiniestro) ||
    String(next.estadoSiniestro || '').trim() ||
    'Abierto';
  next.tipoVivienda = tipoViviendaConDefault(next.tipoVivienda);
  next.fechaVisita = visita === 'SI' ? parseFecha(next.fechaVisita) : null;
  next.fechaInformePreliminar =
    informePrelim === 'SI' ? parseFecha(next.fechaInformePreliminar) : null;
  next.fechaInforme = informe === 'SI' ? parseFecha(next.fechaInforme) : null;
  next.fechaDocumentacionCompleta = docs === 'SI' ? parseFecha(next.fechaDocumentacionCompleta) : null;
  next.fechaCierre = cerrado === 'SI' ? parseFecha(next.fechaCierre) : null;
  next.fechaAsignacion = parseFecha(next.fechaAsignacion);
  next.fechaPrimerContacto = parseFecha(next.fechaPrimerContacto);
  if (next.reclamacion) next.reclamacion = reclamacionTexto13(next.reclamacion);
  const tieneGestion = Boolean(
    visita ||
      informePrelim ||
      informe ||
      docs ||
      next.criterioDetalle ||
      next.estadoSiniestro ||
      next.ultimoComentario
  );
  if (tieneGestion && String(next.informacion || '') === '0') next.informacion = '1';
  return next;
}

export function estadoFacilitadorDesdeArnald(estado) {
  return estadoFacilitadorDesdeCasoSura({ estado });
}

/** Fecha de radicación del informe único/final (para marcar Tramitado). */
export function fechaRadicacionInformeSura(caso = {}) {
  return (
    parseFecha(caso.fchaInfoFnal) ||
    parseFecha(caso.fechaEnvioAseguradora) ||
    parseFecha(caso.informeUnico?.fechaInforme) ||
    parseFecha(caso.fechaLiquidado) ||
    null
  );
}

/**
 * Estado del siniestro (Facilitadores → columna Q ESTADO_SINIESTRO).
 * Prioridad: campo manual estadoFacilitador (Gestionar); si vacío, se deriva del flujo SURA.
 */
export function estadoFacilitadorDesdeCasoSura(caso = {}) {
  const manual = normalizarEstadoFacilitador(caso.estadoFacilitador);
  if (manual) return manual;

  const estado = normalizarEstadoSura(caso.estado);
  const bruto = String(caso.estado || caso.descripcionEstado || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();

  if (estado === 'ANULADO' || bruto.startsWith('ANUL')) {
    return 'Anulado';
  }
  if (bruto.startsWith('DESIST') || bruto.includes('DESISTIDO')) {
    return 'Desistido';
  }
  if (bruto.startsWith('OBJET') || bruto.includes('OBJETADO')) {
    return 'Objetado';
  }
  if (bruto.includes('CANCELADO')) {
    return 'Cancelado Sura';
  }

  const tipo = tipoInformeCasoSura(caso);
  const esUnicoOFinal =
    estado === 'INFORME ÚNICO O FINAL' || tipo === 'unico' || tipo === 'final';
  if (esUnicoOFinal && fechaRadicacionInformeSura(caso)) {
    return 'Tramitado';
  }

  return 'Abierto';
}

/** Tipo del bloque informeUnico: preliminar | final | unico | ''. */
function tipoInformeCasoSura(caso = {}) {
  const t = String(caso?.informeUnico?.tipoInforme || caso?.tipoInforme || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
  if (!t) return '';
  if (t.includes('prelim')) return 'preliminar';
  if (t.includes('unic')) return 'unico';
  if (t.includes('final')) return 'final';
  return '';
}

/**
 * DOCS (documentación completa):
 * - SI: informe final (fchaInfoFnal) o informe único (tipo unico/final o estado)
 * - NO: informe preliminar o actualización/último documento (sin final/único)
 */
export function docsCompletaDesdeCasoSura(caso = {}) {
  const estado = normalizarEstadoSura(caso.estado);
  const tipo = tipoInformeCasoSura(caso);
  const fechaFinal = parseFecha(caso.fchaInfoFnal);
  const docsSi =
    Boolean(fechaFinal) ||
    tipo === 'unico' ||
    tipo === 'final' ||
    estado === 'INFORME ÚNICO O FINAL';

  const fechaDocs = docsSi
    ? fechaFinal ||
      parseFecha(caso.informeUnico?.fechaInforme) ||
      parseFecha(caso.fechaEnvioAseguradora) ||
      null
    : null;

  return {
    documentacionCompleta: docsSi ? 'SI' : 'NO',
    fechaDocumentacionCompleta: fechaDocs,
  };
}

/**
 * Informes preliminar y final desde el caso SURA.
 * Fuentes preliminar (en orden):
 * 1) fchaInfoPrelm (trazabilidad)
 * 2) informeUnico.fechaInformePreliminar (conservada al pasar a final)
 * 3) informeUnico.fechaInforme si el tipo actual es preliminar
 * 4) estado INFORME PRELIMINAR → fecha informe / último documento
 * 5) archivo archivero INFORME_PRELIMINAR
 * 6) si ya hay final/único o informe guardado → SI (flujo terremoto)
 */
export function informesDesdeCasoSura(caso = {}) {
  const estado = normalizarEstadoSura(caso.estado);
  const tipo = tipoInformeCasoSura(caso);
  const tieneInformeObj =
    Boolean(caso.tieneInforme) ||
    (caso.informeUnico != null && typeof caso.informeUnico === 'object');
  const fechaInformeUnico = parseFecha(caso.informeUnico?.fechaInforme);
  const fechaArchivoPrelim =
    fechaArchivoEtiquetaSura(caso, 'INFORME_PRELIMINAR') ||
    fechaArchivoEtiquetaSura(caso, 'INFORME PRELIMINAR');

  const fechaPrelim =
    parseFecha(caso.fchaInfoPrelm) ||
    parseFecha(caso.informeUnico?.fechaInformePreliminar) ||
    (tipo === 'preliminar' ? fechaInformeUnico : null) ||
    (estado === 'INFORME PRELIMINAR Y/O ACTUALIZACIÓN'
      ? fechaInformeUnico || parseFecha(caso.fechaUltimoDocumento)
      : null) ||
    fechaArchivoPrelim ||
    null;

  const yaFinalOUnico =
    tipo === 'final' ||
    tipo === 'unico' ||
    estado === 'INFORME ÚNICO O FINAL' ||
    Boolean(parseFecha(caso.fchaInfoFnal));

  const prelimSi =
    Boolean(fechaPrelim) ||
    tipo === 'preliminar' ||
    estado === 'INFORME PRELIMINAR Y/O ACTUALIZACIÓN' ||
    Boolean(fechaArchivoPrelim) ||
    yaFinalOUnico ||
    (tieneInformeObj && (Boolean(fechaInformeUnico) || Boolean(tipo)));

  const fechaFinal =
    parseFecha(caso.fchaInfoFnal) ||
    parseFecha(caso.fechaEnvioAseguradora) ||
    ((tipo === 'final' || tipo === 'unico') ? fechaInformeUnico : null) ||
    (estado === 'INFORME ÚNICO O FINAL' ? fechaRadicacionInformeSura(caso) : null) ||
    fechaArchivoEtiquetaSura(caso, 'INFORME_UNICO') ||
    fechaArchivoEtiquetaSura(caso, 'INFORME_FINAL') ||
    null;
  const finalSi =
    Boolean(fechaFinal) ||
    tipo === 'final' ||
    tipo === 'unico' ||
    estado === 'INFORME ÚNICO O FINAL';

  let fechaPrelimOut = fechaPrelim;
  if (prelimSi && !fechaPrelimOut) {
    fechaPrelimOut =
      (tipo === 'preliminar' ? fechaInformeUnico : null) ||
      parseFecha(caso.informeUnico?.fechaInformePreliminar) ||
      parseFecha(caso.fchaInfoPrelm) ||
      fechaArchivoPrelim ||
      parseFecha(caso.fechaUltimoDocumento) ||
      // Si solo hay final, usar fecha del informe como aproximación de preliminar
      (yaFinalOUnico ? fechaInformeUnico || parseFecha(caso.fechaEnvioAseguradora) : null) ||
      null;
  }

  return {
    informePreliminarEnviado: prelimSi ? 'SI' : 'NO',
    fechaInformePreliminar: prelimSi ? fechaPrelimOut : null,
    informeEnviado: finalSi ? 'SI' : 'NO',
    fechaInforme: finalSi
      ? fechaFinal ||
        parseFecha(caso.fechaEnvioAseguradora) ||
        fechaInformeUnico ||
        null
      : null,
  };
}

function fechaArchivoEtiquetaSura(caso = {}, etiqueta = '') {
  const want = String(etiqueta || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
  if (!want) return null;
  const archivos = Array.isArray(caso.archivos) ? caso.archivos : [];
  let best = null;
  for (const a of archivos) {
    const et = String(a?.etiqueta || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .trim()
      .toUpperCase();
    if (et !== want && !et.includes(want)) continue;
    const f = parseFecha(a.fechaSubida || a.createdAt || a.updatedAt);
    if (f && (!best || f > best)) best = f;
  }
  return best;
}

export function sugerenciaDesdeCasoSura(caso = {}) {
  const estadoFac = estadoFacilitadorDesdeCasoSura(caso);
  const cerradoFac = ['Anulado', 'Tramitado', 'Desistido', 'Objetado', 'Cancelado Sura'].includes(
    estadoFac
  );
  const fechaInspeccion = parseFecha(caso.fechaInspeccion || caso.fchaInspccion || null);
  const visitaSi = Boolean(fechaInspeccion);
  const criterio = criterioConDefault(caso.estadoPagoPrimas);
  // 1.er contacto: SOLO Contacto inicial; si el caso no lo tiene, fecha de inspección.
  const fechaContactoInicial = parseFecha(caso.fchaContIni);
  const fechaPrimerContacto = fechaContactoInicial || fechaInspeccion || null;
  const docs = docsCompletaDesdeCasoSura(caso);
  const fechaRadicacion = fechaRadicacionInformeSura(caso);
  const informes = informesDesdeCasoSura(caso);
  return {
    casoSuraId: caso._id || null,
    fechaAsignacion: caso.fchaAsgncion || caso.createdAt || null,
    fechaPrimerContacto,
    visitaRealizada: visitaSi ? 'SI' : 'NO',
    fechaVisita: visitaSi ? fechaInspeccion : null,
    ...informes,
    documentacionCompleta: docs.documentacionCompleta,
    fechaDocumentacionCompleta: docs.fechaDocumentacionCompleta,
    casoCerrado: cerradoFac ? 'SI' : 'NO',
    fechaCierre: cerradoFac
      ? fechaRadicacion || caso.fechaLiquidado || caso.updatedAt || null
      : null,
    estadoSiniestro: estadoFac,
    // Todo caso con estado debe llevar comentario: descripción del estado o el propio estado.
    ultimoComentario: String(
      caso.descripcionEstado || caso.estado || caso.observacionLlamada || ''
    ).trim(),
    criterioDetalle: criterio,
    tipoVivienda: tipoViviendaConDefault(caso.tipoVivienda),
  };
}

/** Crea o actualiza la fila del Portal de Facilitadores al guardar Gestionar. */
export async function alimentarFacilitadorDesdeCasoSura(caso, quien = '') {
  const rec = digitsReclamacion(caso?.siniestro);
  if (rec.length < 10) return null;
  const reclamacion = reclamacionTexto13(caso.siniestro);
  const sugerido = sugerenciaDesdeCasoSura(caso);
  const actual = await SuraFacilitadorCaso.findOne({ reclamacion }).lean();
  const base = actual || {
    reclamacion,
    proveedor: PROVEEDOR_FACILITADORES_SURA,
    informacion: '0',
  };
  const next = aplicarPatchFacilitador({
    ...fusionarDesdeCasoSura(base, caso),
    reclamacion,
    proveedor: base.proveedor || PROVEEDOR_FACILITADORES_SURA,
    informacion: '1',
    criterioDetalle: criterioConDefault(sugerido.criterioDetalle || base.criterioDetalle),
    ultimoComentario:
      String(sugerido.ultimoComentario || '').trim() || base.ultimoComentario || '',
  });
  delete next._id;
  delete next.__v;
  const guardado = await SuraFacilitadorCaso.findOneAndUpdate(
    { reclamacion },
    {
      $set: { ...next, actualizadoPor: quien || base.actualizadoPor || '' },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true }
  );
  return guardado;
}

export function completarVacios(destino = {}, sugerido = {}) {
  const out = { ...destino };
  for (const [claveCampo, valor] of Object.entries(sugerido)) {
    const actual = out[claveCampo];
    const vacio = actual === undefined || actual === null || actual === '';
    if (vacio && valor !== undefined && valor !== null && valor !== '') {
      out[claveCampo] = valor;
    }
  }
  return aplicarPatchFacilitador(out);
}

/**
 * Fusiona datos de Gestionar → Facilitadores.
 * Visita / fecha visita / 1.er contacto se pisan cuando el caso ya tiene inspección
 * (aunque en Facilitadores diga NO), porque la fuente de verdad es el caso SURA.
 */
export function fusionarDesdeCasoSura(destino = {}, caso = {}) {
  const sugerido = sugerenciaDesdeCasoSura(caso);
  const mezclado = completarVacios(destino, sugerido);

  if (sugerido.visitaRealizada === 'SI') {
    mezclado.visitaRealizada = 'SI';
    mezclado.fechaVisita = sugerido.fechaVisita;
  } else if (!destino.visitaRealizada || destino.visitaRealizada === 'N/A') {
    mezclado.visitaRealizada = sugerido.visitaRealizada || 'NO';
    mezclado.fechaVisita = sugerido.fechaVisita;
  }

  // Siempre recalcular 1.er contacto desde el caso (contacto inicial → inspección).
  mezclado.fechaPrimerContacto = sugerido.fechaPrimerContacto || null;

  // DOCS: final/único = SI; preliminar / último documento = NO.
  mezclado.documentacionCompleta = sugerido.documentacionCompleta || 'NO';
  mezclado.fechaDocumentacionCompleta = sugerido.fechaDocumentacionCompleta || null;

  // Informes: preliminar y final desde el caso.
  mezclado.informePreliminarEnviado = sugerido.informePreliminarEnviado || 'NO';
  mezclado.fechaInformePreliminar = sugerido.fechaInformePreliminar || null;
  mezclado.informeEnviado = sugerido.informeEnviado || 'NO';
  mezclado.fechaInforme = sugerido.fechaInforme || null;

  // Estado del siniestro siempre desde gestión SURA.
  mezclado.estadoSiniestro = sugerido.estadoSiniestro || 'Abierto';
  mezclado.casoCerrado = sugerido.casoCerrado || 'NO';
  mezclado.fechaCierre = sugerido.fechaCierre || null;

  if (sugerido.ultimoComentario && !String(destino.ultimoComentario || '').trim()) {
    mezclado.ultimoComentario = sugerido.ultimoComentario;
  }

  mezclado.criterioDetalle = criterioConDefault(
    destino.criterioDetalle || sugerido.criterioDetalle
  );

  mezclado.tipoVivienda = tipoViviendaConDefault(
    caso.tipoVivienda || sugerido.tipoVivienda || destino.tipoVivienda
  );

  mezclado.casoSuraId = sugerido.casoSuraId || destino.casoSuraId || null;
  if (sugerido.fechaAsignacion && !destino.fechaAsignacion) {
    mezclado.fechaAsignacion = sugerido.fechaAsignacion;
  }

  return aplicarPatchFacilitador(mezclado);
}

export function erroresValidacionPortal(fila = {}) {
  const errores = [];
  const rec = digitsReclamacion(fila.reclamacion);
  if (rec.length !== 13) errores.push('Reclamación debe tener 13 dígitos');
  const visita = sinoConDefault(fila.visitaRealizada, { permitirNA: false });
  const informePrelim = sinoConDefault(fila.informePreliminarEnviado, { permitirNA: false });
  const informe = sinoConDefault(fila.informeEnviado, { permitirNA: false });
  const docs = sinoConDefault(fila.documentacionCompleta, { permitirNA: false });
  const cerrado = sinoConDefault(fila.casoCerrado, { permitirNA: false });
  if (visita === 'SI' && !parseFecha(fila.fechaVisita)) errores.push('Fecha de visita');
  if (informePrelim === 'SI' && !parseFecha(fila.fechaInformePreliminar)) {
    errores.push('Fecha de informe preliminar');
  }
  if (informe === 'SI' && !parseFecha(fila.fechaInforme)) errores.push('Fecha de informe final');
  if (docs === 'SI' && !parseFecha(fila.fechaDocumentacionCompleta)) {
    errores.push('Fecha de documentación completa');
  }
  if (cerrado === 'SI' && !parseFecha(fila.fechaCierre)) errores.push('Fecha de cierre');
  if (!normalizarEstadoFacilitador(fila.estadoSiniestro)) {
    errores.push('Estado (Abierto / Tramitado / Anulado / Desistido / Objetado / Cancelado Sura)');
  }
  return errores;
}
