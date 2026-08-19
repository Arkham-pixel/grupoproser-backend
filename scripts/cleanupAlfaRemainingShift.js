import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';

await mongoose.connect(process.env.MONGO_URI);
const cali = await SegurosAlfaCaso.find({ numeroCredito: /^CALI$/i })
  .select('consecutivo numeroPoliza numeroCredito informacionContacto correo ciudad')
  .lean();
console.log('cali', cali.length);
cali.forEach((c) => console.log(JSON.stringify(c)));

const all = await SegurosAlfaCaso.find({})
  .select('consecutivo numeroPoliza numeroCredito correo ciudad informacionContacto')
  .lean();
const days = all.filter((c) => /^\d{1,2}$/.test(String(c.numeroPoliza || '').trim()));
console.log('dayPol', days.length);
days.slice(0, 15).forEach((c) =>
  console.log(c.consecutivo, c.numeroPoliza, c.numeroCredito, c.correo, c.informacionContacto)
);

// finish remaining: credito CALI → null; day poliza → placeholder
let n = 0;
for (const c of await SegurosAlfaCaso.find({})) {
  let ch = false;
  if (String(c.numeroCredito || '').toUpperCase() === 'CALI') {
    if (/^\d{5,}$/.test(String(c.informacionContacto || ''))) {
      c.numeroCredito = String(c.informacionContacto).trim();
    } else {
      c.numeroCredito = null;
    }
    ch = true;
  }
  if (/^\d{1,2}$/.test(String(c.numeroPoliza || '').trim())) {
    c.numeroPoliza = 'PORCONFIRMAROPERACIONES';
    ch = true;
  }
  if (ch) {
    await c.save();
    n += 1;
  }
}
console.log('cleaned', n);
console.log(
  'stillCali',
  await SegurosAlfaCaso.countDocuments({ numeroCredito: /^CALI$/i })
);
await mongoose.disconnect();
