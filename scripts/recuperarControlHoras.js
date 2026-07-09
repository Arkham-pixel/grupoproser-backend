/**
 * Restaura control de horas en casos Complex.
 *
 * Uso:
 *   node scripts/recuperarControlHoras.js --from-envio 6a1848e41570d870fe97a147
 *   node scripts/recuperarControlHoras.js --restore 6a1848e41570d870fe97a147 ./backup-ch.json
 *   node scripts/recuperarControlHoras.js --from-envio 6a1848e41570d870fe97a147 --dry-run
 *   node scripts/recuperarControlHoras.js --lote [--dry-run]
 */

import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import Complex from '../models/Complex.js';
import {
  controlHorasTieneDatos,
  buildCamposPersistenciaControlHoras,
} from '../utils/controlHorasUtils.js';
import { controlHorasDesdeHistorialDocs } from './recuperarDesdeExcelHistorial.js';

const MONGO_URI = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
const dryRun = process.argv.includes('--dry-run');
const lote = process.argv.includes('--lote');

function uso() {
  console.log(`
Uso:
  node scripts/recuperarControlHoras.js --from-envio <casoId> [--dry-run]
  node scripts/recuperarControlHoras.js --restore <casoId> <archivo.json> [--dry-run]
  node scripts/recuperarControlHoras.js --lote [--dry-run]
`);
}

function ultimoEnvioConSnapshot(envios) {
  const lista = (Array.isArray(envios) ? envios : []).filter((e) => e?.tipo === 'control_horas');
  return [...lista].reverse().find((e) => controlHorasTieneDatos(e.controlHoras)) || null;
}

async function restaurarEnCaso(casoId, controlHoras, origen, resumenControlHoras = null) {
  if (!controlHorasTieneDatos(controlHoras)) {
    return { ok: false, motivo: 'sin_filas_validas' };
  }

  const caso = await Complex.findById(casoId);
  if (!caso) {
    return { ok: false, motivo: 'caso_no_encontrado' };
  }

  const filasActuales = caso.control_horas?.filas?.length ?? 0;
  if (controlHorasTieneDatos(caso.control_horas)) {
    return {
      ok: false,
      motivo: 'ya_tiene_datos',
      nmroAjste: caso.nmroAjste,
      filasActuales,
    };
  }

  console.log('Caso:', caso.nmroAjste, '|', caso.nmroSinstro, '|', (caso.asgrBenfcro || '').slice(0, 50));
  console.log('Filas actuales:', filasActuales);
  console.log('Filas a restaurar:', controlHoras.filas.length);
  console.log('Origen:', origen);

  if (dryRun) {
    console.log('(dry-run) No se escribió en la base de datos.');
    return { ok: true, dryRun: true, nmroAjste: caso.nmroAjste, filas: controlHoras.filas.length };
  }

  caso.control_horas = {
    ...controlHoras,
    actualizado_en: new Date(),
    actualizado_por: `recuperarControlHoras:${origen}`,
  };

  const camposValor = buildCamposPersistenciaControlHoras(controlHoras, resumenControlHoras);
  if (camposValor.vlorServcios != null) caso.vlorServcios = camposValor.vlorServcios;
  if (camposValor.vlorGastos != null) caso.vlorGastos = camposValor.vlorGastos;

  await caso.save();
  console.log('✅ Control de horas restaurado.');
  return { ok: true, nmroAjste: caso.nmroAjste, filas: controlHoras.filas.length };
}

async function recuperarLote() {
  const col = mongoose.connection.db.collection('gsk3cAppsiniestro');
  const candidatos = await col
    .find({
      'envios_facturacion.tipo': 'control_horas',
      $or: [
        { control_horas: { $exists: false } },
        { 'control_horas.filas': { $exists: false } },
        { 'control_horas.filas': { $size: 0 } },
      ],
    })
    .project({
      nmroAjste: 1,
      nmroSinstro: 1,
      asgrBenfcro: 1,
      codiAsgrdra: 1,
      fchaAsgncion: 1,
      envios_facturacion: 1,
      historialDocs: 1,
      control_horas: 1,
    })
    .toArray();

  console.log(`\nCasos candidatos a recuperación: ${candidatos.length}\n`);

  const resultados = {
    restaurados: [],
    sinSnapshot: [],
    yaTenian: [],
    errores: [],
    sinFuente: [],
  };

  for (const raw of candidatos) {
    const casoId = String(raw._id);
    const envio = ultimoEnvioConSnapshot(raw.envios_facturacion);
    let controlHoras = envio?.controlHoras || null;
    let resumen = envio?.resumenControlHoras || null;
    let origen = envio ? `envio:${envio.id}` : null;

    if (!controlHorasTieneDatos(controlHoras)) {
      const desdeExcel = await controlHorasDesdeHistorialDocs(raw);
      if (desdeExcel) {
        controlHoras = desdeExcel.controlHoras;
        resumen = desdeExcel.resumenControlHoras;
        origen = desdeExcel.origen;
        console.log(`📎 Recuperando desde Excel: ${raw.nmroAjste} | ${desdeExcel.origen}`);
      }
    }

    if (!controlHorasTieneDatos(controlHoras)) {
      const tieneEnvio = (raw.envios_facturacion || []).some((e) => e?.tipo === 'control_horas');
      const tieneAdjunto = (raw.historialDocs || []).some(
        (d) => d.tipo === 'controlHoras' || d.categoria === 'controlHoras'
      );
      if (tieneEnvio && !tieneAdjunto) {
        resultados.sinFuente.push({
          casoId,
          nmroAjste: raw.nmroAjste,
          nmroSinstro: raw.nmroSinstro,
        });
        console.log(`⚠️ Sin fuente recuperable: ${raw.nmroAjste} | ${raw.nmroSinstro}`);
      } else {
        resultados.sinSnapshot.push({
          casoId,
          nmroAjste: raw.nmroAjste,
          nmroSinstro: raw.nmroSinstro,
        });
        console.log(`⚠️ Sin snapshot ni Excel legible: ${raw.nmroAjste} | ${raw.nmroSinstro}`);
      }
      continue;
    }

    try {
      const res = await restaurarEnCaso(casoId, controlHoras, origen, resumen);

      if (res.ok) {
        resultados.restaurados.push({ casoId, ...res });
      } else if (res.motivo === 'ya_tiene_datos') {
        resultados.yaTenian.push({ casoId, nmroAjste: res.nmroAjste });
      } else {
        resultados.errores.push({ casoId, nmroAjste: raw.nmroAjste, motivo: res.motivo });
      }
    } catch (error) {
      resultados.errores.push({
        casoId,
        nmroAjste: raw.nmroAjste,
        motivo: error.message,
      });
      console.error(`❌ Error en ${raw.nmroAjste}:`, error.message);
    }
  }

  console.log('\n=== RESUMEN LOTE ===');
  console.log(`✅ Restaurados: ${resultados.restaurados.length}`);
  console.log(`⏭️ Ya tenían datos: ${resultados.yaTenian.length}`);
  console.log(`⚠️ Sin snapshot recuperable: ${resultados.sinSnapshot.length}`);
  console.log(`⚠️ Sin ninguna fuente (solo correo): ${resultados.sinFuente.length}`);
  console.log(`❌ Errores: ${resultados.errores.length}`);

  if (resultados.restaurados.length) {
    console.log('\nRestaurados:');
    resultados.restaurados.forEach((r) => {
      console.log(`  - ${r.nmroAjste} (${r.filas} filas)${r.dryRun ? ' [dry-run]' : ''}`);
    });
  }

  if (resultados.sinSnapshot.length) {
    console.log('\nSin snapshot (requieren Excel o JSON manual):');
    resultados.sinSnapshot.forEach((r) => {
      console.log(`  - ${r.nmroAjste} | ${r.nmroSinstro} | ${r.casoId}`);
    });
  }

  if (resultados.sinFuente.length) {
    console.log('\nSolo notificación enviada (sin Excel ni datos en sistema):');
    resultados.sinFuente.forEach((r) => {
      console.log(`  - ${r.nmroAjste} | ${r.nmroSinstro} | ${r.casoId}`);
    });
  }

  return resultados;
}

async function main() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definido');
    process.exit(1);
  }

  const fromEnvioIdx = process.argv.indexOf('--from-envio');
  const restoreIdx = process.argv.indexOf('--restore');

  if (!lote && fromEnvioIdx === -1 && restoreIdx === -1) {
    uso();
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });

  if (lote) {
    await recuperarLote();
    await mongoose.disconnect();
    return;
  }

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

    const conSnapshot = ultimoEnvioConSnapshot(caso.envios_facturacion);

    if (!conSnapshot) {
      console.error(
        '❌ No hay snapshot de control de horas en envios_facturacion para este caso.',
        'Los envíos anteriores al fix no guardaron copia. Restaure desde un Excel exportado o JSON manual.'
      );
      process.exit(1);
    }

    const res = await restaurarEnCaso(
      casoId,
      conSnapshot.controlHoras,
      `envio:${conSnapshot.id}`,
      conSnapshot.resumenControlHoras || null
    );
    if (!res.ok) process.exit(1);
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
    const res = await restaurarEnCaso(casoId, controlHoras, archivo);
    if (!res.ok) process.exit(1);
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
