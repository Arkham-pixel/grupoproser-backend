/**
 * Importa Excel FDM (OLA INVERNAL o TERREMOTO) sin borrar lo existente.
 *
 * Uso (desde /grupoproser-backend):
 *   node scripts/importarEquidadFdmDesdeExcel.js --dry-run --file "ruta/al/archivo.xlsx"
 *   node scripts/importarEquidadFdmDesdeExcel.js --file "ruta/al/archivo.xlsx"
 *
 * --replace queda deshabilitado a propósito: no borra la colección.
 */

import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import path from 'path';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import { parsearCasosFdmDesdeArchivo } from '../utils/fdmExcelParse.js';
import { ejecutarImportacionFdm } from '../services/fdmImportService.js';

const mongoOptions = {
  serverSelectionTimeoutMS: 30000,
  retryWrites: true,
  w: 'majority',
};

async function connectMongo() {
  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI no definido');
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
  await mongoose.connect(uri, mongoOptions);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const replace = args.includes('--replace');
  const fileIdx = args.indexOf('--file');
  const sheetIdx = args.indexOf('--sheet');
  const file = fileIdx >= 0 && args[fileIdx + 1] ? path.resolve(args[fileIdx + 1]) : null;
  const sheet = sheetIdx >= 0 && args[sheetIdx + 1] ? String(args[sheetIdx + 1]) : '';
  return { dryRun, replace, file, sheet };
}

async function main() {
  const { dryRun, replace, file, sheet } = parseArgs();

  if (replace) {
    console.error('❌ --replace está deshabilitado. La importación es incremental y no borra casos existentes.');
    process.exit(1);
  }
  if (!file) {
    console.error('❌ Indique el archivo con --file "ruta/al/archivo.xlsx"');
    process.exit(1);
  }

  console.log('📂 Archivo:', file);
  if (sheet) console.log('📄 Hoja solicitada:', sheet);
  const { casos, hoja, encabezados } = parsearCasosFdmDesdeArchivo(file, path.basename(file), {
    preferredSheet: sheet,
  });
  console.log('📄 Hoja usada:', hoja);
  console.log('📑 Encabezados mapeados:', encabezados.join(', '));

  const porEstado = casos.reduce((acc, d) => {
    acc[d.estado] = (acc[d.estado] || 0) + 1;
    return acc;
  }, {});
  const porEvento = casos.reduce((acc, d) => {
    acc[d.evento || '(sin evento)'] = (acc[d.evento || '(sin evento)'] || 0) + 1;
    return acc;
  }, {});

  console.log('\n--- Resumen parseo ---');
  console.log('Casos leídos:', casos.length);
  console.log('Por estado:', JSON.stringify(porEstado));
  console.log('Por evento:', JSON.stringify(porEvento));
  if (casos[0]) {
    console.log('Ejemplo primer caso:', JSON.stringify(casos[0], null, 2));
  }

  if (dryRun) {
    console.log('\n🔍 Modo dry-run: no se escribió en base de datos.');
    return;
  }

  await connectMongo();
  console.log('✅ MongoDB conectado');

  const existentes = await EquidadFdmCaso.countDocuments();
  console.log(`ℹ️  Casos actuales en colección: ${existentes} (no se borran).`);

  const resumen = await ejecutarImportacionFdm(casos);
  const total = await EquidadFdmCaso.countDocuments();
  const nuevos = await EquidadFdmCaso.countDocuments({ esNuevo: true });

  console.log('\n--- Importación ---');
  console.log('Recibidos:', resumen.totalRecibidos);
  console.log('Creados (marcados NUEVO):', resumen.creados);
  console.log('Actualizados:', resumen.actualizados);
  console.log('Omitidos:', resumen.omitidos);
  if (resumen.errores?.length) {
    console.log('Errores:', JSON.stringify(resumen.errores.slice(0, 20), null, 2));
  }
  console.log(`Total en colección: ${total} (nuevos marcados: ${nuevos})`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
