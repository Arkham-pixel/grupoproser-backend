import { normalizarEstadoSura } from './estadosSura.js';
import SuraFacilitadorCaso from '../models/SuraFacilitadorCaso.js';

export const PROVEEDOR_FACILITADORES_SURA = 'PROSER AJUSTES S.A.S';

export const COLUMNAS_FACILITADORES_SURA = [
  'RECLAMACION',
  'PROVEEDOR_ASSIGNADO_A_SERVICIO',
  'INFORMACIÓN',
  'FECHA_ASIGNACION',
  'FECHA_PRIMER_CONTACTO',
  'VISITA_REALIZADA',
  'FECHA_VISITA',
  'CRITERIO_DETALLE',
  'ULTIMO_COMENTARIO',
  'INFORME_ENVIADO',
  'FECHA_INFORME',
  'DOCUMENTACION_COMPLETA',
  'FECHA_DOCUMENTACION_COMPLETA',
  'CASO_CERRADO',
  'FECHA_CIERRE',
  'ESTADO_SINIESTRO',
];

export const SINO_NA = ['SI', 'NO', 'N/A'];
export const SINO = ['SI', 'NO'];
export const CRITERIOS_FACILITADOR = ['Critico', 'Medio', 'Bajo'];
export const ESTADOS_FACILITADOR = ['Abierto', 'Tramitado', 'Anulado', 'Desistido', 'Objetado'];

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

export function normalizarCriterioFacilitador(valor) {
  const k = clave(valor);
  if (k.startsWith('CRIT')) return 'Critico';
  if (k.startsWith('MED')) return 'Medio';
  if (k.startsWith('BAJ')) return 'Bajo';
  return '';
}

export function normalizarEstadoFacilitador(valor) {
  const k = clave(valor);
  if (k.startsWith('ABIER')) return 'Abierto';
  if (k.startsWith('TRAM')) return 'Tramitado';
  if (k.startsWith('ANUL')) return 'Anulado';
  if (k.startsWith('DESIST')) return 'Desistido';
  if (k.startsWith('OBJET')) return 'Objetado';
  return '';
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
  const visita = normalizarSinoNa(raw.VISITA_REALIZADA ?? raw.visitaRealizada);
  const informe = normalizarSinoNa(raw.INFORME_ENVIADO ?? raw.informeEnviado);
  const docs = normalizarSinoNa(raw.DOCUMENTACION_COMPLETA ?? raw.documentacionCompleta);
  const cerrado = normalizarSinoNa(raw.CASO_CERRADO ?? raw.casoCerrado, { permitirNA: false }) || 'NO';
  return {
    reclamacion,
    proveedor: String(raw.PROVEEDOR_ASSIGNADO_A_SERVICIO ?? raw.proveedor ?? PROVEEDOR_FACILITADORES_SURA).trim()
      || PROVEEDOR_FACILITADORES_SURA,
    informacion: String(raw['INFORMACIÓN'] ?? raw.INFORMACION ?? raw.informacion ?? '').trim() || '0',
    fechaAsignacion: parseFecha(raw.FECHA_ASIGNACION ?? raw.fechaAsignacion),
    fechaPrimerContacto: parseFecha(raw.FECHA_PRIMER_CONTACTO ?? raw.fechaPrimerContacto),
    visitaRealizada: visita,
    fechaVisita: fechaSiMarca(visita, raw.FECHA_VISITA ?? raw.fechaVisita),
    criterioDetalle: normalizarCriterioFacilitador(raw.CRITERIO_DETALLE ?? raw.criterioDetalle),
    ultimoComentario: String(raw.ULTIMO_COMENTARIO ?? raw.ultimoComentario ?? '').trim(),
    informeEnviado: informe,
    fechaInforme: fechaSiMarca(informe, raw.FECHA_INFORME ?? raw.fechaInforme),
    documentacionCompleta: docs,
    fechaDocumentacionCompleta: fechaSiMarca(
      docs,
      raw.FECHA_DOCUMENTACION_COMPLETA ?? raw.fechaDocumentacionCompleta
    ),
    casoCerrado: cerrado,
    fechaCierre: fechaSiMarca(cerrado, raw.FECHA_CIERRE ?? raw.fechaCierre),
    estadoSiniestro: normalizarEstadoFacilitador(raw.ESTADO_SINIESTRO ?? raw.estadoSiniestro),
  };
}

export function aplicarPatchFacilitador(base = {}, patch = {}) {
  const next = { ...base, ...patch };
  const visita = normalizarSinoNa(next.visitaRealizada);
  const informe = normalizarSinoNa(next.informeEnviado);
  const docs = normalizarSinoNa(next.documentacionCompleta);
  const cerrado = normalizarSinoNa(next.casoCerrado, { permitirNA: false }) || 'NO';
  next.visitaRealizada = visita;
  next.informeEnviado = informe;
  next.documentacionCompleta = docs;
  next.casoCerrado = cerrado;
  next.criterioDetalle = normalizarCriterioFacilitador(next.criterioDetalle) || String(next.criterioDetalle || '').trim();
  next.estadoSiniestro = normalizarEstadoFacilitador(next.estadoSiniestro) || String(next.estadoSiniestro || '').trim();
  next.fechaVisita = visita === 'SI' ? parseFecha(next.fechaVisita) : null;
  next.fechaInforme = informe === 'SI' ? parseFecha(next.fechaInforme) : null;
  next.fechaDocumentacionCompleta = docs === 'SI' ? parseFecha(next.fechaDocumentacionCompleta) : null;
  next.fechaCierre = cerrado === 'SI' ? parseFecha(next.fechaCierre) : null;
  next.fechaAsignacion = parseFecha(next.fechaAsignacion);
  next.fechaPrimerContacto = parseFecha(next.fechaPrimerContacto);
  if (next.reclamacion) next.reclamacion = reclamacionTexto13(next.reclamacion);
  const tieneGestion =
    Boolean(visita || informe || docs || next.criterioDetalle || next.estadoSiniestro || next.ultimoComentario);
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
 * Estado del siniestro (Facilitadores) desde estado de gestión SURA:
 * - Tramitado: INFORME ÚNICO O FINAL (o tipo único/final) con fecha radicada
 * - Anulado: ANULADO o Desistido
 * - Abierto: el resto
 */
export function estadoFacilitadorDesdeCasoSura(caso = {}) {
  const estado = normalizarEstadoSura(caso.estado);
  const bruto = String(caso.estado || caso.descripcionEstado || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();

  if (estado === 'ANULADO' || bruto.startsWith('DESIST') || bruto.includes('DESISTIDO')) {
    return 'Anulado';
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
  const t = String(caso?.informeUnico?.tipoInforme || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
  if (t === 'preliminar' || t === 'final' || t === 'unico') return t;
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

export function sugerenciaDesdeCasoSura(caso = {}) {
  const estado = normalizarEstadoSura(caso.estado);
  const estadoFac = estadoFacilitadorDesdeCasoSura(caso);
  const cerradoFac = estadoFac === 'Anulado' || estadoFac === 'Tramitado';
  const fechaInspeccion = parseFecha(caso.fechaInspeccion || caso.fchaInspccion || null);
  const visitaSi = Boolean(fechaInspeccion);
  const informeSi = Boolean(caso.fechaEnvioAseguradora) || Boolean(caso.informeUnico);
  const criterio = normalizarCriterioFacilitador(caso.estadoPagoPrimas);
  // 1.er contacto: SOLO Contacto inicial; si el caso no lo tiene, fecha de inspección.
  const fechaContactoInicial = parseFecha(caso.fchaContIni);
  const fechaPrimerContacto = fechaContactoInicial || fechaInspeccion || null;
  const docs = docsCompletaDesdeCasoSura(caso);
  const fechaRadicacion = fechaRadicacionInformeSura(caso);
  return {
    casoSuraId: caso._id || null,
    fechaAsignacion: caso.fchaAsgncion || caso.createdAt || null,
    fechaPrimerContacto,
    visitaRealizada: visitaSi ? 'SI' : 'NO',
    fechaVisita: visitaSi ? fechaInspeccion : null,
    informeEnviado: informeSi ? 'SI' : 'NO',
    fechaInforme: informeSi
      ? caso.fechaEnvioAseguradora || caso.informeUnico?.fechaInforme || null
      : null,
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
    criterioDetalle: sugerido.criterioDetalle || base.criterioDetalle || '',
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

  // Estado del siniestro siempre desde gestión SURA.
  mezclado.estadoSiniestro = sugerido.estadoSiniestro || 'Abierto';
  mezclado.casoCerrado = sugerido.casoCerrado || 'NO';
  mezclado.fechaCierre = sugerido.fechaCierre || null;

  if (sugerido.ultimoComentario && !String(destino.ultimoComentario || '').trim()) {
    mezclado.ultimoComentario = sugerido.ultimoComentario;
  }

  if (sugerido.criterioDetalle && !String(destino.criterioDetalle || '').trim()) {
    mezclado.criterioDetalle = sugerido.criterioDetalle;
  }

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
  const visita = normalizarSinoNa(fila.visitaRealizada, { permitirNA: false });
  const informe = normalizarSinoNa(fila.informeEnviado, { permitirNA: false });
  const docs = normalizarSinoNa(fila.documentacionCompleta, { permitirNA: false });
  const cerrado = normalizarSinoNa(fila.casoCerrado, { permitirNA: false });
  if (!visita) errores.push('Visita realizada (SI / NO)');
  if (visita === 'SI' && !parseFecha(fila.fechaVisita)) errores.push('Fecha de visita');
  if (!informe) errores.push('Informe enviado (SI / NO)');
  if (informe === 'SI' && !parseFecha(fila.fechaInforme)) errores.push('Fecha de informe');
  if (!docs) errores.push('Documentación completa (SI / NO)');
  if (docs === 'SI' && !parseFecha(fila.fechaDocumentacionCompleta)) {
    errores.push('Fecha de documentación completa');
  }
  if (!cerrado) errores.push('Caso cerrado (SI / NO)');
  if (cerrado === 'SI' && !parseFecha(fila.fechaCierre)) errores.push('Fecha de cierre');
  if (!normalizarCriterioFacilitador(fila.criterioDetalle)) {
    errores.push('Criterio (Critico / Medio / Bajo)');
  }
  if (!normalizarEstadoFacilitador(fila.estadoSiniestro)) {
    errores.push('Estado (Abierto / Tramitado / Anulado / Desistido / Objetado)');
  }
  return errores;
}
