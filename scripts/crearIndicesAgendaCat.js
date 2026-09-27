/**
 * Crea índices de fecha de agenda en Atlas (evita COLLSCAN del cron/menú).
 * Uso: node scripts/crearIndicesAgendaCat.js
 */
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';
import mongoose from 'mongoose';

const SPECS = [
  ['gsk3cAppzurichCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppzurichListadoCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppbbvaCatCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppbbvaCatListadoCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppallianzCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppallianzListadoCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppprevisoraCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppprevisoraListadoCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppequidadCatCasos', { fechaCoordinandoInspeccion: 1 }, 'idx_agenda_fecha_coord'],
  ['gsk3cAppsegurosAlfaCasos', { fechaInspeccion: 1 }, 'idx_agenda_fecha_inspeccion'],
  ['gsk3cAppsegurosSuraCasos', { fechaInspeccion: 1 }, 'idx_agenda_fecha_inspeccion'],
];

const db = await conectarMongoRobusto();
for (const [coll, key, name] of SPECS) {
  try {
    const created = await db.collection(coll).createIndex(key, {
      sparse: true,
      name,
      background: true,
    });
    console.log(`OK ${coll} → ${created}`);
  } catch (error) {
    console.error(`FAIL ${coll}: ${error.message}`);
  }
}
await mongoose.disconnect();
console.log('Listo');
process.exit(0);
