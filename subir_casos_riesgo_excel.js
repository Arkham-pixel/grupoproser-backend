import 'dotenv/config';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Riesgo from './models/CasoRiesgo.js';
import EstadoRiesgo from './models/EstadoRiesgo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==============================
// CONFIGURACIÓN (SEGURA)
// ==============================

// Pon tu Excel en backend/ con este nombre (o cámbialo)
// También puedes pasar una ruta por variable de entorno:
//   $env:ARCHIVO_EXCEL="C:\ruta\archivo.xlsx"
const ARCHIVO_EXCEL = process.env.ARCHIVO_EXCEL || 'casos_riesgo.xlsx';

// Campo para identificar un caso (debe existir en tu Excel y en BD).
// En tu Excel, "Consecutivo Aseguradora" solo viene en ~331 filas, pero "Consecutivo" viene en todas.
// Por eso, por defecto usamos nmroRiesgo (mapeado desde "Consecutivo").
// Puedes forzarlo por env:
//   $env:CAMPO_UNICO="nmroConsecutivo"
const CAMPO_UNICO = process.env.CAMPO_UNICO || 'nmroRiesgo';

// PROTECCIÓN: desde esta fecha NO se borra ni se actualiza
// (Octubre 1 de 2025, al mediodía para evitar temas de zona horaria)
const FECHA_LIMITE_PROTECCION = new Date(2025, 9, 1, 12, 0, 0);

// Por seguridad:
// - DRY_RUN=true: no borra ni escribe (solo muestra conteos)
// - Para ejecutar de verdad: DRY_RUN=false
const DRY_RUN = process.env.DRY_RUN !== 'false';

// Por seguridad:
// - BORRAR_ANTIGUOS=false: NO borra antiguos
// - Para permitir borrado: BORRAR_ANTIGUOS=true
const BORRAR_ANTIGUOS = process.env.BORRAR_ANTIGUOS === 'true';

// MODO "UN SOLO TAJO":
// Si REEMPLAZAR_TODO=true, el script:
// 1) Borra TODOS los riesgos
// 2) Inserta TODO lo que venga en el Excel
// Recomendado SOLO cuando tu Excel ya tiene TODOS los casos (incluyendo los nuevos).
const REEMPLAZAR_TODO = process.env.REEMPLAZAR_TODO === 'true';

// Por seguridad:
// Solo se borra si el caso tiene fchaAsgncion (fecha asignación) y es anterior al corte.
// Si quieres incluir registros sin fchaAsgncion, activa INCLUIR_SIN_FECHA_ASIGNACION=true.
const INCLUIR_SIN_FECHA_ASIGNACION = process.env.INCLUIR_SIN_FECHA_ASIGNACION === 'true';

const normalizarEncabezado = (valor) =>
  String(valor ?? '')
    .trim()
    .toLowerCase()
    // quitar tildes/diacríticos
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // normalizar espacios
    .replace(/\s+/g, ' ');

// AJUSTA ESTO según tu Excel (los nombres pueden variar en mayúsculas/tildes)
const MAPEO_CAMPOS = {
  // Identificadores
  'Consecutivo': 'nmroRiesgo', // consecutivo interno (si tu Excel lo trae así)
  'N° Riesgo': 'nmroRiesgo',
  'No. Riesgo': 'nmroRiesgo',
  'Numero Riesgo': 'nmroRiesgo',
  'Número Riesgo': 'nmroRiesgo',
  'Consecutivo Aseguradora': 'nmroConsecutivo', // consecutivo de aseguradora (recomendado como CAMPO_UNICO)
  'Consecutivo de Aseguradora': 'nmroConsecutivo',

  // Básicos
  'Aseguradora': 'codiAsgrdra',
  'Cód. Aseguradora': 'codiAsgrdra',
  'Cod. Aseguradora': 'codiAsgrdra',
  'Codigo Aseguradora': 'codiAsgrdra',
  'Asegurado': 'asgrBenfcro',
  'Asegurado o Beneficiario': 'asgrBenfcro',
  'Inspector': 'codiIspector',

  // Fechas
  'Fecha de asignación': 'fchaAsgncion',
  'Fecha Asignación': 'fchaAsgncion',
  'Fecha de inspección': 'fchaInspccion',
  'Fecha Inspección': 'fchaInspccion',
  'Fecha de informe': 'fchaInforme',
  'Fecha Informe': 'fchaInforme',
  'Fecha Informe Final': 'fchaInforme',
  'Fecha del Informe Final': 'fchaInforme',

  // Valores
  'Vlr Tarifa Aseguradora': 'vlorTarifaAseguradora',
  'Vlor Tarifa Aseguradora': 'vlorTarifaAseguradora',
  'Valor Tarifa Aseguradora': 'vlorTarifaAseguradora',
  'Tarifa Aseguradora': 'vlorTarifaAseguradora',
  'Honorarios': 'vlorHonorarios',
  'Gastos': 'vlorGastos',
  'Total Pagado': 'totalPagado',

  // Ubicación / solicitante
  'Ciudad de inspección': 'codigoPoblado',
  'Ciudad de Inspección': 'codigoPoblado',
  'Ciudad Sucursal': 'ciudadSucursal',
  'Ciudad': 'codigoPoblado',
  'Dirección Física': 'codDireccion',
  'Direccion Fisica': 'codDireccion',
  'Quién Solicita': 'funcSolicita',
  'Quien Solicita': 'funcSolicita',

  // Estado / clasificación
  'Clasificación': 'codiClasificacion',
  'Clasificacion': 'codiClasificacion',
  'Estado': 'codiEstdo',

  // Observaciones (si vienen)
  'Observaciones Asignación': 'observAsignacion',
  'Observaciones de Asignación': 'observAsignacion',
  'Observaciones Inspección': 'observInspeccion',
  'Observaciones de Inspección': 'observInspeccion',
  'Observaciones Informe': 'observInforme',
  'Observaciones de Informe': 'observInforme',
};

// ==============================
// Helpers
// ==============================

const esVacio = (v) => v === null || v === undefined || String(v).trim() === '';

function parsearNumeroFlexible(valor) {
  if (esVacio(valor)) return NaN;
  if (typeof valor === 'number') return valor;

  let s = String(valor).trim();
  // quitar símbolos y texto, dejar solo números y separadores
  s = s.replace(/[^0-9.,-]/g, '');
  if (!s) return NaN;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  // Si tiene coma y punto, decidir cuál es decimal por el último separador
  if (lastComma !== -1 && lastDot !== -1) {
    const commaIsDecimal = lastComma > lastDot;
    if (commaIsDecimal) {
      // 1.234,56 -> 1234.56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56 -> 1234.56
      s = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1 && lastDot === -1) {
    // 1234,56 -> 1234.56
    s = s.replace(',', '.');
  } else {
    // solo punto o ninguno: parseFloat normal
  }

  return parseFloat(s);
}

function parsearFecha(valor) {
  if (esVacio(valor) || valor === 'N/A' || valor === 'NaN/NaN/NaN') return null;

  // serial de Excel
  if (typeof valor === 'number') {
    try {
      const f = XLSX.SSF.parse_date_code(valor);
      if (f) return new Date(f.y, f.m - 1, f.d, 12, 0, 0);
    } catch {
      const d = new Date((valor - 25569) * 86400 * 1000);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  const s = String(valor).trim();

  // dd/mm/yyyy
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const yy = Number(m[3]);
    const d = new Date(yy, mm, dd, 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const yy = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const dd = Number(m[3]);
    const d = new Date(yy, mm, dd, 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function leerExcel(nombreArchivo) {
  let ruta = path.join(__dirname, nombreArchivo);
  if (!fs.existsSync(ruta)) ruta = path.join(__dirname, '..', nombreArchivo);
  if (!fs.existsSync(ruta)) throw new Error(`No se encontró el Excel: ${nombreArchivo}`);

  // Detección rápida: algunos "xlsx" en realidad son HTML (cuando se descargó la página web en vez del archivo)
  const inicio = fs.readFileSync(ruta).slice(0, 2000).toString('utf8').toLowerCase();
  if (inicio.includes('<!doctype html') || (inicio.includes('<html') && inicio.includes('<div id=\"root\"'))) {
    throw new Error(
      `El archivo "${nombreArchivo}" NO es un Excel real. Parece HTML (página web). ` +
        `Vuelve a descargar/exportar el Excel y colócalo en backend/`
    );
  }

  const wb = XLSX.readFile(ruta);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'dd/mm/yyyy' });
  return rows;
}

function mapearDatos(rows, estadoNombreACodigo = new Map()) {
  return rows
    .map((fila, idx) => {
      // Normalizar llaves del Excel para que no dependan de tildes/mayúsculas
      const filaNormalizada = {};
      Object.entries(fila || {}).forEach(([k, v]) => {
        const nk = normalizarEncabezado(k);
        if (!nk) return;
        // si hay columnas repetidas, mantener la primera
        if (!(nk in filaNormalizada)) filaNormalizada[nk] = v;
      });

      const datos = {};
      for (const [colExcel, campoBD] of Object.entries(MAPEO_CAMPOS)) {
        const v = filaNormalizada[normalizarEncabezado(colExcel)];
        if (esVacio(v)) continue;

        if (campoBD.startsWith('fcha')) {
          const f = parsearFecha(v);
          if (f) datos[campoBD] = f;
          continue;
        }

        // Estado: en algunos Excels viene como texto ("En proceso", "Facturado")
        if (campoBD === 'codiEstdo') {
          const n = parsearNumeroFlexible(v);
          if (!Number.isNaN(n)) {
            datos.codiEstdo = n;
          } else {
            const clave = normalizarEncabezado(v);
            const codigo = estadoNombreACodigo.get(clave);
            if (codigo !== undefined) {
              datos.codiEstdo = codigo;
            }
          }
          continue;
        }

        // números conocidos
        if (['vlorTarifaAseguradora', 'vlorHonorarios', 'vlorGastos', 'nmroFactra', 'totalPagado'].includes(campoBD)) {
          const n = parsearNumeroFlexible(v);
          if (!Number.isNaN(n)) datos[campoBD] = n;
          continue;
        }

        datos[campoBD] = String(v).trim();
      }

      let identificador = datos[CAMPO_UNICO];

      // Si falta identificador, generar uno (no perder filas reales).
      // Esto pasa cuando el Excel trae datos pero no trae "N° Riesgo"/"Consecutivo" en algunas filas.
      if (esVacio(identificador)) {
        const f = datos.fchaAsgncion instanceof Date ? datos.fchaAsgncion : null;
        const stamp = f
          ? `${f.getFullYear()}${String(f.getMonth() + 1).padStart(2, '0')}${String(f.getDate()).padStart(2, '0')}`
          : 'SINFECHA';

        // Si hay consecutivo de aseguradora, usarlo para construir un id estable
        const consecAseg = !esVacio(datos.nmroConsecutivo) ? String(datos.nmroConsecutivo).trim() : '';
        const generado = consecAseg ? `AUTO-${consecAseg}` : `AUTO-${stamp}-${idx + 2}`;

        // Asignar al campo único que estemos usando
        datos[CAMPO_UNICO] = generado;

        // Y también asegurar nmroRiesgo (es el que se muestra en UI) si viene vacío
        if (esVacio(datos.nmroRiesgo)) {
          datos.nmroRiesgo = generado;
        }

        identificador = generado;
        console.warn(`⚠️ Fila ${idx + 2}: faltaba ${CAMPO_UNICO}; se generó "${generado}".`);
      }

      return { identificador: String(identificador), datos };
    })
    .filter(Boolean);
}

function dedupe(items) {
  const seen = new Set();
  const unique = [];
  const dupes = [];
  for (const it of items) {
    if (seen.has(it.identificador)) dupes.push(it.identificador);
    else {
      seen.add(it.identificador);
      unique.push(it);
    }
  }
  return { unique, dupes };
}

function esProtegido(doc) {
  // En reemplazo total no existe "protección": el Excel manda.
  if (REEMPLAZAR_TODO) return false;

  const fecha = doc?.fchaAsgncion instanceof Date ? doc.fchaAsgncion : null;
  const created = doc?.createdAt instanceof Date ? doc.createdAt : null;

  // Si tiene fecha de asignación, esa manda
  if (fecha) return fecha >= FECHA_LIMITE_PROTECCION;

  // Si no tiene fecha, por seguridad protegemos lo creado desde el corte
  if (created) return created >= FECHA_LIMITE_PROTECCION;

  // Si no hay nada, por seguridad lo consideramos protegido
  return true;
}

async function borrarAntiguos() {
  if (REEMPLAZAR_TODO) {
    const candidatos = await Riesgo.countDocuments({});
    if (DRY_RUN) {
      console.log(`🧪 DRY_RUN=true → NO se borran candidatos (${candidatos}) en REEMPLAZAR_TODO.`);
      return { candidatos, borrados: 0, protegidos: 0 };
    }
    const res = await Riesgo.deleteMany({});
    return { candidatos, borrados: res.deletedCount || 0, protegidos: 0 };
  }

  if (!BORRAR_ANTIGUOS) {
    console.log('🛡️ BORRAR_ANTIGUOS=false → no se borrará nada (modo seguro).');
    return { candidatos: 0, borrados: 0, protegidos: 0 };
  }

  // Candidatos a borrar: SOLO por fchaAsgncion < corte
  const queryBase = {
    fchaAsgncion: { $exists: true, $ne: null, $lt: FECHA_LIMITE_PROTECCION },
  };

  let query = queryBase;

  // Opcional: incluir registros sin fchaAsgncion (usando createdAt) — DESACTIVADO por defecto
  if (INCLUIR_SIN_FECHA_ASIGNACION) {
    query = {
      $or: [
        queryBase,
        { fchaAsgncion: { $exists: false }, createdAt: { $lt: FECHA_LIMITE_PROTECCION } },
        { fchaAsgncion: null, createdAt: { $lt: FECHA_LIMITE_PROTECCION } },
      ],
    };
  }

  const candidatos = await Riesgo.countDocuments(query);

  // Protegidos (conteo informativo)
  const protegidos = await Riesgo.countDocuments({
    $or: [
      { fchaAsgncion: { $exists: true, $ne: null, $gte: FECHA_LIMITE_PROTECCION } },
      { fchaAsgncion: { $exists: false }, createdAt: { $gte: FECHA_LIMITE_PROTECCION } },
      { fchaAsgncion: null, createdAt: { $gte: FECHA_LIMITE_PROTECCION } },
    ],
  });

  if (DRY_RUN) {
    console.log(`🧪 DRY_RUN=true → NO se borran candidatos (${candidatos}).`);
    return { candidatos, borrados: 0, protegidos };
  }

  const res = await Riesgo.deleteMany(query);
  return { candidatos, borrados: res.deletedCount || 0, protegidos };
}

async function upsertDesdeExcel(items) {
  let insertados = 0;
  let actualizados = 0;
  let omitidos = 0;

  if (DRY_RUN) {
    console.log('🧪 DRY_RUN=true → NO se insertará/actualizará nada.');
    return { insertados, actualizados, omitidos };
  }

  // En reemplazo total, como ya borramos todo, solo insertamos.
  if (REEMPLAZAR_TODO) {
    for (const it of items) {
      try {
        const nuevo = new Riesgo(it.datos);
        await nuevo.save();
        insertados++;
      } catch {
        // Si algo falla, lo contamos como omitido (por ejemplo, datos inválidos)
        omitidos++;
      }
    }
    return { insertados, actualizados: 0, omitidos };
  }

  for (const it of items) {
    const existente = await Riesgo.findOne({ [CAMPO_UNICO]: it.identificador });

    if (existente) {
      if (esProtegido(existente)) {
        // Protección fuerte: no tocar casos nuevos
        omitidos++;
        continue;
      }

      Object.assign(existente, it.datos);
      await existente.save();
      actualizados++;
    } else {
      const nuevo = new Riesgo(it.datos);
      await nuevo.save();
      insertados++;
    }
  }

  return { insertados, actualizados, omitidos };
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) throw new Error('MONGO_URI no está definida.');

  console.log(`📅 Corte de protección: ${FECHA_LIMITE_PROTECCION.toLocaleDateString()}`);
  console.log(`🧱 REEMPLAZAR_TODO: ${REEMPLAZAR_TODO}`);
  console.log(`🧪 DRY_RUN: ${DRY_RUN}`);
  console.log(`🗑️ BORRAR_ANTIGUOS: ${BORRAR_ANTIGUOS}`);
  console.log(`🧷 INCLUIR_SIN_FECHA_ASIGNACION: ${INCLUIR_SIN_FECHA_ASIGNACION}`);

  const mongoOptions = {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 30000,
    retryWrites: true,
    w: 'majority',
  };

  const conectarConReintentos = async () => {
    const maxMs = Number(process.env.MONGO_CONNECT_MAX_WAIT_MS || 180000); // 3 minutos
    const sleepMs = Number(process.env.MONGO_CONNECT_RETRY_MS || 10000); // 10s
    const inicio = Date.now();
    let intento = 0;

    while (Date.now() - inicio < maxMs) {
      intento += 1;
      try {
        await mongoose.connect(MONGO_URI, mongoOptions);
        return;
      } catch (err) {
        const msg = err?.message || String(err);
        console.log(`🔄 Mongo no disponible (intento ${intento}). Reintentando en ${Math.round(sleepMs / 1000)}s...`);
        // Log corto del motivo (sin volcar toda la excepción)
        console.log(`   Motivo: ${msg}`);
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }

    throw new Error(`No fue posible conectar a MongoDB tras ${Math.round(maxMs / 1000)}s. Revisa red/whitelist/IP/DNS.`);
  };

  await conectarConReintentos();

  // Construir mapa de estados: "en proceso" -> 2, etc.
  let estadoNombreACodigo = new Map();
  try {
    const estados = await EstadoRiesgo.find().lean();
    estadoNombreACodigo = new Map(
      (estados || [])
        .filter((e) => e && e.descEstdo !== undefined && e.codiEstdo !== undefined)
        .map((e) => [normalizarEncabezado(e.descEstdo), Number(e.codiEstdo)])
    );
  } catch (e) {
    console.warn('⚠️ No se pudo cargar EstadoRiesgo; codiEstdo puede quedar vacío si el Excel trae texto.');
  }

  const rows = leerExcel(ARCHIVO_EXCEL);
  const mapeados = mapearDatos(rows, estadoNombreACodigo);
  const { unique, dupes } = dedupe(mapeados);

  console.log(`📥 Filas Excel: ${rows.length}`);
  console.log(`✅ Filas válidas (con ${CAMPO_UNICO}): ${mapeados.length}`);
  console.log(`🔁 Duplicados en Excel: ${dupes.length}`);

  const borrado = await borrarAntiguos();
  console.log(`🗑️ Candidatos a borrar (${REEMPLAZAR_TODO ? 'TODO' : 'antiguos'}): ${borrado.candidatos}`);
  console.log(`🗑️ Borrados: ${borrado.borrados}`);
  console.log(`🛡️ Protegidos (oct 2025+): ${borrado.protegidos}`);

  const upsert = await upsertDesdeExcel(unique);
  console.log(`🆕 Insertados: ${upsert.insertados}`);
  console.log(`📝 Actualizados (solo antiguos): ${upsert.actualizados}`);
  console.log(`🛡️ Omitidos (protegidos o no tocables): ${upsert.omitidos}`);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('❌ Error:', e?.message || e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});






