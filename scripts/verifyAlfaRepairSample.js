import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';

await mongoose.connect(process.env.MONGO_URI);
const ids = ['ALFA-2026-08-125', 'ALFA-2026-08-163', 'ALFA-2026-08-69', 'ALFA-2026-08-180'];
const rows = await SegurosAlfaCaso.find({ consecutivo: { $in: ids } })
  .select('consecutivo numeroPoliza numeroCredito informacionContacto correo ciudad')
  .lean();
console.log(JSON.stringify(rows, null, 2));

const cities = [
  'YUMBO',
  'PEREIRA',
  'CALI',
  'JAMUNDI',
  'FLORIDA',
  'CANDELARIA',
  'BUENAVENTURA',
  'MANIZALES',
  'ROLDANILLO',
];
const cityCredits = await SegurosAlfaCaso.find({ numeroCredito: { $in: cities } })
  .select('consecutivo numeroCredito ciudad')
  .lean();
console.log('cityCredits', cityCredits.length);
cityCredits.forEach((c) => console.log(c.consecutivo, c.numeroCredito, c.ciudad));
await mongoose.disconnect();
