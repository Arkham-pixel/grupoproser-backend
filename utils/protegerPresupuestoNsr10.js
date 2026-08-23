/**
 * Protección servidor: un PUT con liquidador vacío / más pobre
 * NUNCA debe borrar un liquidador NSR-10 que ya tenía ítems.
 */

function textoItem(it = {}) {
  return String(
    it?.actividad ||
      it?.componente ||
      it?.capitulo ||
      it?.concepto ||
      it?.item ||
      it?.descripcion ||
      ''
  ).trim();
}

export function contarPresupuestoNsr(liquidador) {
  const items = liquidador?.evaluacionSismicaNSR10?.presupuesto?.items;
  if (!Array.isArray(items)) return 0;
  return items.filter((it) => textoItem(it)).length;
}

export function contarContenidosNsr(liquidador) {
  const items = liquidador?.evaluacionSismicaNSR10?.contenidos?.items;
  if (!Array.isArray(items)) return 0;
  return items.filter((it) =>
    String(it?.articulo || it?.categoria || it?.descripcion || '').trim()
  ).length;
}

export function contarDetalleCat(liquidador) {
  const items = liquidador?.detalleLiquidacionCat;
  if (!Array.isArray(items)) return 0;
  return items.filter((it) => textoItem(it)).length;
}

export function contarOtrosAmparosAlfa(liquidador) {
  const items = liquidador?.otrosAmparos;
  if (!Array.isArray(items)) return 0;
  return items.filter((it) => {
    if (it?.aplica === false) return false;
    const v = it?.valor;
    if (v == null || v === '' || v === 0) return false;
    return String(v).replace(/[^\d]/g, '').length > 0;
  }).length;
}

/** Peso de contenido real del liquidador (0 = cascarón vacío). */
export function scoreContenidoLiquidadorNsr(liquidador) {
  if (!liquidador || typeof liquidador !== 'object') return 0;
  return (
    contarPresupuestoNsr(liquidador) +
    contarContenidosNsr(liquidador) +
    contarDetalleCat(liquidador) +
    contarOtrosAmparosAlfa(liquidador)
  );
}

/**
 * Si el PUT trae liquidador vacío o con menos ítems que el guardado,
 * conserva presupuesto / contenidos / detalle (y el documento entero si el nuevo está vacío).
 */
export function preservarPresupuestoNsrSiVacio(nuevo, actual) {
  if (!nuevo || typeof nuevo !== 'object') {
    // null / basura: si había liquidador con datos, no borrar
    if (scoreContenidoLiquidadorNsr(actual) > 0) return actual;
    return nuevo;
  }
  if (!actual || typeof actual !== 'object') return nuevo;

  const scoreNew = scoreContenidoLiquidadorNsr(nuevo);
  const scoreOld = scoreContenidoLiquidadorNsr(actual);

  // Cascarón vacío o sin ítems no puede pisar uno con contenido
  if (scoreOld > 0 && scoreNew === 0) {
    return actual;
  }

  const evalNew = nuevo.evaluacionSismicaNSR10 || {};
  const evalOld = actual.evaluacionSismicaNSR10 || {};
  let evalOut = evalNew;
  let protegio = false;

  if (contarPresupuestoNsr(actual) > contarPresupuestoNsr(nuevo) && evalOld.presupuesto) {
    evalOut = { ...evalOut, presupuesto: evalOld.presupuesto };
    protegio = true;
  }
  if (contarContenidosNsr(actual) > contarContenidosNsr(nuevo) && evalOld.contenidos) {
    evalOut = { ...evalOut, contenidos: evalOld.contenidos };
    protegio = true;
  }

  let next = protegio ? { ...nuevo, evaluacionSismicaNSR10: evalOut } : { ...nuevo };

  if (
    contarDetalleCat(actual) > contarDetalleCat(nuevo) &&
    Array.isArray(actual.detalleLiquidacionCat)
  ) {
    next = { ...next, detalleLiquidacionCat: actual.detalleLiquidacionCat };
    protegio = true;
  }

  if (
    contarOtrosAmparosAlfa(actual) > contarOtrosAmparosAlfa(next) &&
    Array.isArray(actual.otrosAmparos)
  ) {
    next = { ...next, otrosAmparos: actual.otrosAmparos };
    protegio = true;
  }

  // Conservar liquidación / encabezado / firmas si el nuevo viene más vacío
  if (scoreOld >= scoreNew) {
    if (actual.liquidacionCatastrofico && !next.liquidacionCatastrofico) {
      next.liquidacionCatastrofico = actual.liquidacionCatastrofico;
    }
    if (actual.encabezado && (!next.encabezado || !Object.keys(next.encabezado || {}).length)) {
      next.encabezado = actual.encabezado;
    }
    if (actual.firmaCliente && !next.firmaCliente) next.firmaCliente = actual.firmaCliente;
    if (actual.datosBancarios && !next.datosBancarios) {
      next.datosBancarios = actual.datosBancarios;
    }
    if (actual.observaciones && !next.observaciones) next.observaciones = actual.observaciones;
  }

  return next;
}

/**
 * Resuelve liquidador para $set: nunca dejar null/vacío si ya había contenido.
 */
export function resolverLiquidadorParaUpdate(incoming, actual) {
  if (incoming === undefined) return actual ?? null;
  if (incoming === null || typeof incoming !== 'object') {
    return scoreContenidoLiquidadorNsr(actual) > 0 ? actual : null;
  }
  return preservarPresupuestoNsrSiVacio(incoming, actual);
}

/**
 * Informe: no reemplazar por objeto vacío si el actual tiene texto/fotos.
 */
export function scoreContenidoInforme(informe) {
  if (!informe || typeof informe !== 'object') return 0;
  const ag = informe.analisisGeneral || {};
  const textos = [
    informe.infoEvento,
    informe.conclusiones,
    informe.recomendacion,
    ag.descripcionEvento,
    ag.ubicacionEvento,
    ag.conclusiones,
  ]
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  const fotos = Array.isArray(informe.fotosInspeccion) ? informe.fotosInspeccion.length : 0;
  return textos.length + fotos;
}

export function resolverInformeUnicoParaUpdate(incoming, actual) {
  if (incoming === undefined) return actual ?? null;
  if (incoming === null || typeof incoming !== 'object') {
    return scoreContenidoInforme(actual) > 0 ? actual : null;
  }
  const scoreNew = scoreContenidoInforme(incoming);
  const scoreOld = scoreContenidoInforme(actual);
  if (scoreOld > 0 && scoreNew === 0) return actual;
  return incoming;
}
