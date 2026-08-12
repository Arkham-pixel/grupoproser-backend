/**
 * Borra casos Seguros Alfa de prueba y carga los reales desde
 * OneDrive/.../SEGUROS ALFA.xlsx (hoja BD).
 *
 * Uso: node scripts/cargarCasosRealesAlfa.cjs
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const EXCEL =
  process.env.ALFA_EXCEL_PATH ||
  'C:/Users/GP-TI/OneDrive/Documentos/SEFUROS ALFA/SEGUROS ALFA.xlsx';

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
  ASEGURADO: 'asegurado',
  NOMBRE: 'asegurado',
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
  EMAIL: 'correo',
  CIUDAD: 'ciudad',
  DEPARTAMENTO: 'departamento',
  'FECHA SINIESTRO': 'fechaSiniestro',
  'FECHA INICIO': 'fechaInicioPoliza',
  'FECHA FIN': 'fechaFinPoliza',
  'VALOR ASEGURADO INMUEBLE': 'valorAseguradoInmueble',
  'VALOR ASEGURADO CONTENIDOS': 'valorAseguradoContenidos',
  COBERTURA: 'cobertura',
  'ESTADO PAGO PRIMAS': 'estadoPagoPrimas',
  'CANAL DE RADICACION': 'canalRadicacion',
  CANAL: 'canalRadicacion',
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
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fallback */
  }
  return date.toISOString().slice(0, 10);
};

const parseFecha = (valor) => {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return fechaBogotaIso(valor);
  if (typeof valor === 'number') {
    const utc = Date.UTC(1899, 11, 30) + Math.round(valor * 86400000);
    return fechaBogotaIso(new Date(utc));
  }
  const texto = String(valor).trim();
  if (/^POR CONFIRM/i.test(texto)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  return null;
};

const parseNumero = (valor) => {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  const texto = String(valor).trim();
  if (/^(n\/?a|null|desiste|por confirmar|-)$/i.test(texto)) return null;
  if (!/\d/.test(texto)) return null;
  const n = Number(texto.replace(/[^\d.,-]/g, '').replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
};

const parsearHoja = (sheet) => {
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  if (!matriz.length) return [];
  let headerRowIdx = -1;
  let colMap = {};
  for (let r = 0; r < Math.min(matriz.length, 20); r += 1) {
    const provisional = {};
    (matriz[r] || []).forEach((celda, c) => {
      const campo = HEADER_MAP[normHeader(celda)];
      if (campo) provisional[c] = campo;
    });
    const campos = new Set(Object.values(provisional));
    if (campos.has('identificacion')) {
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
      if (CAMPOS_FECHA.has(campo)) caso[campo] = parseFecha(raw);
      else if (CAMPOS_NUMERO.has(campo)) caso[campo] = parseNumero(raw);
      else if (raw == null || raw === '') caso[campo] = null;
      else caso[campo] = String(raw).trim();
    });
    if (!caso.identificacion) continue;
    if (!caso.estado) caso.estado = 'PENDIENTE';
    casos.push(caso);
  }
  return casos;
};

const toDate = (iso) => {
  if (!iso || typeof iso !== 'string') return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
};

async function main() {
  if (!fs.existsSync(EXCEL)) {
    console.error('No se encontró el Excel:', EXCEL);
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('Falta MONGO_URI en .env');
    process.exit(1);
  }

  const wb = XLSX.readFile(EXCEL, { cellDates: true });
  const hoja =
    wb.SheetNames.find((n) => normHeader(n) === 'BD') ||
    wb.SheetNames.find((n) => normHeader(n) === 'PENDIENTES') ||
    wb.SheetNames[0];
  const casos = parsearHoja(wb.Sheets[hoja]);
  console.log(`Hoja ${hoja}: ${casos.length} casos parseados`);
  if (!casos.length) {
    console.error('Sin filas válidas');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.collection('gsk3cAppsegurosAlfaCasos');
  const antes = await col.countDocuments();
  const del = await col.deleteMany({});
  console.log(`Borrados ${del.deletedCount} casos previos (había ${antes})`);

  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const docs = casos.map((c, i) => ({
    ...c,
    consecutivo: `ALFA-${año}-${mes}-${i + 1}`,
    fechaSiniestro: toDate(c.fechaSiniestro),
    fechaInicioPoliza: toDate(c.fechaInicioPoliza),
    fechaFinPoliza: toDate(c.fechaFinPoliza),
    fechaInspeccion: toDate(c.fechaInspeccion),
    fechaUltimoDocumento: toDate(c.fechaUltimoDocumento),
    fechaLiquidado: toDate(c.fechaLiquidado),
    fechaAceptacionLiquidacion: toDate(c.fechaAceptacionLiquidacion),
    fechaEnvioAseguradora: toDate(c.fechaEnvioAseguradora),
    liquidador: null,
    informeUnico: null,
    archivos: [],
    createdAt: ahora,
    updatedAt: ahora,
  }));

  const ins = await col.insertMany(docs);
  console.log(`Insertados ${ins.insertedCount || docs.length} casos reales`);
  console.log(
    'Muestra:',
    docs.slice(0, 3).map((d) => ({
      consecutivo: d.consecutivo,
      id: d.identificacion,
      asegurado: d.asegurado,
      canal: d.canalRadicacion,
      ciudad: d.ciudad,
    }))
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
