import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from '../models/Complex.js';
import Responsable from '../models/Responsable.js';
import {
  generarAlertasCaso,
  obtenerAlertasAjustador,
  CODIGOS_ESTADO_SIN_ALERTAS,
} from '../services/alertasService.js';
import { obtenerProtocoloActivo } from '../services/protocoloConfigService.js';

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const protocolo = await obtenerProtocoloActivo();

const facturados = await Complex.find({ codiEstdo: { $in: ['17', 17] } })
  .select('nmroAjste codiRespnsble codiEstdo fchaAsgncion')
  .limit(80)
  .lean();

let conAlertas = 0;
for (const c of facturados) {
  const a = generarAlertasCaso(c, protocolo);
  if (a.totalAlertas > 0) conAlertas++;
}
console.log('Muestra facturados con alertas tras fix:', conAlertas, '(debe ser 0)');
console.log('CODIGOS_ESTADO_SIN_ALERTAS:', CODIGOS_ESTADO_SIN_ALERTAS);

const codigos = [
  '72134505',
  '1041899782',
  '8700774',
  '72288319',
  '1048210029',
  '1044800214',
  '72007205',
  '1065658621',
  '72253708',
  '1007183772',
];
console.log('\n=== Alertas por ajustador tras fix ===');
for (const cod of codigos) {
  const r = await Responsable.findOne({ codiRespnsble: cod })
    .select('nmbrRespnsble email')
    .lean();
  const a = await obtenerAlertasAjustador(cod);
  const facturadosEnAlertas = (a.casos || []).filter((c) => String(c.estado) === '17');
  console.log(
    `${cod} | ${r?.nmbrRespnsble || '?'} | elegibles:${a.totalCasos} | conAlertas:${a.casosConAlertas} | facturadosEnLista:${facturadosEnAlertas.length}`
  );
}

await mongoose.disconnect();
