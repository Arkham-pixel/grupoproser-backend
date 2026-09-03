/**
 * Recalcula valorReclamado / valorLiquidado desde el liquidador Alfa.
 * Misma fórmula que el frontend: (subtotal + AIU) − deducible + otros amparos.
 */

import { parseCopMoney } from './alfaExcelNormalize.js';

const AIU_DEFAULT = 0.2;
const SMMLV_DEFAULT = 1_750_905;

function n(valor) {
  const parsed = parseCopMoney(valor);
  if (parsed == null) return 0;
  return parsed;
}

function round2(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

function aiuPctDe(presupuesto = {}, cotizPct) {
  let pct = Number(cotizPct);
  if (!Number.isFinite(pct)) pct = Number(presupuesto.aiuPorcentaje);
  if (!Number.isFinite(pct)) pct = AIU_DEFAULT;
  if (pct === 0.05 || pct === 0.15) pct = AIU_DEFAULT;
  if (pct > 1) pct /= 100;
  return pct;
}

function textoItem(it = {}) {
  return String(
    it?.actividad || it?.componente || it?.capitulo || it?.descripcion || it?.item || ''
  ).trim();
}

function blobTextoItem(it = {}) {
  return [it?.descripcion, it?.actividad, it?.componente, it?.concepto, it?.item, it?.capitulo]
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

/** Hospedaje real: texto de alojamiento, o id hospedaje sin otra descripción. */
export function esFilaHospedajeAlfa(it = {}) {
  const blob = blobTextoItem(it);
  if (blob.includes('hospedaje') || blob.includes('alojamiento temporal')) return true;
  const descPropia = String(it?.descripcion || it?.actividad || '').trim();
  return String(it?.id || '').toLowerCase() === 'hospedaje' && !descPropia;
}

/** Fila auto-generada: 1% o 2% del SID, sin valor manual. */
export function esFilaHospedajeFantasmaAlfa(it, { sid, hospedajeManual } = {}) {
  if (n(hospedajeManual) > 0) return false;
  if (!esFilaHospedajeAlfa(it) && String(it?.id || '').toLowerCase() !== 'hospedaje') {
    return false;
  }
  const descPropia = String(it?.descripcion || it?.actividad || '').trim().toLowerCase();
  const blob = blobTextoItem(it);
  const esTextoHosp =
    !descPropia ||
    descPropia.includes('hospedaje') ||
    descPropia.includes('alojamiento temporal') ||
    blob.includes('hospedaje') ||
    blob.includes('alojamiento temporal');
  if (!esTextoHosp) return false;
  const m = Math.round(n(it.valorPerdida) || n(it.total) || n(it.cantidad) * n(it.valorUnitario));
  if (m <= 0) return false;
  const sidN = n(sid);
  if (sidN <= 0) return false;
  for (const pct of [0.01, 0.02]) {
    const auto = Math.round(sidN * pct);
    if (auto > 0 && Math.abs(m - auto) / auto < 0.03) return true;
  }
  return false;
}

function limpiarFilasHospedaje(arr, { sid, hospedajeManual } = {}) {
  if (!Array.isArray(arr)) return { arr, stripped: 0, retagged: 0, phantomMonto: 0 };
  let stripped = 0;
  let retagged = 0;
  let phantomMonto = 0;
  const next = [];
  arr.forEach((it, idx) => {
    if (esFilaHospedajeFantasmaAlfa(it, { sid, hospedajeManual })) {
      stripped += 1;
      phantomMonto += Math.round(
        n(it.valorPerdida) || n(it.total) || n(it.cantidad) * n(it.valorUnitario)
      );
      return;
    }
    if (String(it?.id || '') === 'hospedaje' && !esFilaHospedajeAlfa(it)) {
      retagged += 1;
      next.push({ ...it, id: `det-retag-${idx}` });
      return;
    }
    next.push(it);
  });
  return { arr: next, stripped, retagged, phantomMonto };
}

/**
 * Quita hospedaje automático del SID y corrige id "hospedaje" en ítems reales.
 */
export function limpiarLiquidadorHospedajeFantasmaAlfa(liquidador = {}, caso = {}) {
  if (!liquidador || typeof liquidador !== 'object') {
    return { liquidador, changed: false, stripped: 0, retagged: 0, phantomMonto: 0 };
  }
  const sid =
    n(caso.valorAseguradoSid) ||
    n(liquidador.encabezado?.valorAseguradoSid) ||
    n(liquidador.liquidacionCatastrofico?.valorAsegurado);
  const hospManual = liquidador.liquidacionCatastrofico?.hospedajeManual;
  const ctx = { sid, hospedajeManual: hospManual };
  const det = limpiarFilasHospedaje(liquidador.detalleLiquidacionCat, ctx);
  const evalData = liquidador.evaluacionSismicaNSR10 || {};
  const presupuesto = evalData.presupuesto || {};
  const pres = limpiarFilasHospedaje(presupuesto.items, ctx);
  const stripped = det.stripped + pres.stripped;
  const retagged = det.retagged + pres.retagged;
  const phantomMonto = Math.max(det.phantomMonto, pres.phantomMonto);
  if (!stripped && !retagged) {
    return { liquidador, changed: false, stripped: 0, retagged: 0, phantomMonto: 0 };
  }
  const next = { ...liquidador };
  if (Array.isArray(liquidador.detalleLiquidacionCat)) {
    next.detalleLiquidacionCat = det.arr;
  }
  if (Array.isArray(presupuesto.items)) {
    next.evaluacionSismicaNSR10 = {
      ...evalData,
      presupuesto: { ...presupuesto, items: pres.arr },
    };
  }
  return { liquidador: next, changed: true, stripped, retagged, phantomMonto };
}

function totalFilaPresupuesto(it = {}) {
  const total = n(it.total ?? it.valorPerdida);
  if (total) return total;
  return n(it.cantidad) * n(it.valorUnitario);
}

function sumarOtrosAmparos(lista = []) {
  if (!Array.isArray(lista)) return 0;
  let acc = 0;
  for (const it of lista) {
    if (!it || it.aplica === false) continue;
    const cant = n(it.cantidad);
    const vu = n(it.valorUnitario);
    const tieneCant = it.cantidad !== '' && it.cantidad != null;
    const tieneVu = it.valorUnitario !== '' && it.valorUnitario != null;
    const valor = tieneCant && tieneVu ? cant * vu : n(it.valor);
    if (valor) acc += valor;
  }
  return round2(acc);
}

function resumenCotizacion(liquidador = {}) {
  const slots = [
    liquidador?.cotizacionesPdf?.materiales,
    liquidador?.cotizacionesPdf?.manoObra,
    liquidador?.cotizacionesPdf?.completo,
    liquidador?.cotizacionPdf,
  ];
  let total = 0;
  let nUsadas = 0;
  let aiuPct = null;
  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') continue;
    if (slot.usarComoBasePresupuesto === false) continue;
    const monto = n(slot.montoFinal);
    if (monto > 0) {
      total += monto;
      nUsadas += 1;
    }
    if (aiuPct == null && slot.aiuPorcentaje != null) aiuPct = slot.aiuPorcentaje;
  }
  total = round2(total);
  return { total, nUsadas, usaComoBase: nUsadas > 0 && total > 0, aiuPct };
}

function calcularDeducible({ valorAsegurado, totalDanios, cfg = {} }) {
  const base =
    cfg.baseDeducible === 'perdida' || cfg.baseDeducible === 'perdida_total'
      ? 'perdida'
      : 'valor_asegurable';
  const pctRaw = Number(cfg.porcentaje);
  const pct = Number.isFinite(pctRaw) ? pctRaw : base === 'perdida' ? 1 : 2;
  const cantRaw = Number(cfg.cantidadSMMLV);
  const cant = Number.isFinite(cantRaw) ? cantRaw : base === 'perdida' ? 0 : 2;
  const smmlv = n(cfg.valorSMMLV) || SMMLV_DEFAULT;
  const minSmmlv = cant > 0 ? round2(cant * smmlv) : 0;

  if (base === 'perdida') {
    if (!totalDanios) return 0;
    const porPct = round2(totalDanios * (pct / 100));
    return minSmmlv > 0 ? Math.max(porPct, minSmmlv) : porPct;
  }
  if (!valorAsegurado) return 0;
  const porPct = round2(valorAsegurado * (pct / 100));
  return round2(Math.max(porPct, minSmmlv));
}

export function liquidadorAlfaTieneCifras(liquidador) {
  if (!liquidador || typeof liquidador !== 'object') return false;
  const items = liquidador?.evaluacionSismicaNSR10?.presupuesto?.items;
  if (Array.isArray(items) && items.some((it) => textoItem(it) || n(it.total) || n(it.valorUnitario))) {
    return true;
  }
  const detalle = liquidador?.detalleLiquidacionCat;
  if (Array.isArray(detalle) && detalle.some((it) => textoItem(it) || n(it.valorPerdida))) {
    return true;
  }
  if (sumarOtrosAmparos(liquidador?.otrosAmparos) > 0) return true;
  if (resumenCotizacion(liquidador).usaComoBase) return true;
  return false;
}

/**
 * Si el valor guardado es el correcto con 1 o 2 decimales pegados al entero (×10 / ×100).
 * También ×100 con deriva (p. ej. 677.872.603 vs 7.073.453 ≈ ×96): g/100 debe
 * estar cerca del liquidador; un SID de cientos de millones no cuadra.
 */
export function pareceInfladoPorCentavos(guardado, correcto) {
  const g = Number(guardado);
  const c = Number(correcto);
  if (!Number.isFinite(g) || !Number.isFinite(c) || c <= 0) return false;
  if (Math.abs(g - c) < 1) return false;
  const rel = (cand) => Math.abs(cand - c) / Math.max(c, 1);
  for (const factor of [100, 10]) {
    if (rel(g / factor) < 0.02) return true;
  }
  const ratio = g / c;
  if (ratio > 50 && ratio < 150 && rel(g / 100) < 0.2) return true;
  return false;
}

/**
 * Si reclamado/liquidado guardados son el recálculo del liquidador con
 * centavos concatenados (p. ej. 7.597.812,12 → 759.781.212), usa el recálculo.
 * No toca SID/reclamados reales de cientos de millones.
 * Si el recálculo liquida 0 (deducible > daños) pero el guardado es el daños ×~100,
 * también se corrige a 0.
 */
export function aplicarMontosOficialesDesdeLiquidadorAlfa(doc = {}) {
  if (!doc || typeof doc !== 'object') return doc;
  if (!liquidadorAlfaTieneCifras(doc.liquidador)) return doc;
  const montos = extraerMontosLiquidadorAlfa(doc.liquidador, doc);
  const out = { ...doc };
  const recOk = Math.round(Number(montos.valorReclamado) || 0);
  const liqOk = Math.round(Number(montos.valorLiquidado) || 0);
  const danios = Math.round(Number(montos.totalDaniosCat) || 0);
  const refsInflado = [...new Set([recOk, liqOk, danios].filter((x) => x > 0))];

  if (recOk > 0 && out.valorReclamado != null && out.valorReclamado !== '') {
    if (refsInflado.some((r) => pareceInfladoPorCentavos(out.valorReclamado, r))) {
      out.valorReclamado = recOk;
    }
  }
  if (out.valorLiquidado != null && out.valorLiquidado !== '') {
    if (refsInflado.some((r) => pareceInfladoPorCentavos(out.valorLiquidado, r))) {
      out.valorLiquidado = liqOk;
    }
  }
  return out;
}

export function extraerMontosLiquidadorAlfa(liquidador = {}, caso = {}) {
  const evalData = liquidador.evaluacionSismicaNSR10 || {};
  const presupuesto = evalData.presupuesto || { items: [] };
  const liq = liquidador.liquidacionCatastrofico || {};
  const enc = liquidador.encabezado || {};
  const cotiz = resumenCotizacion(liquidador);
  const usaCotiz = cotiz.usaComoBase;

  const sid =
    n(enc.valorAseguradoSid) ||
    n(caso.valorAseguradoSid) ||
    n(liq.valorAsegurado) ||
    n(cotiz.total && enc.valorAseguradoSid);

  const detalle = Array.isArray(liquidador.detalleLiquidacionCat)
    ? liquidador.detalleLiquidacionCat
    : null;
  const subtotalDetalle = detalle
    ? round2(detalle.reduce((acc, it) => acc + n(it.valorPerdida), 0))
    : 0;
  const usarDetalle =
    Boolean(detalle) &&
    (subtotalDetalle > 0 ||
      detalle.some((it) => textoItem(it) || it?.catalogoId));

  const aiuPct = aiuPctDe(presupuesto, usaCotiz ? cotiz.aiuPct : undefined);
  let subtotal;
  let aiu;
  let totalDaniosCat;

  if (usaCotiz) {
    subtotal = cotiz.total;
    aiu = round2(subtotal * aiuPct);
    totalDaniosCat = round2(subtotal + aiu);
  } else if (usarDetalle) {
    subtotal = subtotalDetalle;
    aiu = round2(subtotal * aiuPct);
    totalDaniosCat = round2(subtotal + aiu);
  } else {
    const items = Array.isArray(presupuesto.items) ? presupuesto.items : [];
    subtotal = round2(items.reduce((acc, it) => acc + totalFilaPresupuesto(it), 0));
    aiu = round2(subtotal * aiuPct);
    const contenidos = Array.isArray(evalData.contenidos?.items)
      ? round2(
          evalData.contenidos.items.reduce(
            (acc, it) => acc + n(it.total ?? it.valor ?? it.valorUnitario),
            0
          )
        )
      : 0;
    totalDaniosCat = round2(subtotal + aiu + contenidos);
  }

  const cfgDed =
    (usaCotiz ? liq.deducibleConfig : liq.deducibleConfigPresupuesto || liq.deducibleConfig) ||
    {};
  const deducible = calcularDeducible({
    valorAsegurado: sid || n(liq.valorAsegurado),
    totalDanios: totalDaniosCat,
    cfg: cfgDed,
  });

  const itemsHospedaje = detalle || presupuesto.items || [];
  const hospedajeYaEnItems = itemsHospedaje.some((it) => esFilaHospedajeAlfa(it));
  const hospedaje = usaCotiz || hospedajeYaEnItems ? 0 : n(liq.hospedajeManual);
  const totalOtrosAmparos = sumarOtrosAmparos(liquidador.otrosAmparos);
  const indemnizacionPrincipal = Math.max(0, round2(totalDaniosCat - deducible + hospedaje));
  const valorLiquidado = Math.max(0, round2(indemnizacionPrincipal + totalOtrosAmparos));

  const reclamadoCaso = n(liquidador.valorReclamadoCaso);
  const valorReclamado =
    reclamadoCaso > 0 && !pareceInfladoPorCentavos(reclamadoCaso, totalDaniosCat)
      ? reclamadoCaso
      : totalDaniosCat;

  return {
    valorReclamado,
    valorLiquidado,
    totalDaniosCat,
    subtotal,
    aiu,
    aiuPct,
    deducible,
    totalOtrosAmparos,
    usaCotiz,
    sid: sid || null,
  };
}
