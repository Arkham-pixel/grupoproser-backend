/**
 * Parser del Excel Fundación de la Mujer (OLA INVERNAL y TERREMOTO).
 * Mapeo por encabezado, no por índice de columna.
 */
import XLSX from 'xlsx';

const normHeader = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[°º]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const HEADER_MAP = {
  NUMERO: 'numero',
  N: 'numero',
  NOMBRE: 'nombre',
  ASEGURADO: 'nombre',
  CEDULA: 'cedula',
  IDENTIFICACION: 'cedula',
  CELULAR: 'celular',
  TELEFONO: 'celular',
  'DIRECCION AFECTADA': 'direccionAfectada',
  DIRECCION: 'direccionAfectada',
  MUNICIPIO: 'municipio',
  'CIUDAD MUNICIPIO': 'municipio',
  CIUDAD: 'municipio',
  DEPARTAMENTO: 'departamento',
  'OFICINA RADICADORA': 'oficinaRadicadora',
  OFICINA: 'oficinaRadicadora',
  AJUSTADOR: 'ajustador',
  AIF: 'aif',
  'ASESOR INTEGRAL': 'aif',
  'POLIZA DANOS VIGENTE SI NO': 'polizaDanosVigente',
  'POLIZA DANOS VIGENTE': 'polizaDanosVigente',
  'POLIZA AFECTAR': 'polizaAfectar',
  POLIZA: 'polizaAfectar',
  ORDEN: 'orden',
  'VIGENCIA POLIZA': 'vigenciaPoliza',
  'AFECTACIONES ANTERIORES': 'afectacionesAnteriores',
  'SINIESTRO INDEMNIZADO': 'siniestroIndemnizado',
  EDIFCIO: 'valorEdificio',
  EDIFICIO: 'valorEdificio',
  'VALOR EDIFICIO': 'valorEdificio',
  CONTENIDO: 'valorContenido',
  'VALOR CONTENIDO': 'valorContenido',
  'VALORES QUE SE PUEDE INDEMNIZAR': 'valoresIndemnizables',
  'VALORES INDEMNIZABLES': 'valoresIndemnizables',
  'SUBSIDIO EMPRESARIAL': 'subsidioEmpresarial',
  COBERTURA: 'cobertura',
  PRIMAS: 'primas',
  'TIPO DE NEGOCIO': 'tipoNegocio',
  'PERDIDA POR CONTENIDOS': 'perdidaContenidos',
  'PERDIDA POR EDIFICIO': 'perdidaEdificio',
  'TOTAL PERDIDA': 'totalPerdida',
  DEDUCIBLE: 'deducible',
  'TOTAL LIQUIDADO': 'totalLiquidado',
  SUBSIDIO: 'subsidio',
  'VALOR INDEMNIZADO AJUSTADOR': 'valorIndemnizadoAjustador',
  CASO: 'caso',
  SINIESTRO: 'siniestro',
  'FECHA DE REGISTRO': 'fechaRegistro',
  'FECHA REGISTRO': 'fechaRegistro',
  'FECHA DE LIQUIDACION': 'fechaLiquidacion',
  'FECHA LIQUIDACION': 'fechaLiquidacion',
  'FECHA DE AVISO': 'fechaAviso',
  'FECHA AVISO': 'fechaAviso',
  'VALOR DE OBJECION': 'valorObjecion',
  'VALOR OBJECION': 'valorObjecion',
  'FECHA DE CAUSACION': 'fechaCausacion',
  'FECHA CAUSACION': 'fechaCausacion',
  'VALOR INDEMNIZADO': 'valorIndemnizado',
  'FECHA DE GIRO': 'fechaGiro',
  'FECHA GIRO': 'fechaGiro',
  ESTADO: 'estado',
  OBSERVACIONES: 'observaciones',
  DETALLE: 'detalle',
  EVENTO: 'evento',
};

const CAMPOS_FECHA = new Set([
  'fechaRegistro',
  'fechaLiquidacion',
  'fechaAviso',
  'fechaCausacion',
  'fechaGiro',
]);

const CAMPOS_NUMERO = new Set([
  'numero',
  'valorEdificio',
  'valorContenido',
  'valoresIndemnizables',
  'perdidaContenidos',
  'perdidaEdificio',
  'totalPerdida',
  'deducible',
  'totalLiquidado',
  'subsidio',
  'valorIndemnizadoAjustador',
  'valorIndemnizado',
]);

const CAMPOS_MAYUSCULAS = new Set([
  'municipio',
  'departamento',
  'ajustador',
  'aif',
  'polizaDanosVigente',
  'afectacionesAnteriores',
  'siniestroIndemnizado',
  'cobertura',
  'primas',
  'tipoNegocio',
  'estado',
  'detalle',
  'evento',
  'oficinaRadicadora',
]);

export const limpiarTexto = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return null;
  const texto = String(value).replace(/\s+/g, ' ').trim();
  return texto || null;
};

export const limpiarTextoMayusculas = (value) => {
  const texto = limpiarTexto(value);
  return texto ? texto.toUpperCase() : null;
};

const esMontoVacio = (value) => {
  const t = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return !t || t === '-' || t === '$ -' || t === '$-' || t === '$' || t === 'N/A' || t === 'NA';
};

export const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (esMontoVacio(value)) return 0;
  let texto = String(value).replace(/[$%\s]/g, '').trim();
  if (!texto || texto === '-') return 0;
  if (texto.includes(',') && texto.includes('.')) {
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) {
      texto = texto.replace(/\./g, '').replace(',', '.');
    } else {
      texto = texto.replace(/,/g, '');
    }
  } else if (texto.includes(',')) {
    const partes = texto.split(',');
    texto = partes.length === 2 && partes[1].length !== 3 ? texto.replace(',', '.') : texto.replace(/,/g, '');
  } else if (texto.includes('.')) {
    const partes = texto.split('.');
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) {
      texto = texto.replace(/\./g, '');
    }
  }
  const n = Number(texto.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const fechaValida = (y, m, d) => {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const anioCompleto = (y) => (y >= 100 ? y : y >= 70 ? 1900 + y : 2000 + y);

const elegirEntreDM = (a, b, c) => {
  const y = anioCompleto(c);
  const comoDiaMes = fechaValida(y, b, a);
  const comoMesDia = fechaValida(y, a, b);
  if (comoDiaMes && !comoMesDia) return comoDiaMes;
  if (comoMesDia && !comoDiaMes) return comoMesDia;
  if (!comoDiaMes && !comoMesDia) return null;
  const ref = new Date(2026, 7, 10, 12, 0, 0);
  const distA = Math.abs(comoDiaMes.getTime() - ref.getTime());
  const distB = Math.abs(comoMesDia.getTime() - ref.getTime());
  return distA <= distB ? comoDiaMes : comoMesDia;
};

export const parseFechaFlexible = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const utc = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(utc.getTime() + value * 86400000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const texto = String(value).trim();
  if (!texto || texto === '-') return null;

  let match = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return fechaValida(Number(match[1]), Number(match[2]), Number(match[3]));

  match = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) return elegirEntreDM(Number(match[1]), Number(match[2]), Number(match[3]));

  match = texto.match(/^(\d{2})(\d{2})\/(\d{4})$/);
  if (match) return fechaValida(Number(match[3]), Number(match[2]), Number(match[1]));

  match = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\/(\d{2})$/);
  if (match) {
    return fechaValida(Number(`${match[3]}${match[4]}`), Number(match[2]), Number(match[1]));
  }

  const parsed = new Date(texto);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const inferirEventoFdm = ({ cobertura, archivoNombre, hoja } = {}) => {
  const blob = `${cobertura || ''} ${archivoNombre || ''} ${hoja || ''}`.toUpperCase();
  if (/TERREMOTO|TEMBLOR/.test(blob)) return 'TERREMOTO 10 AGOSTO 2026';
  if (/ANEGACION|OLA INVERNAL|INVERNAL/.test(blob)) return 'OLA INVERNAL';
  return null;
};

const FLAGS_SUBSIDIO = new Set(['SI', 'NO', 'APLICA', 'NO APLICA']);

const partirSubsidioEmpresarial = (value) => {
  const texto = limpiarTextoMayusculas(value);
  if (!texto) return { flag: null, monto: null };
  if (FLAGS_SUBSIDIO.has(texto)) {
    if (texto === 'SI') return { flag: 'APLICA', monto: null };
    if (texto === 'NO') return { flag: 'NO APLICA', monto: null };
    return { flag: texto, monto: null };
  }
  const monto = toNumberOrNull(value);
  if (monto != null && monto > 0) return { flag: 'APLICA', monto };
  return { flag: texto, monto: null };
};

const mapearEncabezados = (headerRow = []) => {
  const indice = {};
  headerRow.forEach((celda, i) => {
    const campo = HEADER_MAP[normHeader(celda)];
    if (campo && indice[campo] == null) indice[campo] = i;
  });
  return indice;
};

const valorCelda = (row, indice, campo) => {
  const i = indice[campo];
  if (i == null) return null;
  return row[i];
};

const normalizarCobertura = (value) => {
  const cobertura = limpiarTextoMayusculas(value);
  if (!cobertura) return null;
  if (cobertura === 'ANEGACIÓN' || cobertura === 'ANEGACION') return 'ANEGACION';
  if (cobertura === 'TEMBLOR' || cobertura === 'TERREMOTO') return 'TEMBLOR';
  return cobertura;
};

const mapRow = (row, indice, meta) => {
  const nombre = limpiarTexto(valorCelda(row, indice, 'nombre'));
  const cedula = limpiarTexto(valorCelda(row, indice, 'cedula'));
  if (!nombre && !cedula) return null;

  const cobertura = normalizarCobertura(valorCelda(row, indice, 'cobertura'));
  const eventoExcel = limpiarTextoMayusculas(valorCelda(row, indice, 'evento'));
  const evento =
    eventoExcel ||
    inferirEventoFdm({ cobertura, archivoNombre: meta.archivoNombre, hoja: meta.hoja });

  const fechaRegistro = parseFechaFlexible(valorCelda(row, indice, 'fechaRegistro'));
  const fechaAviso = parseFechaFlexible(valorCelda(row, indice, 'fechaAviso')) || fechaRegistro;

  const partido = partirSubsidioEmpresarial(valorCelda(row, indice, 'subsidioEmpresarial'));
  const subsidioCol = toNumberOrNull(valorCelda(row, indice, 'subsidio'));

  const doc = {
    nombre: nombre || 'SIN NOMBRE',
    cedula,
    evento,
    cobertura,
    fechaRegistro,
    fechaAviso,
    subsidioEmpresarial: partido.flag,
    subsidio: subsidioCol != null && subsidioCol !== 0 ? subsidioCol : partido.monto,
  };

  const omitir = new Set([
    'nombre',
    'cedula',
    'evento',
    'cobertura',
    'fechaRegistro',
    'fechaAviso',
    'subsidioEmpresarial',
    'subsidio',
  ]);

  for (const campo of Object.keys(indice)) {
    if (omitir.has(campo)) continue;
    const crudo = valorCelda(row, indice, campo);
    if (CAMPOS_FECHA.has(campo)) {
      doc[campo] = parseFechaFlexible(crudo);
    } else if (CAMPOS_NUMERO.has(campo)) {
      doc[campo] = toNumberOrNull(crudo);
    } else if (CAMPOS_MAYUSCULAS.has(campo)) {
      doc[campo] = limpiarTextoMayusculas(crudo);
    } else {
      doc[campo] = limpiarTexto(crudo);
    }
  }

  if (!doc.estado) doc.estado = 'PENDIENTE';
  return doc;
};

const elegirHojaCasos = (wb) => {
  const conEncabezados = wb.SheetNames.find((name) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, range: 0 });
    const headerIdx = rows.findIndex(
      (r) =>
        Array.isArray(r) &&
        r.some((c) => normHeader(c) === 'NOMBRE') &&
        r.some((c) => ['CEDULA', 'IDENTIFICACION'].includes(normHeader(c)))
    );
    return headerIdx >= 0;
  });
  return conEncabezados || wb.SheetNames[0];
};

export const parsearCasosFdmDesdeArchivo = (filePath, archivoNombre = '') => {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  if (!wb.SheetNames.length) throw new Error('El Excel no tiene hojas.');

  const hoja = elegirHojaCasos(wb);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], {
    header: 1,
    defval: null,
    raw: true,
  });

  const headerIdx = rows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => normHeader(c) === 'NOMBRE')
  );
  if (headerIdx < 0) {
    throw new Error('No se encontró la fila de encabezados (columna NOMBRE).');
  }

  const indice = mapearEncabezados(rows[headerIdx]);
  const meta = { archivoNombre: archivoNombre || filePath, hoja };
  const casos = [];
  for (const row of rows.slice(headerIdx + 1)) {
    if (!Array.isArray(row)) continue;
    const doc = mapRow(row, indice, meta);
    if (doc) casos.push(doc);
  }

  return { casos, hoja, encabezados: Object.keys(indice) };
};
