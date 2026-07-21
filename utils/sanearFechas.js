/**
 * Saneamiento de fechas imposibles en payloads de casos.
 * Evita que errores de digitación o importaciones (p. ej. año 1902 por serial
 * de Excel) entren a la base de datos y distorsionen métricas y alertas.
 */

const ANIO_MINIMO_VALIDO = 2015;

function fechaMaximaValida() {
  const hoy = new Date();
  return new Date(hoy.getFullYear() + 1, hoy.getMonth(), hoy.getDate());
}

function esCampoFecha(clave) {
  const k = String(clave).toLowerCase();
  return k.startsWith('fcha') || k.startsWith('fecha_') || k === 'fecha';
}

function aFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'string') {
    const s = valor.trim();
    if (!s) return null;
    const f = new Date(s);
    return Number.isNaN(f.getTime()) ? null : f;
  }
  return null;
}

export function esFechaImposible(valor) {
  const f = aFecha(valor);
  if (!f) return false;
  return f.getFullYear() < ANIO_MINIMO_VALIDO || f > fechaMaximaValida();
}

/**
 * Elimina del payload los campos de fecha con valores imposibles
 * (año < 2015 o más de un año en el futuro). Muta y devuelve el objeto.
 * @returns {{ datos: object, descartadas: string[] }}
 */
export function sanearFechasImposibles(datos, contexto = '') {
  const descartadas = [];
  if (!datos || typeof datos !== 'object') return { datos, descartadas };

  Object.keys(datos).forEach((clave) => {
    if (!esCampoFecha(clave)) return;
    if (!esFechaImposible(datos[clave])) return;
    descartadas.push(`${clave}=${String(datos[clave]).slice(0, 24)}`);
    delete datos[clave];
  });

  if (descartadas.length) {
    console.warn(
      `⚠️ [sanearFechasImposibles]${contexto ? ` ${contexto}:` : ''} fechas imposibles descartadas → ${descartadas.join(' | ')}`
    );
  }
  return { datos, descartadas };
}
