/**
 * Reserva del caso = suma de capítulos del presupuesto preliminar.
 * Evita que un reservaSugerida congelado (p. ej. de la IA) pise el total al autoguardar.
 */

import {
  parsearMontoInformeSeguro,
  sanitizarInformeUnicoCamposWord,
} from './limpiarTextoInformeWord.js';

export function parsearMontoZurich(valor) {
  return parsearMontoInformeSeguro(valor);
}

export function sumaPresupuestoPreliminarZurich(filas = []) {
  return (Array.isArray(filas) ? filas : []).reduce(
    (acc, fila) => acc + parsearMontoZurich(fila?.valor),
    0
  );
}

export function aplicarReservaDesdePresupuestoZurich(payload = {}) {
  const informe = payload?.informeUnico;
  if (!informe || typeof informe !== 'object') return payload;
  const limpio = sanitizarInformeUnicoCamposWord(informe);
  const suma = Math.round(sumaPresupuestoPreliminarZurich(limpio.filasPresupuestoPreliminar));
  if (suma <= 0) {
    return { ...payload, informeUnico: limpio };
  }
  return {
    ...payload,
    reserva: suma,
    informeUnico: {
      ...limpio,
      reservaSugerida: String(suma),
    },
  };
}

/** No dejar que un formulario en blanco pise un informe ya diligenciado. */
export function scoreNarrativaInformeZurich(inf) {
  if (!inf || typeof inf !== 'object') return 0;
  const t = (v) => {
    const s = String(v || '').trim();
    if (/<w:|w:tcPr/.test(s)) return '';
    return s;
  };
  const filasTxt = (arr, keys) =>
    (Array.isArray(arr) ? arr : []).reduce((n, f) => {
      const s = keys.map((k) => t(f?.[k])).join(' ');
      return n + (s.length > 15 ? s.length : 0);
    }, 0);
  return (
    t(inf.descripcionDanios).length +
    t(inf.conclusiones).length +
    t(inf.recomendacion).length +
    t(inf.analisisCobertura).length +
    filasTxt(inf.filasDanios, ['condicion', 'observacion', 'descripcion', 'dano']) +
    filasTxt(inf.filasPresupuestoPreliminar, ['descripcion', 'capitulo', 'item', 'concepto', 'valor'])
  );
}

export function fusionarInformeUnicoZurich(incoming, existing) {
  if (!incoming || typeof incoming !== 'object') {
    return existing && typeof existing === 'object'
      ? sanitizarInformeUnicoCamposWord(existing)
      : existing ?? incoming ?? null;
  }
  const limpioIn = sanitizarInformeUnicoCamposWord(incoming);
  if (!existing || typeof existing !== 'object') return limpioIn;
  const limpioEx = sanitizarInformeUnicoCamposWord(existing);
  const sIn = scoreNarrativaInformeZurich(limpioIn);
  const sEx = scoreNarrativaInformeZurich(limpioEx);
  if (!(sEx > 120 && sIn < sEx * 0.45)) return limpioIn;
  return {
    ...limpioIn,
    infoEvento: limpioEx.infoEvento || limpioIn.infoEvento,
    descripcionDanios: limpioEx.descripcionDanios,
    filasDanios: limpioEx.filasDanios,
    filasPolizaCobertura: limpioEx.filasPolizaCobertura,
    filasPresupuestoPreliminar:
      Array.isArray(limpioEx.filasPresupuestoPreliminar) &&
      limpioEx.filasPresupuestoPreliminar.length >
        (Array.isArray(limpioIn.filasPresupuestoPreliminar)
          ? limpioIn.filasPresupuestoPreliminar.length
          : 0)
        ? limpioEx.filasPresupuestoPreliminar
        : limpioIn.filasPresupuestoPreliminar,
    conclusiones: limpioEx.conclusiones,
    recomendacion: limpioEx.recomendacion,
    analisisCobertura: limpioEx.analisisCobertura,
    coordenadasRiesgo: limpioEx.coordenadasRiesgo || limpioIn.coordenadasRiesgo,
    fotosInspeccion: limpioEx.fotosInspeccion?.length
      ? limpioEx.fotosInspeccion
      : limpioIn.fotosInspeccion,
    generadoPorIa: limpioEx.generadoPorIa ?? limpioIn.generadoPorIa,
    generadoPorIaEn: limpioEx.generadoPorIaEn || limpioIn.generadoPorIaEn,
    generadoPorIaNota: limpioEx.generadoPorIaNota || limpioIn.generadoPorIaNota,
  };
}
