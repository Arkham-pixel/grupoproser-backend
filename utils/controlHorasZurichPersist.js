import { controlHorasTieneDatos } from './controlHorasUtils.js';

const primerValor = (...vals) => {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
};

const parseDateControlHoras = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    const [year, month, day] = value.trim().slice(0, 10).split('-').map(Number);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
      return new Date(year, month - 1, day, 12, 0, 0);
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const primerNumero = (...vals) => {
  const raw = primerValor(...vals);
  if (raw === undefined) return undefined;
  const n = Number(String(raw).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

const aplicarFecha = (payload, data, base, keys, dest) => {
  const hasIncoming = keys.some((k) => data[k] !== undefined);
  if (!hasIncoming) {
    if (base[dest] != null) payload[dest] = base[dest];
    return;
  }
  const raw = primerValor(...keys.map((k) => data[k]));
  if (raw) payload[dest] = parseDateControlHoras(raw) ?? base[dest] ?? null;
  else payload[dest] = base[dest] ?? null;
};

const aplicarTexto = (payload, data, base, keys, dest) => {
  const hasIncoming = keys.some((k) => data[k] !== undefined);
  if (!hasIncoming) {
    if (base[dest] != null) payload[dest] = base[dest];
    return;
  }
  const raw = primerValor(...keys.map((k) => data[k]));
  payload[dest] = raw != null ? String(raw) : base[dest] ?? '';
};

/**
 * Une control de horas / facturación al payload Zurich (CAT o listado).
 * No borra un control ya guardado si el incoming llega vacío.
 */
export const aplicarCamposControlHorasZurich = (payload = {}, data = {}, base = {}) => {
  const incomingCH = data.control_horas;
  if (controlHorasTieneDatos(incomingCH)) {
    payload.control_horas = incomingCH;
  } else if (controlHorasTieneDatos(base.control_horas)) {
    payload.control_horas = base.control_horas;
  } else if (incomingCH && typeof incomingCH === 'object') {
    payload.control_horas = incomingCH;
  } else if (base.control_horas) {
    payload.control_horas = base.control_horas;
  }

  aplicarFecha(payload, data, base, ['fecha_control_horas', 'fcha_control_horas', 'fechaControlHoras'], 'fcha_control_horas');
  aplicarFecha(payload, data, base, ['fecha_envio_control_horas', 'fcha_envio_control_horas'], 'fcha_envio_control_horas');
  aplicarFecha(
    payload,
    data,
    base,
    ['fecha_recibido_control_horas', 'fcha_recibido_control_horas'],
    'fcha_recibido_control_horas'
  );
  aplicarFecha(
    payload,
    data,
    base,
    ['fecha_seguimiento_envio_control_horas', 'fcha_seguimiento_envio_control_horas'],
    'fcha_seguimiento_envio_control_horas'
  );
  aplicarFecha(payload, data, base, ['fecha_factura'], 'fecha_factura');
  aplicarFecha(payload, data, base, ['fecha_ultima_revision', 'fchaUltRevi'], 'fchaUltRevi');

  aplicarTexto(
    payload,
    data,
    base,
    ['observacion_seguimiento_envio_control_horas', 'obse_seguimiento_envio_control_horas'],
    'obse_seguimiento_envio_control_horas'
  );
  aplicarTexto(payload, data, base, ['adjunto_control_horas'], 'adjunto_control_horas');
  aplicarTexto(payload, data, base, ['adjunto_evidencia'], 'adjunto_evidencia');
  aplicarTexto(
    payload,
    data,
    base,
    ['adjunto_seguimiento_envio_control_horas', 'anxo_seguimiento_envio_control_horas'],
    'anxo_seguimiento_envio_control_horas'
  );
  aplicarTexto(payload, data, base, ['adjunto_factura'], 'adjunto_factura');
  aplicarTexto(payload, data, base, ['numero_factura'], 'numero_factura');
  aplicarTexto(payload, data, base, ['observacion_compromisos'], 'observacion_compromisos');

  const valorServicio = primerNumero(data.valor_servicio, data.vlorServcios, data.valorServicio);
  if (valorServicio !== undefined) payload.vlorServcios = Math.round(valorServicio);
  else if (base.vlorServcios != null) payload.vlorServcios = base.vlorServcios;

  const valorGastos = primerNumero(data.valor_gastos, data.vlorGastos, data.valorGastos);
  if (valorGastos !== undefined) payload.vlorGastos = Math.round(valorGastos);
  else if (base.vlorGastos != null) payload.vlorGastos = base.vlorGastos;

  if (Array.isArray(data.historialDocs)) {
    if (data.historialDocs.length === 0 && base.historialDocs?.length) {
      payload.historialDocs = base.historialDocs;
    } else {
      payload.historialDocs = data.historialDocs;
    }
  } else if (Array.isArray(base.historialDocs)) {
    payload.historialDocs = base.historialDocs;
  }

  if (data.envios_facturacion !== undefined) payload.envios_facturacion = data.envios_facturacion;
  else if (base.envios_facturacion) payload.envios_facturacion = base.envios_facturacion;

  if (data.ultimo_envio_facturacion !== undefined) {
    payload.ultimo_envio_facturacion = data.ultimo_envio_facturacion;
  } else if (base.ultimo_envio_facturacion) {
    payload.ultimo_envio_facturacion = base.ultimo_envio_facturacion;
  }

  return payload;
};
