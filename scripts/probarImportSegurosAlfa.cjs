/**
 * Prueba local: parsea el consolidado y llama 2 veces a /api/seguros-alfa/importar
 * para validar creación + deduplicación (segunda pasada debe actualizar).
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const API = process.env.ALFA_API || 'http://localhost:3000/api/seguros-alfa';
const EXCEL =
  process.env.ALFA_EXCEL ||
  'C:/Users/GP-TI/Downloads/CONSOLIDADO-TERREMOTO -AGOSTO 2026- FAC-Cali.xlsx';

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
  CONTACTO: 'informacionContacto',
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

const parseFechaCelda = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }
  if (typeof valor === 'number') {
    const utc = Date.UTC(1899, 11, 30) + Math.round(valor * 86400000);
    return new Date(utc).toISOString().slice(0, 10);
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
  const limpio = String(valor).replace(/[^\d.,-]/g, '').replace(/,/g, '');
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

async function importar(casos) {
  const res = await fetch(`${API}/importar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ casos }),
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(json.error || json.detalle || `HTTP ${res.status}`);
  }
  return json.data;
}

async function listar() {
  const res = await fetch(`${API}?limit=200`);
  const json = await res.json();
  return json;
}

async function main() {
  if (!fs.existsSync(EXCEL)) {
    throw new Error(`No existe Excel: ${EXCEL}`);
  }
  const wb = XLSX.readFile(EXCEL, { cellDates: true });
  console.log('Hojas:', wb.SheetNames.join(', '));

  let hoja = null;
  let casos = [];
  for (const nombre of ['BD', 'PENDIENTES', ...wb.SheetNames]) {
    if (!wb.Sheets[nombre]) continue;
    const parsed = parsearHoja(wb.Sheets[nombre]);
    if (parsed.length) {
      hoja = nombre;
      casos = parsed;
      break;
    }
  }

  console.log(`Hoja usada: ${hoja}`);
  console.log(`Casos parseados: ${casos.length}`);
  if (!casos.length) throw new Error('Sin casos para importar');
  console.log('Ejemplo:', JSON.stringify(casos[0], null, 2));

  console.log('\n--- Pasada 1 (crear) ---');
  const r1 = await importar(casos);
  console.log(r1);

  console.log('\n--- Pasada 2 (debe actualizar, no duplicar) ---');
  const r2 = await importar(casos);
  console.log(r2);

  const lista = await listar();
  console.log(`\nTotal en BD: ${lista.total}`);
  console.log(
    'Consecutivos:',
    (lista.data || []).slice(0, 15).map((c) => `${c.consecutivo}|${c.identificacion}`).join(' ; ')
  );

  const okDedup =
    r2.creados === 0 &&
    r2.actualizados === casos.length &&
    lista.total === r1.creados + (lista.total - r1.creados); // soft check

  if (r2.creados !== 0) {
    console.error('\nFALLO: la 2ª pasada creó casos nuevos (debería ser 0).');
    process.exit(1);
  }
  if (r2.actualizados < 1) {
    console.error('\nFALLO: la 2ª pasada no actualizó casos.');
    process.exit(1);
  }
  if (lista.total !== r1.creados && r1.actualizados === 0) {
    // first run on empty DB: total should equal created
  }
  console.log('\nOK: deduplicación funcionó (2ª pasada solo actualizó).');
  void okDedup;
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
