#!/usr/bin/env node
/**
 * Mantenimiento S3: borrado por prefijo (año, trimestre, mes, día, cliente/usuario).
 *
 * Ejemplos:
 *   node scripts/s3-storage-maintenance.js --dry-run --year=2024
 *   node scripts/s3-storage-maintenance.js --year=2026 --quarter=2
 *   node scripts/s3-storage-maintenance.js --year=2026 --quarter=2 --month=06 --day=05
 *   node scripts/s3-storage-maintenance.js --year=2025 --owner-type=cliente --owner-id=CLI-001
 *
 * Requiere: STORAGE_DRIVER=s3, AWS_S3_BUCKET, credenciales AWS en entorno o IAM role.
 */
import '../config/secrets.js';
import { isS3StorageEnabled } from '../config/storage.js';
import { buildMaintenancePrefix } from '../utils/storageKeyBuilder.js';
import { deleteObjectsByPrefix } from '../services/s3StorageService.js';

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--year=')) out.year = arg.split('=')[1];
    else if (arg.startsWith('--quarter=')) out.quarter = arg.split('=')[1];
    else if (arg.startsWith('--month=')) out.month = arg.split('=')[1];
    else if (arg.startsWith('--day=')) out.day = arg.split('=')[1];
    else if (arg.startsWith('--owner-type=')) out.ownerType = arg.split('=')[1];
    else if (arg.startsWith('--owner-id=')) out.ownerId = arg.split('=')[1];
    else if (arg.startsWith('--category=')) out.category = arg.split('=')[1];
  }
  return out;
}

async function main() {
  if (!isS3StorageEnabled()) {
    console.error('❌ STORAGE_DRIVER debe ser "s3" y AWS_S3_BUCKET definido.');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args.year) {
    console.error(
      'Uso: --year=YYYY [--quarter=1|2|3|4] [--month=MM] [--day=DD] [--owner-type=usuario|cliente] [--owner-id=ID] [--category=...] [--dry-run]'
    );
    process.exit(1);
  }

  const prefix = buildMaintenancePrefix({
    year: args.year,
    quarter: args.quarter,
    month: args.month,
    day: args.day,
    ownerType: args.ownerType,
    ownerId: args.ownerId,
    category: args.category,
  });

  console.log(`🔍 Prefijo: ${prefix}`);
  if (args.dryRun) console.log('   (modo simulación — no se borra nada)');

  const result = await deleteObjectsByPrefix(prefix, { dryRun: args.dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
