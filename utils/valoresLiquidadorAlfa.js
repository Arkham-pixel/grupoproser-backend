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
 */
export function pareceInfladoPorCentavos(guardado, correcto) {
  const g = Number(guardado);
  const c = Number(correcto);
  if (!Number.isFinite(g) || !Number.isFinite(c) || c <= 0) return false;
  if (Math.abs(g - c) < 1) return false;
  for (const factor of [100, 10]) {
    const cand = g / factor;
    if (Math.abs(cand - c) / Math.max(c, 1) < 0.02) return true;
  }
  return false;
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
  const hospedajeYaEnItems = itemsHospedaje.some((it) => {
    const id = String(it?.id || '');
    const desc = String(it?.descripcion || it?.actividad || '').toLowerCase();
    return id === 'hospedaje' || desc.includes('hospedaje');
  });
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
