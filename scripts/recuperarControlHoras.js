/**
 * Restaura control de horas en casos Complex.
 *
 * Uso:
 *   node scripts/recuperarControlHoras.js --from-envio 6a1848e41570d870fe97a147
 *   node scripts/recuperarControlHoras.js --restore 6a1848e41570d870fe97a147 ./backup-ch.json
 *   node scripts/recuperarControlHoras.js --from-envio 6a1848e41570d870fe97a147 --dry-run
 */

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import Complex from '../models/Complex.js';
import { controlHorasTieneDatos } from '../utils/controlHorasUtils.js';

const MONGO_URI = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
const dryRun = process.argv.includes('--dry-run');

function uso() {
  console.log(`
Uso:
  node scripts/recuperarControlHoras.js --from-envio <casoId> [--dry-run]
  node scripts/recuperarControlHoras.js --restore <casoId> <archivo.json> [--dry-run]
`);
}

async function restaurarEnCaso(casoId, controlHoras, origen) {
  if (!controlHorasTieneDatos(controlHoras)) {
    console.error('❌ El control de horas a restaurar no tiene filas válidas.');
    process.exit(1);
  }

  const caso = await Complex.findById(casoId);
  if (!caso) {
    console.error('❌ Caso no encontrado:', casoId);
    process.exit(1);
  }

  console.log('Caso:', caso.nmroAjste, '|', caso.nmroSinstro, '|', caso.asgrBenfcro);
  console.log('Filas actuales:', caso.control_horas?.filas?.length ?? 0);
  console.log('Filas a restaurar:', controlHoras.filas.length);
  console.log('Origen:', origen);

  if (dryRun) {
    console.log('(dry-run) No se escribió en la base de datos.');
    return;
  }

  caso.control_horas = {
    ...controlHoras,
    actualizado_en: new Date(),
    actualizado_por: `recuperarControlHoras:${origen}`,
  };

  await caso.save();
  console.log('✅ Control de horas restaurado.');
}

async function main() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definido');
    process.exit(1);
  }

  const fromEnvioIdx = process.argv.indexOf('--from-envio');
  const restoreIdx = process.argv.indexOf('--restore');

  if (fromEnvioIdx === -1 && restoreIdx === -1) {
    uso();
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });

  if (fromEnvioIdx !== -1) {
    const casoId = process.argv[fromEnvioIdx + 1];
    if (!casoId) {
      uso();
      process.exit(1);
    }

    const caso = await Complex.findById(casoId).lean();
    if (!caso) {
      console.error('❌ Caso no encontrado');
      process.exit(1);
    }

    const envios = (caso.envios_facturacion || []).filter((e) => e?.tipo === 'control_horas');
    const conSnapshot = [...envios].reverse().find((e) => controlHorasTieneDatos(e.controlHoras));

    if (!conSnapshot) {
      console.error(
        '❌ No hay snapshot de control de horas en envios_facturacion para este caso.',
        'Los envíos anteriores al fix no guardaron copia. Restaure desde un Excel exportado o JSON manual.'
      );
      process.exit(1);
    }

    await restaurarEnCaso(casoId, conSnapshot.controlHoras, `envio:${conSnapshot.id}`);
  }

  if (restoreIdx !== -1) {
    const casoId = process.argv[restoreIdx + 1];
    const archivo = process.argv[restoreIdx + 2];
    if (!casoId || !archivo) {
      uso();
      process.exit(1);
    }

    const raw = fs.readFileSync(archivo, 'utf8');
    const controlHoras = JSON.parse(raw);
    await restaurarEnCaso(casoId, controlHoras, archivo);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  if (err?.code === 'ENOENT') {
    console.error(`❌ No se encontró el archivo: ${err.path}`);
    console.error('');
    console.error('Ese JSON debe contener el control de horas exportado o copiado manualmente.');
    console.error('Opciones:');
    console.error('  1. Si tienes Excel: Facturación → Importar desde Excel en el caso.');
    console.error('  2. Crear un .json con la estructura de control_horas y volver a ejecutar --restore.');
    console.error('');
    console.error('Ejemplo mínimo del JSON:');
    console.error(`{
  "valor_hora": 150000,
  "valor_hora_origen": "manual",
  "gastos": 0,
  "filas": [
    {
      "id": "fila-1",
      "fecha": "2026-06-10",
      "descripcion": "Inspección",
      "nombre_funcionario": "Nombre",
      "cargo": "Ajustador",
      "horas_viaje": 1,
      "horas_campo": 4,
      "horas_oficina": 2,
      "horas_secretaria": 0
    }
  ]
}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
