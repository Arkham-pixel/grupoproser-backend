/**
 * Recupera texto y montos COP cuando un parser de .docx pegó OOXML (w:tcPr, w:t, …)
 * o cuando InputMoneda concatenó los dígitos de esos atributos.
 */

export const MAX_DIGITOS_COP_INFORME = 13;
export const MAX_COP_INFORME = 9_999_999_999_999;

/** Dígitos típicos de <w:tcPr> de la columna «Valor estimado» (ancho 2000) del Word Zurich. */
const PREFIJO_DIGITOS_CELDA_VALOR_WORD = '200010000008000000800000080000008801008010002424';

export function esXmlWordOoXml(valor) {
  return /<w:|w:tcPr|w:tcW|w:gridSpan|w:tcBorders/.test(String(valor || ''));
}

function decodificarEntidadesXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function extraerTextosWord(xml) {
  const s = String(xml || '');
  const partes = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(s))) partes.push(decodificarEntidadesXml(m[1]));
  if (partes.length) {
    return partes.join('').replace(/\s+/g, ' ').trim();
  }
  const abierto = s.match(/<w:t\b[^>]*>([\s\S]*)$/);
  if (abierto) {
    const bruto = abierto[1].replace(/<[^>]+>/g, ' ');
    return decodificarEntidadesXml(bruto).replace(/\s+/g, ' ').trim();
  }
  return '';
}

export function limpiarTextoCampoInforme(valor) {
  const s = String(valor ?? '').trim();
  if (!s) return '';
  if (esXmlWordOoXml(s)) return extraerTextosWord(s);
  return s;
}

function parsearMontoLimpio(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor <= 0 || Math.abs(valor) > MAX_COP_INFORME) return 0;
    return valor;
  }
  let numero = String(valor).replace(/[^\d.,-]/g, '');
  const nDigitos = numero.replace(/[^\d]/g, '').length;
  if (!numero || nDigitos === 0 || nDigitos > MAX_DIGITOS_COP_INFORME) return 0;
  if (numero.includes(',') && numero.includes('.')) {
    numero = numero.replace(/\./g, '').replace(',', '.');
  } else if (numero.includes('.') && !numero.includes(',')) {
    numero = numero.replace(/\./g, '');
  } else if (numero.includes(',')) {
    numero = numero.replace(',', '.');
  }
  const n = parseFloat(numero);
  return Number.isFinite(n) && n > 0 && n <= MAX_COP_INFORME ? n : 0;
}

/**
 * Interpreta un valor de presupuesto aunque venga como XML de Word o como
 * sopa de dígitos (atributos OOXML + monto con puntos de miles al final).
 */
export function parsearMontoInformeSeguro(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  if (typeof valor === 'number') return parsearMontoLimpio(valor);
  const str = String(valor);

  if (esXmlWordOoXml(str)) {
    const nTxt = parsearMontoLimpio(extraerTextosWord(str));
    if (nTxt > 0) return nTxt;
  }

  const m2424 = str.match(/2424(\d{1,3}(?:\.\d{3})+)$/);
  if (m2424) {
    const n = parsearMontoLimpio(m2424[1]);
    if (n > 0) return n;
  }

  const digits = str.replace(/[^\d]/g, '');
  if (digits.startsWith(PREFIJO_DIGITOS_CELDA_VALOR_WORD)) {
    const n = parsearMontoLimpio(digits.slice(PREFIJO_DIGITOS_CELDA_VALOR_WORD.length));
    if (n > 0) return n;
  }

  const soloPuntos = str.replace(/[^\d.]/g, '');
  if (soloPuntos.startsWith(PREFIJO_DIGITOS_CELDA_VALOR_WORD)) {
    const n = parsearMontoLimpio(soloPuntos.slice(PREFIJO_DIGITOS_CELDA_VALOR_WORD.length));
    if (n > 0) return n;
  }

  return parsearMontoLimpio(str);
}

function esFilaTotalPresupuesto(fila, capitulo, descripcion) {
  const xml = `${fila?.capitulo || ''}${fila?.descripcion || ''}`;
  if (/w:w="7360"/.test(xml) || /gridSpan w:val="2"/.test(xml)) return true;
  const blob = `${capitulo} ${descripcion}`.toUpperCase();
  return /TOTAL RESERVA/.test(blob);
}

function esFilaEncabezadoPresupuesto(capitulo) {
  const n = String(capitulo || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return n === 'capitulo' || n === 'capitulo.';
}

export function sanitizarFilaPresupuestoPreliminar(fila = {}, idx = 0) {
  const capitulo = limpiarTextoCampoInforme(fila?.capitulo);
  const descripcion = limpiarTextoCampoInforme(fila?.descripcion);
  if (esFilaTotalPresupuesto(fila, capitulo, descripcion)) return null;
  if (esFilaEncabezadoPresupuesto(capitulo)) return null;
  const n = parsearMontoInformeSeguro(fila?.valor);
  return {
    ...fila,
    id: fila?.id || `cap-${idx}`,
    capitulo,
    descripcion,
    valor: n > 0 ? String(Math.round(n)) : '',
  };
}

export function sanitizarFilaDaniosInforme(fila = {}, idx = 0) {
  const zona = limpiarTextoCampoInforme(fila?.zona);
  const condicion = limpiarTextoCampoInforme(fila?.condicion);
  const nivel = limpiarTextoCampoInforme(fila?.nivel);
  if (/^elemento\s*\/\s*zona$/i.test(zona)) return null;
  return {
    ...fila,
    id: fila?.id || `danio-${idx}`,
    zona,
    condicion,
    nivel,
    observacion: limpiarTextoCampoInforme(fila?.observacion),
    descripcion: fila?.descripcion != null ? limpiarTextoCampoInforme(fila.descripcion) : fila?.descripcion,
  };
}

export function sanitizarFilaPolizaInforme(fila = {}, idx = 0) {
  return {
    ...fila,
    id: fila?.id || `poliza-${idx}`,
    concepto: limpiarTextoCampoInforme(fila?.concepto),
    analisis: limpiarTextoCampoInforme(fila?.analisis),
    conclusion: limpiarTextoCampoInforme(fila?.conclusion),
  };
}

function limpiarCampoOpcionalXml(valor) {
  if (valor == null) return valor;
  if (esXmlWordOoXml(valor)) return extraerTextosWord(valor);
  return valor;
}

export function informeTieneXmlWordOMontosRotos(informe) {
  if (!informe || typeof informe !== 'object') return false;
  const campos = [informe.descripcionDanios, informe.conclusiones, informe.recomendacion, informe.analisisCobertura];
  if (campos.some((c) => esXmlWordOoXml(c))) return true;
  const filas = [
    ...(informe.filasPresupuestoPreliminar || []),
    ...(informe.filasDanios || []),
    ...(informe.filasPolizaCobertura || []),
  ];
  return filas.some((f) =>
    ['capitulo', 'descripcion', 'valor', 'zona', 'condicion', 'nivel', 'concepto', 'analisis', 'conclusion'].some(
      (k) => esXmlWordOoXml(f?.[k]) || (k === 'valor' && String(f?.[k] || '').replace(/[^\d]/g, '').length > 14)
    )
  );
}

/** Idempotente: deja el informe listo para pantalla y para persistir. */
export function sanitizarInformeUnicoCamposWord(informe = {}) {
  if (!informe || typeof informe !== 'object') return informe;
  const filasPpto = (Array.isArray(informe.filasPresupuestoPreliminar)
    ? informe.filasPresupuestoPreliminar
    : []
  )
    .map((f, i) => sanitizarFilaPresupuestoPreliminar(f, i))
    .filter(Boolean);
  const filasDanios = (Array.isArray(informe.filasDanios) ? informe.filasDanios : [])
    .map((f, i) => sanitizarFilaDaniosInforme(f, i))
    .filter(Boolean);
  const filasPoliza = (Array.isArray(informe.filasPolizaCobertura) ? informe.filasPolizaCobertura : []).map(
    (f, i) => sanitizarFilaPolizaInforme(f, i)
  );

  const suma = filasPpto.reduce((acc, f) => acc + parsearMontoInformeSeguro(f.valor), 0);
  let reservaSugerida = informe.reservaSugerida;
  if (suma > 0) {
    reservaSugerida = String(Math.round(suma));
  } else {
    const nRes = parsearMontoInformeSeguro(reservaSugerida);
    reservaSugerida = nRes > 0 ? String(Math.round(nRes)) : '';
  }

  return {
    ...informe,
    descripcionDanios: limpiarCampoOpcionalXml(informe.descripcionDanios),
    conclusiones: limpiarCampoOpcionalXml(informe.conclusiones),
    recomendacion: limpiarCampoOpcionalXml(informe.recomendacion),
    analisisCobertura: limpiarCampoOpcionalXml(informe.analisisCobertura),
    infoEvento: limpiarCampoOpcionalXml(informe.infoEvento),
    filasPresupuestoPreliminar: filasPpto,
    filasDanios,
    filasPolizaCobertura: filasPoliza,
    reservaSugerida,
  };
}
