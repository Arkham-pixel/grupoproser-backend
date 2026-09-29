import { conectarMongoRobusto } from './_conectarMongoRobusto.js';
import mongoose from 'mongoose';

const SPECS = [
  ['gsk3cAppbbvaCatListadoCasos', { createdAt: -1 }, 'idx_lista_createdAt'],
  ['gsk3cAppbbvaCatCasos', { createdAt: -1 }, 'idx_lista_createdAt'],
  ['gsk3cAppzurichListadoCasos', { createdAt: -1 }, 'idx_lista_createdAt'],
  ['gsk3cAppzurichCasos', { createdAt: -1 }, 'idx_lista_createdAt'],
  ['gsk3cAppallianzListadoCasos', { createdAt: -1 }, 'idx_lista_createdAt'],
  ['gsk3cAppallianzCasos', { createdAt: -1 }, 'idx_lista_createdAt'],
  ['gsk3cAppequidadCatCasos', { createdAt: -1 }, 'idx_lista_createdAt'],
];

const db = await conectarMongoRobusto();
for (const [coll, key, name] of SPECS) {
  try {
    const created = await db.collection(coll).createIndex(key, { name, background: true });
    console.log(`OK ${coll} → ${created}`);
  } catch (error) {
    console.error(`FAIL ${coll}: ${error.message}`);
  }
}
await mongoose.disconnect();
console.log('Listo');
process.exit(0);
