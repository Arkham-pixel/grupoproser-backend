/**
 * Valores del ajustador (Proser) desde el liquidador BBVA CAT.
 * Valor a liquidar = subtotal + AIU (porcentaje del liquidador, default 25%) − MAX(SMMLV, %, USD, pesos).
 * La reserva del ajustador no se pisa con el AIU: ese porcentaje se ve en el caso,
 * no se suma caso a caso en el dashboard.
 * No toca reserva ni reclamado de la aseguradora.
 */

const AIU_PORCENTAJE_DEFAULT = 0.25;

const SMMLV_TABLA = {
  2022: 1000000,
  2023: 1160000,
  2024: 1300000,
  2025: 1423500,
  2026: 1750905,
};

function parseMonto(valor) {
  if (valor == null || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  let s = String(valor).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes('.') && !s.includes(',')) {
    const partes = s.split('.');
    if (partes.length > 2 || (partes[1] && partes[1].length === 3)) s = s.replace(/\./g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

function redondear(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function parsePorcentaje(valor) {
  const n = parseMonto(valor);
  if (!n) return 0;
  if (n > 1) return n / 100;
  return n;
}

function anioDesdeFecha(fecha) {
  if (!fecha) return 2026;
  if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) return fecha.getFullYear();
  const iso = String(fecha).trim().match(/^(\d{4})/);
  if (iso) return Number(iso[1]);
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? 2026 : d.getFullYear();
}

function smmlvPorAnio(anio) {
  const n = Number(anio);
  if (Number.isFinite(n) && SMMLV_TABLA[n] != null) return SMMLV_TABLA[n];
  const anios = Object.keys(SMMLV_TABLA)
    .map(Number)
    .sort((a, b) => a - b);
  const menor = [...anios].reverse().find((a) => a <= n);
  return SMMLV_TABLA[menor] || SMMLV_TABLA[2026];
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function inferirTipo(liquidador = {}) {
  const v = String(liquidador.tipoLiquidador || '')
    .trim()
    .toLowerCase();
  if (v === 'leasing') return 'leasing';
  if (v === 'deudores') return 'deudores';
  const blob = [
    liquidador.encabezado?.tipoPoliza,
    liquidador.encabezado?.tomador,
    liquidador.encabezado?.asegurado,
  ].join(' ');
  if (/\bLEASING\b/.test(normalizarTexto(blob))) return 'leasing';
  return 'deudores';
}

function esRamoCatastrofico(ramo) {
  return /TERREMOTO|TEMBLOR|ERUPCION|VOLCAN|MAREMOTO|TSUNAMI|CATASTROF/.test(
    normalizarTexto(ramo)
  );
}

function defaultDeducible(liquidador = {}) {
  const tipo = inferirTipo(liquidador);
  const enc = liquidador.encabezado || {};
  const ramo = enc.ramoAfectado || enc.cobertura || enc.evento || '';
  if (tipo === 'leasing' && ramo && !esRamoCatastrofico(ramo)) {
    return { tipo, smmlv: 1.5, porcentaje: 0.15, basePct: 'subtotal', dolares: 0, pesos: 0 };
  }
  return { tipo, smmlv: 3, porcentaje: 0.02, basePct: 'valor_global', dolares: 0, pesos: 0 };
}

function resolverDeducibleFormato(liquidador = {}) {
  const base = defaultDeducible(liquidador);
  const saved = liquidador.deducibleFormato;
  const extras = {};
  if (saved && typeof saved === 'object') {
    extras.dolares = parseMonto(saved.dolares);
    extras.pesos = parseMonto(saved.pesos);
    const smmlvSaved = parseMonto(saved.smmlv);
    if (smmlvSaved > 0) extras.smmlv = smmlvSaved;
    const pctSaved = parsePorcentaje(saved.porcentaje);
    const esResidualCinco =
      Math.abs(pctSaved - 0.05) < 1e-6 && Math.abs(base.porcentaje - 0.02) < 1e-6;
    if (pctSaved > 0 && !esResidualCinco) extras.porcentaje = pctSaved;
  }
  const cfg =
    liquidador.liquidacionCatastrofico?.deducibleConfigPresupuesto ||
    liquidador.liquidacionCatastrofico?.deducibleConfig ||
    {};
  if (extras.smmlv == null) {
    const cant = Number(cfg.cantidadSMMLV);
    if (Number.isFinite(cant) && cant > 0 && cant !== 4) extras.smmlv = cant;
  }
  return {
    ...base,
    ...extras,
    tipo: base.tipo,
    basePct: base.basePct,
    porcentaje: extras.porcentaje ?? base.porcentaje,
    smmlv: extras.smmlv ?? base.smmlv,
  };
}

function sumaFilasDetalle(det) {
  return det.reduce((acc, it) => {
    const t = parseMonto(it?.perdidaIndemnizable);
    return acc + (t > 0 ? t : 0);
  }, 0);
}

function sumaPresupuesto(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, it) => {
    const cant = parseMonto(it?.cantidad);
    const vu = parseMonto(it?.valorUnitario);
    let t = 0;
    if (
      it?.cantidad !== '' &&
      it?.cantidad != null &&
      it?.valorUnitario !== '' &&
      it?.valorUnitario != null
    ) {
      t = cant * vu;
    } else {
      t = parseMonto(it?.total);
    }
    return acc + (t > 0 ? t : 0);
  }, 0);
}

function sumaIndemnizable(liquidador) {
  const det = liquidador?.detalleLiquidacionCat;
  if (Array.isArray(det)) return redondear(sumaFilasDetalle(det));
  return redondear(sumaPresupuesto(liquidador?.evaluacionSismicaNSR10?.presupuesto?.items));
}

function sumaOtrosAmparos(liquidador) {
  const lista = liquidador?.otrosAmparos;
  if (!Array.isArray(lista)) return 0;
  return lista.reduce((acc, it) => {
    if (!it || it.aplica === false) return acc;
    const cant = parseMonto(it.cantidad);
    const vu = parseMonto(it.valorUnitario);
    const tieneCant = it.cantidad !== '' && it.cantidad != null;
    const tieneVu = it.valorUnitario != null && String(it.valorUnitario).trim() !== '';
    const v = tieneCant && tieneVu ? cant * vu : parseMonto(it.valor);
    return acc + (v > 0 ? v : 0);
  }, 0);
}

export function liquidadorBbvaCatTieneCifras(liquidador) {
  if (!liquidador || typeof liquidador !== 'object') return false;
  const det = liquidador.detalleLiquidacionCat;
  if (Array.isArray(det) && det.some((it) => parseMonto(it?.perdidaIndemnizable) > 0)) return true;
  const items = liquidador.evaluacionSismicaNSR10?.presupuesto?.items;
  if (Array.isArray(items) && sumaPresupuesto(items) > 0) return true;
  if (sumaOtrosAmparos(liquidador) > 0) return true;
  if (montoCotizacionPdfBbva(liquidador) > 0) return true;
  return false;
}

function montoCotizacionPdfBbva(liquidador = {}) {
  const c = liquidador?.cotizacionPdf;
  if (!c || typeof c !== 'object') return 0;
  return parseMonto(c.montoFinal ?? c.monto);
}

function resolverAiuPctPdf(liquidador = {}) {
  const raw = liquidador?.liquidacionCotizacionPdf?.aiuPorcentaje;
  if (raw === '' || raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.max(0, n > 1 ? n / 100 : n);
}

function resolverAiuPct(liquidador = {}) {
  const cands = [
    liquidador.aiuPorcentaje,
    liquidador.evaluacionSismicaNSR10?.presupuesto?.aiuPorcentaje,
  ];
  for (const raw of cands) {
    if (raw === '' || raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    return Math.max(0, n > 1 ? n / 100 : n);
  }
  return AIU_PORCENTAJE_DEFAULT;
}

function resolverDeducibleFormatoPdf(liquidador = {}) {
  const base = defaultDeducible(liquidador);
  const saved = liquidador?.liquidacionCotizacionPdf?.deducibleFormato;
  if (!saved || typeof saved !== 'object') return base;
  const smmlvSaved = parseMonto(saved.smmlv);
  const pctSaved = parsePorcentaje(saved.porcentaje);
  return {
    ...base,
    smmlv: smmlvSaved > 0 ? smmlvSaved : base.smmlv,
    porcentaje: pctSaved > 0 ? pctSaved : base.porcentaje,
    dolares: parseMonto(saved.dolares),
    pesos: parseMonto(saved.pesos),
    basePct: saved.basePct || base.basePct,
  };
}

function totalesDesdeLiquidadorBbva(liquidador) {
  const enc = liquidador?.encabezado || {};
  const otros = sumaOtrosAmparos(liquidador);
  const montoPdf = montoCotizacionPdfBbva(liquidador);
  if (montoPdf > 0) {
    const aiuPct = resolverAiuPctPdf(liquidador);
    const aiu = redondear(montoPdf * aiuPct);
    const totalConAiu = redondear(montoPdf + aiu);
    const valorGlobal =
      parseMonto(enc.valorGlobal) ||
      parseMonto(enc.valorAseguradoInmueble) ||
      parseMonto(liquidador?.liquidacionCatastrofico?.valorAsegurado) ||
      0;
    const dedFmt = resolverDeducibleFormatoPdf(liquidador);
    const anio = anioDesdeFecha(enc.fechaSiniestro);
    const montoSmmlv = redondear(parseMonto(dedFmt.smmlv) * smmlvPorAnio(anio));
    const basePct =
      String(dedFmt.basePct || 'valor_global') === 'subtotal' ? totalConAiu : valorGlobal;
    const montoPct = redondear(basePct * parsePorcentaje(dedFmt.porcentaje));
    const montoUsd = redondear(parseMonto(dedFmt.dolares) * parseMonto(enc.trm));
    const montoPesos = redondear(parseMonto(dedFmt.pesos));
    const deduciblePoliza = Math.max(montoSmmlv, montoPct, montoUsd, montoPesos);
    const deducibleAplicable = redondear(
      Math.min(deduciblePoliza, totalConAiu || deduciblePoliza)
    );
    const valorAIndemnizar = redondear(Math.max(0, totalConAiu - deducibleAplicable));
    return {
      subTotal: montoPdf,
      aiu,
      totalConAiu,
      baseIndemnizable: totalConAiu,
      valorAIndemnizar,
      otros,
    };
  }

  const subTotal = sumaIndemnizable(liquidador);
  const aiuPct = resolverAiuPct(liquidador);
  const aiu = redondear(subTotal * aiuPct);
  const totalConAiu = redondear(subTotal + aiu);
  const valorGlobal =
    parseMonto(enc.valorGlobal) ||
    parseMonto(enc.valorAseguradoInmueble) ||
    parseMonto(liquidador?.liquidacionCatastrofico?.valorAsegurado) ||
    0;
  const baseIndemnizable = valorGlobal > 0 ? redondear(Math.min(totalConAiu, valorGlobal)) : totalConAiu;
  const dedFmt = resolverDeducibleFormato(liquidador);
  const anio = anioDesdeFecha(enc.fechaSiniestro);
  const montoSmmlv = redondear(parseMonto(dedFmt.smmlv) * smmlvPorAnio(anio));
  const basePct = String(dedFmt.basePct || 'valor_global') === 'subtotal' ? baseIndemnizable : valorGlobal;
  const montoPct = redondear(basePct * parsePorcentaje(dedFmt.porcentaje));
  const montoUsd = redondear(parseMonto(dedFmt.dolares) * parseMonto(enc.trm));
  const montoPesos = redondear(parseMonto(dedFmt.pesos));
  const deduciblePoliza = Math.max(montoSmmlv, montoPct, montoUsd, montoPesos);
  const deducibleAplicable = redondear(
    Math.min(deduciblePoliza, baseIndemnizable || deduciblePoliza)
  );
  const valorAIndemnizar = redondear(Math.max(0, baseIndemnizable - deducibleAplicable));
  return { subTotal, aiu, totalConAiu, baseIndemnizable, valorAIndemnizar, otros };
}

/**
 * Reserva del ajustador: subtotal + AIU (tope valor global) + otros amparos.
 * No resta el deducible: eso va en valor a liquidar.
 */
export function extraerReservaConAiuLiquidadorBbva(liquidador) {
  if (!liquidador || typeof liquidador !== 'object') return 0;
  const t = totalesDesdeLiquidadorBbva(liquidador);
  return Math.round((t.baseIndemnizable || 0) + t.otros);
}

/**
 * Valor a indemnizar de pantalla (después del deducible).
 */
export function extraerValorLiquidadoLiquidadorBbva(liquidador) {
  if (!liquidador || typeof liquidador !== 'object') return 0;
  const t = totalesDesdeLiquidadorBbva(liquidador);
  return Math.round(t.valorAIndemnizar + t.otros);
}

/**
 * Si el payload trae liquidador con cifras, sube valorALiquidar (puede quedar en 0
 * cuando el deducible cubre toda la pérdida).
 * No pisa reserva BBVA, cuantía probable ni reserva del ajustador (el AIU no entra
 * en el total de cartera).
 */
export function aplicarValoresDesdeLiquidadorBbva(payload = {}) {
  const liq = payload.liquidador;
  if (!liq || typeof liq !== 'object') return payload;
  if (!liquidadorBbvaCatTieneCifras(liq)) return payload;
  payload.valorALiquidar = extraerValorLiquidadoLiquidadorBbva(liq);
  return payload;
}

export function aplicarValorALiquidarDesdeLiquidadorBbva(payload = {}) {
  return aplicarValoresDesdeLiquidadorBbva(payload);
}

export function aplicarValorLiquidadoDesdeLiquidadorBbva(payload = {}) {
  return aplicarValoresDesdeLiquidadorBbva(payload);
}
