import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';

const CITY_NAMES = new Set(
  [
    'CALI',
    'YUMBO',
    'PEREIRA',
    'JAMUNDI',
    'FLORIDA',
    'CANDELARIA',
    'BUENAVENTURA',
    'MANIZALES',
    'ROLDANILLO',
    'PALMIRA',
    'BUGA',
    'TULUA',
    'CARTAGO',
  ].map((s) => s.toUpperCase())
);

await mongoose.connect(process.env.MONGO_URI);
let fixed = 0;
for (const caso of await SegurosAlfaCaso.find({})) {
  const cred = String(caso.numeroCredito || '').trim().toUpperCase();
  if (!CITY_NAMES.has(cred)) continue;
  const contact = String(caso.informacionContacto || '').trim();
  const correo = String(caso.correo || '').trim();
  if (/^\d{5,}$/.test(contact)) caso.numeroCredito = contact;
  else caso.numeroCredito = null;
  if (/^\d{7,15}$/.test(correo)) {
    caso.informacionContacto = correo;
    caso.correo = null;
  }
  if (/^\d{1,2}$/.test(String(caso.numeroPoliza || '').trim())) {
    caso.numeroPoliza = 'PORCONFIRMAROPERACIONES';
  }
  await caso.save();
  fixed += 1;
  console.log('fixed', caso.consecutivo, 'wasCredit', cred, '->', caso.numeroCredito);
}
console.log('total', fixed);
await mongoose.disconnect();
