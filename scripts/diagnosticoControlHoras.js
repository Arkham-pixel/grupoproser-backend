/**
 * Diagnóstico y recuperación de control de horas perdido.
 *
 * Uso:
 *   node scripts/diagnosticoControlHoras.js INC-25334
 *   node scripts/diagnosticoControlHoras.js --sospechosos
 */

import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
const arg = process.argv[2];

async function main() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definido');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  const col = mongoose.connection.db.collection('gsk3cAppsiniestro');

  if (arg === '--perdidos-con-envio') {
    const perdidos = await col
      .find({
        'envios_facturacion.tipo': 'control_horas',
        $or: [{ 'control_horas.filas': { $size: 0 } }, { 'control_horas.filas': { $exists: false } }],
      })
      .project({
        nmroAjste: 1,
        nmroSinstro: 1,
        asgrBenfcro: 1,
        envios_facturacion: 1,
        control_horas: 1,
        vlorServcios: 1,
      })
      .toArray();

    console.log(`Casos con notificación de CH enviada pero sin filas guardadas: ${perdidos.length}`);
    perdidos.forEach((c) => {
      const ult = (c.envios_facturacion || []).filter((e) => e.tipo === 'control_horas').pop();
      console.log(
        `- ${c.nmroAjste} | ${c.nmroSinstro} | ${(c.asgrBenfcro || '').slice(0, 45)} | envío: ${ult?.fecha} | vlorServcios: ${c.vlorServcios ?? '—'}`
      );
    });
    await mongoose.disconnect();
    return;
  }

  if (arg === '--sospechosos') {
    const sospechosos = await col
      .find({
        $and: [
          {
            $or: [
              { control_horas: { $exists: false } },
              { 'control_horas.filas': { $exists: false } },
              { 'control_horas.filas': { $size: 0 } },
            ],
          },
          {
            $or: [{ vlorServcios: { $gt: 0 } }, { vlorGastos: { $gt: 0 } }],
          },
        ],
      })
      .limit(30)
      .project({
        nmroAjste: 1,
        nmroSinstro: 1,
        asgrBenfcro: 1,
        vlorServcios: 1,
        vlorGastos: 1,
        updatedAt: 1,
      })
      .toArray();

    console.log(`Casos con honorarios/gastos pero sin filas de control_horas: ${sospechosos.length}`);
    sospechosos.forEach((c) => {
      console.log(
        `- ${c.nmroAjste || c.nmroSinstro} | servicios: ${c.vlorServcios} | gastos: ${c.vlorGastos} | ${c.asgrBenfcro || ''}`
      );
    });
    await mongoose.disconnect();
    return;
  }

  const termino = arg || 'INC-25334';
  const regex = new RegExp(termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const casos = await col
    .find({
      $or: [{ nmroSinstro: regex }, { nmroAjste: regex }, { nmroPolza: regex }],
    })
    .project({
      nmroAjste: 1,
      nmroSinstro: 1,
      asgrBenfcro: 1,
      codiAsgrdra: 1,
      codiRespnsble: 1,
      control_horas: 1,
      fcha_control_horas: 1,
      vlorServcios: 1,
      vlorGastos: 1,
      envios_facturacion: 1,
      historialDocs: 1,
      updatedAt: 1,
    })
    .toArray();

  console.log(`Casos encontrados para "${termino}": ${casos.length}`);

  for (const c of casos) {
    const filas = c.control_horas?.filas?.length ?? 0;
    console.log('\n---');
    console.log('_id:', c._id);
    console.log('nmroAjste:', c.nmroAjste, '| siniestro:', c.nmroSinstro);
    console.log('asegurado:', c.asgrBenfcro);
    console.log('control_horas filas:', filas);
    console.log('fcha_control_horas:', c.fcha_control_horas);
    console.log('vlorServcios:', c.vlorServcios, '| vlorGastos:', c.vlorGastos);
    console.log('updatedAt:', c.updatedAt);

    if (filas > 0) {
      console.log('control_horas:', JSON.stringify(c.control_horas, null, 2));
    }

    const docsCH = (c.historialDocs || []).filter(
      (d) => d.tipo === 'controlHoras' || d.categoria === 'controlHoras'
    );
    console.log('adjuntos controlHoras en historialDocs:', docsCH.length);
    docsCH.forEach((d) => console.log('  -', d.nombre || d.filename, d.ruta || d.url || ''));

    const envios = (c.envios_facturacion || []).filter((e) => e?.tipo === 'control_horas');
    console.log('envios_facturacion control_horas:', envios.length);
    envios.forEach((e) => {
      const filasSnapshot = e.controlHoras?.filas?.length ?? 0;
      console.log(
        `  - ${e.fecha} → ${e.gerente} | snapshot filas: ${filasSnapshot}${filasSnapshot ? ' (recuperable)' : ''}`
      );
    });
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
