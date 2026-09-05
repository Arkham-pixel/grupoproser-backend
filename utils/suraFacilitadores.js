import { normalizarEstadoSura } from './estadosSura.js';

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
  if (!valor) return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;
  const s = String(valor).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split(/[/\s]/).map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
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
  const n = normalizarEstadoSura(estado);
  if (n === 'ANULADO') return 'Anulado';
  if (n === 'INFORME ÚNICO O FINAL') return 'Tramitado';
  return 'Abierto';
}

export function sugerenciaDesdeCasoSura(caso = {}) {
  const estado = normalizarEstadoSura(caso.estado);
  const anulado = estado === 'ANULADO';
  const unico = estado === 'INFORME ÚNICO O FINAL';
  const visitaSi = Boolean(caso.fechaInspeccion);
  const informeSi = Boolean(caso.fechaEnvioAseguradora) || Boolean(caso.informeUnico);
  return {
    casoSuraId: caso._id || null,
    fechaAsignacion: caso.fchaAsgncion || caso.createdAt || null,
    fechaPrimerContacto: caso.fechaLlamada || null,
    visitaRealizada: anulado ? 'N/A' : visitaSi ? 'SI' : 'NO',
    fechaVisita: anulado ? null : caso.fechaInspeccion || null,
    informeEnviado: anulado ? 'N/A' : informeSi ? 'SI' : 'NO',
    fechaInforme: anulado ? null : caso.fechaEnvioAseguradora || caso.informeUnico?.fechaInforme || null,
    documentacionCompleta: anulado ? 'N/A' : 'NO',
    fechaDocumentacionCompleta: null,
    casoCerrado: anulado || unico ? 'SI' : 'NO',
    fechaCierre: anulado || unico
      ? caso.fechaLiquidado || caso.fechaEnvioAseguradora || caso.updatedAt || null
      : null,
    estadoSiniestro: estadoFacilitadorDesdeArnald(estado),
    ultimoComentario: String(caso.observacionLlamada || '').trim(),
  };
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

export function erroresValidacionPortal(fila = {}) {
  const errores = [];
  const rec = digitsReclamacion(fila.reclamacion);
  if (rec.length !== 13) errores.push('Reclamación debe tener 13 dígitos');
  const visita = normalizarSinoNa(fila.visitaRealizada);
  const informe = normalizarSinoNa(fila.informeEnviado);
  const docs = normalizarSinoNa(fila.documentacionCompleta);
  const cerrado = normalizarSinoNa(fila.casoCerrado, { permitirNA: false });
  if (!visita) errores.push('Visita realizada (SI / NO / N/A)');
  if (visita === 'SI' && !parseFecha(fila.fechaVisita)) errores.push('Fecha de visita');
  if (!informe) errores.push('Informe enviado (SI / NO / N/A)');
  if (informe === 'SI' && !parseFecha(fila.fechaInforme)) errores.push('Fecha de informe');
  if (!docs) errores.push('Documentación completa (SI / NO / N/A)');
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
