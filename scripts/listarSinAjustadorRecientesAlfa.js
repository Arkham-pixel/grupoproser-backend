/**
 * Analiza cuántos casos sin ajustador se tocaron desde el filtro por ciudad
 * y si hay más rastros (archivos, emails, etc.).
 */
import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
const casos = db.collection('gsk3cAppsegurosAlfaCasos');
const desde = new Date('2026-08-16T00:00:00.000Z');

const sinRecientes = await casos
  .find({
    updatedAt: { $gte: desde },
    $or: [{ ajustador: null }, { ajustador: '' }, { ajustador: { $exists: false } }],
  })
  .project({
    consecutivo: 1,
    ciudad: 1,
    updatedAt: 1,
    ajustadorLider: 1,
    inspector: 1,
    'liquidador.encabezado.ajustador': 1,
    archivos: 1,
  })
  .sort({ updatedAt: -1 })
  .toArray();

// Cases that still have adjuster - when last updated
const conAj = await casos
  .find({ ajustador: { $nin: [null, ''] } })
  .project({ consecutivo: 1, ajustador: 1, updatedAt: 1, ciudad: 1 })
  .toArray();

// Email outbox mentioning cases?
const emails = db.collection('emailoutboxes');
const emailSample = await emails.find({}).sort({ createdAt: -1 }).limit(1).project({ subject: 1, to: 1, createdAt: 1 }).toArray();

console.log(
  JSON.stringify(
    {
      sinAjustadorActualizadosDesde16Ago: sinRecientes.length,
      lista: sinRecientes.map((c) => ({
        consecutivo: c.consecutivo,
        ciudad: c.ciudad,
        updatedAt: c.updatedAt,
        lider: c.ajustadorLider || null,
        insp: c.inspector || null,
        liqAj: c.liquidador?.encabezado?.ajustador || null,
      })),
      conAjustadorActual: conAj,
      emailSample,
    },
    null,
    2
  )
);

await mongoose.disconnect();
