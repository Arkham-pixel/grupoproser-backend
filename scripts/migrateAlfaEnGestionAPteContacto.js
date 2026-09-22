/**
 * Migra estadoGestion «EN GESTIÓN» → «PTE CONTACTO» (EN GESTIÓN ya no existe).
 *
 * Uso:
 *   node scripts/migrateAlfaEnGestionAPteContacto.js --dry-run
 *   node scripts/migrateAlfaEnGestionAPteContacto.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { homologarEstadoGestionAlfa } from '../config/alfaExcelStatuses.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';

const DRY = process.argv.includes('--dry-run');

const MATCH = {
  $or: [
    { estadoGestion: { $in: ['EN GESTIÓN', 'EN GESTION', 'En gestión', 'En Gestion'] } },
    { estadoGestion: { $regex: '^\\s*EN\\s+GESTI[OÓ]N\\s*$', $options: 'i' } },
  ],
};

await mongoose.connect(process.env.MONGO_URI, {
  family: 4,
  serverSelectionTimeoutMS: 30000,
});

const candidatos = await SegurosAlfaCaso.find(MATCH)
  .select('_id consecutivo estado estadoGestion')
  .lean();

console.log(`Candidatos EN GESTIÓN: ${candidatos.length} (dryRun=${DRY})`);

let updated = 0;
let skipped = 0;
let errors = 0;

for (const caso of candidatos) {
  const before = String(caso.estadoGestion || '');
  const after = homologarEstadoGestionAlfa(before);
  if (after === before || after !== 'PTE CONTACTO') {
    skipped += 1;
    continue;
  }
  if (DRY) {
    console.log(`DRY ${caso.consecutivo || caso._id}: "${before}" → "${after}"`);
    updated += 1;
    continue;
  }
  try {
    await SegurosAlfaCaso.updateOne(
      { _id: caso._id },
      { $set: { estadoGestion: 'PTE CONTACTO' } }
    );
    await enqueueAlfaExcelOutboundFromCaseUpdate({
      beforeDoc: caso,
      afterDoc: { ...caso, estadoGestion: 'PTE CONTACTO' },
    });
    updated += 1;
  } catch (err) {
    errors += 1;
    console.error(`ERR ${caso._id}:`, err.message);
  }
}

const restantes = await SegurosAlfaCaso.countDocuments(MATCH);
console.log(JSON.stringify({ updated, skipped, errors, restantes }, null, 2));
await mongoose.disconnect();
