import ExcelJS from 'exceljs';
import {
  calcularTotalesControlHoras,
  crearFilaVacia,
  fechaParaInput,
  normalizarControlHorasParaGuardar,
} from './controlHorasImportHelpers.js';
import { resolverTarifaHora } from './controlHorasImportHelpers.js';

const normalizar = (texto) =>
  String(texto ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const aTextoSeguro = (valor) => {
  if (valor == null || valor === '') return '';
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? '' : valor.toLocaleDateString('es-CO');
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (typeof valor === 'string') {
    return valor.trim();
  }
  if (typeof valor === 'object') {
    if (valor.error) return '';
    if (valor.result != null && valor.result !== '') return aTextoSeguro(valor.result);
    if (valor.text != null && valor.text !== '') return aTextoSeguro(valor.text);
    if (Array.isArray(valor.richText)) {
      return valor.richText.map((t) => aTextoSeguro(t?.text)).join('').trim();
    }
    if (valor.hyperlink && valor.text) return aTextoSeguro(valor.text);
    return '';
  }
  try {
    return String(valor).trim();
  } catch {
    return '';
  }
};

/** Valor visible o calculado de la celda (incluye texto formateado "2,00"). */
const valorCelda = (cell) => {
  if (!cell) return null;
  try {
    const desdeValor = aTextoSeguro(cell.value);
    if (desdeValor) return desdeValor;
    const desdeTexto = aTextoSeguro(cell.text);
    if (desdeTexto) return desdeTexto;
    return null;
  } catch {
    return null;
  }
};

const textoCelda = (cell) => {
  const v = valorCelda(cell);
  return v == null ? '' : aTextoSeguro(v);
};

const parseNumero = (valor) => {
  if (valor == null || valor === '') return 0;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  let s = String(valor).trim();
  if (!s) return 0;
  s = s.replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    return parseFloat(s.replace(/\./g, '')) || 0;
  }
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Montos COP: $100.000,00 | $87.424,00 | $1.092.800,00 */
const parseMoneda = (valor) => {
  if (valor == null || valor === '') return 0;
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return valor >= 100 ? valor : 0;
  }
  const s = aTextoSeguro(valor).replace(/[$\s]/g, '');
  if (!s) return 0;
  const partes =
    s.match(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:\.\d{3})+|\d+(?:,\d{1,2})?/g) || [];
  let mejor = 0;
  partes.forEach((parte) => {
    const n = parseNumero(parte);
    if (n > mejor) mejor = n;
  });
  if (mejor > 0) return mejor;
  return parseNumero(s);
};

const esValorHoraRazonable = (n) => n >= 5000 && n <= 999999;

/** Horas en texto: 2,00 | 0,50 | 2:30 (HH:MM). */
const parseHorasTexto = (valor) => {
  if (valor == null || valor === '') return 0;
  const s = String(valor).trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const partes = s.split(':').map((p) => parseNumero(p));
    return (partes[0] || 0) + (partes[1] || 0) / 60;
  }
  return parseNumero(valor);
};

const numFmtEsTiempo = (numFmt) =>
  /[hms]/i.test(String(numFmt || '').replace(/\[[^\]]*\]/g, ''));

/**
 * Lee horas desde celda Excel.
 * Plantillas PROSER usan horas decimales (0,50 = media hora), no fracción de día.
 * Solo convierte value*24 si la celda tiene formato de hora Excel y el valor es fracción < 1.
 */
const parseHorasDesdeCelda = (cell) => {
  if (!cell) return 0;
  const textoVisible = aTextoSeguro(cell.text).trim();
  const valor = cell.value;

  if (textoVisible.includes(':')) {
    return parseHorasTexto(textoVisible);
  }

  if (textoVisible) {
    return parseHorasTexto(textoVisible);
  }

  if (typeof valor === 'number' && Number.isFinite(valor)) {
    if (valor > 0 && valor < 1 && numFmtEsTiempo(cell.numFmt)) {
      return Math.round(valor * 24 * 100) / 100;
    }
    return valor;
  }

  return parseHorasTexto(valorCelda(cell));
};

const parseHoras = (valor) => parseHorasTexto(valor);

const parseFecha = (valor) => {
  if (valor == null || valor === '') return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return fechaParaInput(valor);
  }
  if (typeof valor === 'number' && valor > 30000 && valor < 60000) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + valor * 86400000);
    return fechaParaInput(d);
  }
  const s = String(valor).trim();
  const dmY = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmY) {
    const d = dmY[1].padStart(2, '0');
    const m = dmY[2].padStart(2, '0');
    let y = dmY[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
};

const ALIAS_COLUMNAS = {
  fecha: ['FECHA'],
  descripcion: [
    'DESCRIPCION ACTIVIDAD',
    'DESCRIPCION DE LA ACTIVIDAD',
    'DESCRIPCION',
    'ACTIVIDAD',
  ],
  funcionario: ['FUNCIONARIO', 'NOMBRE FUNCIONARIO'],
  cargo: ['CARGO / PROFESION', 'CARGO PROFESION', 'CARGO', 'PROFESION'],
  viaje: ['HORAS DESPLAZAMIENTO', 'DESPLAZAMIENTO - VIAJE', 'VIAJE'],
  campo: ['HORAS DE CAMPO', 'HORAS CAMPO', 'CAMPO - INSPECCION', 'INSPECCION'],
  oficina: ['HORAS OFICINA', 'OFICINA'],
  secretaria: ['HORAS SECRETARIA', 'SECRETARIA', 'SECR'],
  total: ['HORAS TOTAL', 'TOTAL HORAS'],
};

const esEncabezadoFecha = (texto) => {
  const h = normalizar(texto);
  if (h === 'FECHA') return true;
  return false;
};

const coincideAlias = (header, aliasList, key = '') => {
  const h = normalizar(header);
  if (!h) return false;
  if (key === 'fecha') return esEncabezadoFecha(header);
  return aliasList.some((a) => {
    const alias = normalizar(a);
    return h === alias || h.includes(alias) || alias.includes(h);
  });
};

const detectarMapaColumnas = (filaHeaders) => {
  const mapa = {};
  filaHeaders.forEach((texto, idx) => {
    const col = idx + 1;
    Object.entries(ALIAS_COLUMNAS).forEach(([key, aliases]) => {
      if (!mapa[key] && coincideAlias(texto, aliases, key)) {
        mapa[key] = col;
      }
    });
  });
  return mapa;
};

const ultimaFilaHoja = (sheet) => {
  const bottom = sheet.dimensions?.bottom;
  if (bottom && bottom > 0) return bottom;
  let max = sheet.rowCount || 0;
  sheet.eachRow((row, num) => {
    if (num > max) max = num;
  });
  return max || 80;
};

const esFilaFinTabla = (row) => {
  for (let c = 1; c <= 12; c++) {
    const t = normalizar(textoCelda(row.getCell(c)));
    if (
      t.includes('VALORES TOTALES') ||
      t === 'TOTAL' ||
      t.includes('HONORARIOS') ||
      t.includes('SUBTOTAL')
    ) {
      return true;
    }
  }
  return false;
};

const sumarHorasFila = (row, mapa) => {
  const cols = [mapa.viaje, mapa.campo, mapa.oficina, mapa.secretaria].filter(Boolean);
  let suma = cols.reduce((acc, col) => acc + parseHorasDesdeCelda(row.getCell(col)), 0);
  if (suma <= 0 && mapa.total) {
    suma = parseHorasDesdeCelda(row.getCell(mapa.total));
  }
  return suma;
};

const filaTieneDatos = (row, mapa) => {
  const desc = textoCelda(row.getCell(mapa.descripcion));
  const func = textoCelda(row.getCell(mapa.funcionario));
  const horas = sumarHorasFila(row, mapa);
  const fechaTxt = textoCelda(row.getCell(mapa.fecha));
  const pareceFecha = /^\d{1,2}[\/\-]\d{1,2}/.test(fechaTxt);
  return Boolean(desc || func || horas > 0 || pareceFecha);
};

const extraerCampoCabeceraExcel = (sheet, antesDeFilaTabla, patronLabel) => {
  const busca = normalizar(patronLabel);
  for (let r = 1; r < antesDeFilaTabla; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= 12; c++) {
      const label = normalizar(textoCelda(row.getCell(c)));
      if (!label.includes(busca)) continue;
      const columnasValor = [c + 1, 2, c + 3, 4, 6];
      for (const col of columnasValor) {
        const valor = valorCelda(row.getCell(col));
        const texto = aTextoSeguro(valor);
        if (texto) return texto;
      }
    }
  }
  return '';
};

/** Formato vertical (label col A, valor col B) y horizontal (pares de columnas). */
const leerFilaResumen = (sheet, ultima) => {
  let valorHora = null;
  let gastos = null;
  let totalHorasHonorarios = null;
  let subtotalHonorarios = null;

  const asignarValorHora = (candidatos) => {
    const tarifas = candidatos.filter(esValorHoraRazonable);
    if (!tarifas.length) return;
    const menor = Math.min(...tarifas);
    if (!valorHora || menor < valorHora) valorHora = menor;
  };

  const montosEnFila = (row, colInicio = 1) => {
    const montos = [];
    for (let c = colInicio; c <= 15; c++) {
      const m = parseMoneda(valorCelda(row.getCell(c)));
      if (m > 0) montos.push(m);
    }
    return montos;
  };

  for (let r = 1; r <= ultima; r++) {
    const row = sheet.getRow(r);

    for (let c = 1; c <= 15; c++) {
      const t = normalizar(textoCelda(row.getCell(c)));
      if (!t) continue;

      if (t.includes('VALOR HORA') && !t.includes('HONORARIOS')) {
        const candidatos = [
          parseMoneda(textoCelda(row.getCell(c))),
          parseMoneda(valorCelda(row.getCell(c + 1))),
          parseMoneda(valorCelda(row.getCell(2))),
          parseMoneda(valorCelda(row.getCell(c + 2))),
        ];
        asignarValorHora(candidatos);
      }

      if (t.includes('HONORARIOS') && !t.includes('VALOR HORA')) {
        for (let k = 1; k <= 10; k++) {
          const h = parseHorasDesdeCelda(row.getCell(c + k));
          if (h > 0 && h < 500) {
            totalHorasHonorarios = h;
            break;
          }
        }
        const montos = montosEnFila(row, c + 1);
        const subtotales = montos.filter((m) => m >= 50000);
        if (subtotales.length) {
          subtotalHonorarios = Math.max(subtotalHonorarios || 0, ...subtotales);
        }
      }

      if (t === 'GASTOS' || t.startsWith('GASTOS')) {
        const g = parseMoneda(valorCelda(row.getCell(c + 1))) || parseMoneda(valorCelda(row.getCell(2)));
        if (g >= 0) gastos = g;
      }

      if (t.includes('TOTAL') && t.includes('FACTURAR')) {
        const g = parseMoneda(valorCelda(row.getCell(c + 1)));
        if (g >= 0) gastos = g;
      }
    }

    const labelA = normalizar(textoCelda(row.getCell(1)));
    const valB = valorCelda(row.getCell(2));

    if (labelA.includes('VALOR HORA')) {
      asignarValorHora([parseMoneda(textoCelda(row.getCell(1))), parseMoneda(valB)]);
    }
    if (labelA.includes('HONORARIOS') && !labelA.includes('VALOR')) {
      const h = parseHorasDesdeCelda(row.getCell(2));
      if (h > 0 && h < 500) totalHorasHonorarios = h;
    }
    if (labelA === 'GASTOS' || labelA.startsWith('GASTOS')) {
      const g = parseMoneda(valB);
      if (g >= 0) gastos = g;
    }
  }

  if (!subtotalHonorarios) {
    for (let r = 1; r <= ultima; r++) {
      const montos = montosEnFila(sheet.getRow(r));
      const grandes = montos.filter((m) => m >= 100000 && m < 50000000);
      if (grandes.length) {
        subtotalHonorarios = Math.max(subtotalHonorarios || 0, ...grandes);
      }
    }
  }

  if ((!valorHora || !esValorHoraRazonable(valorHora)) && subtotalHonorarios && totalHorasHonorarios) {
    valorHora = Math.round(subtotalHonorarios / totalHorasHonorarios);
  }

  return { valorHora, gastos, totalHorasHonorarios, subtotalHonorarios };
};

const buscarHojaControl = (workbook) => {
  const preferida = workbook.worksheets.find((ws) => {
    const n = normalizar(ws.name);
    return (
      n.includes('FORMATO') ||
      n.includes('CONTROL') ||
      n.includes('HORA') ||
      n.includes('AJUSTE') ||
      n.includes('TIEMPO')
    );
  });
  if (preferida) return preferida;
  return (
    workbook.worksheets.find((ws) => (ws.rowCount || 0) > 10) || workbook.worksheets[0]
  );
};

const buscarFilaEncabezados = (sheet, ultima) => {
  for (let r = 1; r <= Math.min(ultima, 80); r++) {
    const row = sheet.getRow(r);
    const textos = [];
    for (let c = 1; c <= 15; c++) {
      textos.push(textoCelda(row.getCell(c)));
    }
    const tieneFechaCol = textos.some((t) => esEncabezadoFecha(t));
    const tieneDescripcion = textos.some((t) =>
      coincideAlias(t, ALIAS_COLUMNAS.descripcion, 'descripcion')
    );
    const tieneHoras = textos.some(
      (t) => normalizar(t).includes('HORAS') && !normalizar(t).includes('HONORARIOS')
    );
    if (tieneFechaCol && (tieneDescripcion || tieneHoras) && tieneHoras) {
      return { fila: r, textos };
    }
  }
  return null;
};

export async function importarControlHorasDesdeArchivo(
  archivo,
  { formData = {}, nombreAseguradora = '' } = {}
) {
  if (!archivo) throw new Error('No se seleccionó ningún archivo.');

  const ext = (archivo.name || '').split('.').pop()?.toLowerCase();
  if (!['xlsx', 'xlsm', 'xls'].includes(ext)) {
    throw new Error('Seleccione un archivo Excel (.xlsx o .xls).');
  }

  const buffer = await archivo.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = buscarHojaControl(workbook);
  if (!sheet) throw new Error('El archivo no contiene hojas válidas.');

  const ultima = ultimaFilaHoja(sheet);
  const encabezado = buscarFilaEncabezados(sheet, ultima);
  if (!encabezado) {
    throw new Error(
      'No se encontró la tabla de actividades. Debe incluir fila con FECHA, DESCRIPCIÓN ACTIVIDAD y columnas de HORAS.'
    );
  }

  const mapa = detectarMapaColumnas(encabezado.textos);
  const base = mapa.fecha || 1;
  if (!mapa.fecha) mapa.fecha = base;
  if (!mapa.descripcion) mapa.descripcion = base + 1;
  if (!mapa.funcionario) mapa.funcionario = base + 2;
  if (!mapa.cargo) mapa.cargo = base + 3;
  if (!mapa.viaje) mapa.viaje = base + 4;
  if (!mapa.campo) mapa.campo = base + 5;
  if (!mapa.oficina) mapa.oficina = base + 6;
  if (!mapa.secretaria) mapa.secretaria = base + 7;
  if (!mapa.total) mapa.total = base + 8;

  const filas = [];
  let filaFin = encabezado.fila + 1;
  let totalHorasTabla = null;
  const responsable = formData.nombreResponsable || formData.responsable || '';

  for (let r = encabezado.fila + 1; r <= ultima; r++) {
    const row = sheet.getRow(r);

    if (esFilaFinTabla(row)) {
      filaFin = r;
      if (mapa.total) {
        const th = parseHorasDesdeCelda(row.getCell(mapa.total));
        if (th > 0) totalHorasTabla = th;
      }
      break;
    }

    if (!filaTieneDatos(row, mapa)) continue;

    filas.push({
      ...crearFilaVacia({ nombre_funcionario: responsable, cargo: 'Ajustador' }),
      fecha: parseFecha(valorCelda(row.getCell(mapa.fecha))),
      descripcion: textoCelda(row.getCell(mapa.descripcion)),
      nombre_funcionario: textoCelda(row.getCell(mapa.funcionario)) || responsable,
      cargo: textoCelda(row.getCell(mapa.cargo)) || 'Ajustador',
      horas_viaje: parseHorasDesdeCelda(row.getCell(mapa.viaje)),
      horas_campo: parseHorasDesdeCelda(row.getCell(mapa.campo)),
      horas_oficina: parseHorasDesdeCelda(row.getCell(mapa.oficina)),
      horas_secretaria: parseHorasDesdeCelda(row.getCell(mapa.secretaria)),
    });
  }

  if (!filas.length) {
    throw new Error(
      'No se encontraron filas de actividades con horas en el Excel. Verifique que la tabla tenga datos debajo de los encabezados (FECHA, DESCRIPCIÓN, columnas de HORAS).'
    );
  }

  const companiaExcel = extraerCampoCabeceraExcel(sheet, encabezado.fila, 'COMPANIA');
  const nombreTarifa =
    nombreAseguradora || companiaExcel || formData.nombreCliente || '';
  const fechaAsignacionExcel = extraerCampoCabeceraExcel(
    sheet,
    encabezado.fila,
    'FECHA ASIGNACION'
  );
  const fchaAsignacionTarifa =
    formData.fchaAsgncion ||
    parseFecha(fechaAsignacionExcel) ||
    '';

  const resumen = leerFilaResumen(sheet, ultima);
  let valorHora = resumen.valorHora;
  let gastos = resumen.gastos ?? '';

  const horasDesdeFilas = calcularTotalesControlHoras({
    filas,
    valor_hora: 1,
    gastos: 0,
  }).total_horas;

  const horasReferencia =
    resumen.totalHorasHonorarios || totalHorasTabla || horasDesdeFilas || 0;

  if ((!valorHora || !esValorHoraRazonable(valorHora)) && resumen.subtotalHonorarios && horasReferencia > 0) {
    valorHora = Math.round(resumen.subtotalHonorarios / horasReferencia);
  }

  const advertencias = [];
  let valor_hora_origen = 'manual';
  const tieneValorHora = valorHora != null && esValorHoraRazonable(valorHora);

  if (tieneValorHora) {
    const tarifa = resolverTarifaHora({
      codiAsgrdra: formData.codiAsgrdra,
      nombreAseguradora: nombreTarifa,
      nombreCliente: formData.nombreCliente || companiaExcel,
      fchaAsgncion: fchaAsignacionTarifa,
    });
    if (tarifa.origen === 'tarifa' && Math.abs(tarifa.valorHora - valorHora) < 2) {
      valor_hora_origen = 'tarifa';
    }
  } else {
    valorHora = '';
    advertencias.push(
      'No se detectó el valor hora en el Excel. Se importaron las horas trabajadas; ingrese el valor hora manualmente en «Editar control de horas» (Previsora y otras compañías sin tarifa fija suelen requerirlo).'
    );
  }

  const borrador = {
    valor_hora: tieneValorHora ? valorHora : '',
    valor_hora_origen,
    gastos: gastos === '' ? 0 : gastos,
    filas,
  };

  const totales = calcularTotalesControlHoras({
    ...borrador,
    valor_hora: tieneValorHora ? valorHora : 0,
  });
  const normalizado = normalizarControlHorasParaGuardar(borrador);

  let mensaje = `Se importaron ${filas.length} actividad(es) con ${totales.total_horas.toFixed(2)} horas.`;
  if (advertencias.length) {
    mensaje += ' Revise el valor hora antes de guardar el caso.';
  } else {
    mensaje += ' Revise los datos y guarde el caso.';
  }

  return {
    normalizado,
    totales,
    mensaje,
    advertencias,
    requiereValorHoraManual: !tieneValorHora,
  };
}

/** Variante para scripts Node: recibe Buffer directamente. */
export async function importarControlHorasDesdeBuffer(
  buffer,
  filename = 'control.xlsx',
  options = {}
) {
  const archivo = {
    name: filename,
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
  return importarControlHorasDesdeArchivo(archivo, options);
}
