/**
 * Asigna aseguradoraNombre a sucursales existentes (heurística + mapa de capturas).
 * Uso: node scripts/backfillSucursalAseguradora.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import PuertosCatalogo from '../models/PuertosCatalogo.js';

dotenv.config();

const STOP = new Set([
  'SEGUROS', 'SEGURO', 'SERVICIOS', 'SERVICIO', 'COMPANIA', 'COLOMBIA',
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'Y', 'SA', 'SAS', 'LTDA', 'S', 'A',
]);

const EXCLUSIVE = {
  'ASISTENCIA BOGOTA': 'SERVICIOS BOLIVAR',
  ADIDAS: 'ADIDAS COLOMBIA',
};

const EXTRAS_TO_ASEG = {
  ANTIOQUIA: 'MAPFRE SEGUROS',
  'BOGOTA I': 'MAPFRE SEGUROS',
  'BOGOTA II': 'MAPFRE SEGUROS',
  DIRECTO: 'MAPFRE SEGUROS',
  GUARNE: 'MAPFRE SEGUROS',
  'LA ESTRELLA': 'MAPFRE SEGUROS',
  MANIZALES: 'MAPFRE SEGUROS',
  'REG.CORREDORES CALI': 'MAPFRE SEGUROS',
  'REG.CUENTAS CORPORATIV.BOGOTA': 'MAPFRE SEGUROS',
  'REG.EJE CAFETERO': 'MAPFRE SEGUROS',
  'REG.NORTE B/QUILLA': 'MAPFRE SEGUROS',
  'REG.OCCIDENTE': 'MAPFRE SEGUROS',
  'SUCURSAL PEREIRA': 'SEGUROS BOLIVAR S.A',
};

function norm(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9/.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function infer(sucNombre, aseguradoras) {
  const sn = norm(sucNombre);
  if (EXCLUSIVE[sn]) {
    const hit = aseguradoras.find((a) => norm(a) === norm(EXCLUSIVE[sn]));
    if (hit) return hit;
  }
  if (EXTRAS_TO_ASEG[sn]) {
    const hit = aseguradoras.find((a) => norm(a) === norm(EXTRAS_TO_ASEG[sn]));
    if (hit) return hit;
  }
  for (const aseg of aseguradoras) {
    const tokens = norm(aseg)
      .split(/[\s./\-]+/)
      .filter((t) => t.length >= 2 && !STOP.has(t));
    if (!tokens.length) continue;
    const marca = [...tokens].sort((a, b) => b.length - a.length)[0];
    if (sn.includes(marca)) return aseg;
  }
  return null;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;
  if (!uri) {
    console.error('Falta MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const aseguradoras = (await PuertosCatalogo.find({ tipo: 'aseguradora', activo: true }).lean()).map(
    (a) => a.nombre
  );
  const sucursales = await PuertosCatalogo.find({ tipo: 'sucursal' });
  let updated = 0;
  let skipped = 0;
  for (const s of sucursales) {
    if (s.aseguradoraNombre) {
      skipped += 1;
      continue;
    }
    const padre = infer(s.nombre, aseguradoras);
    if (!padre) {
      console.log('Sin match:', s.nombre);
      continue;
    }
    s.aseguradoraNombre = padre;
    await s.save();
    updated += 1;
    console.log(`${s.nombre} → ${padre}`);
  }
  console.log({ updated, skipped, aseguradoras: aseguradoras.length });
  console.log('RESULT: OK');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
