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
