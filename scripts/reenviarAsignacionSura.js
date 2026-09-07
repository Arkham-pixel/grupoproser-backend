/**
 * Reenvía correo de asignación SURA con el mapeo corregido.
 *
 * Uso:
 *   node scripts/reenviarAsignacionSura.js SURA-2026-08-117
 *   node scripts/reenviarAsignacionSura.js SURA-2026-08-117 --to=tu@correo.com
 */
import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import SegurosSuraCaso from '../models/SegurosSuraCaso.js';
import { enviarNotificacionAsignacion } from '../services/emailService.js';
import { isMailConfigured, getMailConfigStatus } from '../services/mailTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const consecutivo = process.argv[2] || 'SURA-2026-08-117';
const toArg = process.argv.find((a) => a.startsWith('--to='));
const emailOverride = toArg ? toArg.slice(5).trim() : '';

const texto = (...vals) =>
  vals.map((v) => String(v || '').trim()).find((v) => v && !/^seguros\s+generales\s+suramericana/i.test(v)) ||
  '';

async function main() {
  if (!isMailConfigured()) {
    console.error('❌ Correo no configurado:', getMailConfigStatus());
    process.exit(1);
  }

  const uri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ Falta MONGO_URI');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const caso = await SegurosSuraCaso.findOne({
    $or: [{ consecutivo }, { nmroAjste: consecutivo }],
  }).lean();

  if (!caso) {
    console.error(`❌ Caso no encontrado: ${consecutivo}`);
    process.exit(1);
  }

  const nombreAsegurado = texto(caso.asegurado, caso.asgrBenfcro, caso.tomador);
  const fechaAsignacion =
    caso.fchaAsgncion || caso.fechaAsignacion || caso.updatedAt || caso.createdAt || new Date();

  console.log('📋 Caso:', caso.consecutivo || caso.nmroAjste);
  console.log('   siniestro:', caso.siniestro || caso.nmroSinstro || '(vacío)');
  console.log('   asegurado:', nombreAsegurado || '(vacío)');
  console.log('   intermediario:', caso.nombIntermediario || '(vacío)');
  console.log('   ciudad:', caso.ciudad || '(vacío)');
  console.log('   póliza:', caso.numeroPoliza || caso.nmroPolza || '(vacío)');
  console.log('   ajustador:', caso.ajustador || '(vacío)');

  const email =
    emailOverride ||
    process.env.EMAIL_TEST_TO ||
    'alvaro@proserpuertos.com.co';

  const resultado = await enviarNotificacionAsignacion({
    modulo: 'sura',
    tipoCaso: 'sura',
    numeroCaso: caso.consecutivo || caso.nmroAjste || consecutivo,
    consecutivo: caso.consecutivo || consecutivo,
    casoId: String(caso._id),
    numeroSiniestro: caso.siniestro || caso.nmroSinstro || '',
    siniestro: caso.siniestro || caso.nmroSinstro || '',
    nmroSinstro: caso.nmroSinstro || caso.siniestro || '',
    codigoWorkflow: caso.codWorkflow || '',
    fechaSiniestro: caso.fechaSiniestro || caso.fchaSinstro || null,
    fchaSinstro: caso.fchaSinstro || caso.fechaSiniestro || null,
    fechaAsignacion,
    fchaAsgncion: fechaAsignacion,
    tipoPoliza: caso.cobertura || caso.tipoPoliza || caso.causa_siniestro || '',
    cobertura: caso.cobertura || '',
    aseguradora: 'Seguros Sura',
    asegurado: nombreAsegurado,
    aseguradoReal: nombreAsegurado,
    asgrBenfcro: nombreAsegurado,
    tomador: caso.tomador || '',
    intermediario: caso.nombIntermediario || '',
    nombIntermediario: caso.nombIntermediario || '',
    funcionarioAseguradora: caso.funcAsgrdraNombre || '',
    numeroPoliza: caso.numeroPoliza || caso.nmroPolza || '',
    ciudadSiniestro: caso.ciudad || caso.ciudadSiniestro || caso.nombreCiudad || '',
    ciudad: caso.ciudad || '',
    descripcionSiniestro: caso.descSinstro || caso.observacionLlamada || '',
    estado: caso.estado || caso.descripcionEstado || '',
    descripcionEstado: caso.descripcionEstado || caso.estado || '',
    nombreResponsable: caso.ajustador || caso.nombreResponsable || '',
    emailResponsable: email,
    quienAsigna: 'ARNALD (reenvío prueba)',
    observaciones: `Reenvío de prueba — mapeo corregido de asignación SURA (${consecutivo}).`,
    enlacePanelOverride: `${process.env.FRONTEND_URL || 'https://arnald.proserpuertos.com.co'}/sura/caso?id=${caso._id}`,
  });

  console.log('📧 Resultado:', JSON.stringify(resultado, null, 2));
  await mongoose.disconnect();
  process.exit(resultado?.success ? 0 : 1);
}

main().catch(async (err) => {
  console.error('❌ Error:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
