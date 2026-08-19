/**
 * Fusiona casos FDM duplicados (p. ej. filas incompletas de Fundación/SharePoint).
 * Conserva el caso más completo (cédula/liquidador) y une archivos.
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import {
  fusionarDuplicadosExistentesFdm,
  sonElMismoCasoFdm,
} from '../services/fdmImportService.js';

const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGO_URI);
const docs = await EquidadFdmCaso.find().select('consecutivo nombre cedula evento createdAt').lean();
let gruposPrevistos = 0;
const vistos = new Set();
for (let i = 0; i < docs.length; i += 1) {
  if (vistos.has(String(docs[i]._id))) continue;
  const grupo = [docs[i]];
  for (let j = i + 1; j < docs.length; j += 1) {
    if (vistos.has(String(docs[j]._id))) continue;
    if (!sonElMismoCasoFdm(docs[i], docs[j])) continue;
    grupo.push(docs[j]);
    vistos.add(String(docs[j]._id));
  }
  vistos.add(String(docs[i]._id));
  if (grupo.length > 1) {
    gruposPrevistos += 1;
    console.log(
      `GRUPO ${grupo.length}:`,
      grupo.map((g) => `${g.consecutivo}|${g.nombre}|${g.cedula || '-'}`).join(' || ')
    );
  }
}

if (!apply) {
  console.log(JSON.stringify({ dryRun: true, grupos: gruposPrevistos, casos: docs.length }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
}

const fusionados = await fusionarDuplicadosExistentesFdm();
const restantes = await EquidadFdmCaso.countDocuments();
console.log(JSON.stringify({ applied: true, fusionados, restantes }, null, 2));
await mongoose.disconnect();
