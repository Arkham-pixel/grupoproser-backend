/**
 * Reserva del caso = suma de capítulos del presupuesto preliminar.
 * Evita que un reservaSugerida congelado (p. ej. de la IA) pise el total al autoguardar.
 */

export function parsearMontoZurich(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  let numero = String(valor).replace(/[^\d.,-]/g, '');
  if (numero.includes(',') && numero.includes('.')) {
    numero = numero.replace(/\./g, '').replace(',', '.');
  } else if (numero.includes('.') && !numero.includes(',')) {
    numero = numero.replace(/\./g, '');
  } else if (numero.includes(',')) {
    numero = numero.replace(',', '.');
  }
  const n = parseFloat(numero);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
  const suma = Math.round(sumaPresupuestoPreliminarZurich(informe.filasPresupuestoPreliminar));
  if (suma <= 0) return payload;
  return {
    ...payload,
    reserva: suma,
    informeUnico: {
      ...informe,
      reservaSugerida: String(suma),
    },
  };
}

/** No dejar que un formulario en blanco pise un informe ya diligenciado. */
export function scoreNarrativaInformeZurich(inf) {
  if (!inf || typeof inf !== 'object') return 0;
  const t = (v) => String(v || '').trim();
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
  if (!incoming || typeof incoming !== 'object') return existing ?? incoming ?? null;
  if (!existing || typeof existing !== 'object') return incoming;
  const sIn = scoreNarrativaInformeZurich(incoming);
  const sEx = scoreNarrativaInformeZurich(existing);
  if (!(sEx > 120 && sIn < sEx * 0.45)) return incoming;
  return {
    ...incoming,
    infoEvento: existing.infoEvento || incoming.infoEvento,
    descripcionDanios: existing.descripcionDanios,
    filasDanios: existing.filasDanios,
    filasPolizaCobertura: existing.filasPolizaCobertura,
    filasPresupuestoPreliminar:
      Array.isArray(existing.filasPresupuestoPreliminar) &&
      existing.filasPresupuestoPreliminar.length >
        (Array.isArray(incoming.filasPresupuestoPreliminar)
          ? incoming.filasPresupuestoPreliminar.length
          : 0)
        ? existing.filasPresupuestoPreliminar
        : incoming.filasPresupuestoPreliminar,
    conclusiones: existing.conclusiones,
    recomendacion: existing.recomendacion,
    analisisCobertura: existing.analisisCobertura,
    coordenadasRiesgo: existing.coordenadasRiesgo || incoming.coordenadasRiesgo,
    fotosInspeccion: existing.fotosInspeccion?.length
      ? existing.fotosInspeccion
      : incoming.fotosInspeccion,
    generadoPorIa: existing.generadoPorIa ?? incoming.generadoPorIa,
    generadoPorIaEn: existing.generadoPorIaEn || incoming.generadoPorIaEn,
    generadoPorIaNota: existing.generadoPorIaNota || incoming.generadoPorIaNota,
  };
}
