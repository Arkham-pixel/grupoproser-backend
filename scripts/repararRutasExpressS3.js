/**
 * Repara rutas corruptas en anexos Express (anexos + anexosSalvamento).
 *
 * Uso:
 *   node scripts/repararRutasExpressS3.js --dry-run
 *   node scripts/repararRutasExpressS3.js --apply
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SiniestroExpress from '../models/SiniestroExpress.js';
import { canAccessS3Bucket } from '../config/storage.js';
import {
  normalizeStoredFileReference,
  parseS3KeyFromStoredPath,
  extractS3PathHints,
  buildRecentStorageSearchPrefixes,
} from '../utils/storageKeyBuilder.js';
import { findObjectKeysByFilename } from '../services/s3StorageService.js';
import { storageConfig } from '../config/storage.js';

dotenv.config();

const args = new Set(process.argv.slice(2));
const dryRun = !args.has('--apply');

function repararAnexo(anexo) {
  if (!anexo?.url) return { anexo, changed: false, repaired: false };

  const original = anexo.url;
  const normalizada = normalizeStoredFileReference(original);
  if (!normalizada) return { anexo: null, changed: true, repaired: false };

  if (normalizada === original) {
    return { anexo, changed: false, repaired: false };
  }

  return {
    anexo: { ...anexo, url: normalizada },
    changed: true,
    repaired: true,
    from: original,
    to: normalizada,
  };
}

async function buscarClaveS3ParaAnexo(anexo) {
  const url = normalizeStoredFileReference(anexo?.url || '');
  if (!url.startsWith('s3:')) return null;

  const primary = parseS3KeyFromStoredPath(url);
  const hints = extractS3PathHints(primary || '');
  if (!hints?.filename) return null;

  const bucketPrefix = storageConfig.keyPrefix();
  const searchPrefixes = buildRecentStorageSearchPrefixes(new Date(), 6).flatMap((p) =>
    bucketPrefix ? [`${bucketPrefix}/${p}`, p] : [p]
  );

  const keys = await findObjectKeysByFilename(hints.filename, {
    ownerId: hints.ownerId,
    category: hints.category || 'express',
    searchPrefixes,
    maxResults: 3,
  });

  if (keys.length === 1) return `s3:${keys[0]}`;
  return null;
}

async function repararListaAnexos(anexos = [], stats) {
  const resultado = [];
  for (const anexo of anexos) {
    let { anexo: actual, changed, repaired, from, to } = repararAnexo(anexo);

    if (actual && canAccessS3Bucket()) {
      const claveEncontrada = await buscarClaveS3ParaAnexo(actual);
      if (claveEncontrada && claveEncontrada !== actual.url) {
        from = actual.url;
        to = claveEncontrada;
        actual = { ...actual, url: claveEncontrada };
        changed = true;
        repaired = true;
        stats.recuperadosS3 += 1;
      }
    }

    if (changed && repaired) {
      stats.reparados += 1;
      console.log(`   📎 ${anexo?.nombre || 'anexo'}:`);
      console.log(`      antes: ${from}`);
      console.log(`      después: ${to}`);
    } else if (changed && !actual) {
      stats.eliminados += 1;
      console.log(`   🗑️ anexo inválido eliminado: ${from}`);
    }

    if (actual) resultado.push(actual);
  }
  return resultado;
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definido');
    process.exit(1);
  }

  console.log(dryRun ? '🔍 Modo simulación (--dry-run)' : '✏️ Modo aplicar (--apply)');
  if (canAccessS3Bucket()) {
    console.log(`☁️ Bucket S3: ${storageConfig.bucket()}`);
  } else {
    console.log('⚠️ S3 no configurado: solo normalización de rutas (sin búsqueda en bucket)');
  }

  await mongoose.connect(MONGO_URI);
  const registros = await SiniestroExpress.find({}).lean();
  const stats = { total: registros.length, casos: 0, reparados: 0, eliminados: 0, recuperadosS3: 0 };

  for (const registro of registros) {
    const anexosAntes = JSON.stringify(registro.anexos || []);
    const salvAntes = JSON.stringify(registro.anexosSalvamento || []);

    const anexos = await repararListaAnexos(registro.anexos || [], stats);
    const anexosSalvamento = await repararListaAnexos(registro.anexosSalvamento || [], stats);

    const anexosDespues = JSON.stringify(anexos);
    const salvDespues = JSON.stringify(anexosSalvamento);

    if (anexosAntes !== anexosDespues || salvAntes !== salvDespues) {
      stats.casos += 1;
      console.log(`\n📋 ${registro.consecutivo || registro.numeroSiniestro || registro._id}`);

      if (!dryRun) {
        await SiniestroExpress.updateOne(
          { _id: registro._id },
          { $set: { anexos, anexosSalvamento } }
        );
      }
    }
  }

  console.log('\n=== RESUMEN ===');
  console.log(`Registros revisados: ${stats.total}`);
  console.log(`Casos con cambios:   ${stats.casos}`);
  console.log(`Anexos reparados:    ${stats.reparados}`);
  console.log(`Recuperados desde S3:${stats.recuperadosS3}`);
  console.log(`Anexos eliminados:   ${stats.eliminados}`);
  if (dryRun && stats.casos > 0) {
    console.log('\nEjecute con --apply para guardar los cambios en MongoDB.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
