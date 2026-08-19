/**
 * Agrega al Excel de SharePoint los casos FDM (terremoto) que existen en ARNALD y no en el libro.
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import { syncMissingArnaldCasosToExcel } from '../services/equidadFdmExcelOutboundService.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

await mongoose.connect(process.env.MONGO_URI);
try {
  const result = await syncMissingArnaldCasosToExcel();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await mongoose.disconnect();
}
