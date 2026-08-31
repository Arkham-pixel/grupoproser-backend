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
export function fusionarInformeUnicoZurich(incoming, existing) {
  if (!incoming || typeof incoming !== 'object') return existing ?? incoming ?? null;
  if (!existing || typeof existing !== 'object') return incoming;
  const descIn = String(incoming.descripcionDanios || '').trim();
  const descEx = String(existing.descripcionDanios || '').trim();
  const daniosLlenos = (filas) =>
    (Array.isArray(filas) ? filas : []).filter((f) => String(f?.condicion || '').trim().length > 20).length;
  const parecePlantillaVacia =
    descIn.length < 80 &&
    daniosLlenos(incoming.filasDanios) < 4 &&
    String(incoming.infoEvento || '').includes('la visita de inspección realizada al predio asegurado');
  if (!parecePlantillaVacia || (descEx.length < 200 && daniosLlenos(existing.filasDanios) < 8)) {
    return incoming;
  }
  return {
    ...incoming,
    infoEvento: existing.infoEvento,
    descripcionDanios: existing.descripcionDanios,
    filasDanios: existing.filasDanios,
    filasPolizaCobertura: existing.filasPolizaCobertura,
    filasPresupuestoPreliminar:
      Array.isArray(existing.filasPresupuestoPreliminar) && existing.filasPresupuestoPreliminar.length > 3
        ? existing.filasPresupuestoPreliminar
        : incoming.filasPresupuestoPreliminar,
    conclusiones: existing.conclusiones,
    recomendacion: existing.recomendacion,
    analisisCobertura: existing.analisisCobertura,
    coordenadasRiesgo: existing.coordenadasRiesgo || incoming.coordenadasRiesgo,
    fotosInspeccion: existing.fotosInspeccion?.length ? existing.fotosInspeccion : incoming.fotosInspeccion,
    generadoPorIa: existing.generadoPorIa ?? incoming.generadoPorIa,
    generadoPorIaEn: existing.generadoPorIaEn || incoming.generadoPorIaEn,
    generadoPorIaNota: existing.generadoPorIaNota || incoming.generadoPorIaNota,
  };
}
