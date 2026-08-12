/**
 * Reimporta el consolidado con parser de fechas/números corregido y valida vs Excel.
 */
const fs = require('fs');
const XLSX = require('xlsx');

const API = 'http://localhost:3000/api/seguros-alfa';
const EXCEL = 'C:/Users/GP-TI/Downloads/CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';

const normHeader = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[°º]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const HEADER_MAP = {
  SINIESTRO: 'siniestro',
  IDENTIFICACION: 'identificacion',
  CEDULA: 'identificacion',
  NOMBRE: 'informacionContacto',
  TOMADOR: 'tomador',
  'N POLIZA': 'numeroPoliza',
  'NUMERO POLIZA': 'numeroPoliza',
  'NO POLIZA': 'numeroPoliza',
  'DIRECCION PREDIO': 'direccionPredio',
  'N CREDITO': 'numeroCredito',
  'NUMERO CREDITO': 'numeroCredito',
  'NO CREDITO': 'numeroCredito',
  CREDITO: 'numeroCredito',
  'INFORMACION DE CONTACTO': 'informacionContacto',
  CORREO: 'correo',
  CIUDAD: 'ciudad',
  DEPARTAMENTO: 'departamento',
  'FECHA SINIESTRO': 'fechaSiniestro',
  'FECHA INICIO': 'fechaInicioPoliza',
  'FECHA INICIO POLIZA': 'fechaInicioPoliza',
  'VIGENCIA DESDE': 'fechaInicioPoliza',
  'FECHA FIN': 'fechaFinPoliza',
  'FECHA FIN POLIZA': 'fechaFinPoliza',
  'VIGENCIA HASTA': 'fechaFinPoliza',
  'VALOR ASEGURADO INMUEBLE': 'valorAseguradoInmueble',
  'VALOR ASEGURADO CONTENIDOS': 'valorAseguradoContenidos',
  COBERTURA: 'cobertura',
  'ESTADO PAGO PRIMAS': 'estadoPagoPrimas',
  'VALOR RESERVA PREVENTIVA PROMEDIO': 'valorReservaPreventivaPromedio',
  'VALOR COMERCIAL INMUEBLE': 'valorComercialInmueble',
  RESERVA: 'reserva',
  'VALOR RECLAMADO': 'valorReclamado',
  'VALOR LIQUIDADO': 'valorLiquidado',
  'FECHA INSPECCION': 'fechaInspeccion',
  'FECHA ULTIMO DOCUMENTO': 'fechaUltimoDocumento',
  'FECHA LIQUIDADO': 'fechaLiquidado',
  'FECHA ACEPTACION LIQUIDACION': 'fechaAceptacionLiquidacion',
  'FECHA ENVIO A LA ASEGURADORA': 'fechaEnvioAseguradora',
  ESTADO: 'estado',
  'ESTADO FINAL': 'estado',
};

const CAMPOS_FECHA = new Set([
  'fechaSiniestro',
  'fechaInicioPoliza',
  'fechaFinPoliza',
  'fechaInspeccion',
  'fechaUltimoDocumento',
  'fechaLiquidado',
  'fechaAceptacionLiquidacion',
  'fechaEnvioAseguradora',
]);
const CAMPOS_NUMERO = new Set([
  'valorAseguradoInmueble',
  'valorAseguradoContenidos',
  'valorReservaPreventivaPromedio',
  'valorComercialInmueble',
  'reserva',
  'valorReclamado',
  'valorLiquidado',
]);

const fechaBogotaIso = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
};

const parseFechaCelda = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return fechaBogotaIso(valor);
  if (typeof valor === 'number') {
    const utc = Date.UTC(1899, 11, 30) + Math.round(valor * 86400000);
    return fechaBogotaIso(new Date(utc));
  }
  const texto = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const m = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  let month = Number(m[1]);
  let day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month > 12 && day <= 12) [month, day] = [day, month];
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const parseNumeroCelda = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number' && !Number.isNaN(valor)) return valor;
  const texto = String(valor).trim();
  if (!texto) return null;
  if (/^(n\/?a|null|undefined|desiste|por confirmar|por confrimar|-)$/i.test(texto)) return null;
  if (!/\d/.test(texto)) return null;
  const limpio = texto.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!limpio || limpio === '-') return null;
  const n = Number(limpio);
  return Number.isNaN(n) ? null : n;
};

function parsearHoja(sheet) {
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  let headerRowIdx = -1;
  let colMap = {};
  for (let r = 0; r < Math.min(matriz.length, 30); r += 1) {
    const provisional = {};
    (matriz[r] || []).forEach((celda, c) => {
      const campo = HEADER_MAP[normHeader(celda)];
      if (campo) provisional[c] = campo;
    });
    const campos = new Set(Object.values(provisional));
    if (campos.has('identificacion') || (campos.has('siniestro') && campos.has('estado'))) {
      headerRowIdx = r;
      colMap = provisional;
      break;
    }
  }
  if (headerRowIdx < 0) return [];
  const casos = [];
  for (let r = headerRowIdx + 1; r < matriz.length; r += 1) {
    const row = matriz[r] || [];
    const caso = {};
    Object.entries(colMap).forEach(([colStr, campo]) => {
      const raw = row[Number(colStr)];
      if (CAMPOS_FECHA.has(campo)) caso[campo] = parseFechaCelda(raw);
      else if (CAMPOS_NUMERO.has(campo)) caso[campo] = parseNumeroCelda(raw);
      else if (raw === null || raw === undefined || raw === '') caso[campo] = null;
      else caso[campo] = String(raw).trim();
    });
    if (!caso.identificacion) continue;
    if (!caso.estado) caso.estado = 'PENDIENTE';
    casos.push(caso);
  }
  return casos;
}

const fmtApiDate = (iso) => {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
};

async function main() {
  if (!fs.existsSync(EXCEL)) throw new Error('Excel no encontrado');
  const wb = XLSX.readFile(EXCEL, { cellDates: true });
  const casos = parsearHoja(wb.Sheets.PENDIENTES);
  console.log('Parseados', casos.length);
  console.log('Ejemplo fechaSiniestro', casos[0].fechaSiniestro, 'contenidos', casos[0].valorAseguradoContenidos);

  const r1 = await fetch(`${API}/importar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ casos }),
  }).then((x) => x.json());
  console.log('Import', r1.data || r1);

  const lista = await fetch(`${API}?limit=50`).then((x) => x.json());
  const byId = new Map((lista.data || []).map((c) => [String(c.identificacion), c]));

  let ok = 0;
  let fail = 0;
  for (const excel of casos) {
    const api = byId.get(String(excel.identificacion));
    if (!api) {
      console.log('FALTA', excel.identificacion);
      fail += 1;
      continue;
    }
    const fechaApi = fmtApiDate(api.fechaSiniestro);
    const fechaOk = (excel.fechaSiniestro || null) === (fechaApi || null);
    const reservaOk = (excel.reserva ?? null) === (api.reserva ?? null);
    const contenidosOk =
      (excel.valorAseguradoContenidos ?? null) === (api.valorAseguradoContenidos ?? null);
    const polizaOk = (excel.numeroPoliza || '') === (api.numeroPoliza || '');
    const line = `${excel.identificacion} fecha excel=${excel.fechaSiniestro} api=${fechaApi} [${fechaOk ? 'OK' : 'BAD'}] reserva[${reservaOk ? 'OK' : 'BAD'}] contenidos[${contenidosOk ? 'OK' : 'BAD'}] poliza[${polizaOk ? 'OK' : 'BAD'}]`;
    console.log(line);
    if (fechaOk && reservaOk && contenidosOk && polizaOk) ok += 1;
    else fail += 1;
  }
  console.log(`\nResultado: ${ok} OK / ${fail} fallos / total ${casos.length}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
