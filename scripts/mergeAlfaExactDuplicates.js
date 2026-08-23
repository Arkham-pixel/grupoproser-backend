/**
 * Fusiona duplicados exactos Alfa (misma identificación + misma póliza real + mismo crédito).
 * Conserva el caso más rico (liquidador/informe/estado avanzado) y borra el resto.
 *
 * node scripts/mergeAlfaExactDuplicates.js
 * node scripts/mergeAlfaExactDuplicates.js --apply
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { isPolicyPlaceholder, normalizeIdentification, normalizeCreditNumber } from '../utils/alfaExcelNormalize.js';
import { normalizePolicyNumber } from '../utils/alfaPolicyNumber.js';

const apply = process.argv.includes('--apply');

function score(c) {
  let s = 0;
  if (c.liquidador && typeof c.liquidador === 'object' && Object.keys(c.liquidador).length) s += 100;
  if (c.informeUnico && typeof c.informeUnico === 'object' && Object.keys(c.informeUnico).length) s += 80;
  if (Array.isArray(c.archivos) && c.archivos.length) s += 10 * Math.min(c.archivos.length, 20);
  const est = String(c.estado || '').toUpperCase();
  if (est.includes('LIQUID')) s += 50;
  if (est.includes('INSPECC')) s += 30;
  if (est.includes('GIRADO')) s += 60;
  if (c.fechaInspeccion) s += 15;
  if (c.fechaUltimoDocumento) s += 10;
  if (c.valorLiquidado) s += 10;
  return s;
}

await mongoose.connect(process.env.MONGO_URI);
const all = await SegurosAlfaCaso.find().lean();
const groups = new Map();

for (const c of all) {
  const id = normalizeIdentification(c.identificacion) || '';
  const polRaw = c.numeroPoliza;
  if (!id || isPolicyPlaceholder(polRaw)) continue;
  const pol = normalizePolicyNumber(polRaw) || String(polRaw || '').trim().toUpperCase();
  const cred = normalizeCreditNumber(c.numeroCredito) || '';
  if (!pol) continue;
  const key = `${id}|${pol}|${cred}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(c);
}

const dups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
console.log(JSON.stringify({ dryRun: !apply, grupos: dups.length, casos: all.length }, null, 2));

let deleted = 0;
for (const [key, arr] of dups) {
  const ranked = [...arr].sort((a, b) => score(b) - score(a));
  const keep = ranked[0];
  const drop = ranked.slice(1);
  console.log(
    `KEEP ${keep.consecutivo} score=${score(keep)} | DROP ${drop.map((d) => d.consecutivo).join(', ')} | ${key}`
  );
  if (!apply) continue;

  // Fusionar archivos al keep
  const archivos = [...(keep.archivos || [])];
  for (const d of drop) {
    for (const a of d.archivos || []) {
      const ida = String(a?._id || a?.archivoId || a?.nombre || '');
      if (!archivos.some((x) => String(x?._id || x?.archivoId || x?.nombre || '') === ida)) {
        archivos.push(a);
      }
    }
  }
  if (archivos.length !== (keep.archivos || []).length) {
    await SegurosAlfaCaso.updateOne({ _id: keep._id }, { $set: { archivos } });
  }
  for (const d of drop) {
    await SegurosAlfaCaso.deleteOne({ _id: d._id });
    deleted += 1;
  }
}

const after = await SegurosAlfaCaso.countDocuments();
console.log(JSON.stringify({ applied: apply, deleted, restantes: after }, null, 2));
await mongoose.disconnect();
