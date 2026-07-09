import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;

await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
const col = mongoose.connection.db.collection('gsk3cAppsiniestro');

const casos = await col
  .find({
    'envios_facturacion.tipo': 'control_horas',
    $or: [
      { 'control_horas.filas': { $size: 0 } },
      { 'control_horas.filas': { $exists: false } },
    ],
  })
  .project({ nmroAjste: 1, nmroSinstro: 1, envios_facturacion: 1, historialDocs: 1 })
  .toArray();

for (const c of casos) {
  const envios = (c.envios_facturacion || []).filter((e) => e.tipo === 'control_horas');
  const snapFilas = Math.max(
    0,
    ...envios.map((e) => e.controlHoras?.filas?.length ?? 0)
  );
  const docs = (c.historialDocs || []).filter(
    (d) => d.tipo === 'controlHoras' || d.categoria === 'controlHoras'
  );
  const xlsx = docs.filter((d) => /\.xlsx?/i.test(d.nombre || d.filename || ''));
  console.log(
    [
      c.nmroAjste,
      '| siniestro:',
      c.nmroSinstro,
      '| snap:',
      snapFilas,
      '| adjuntos:',
      docs.length,
      '| xlsx:',
      xlsx.length,
      xlsx[0]?.nombre || docs[0]?.nombre || '',
    ].join(' ')
  );
}

await mongoose.disconnect();
