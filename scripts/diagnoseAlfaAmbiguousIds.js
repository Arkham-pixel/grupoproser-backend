import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';

const ids = ['7184157', '1144041534', '1130615893', '1144066227'];
await mongoose.connect(process.env.MONGO_URI);

const out = [];
for (const id of ids) {
  const casos = await SegurosAlfaCaso.find({
    $or: [
      { identificacion: id },
      { identificacion: Number(id) },
      { identificacion: new RegExp(`^0*${id}$`) },
    ],
  })
    .select('consecutivo identificacion numeroPoliza direccionPredio asegurado')
    .lean();
  out.push({
    id,
    count: casos.length,
    casos: casos.map((c) => ({
      consecutivo: c.consecutivo,
      poliza: c.numeroPoliza,
      asegurado: c.asegurado,
      dir: String(c.direccionPredio || '').slice(0, 60),
    })),
  });
}
console.log(JSON.stringify({ total: await SegurosAlfaCaso.countDocuments(), out }, null, 2));
await mongoose.disconnect();
