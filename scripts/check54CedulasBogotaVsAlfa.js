/**
 * Verifica las 54 cédulas del pantallazo vs Alfa.
 *   node scripts/check54CedulasBogotaVsAlfa.js
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { normalizeIdentification } from '../utils/alfaIdentification.js';

const LISTA = [
  { id: '67031803', asegurado: 'NATALY GARCIA' },
  { id: '5928432', asegurado: 'LUIS FERNANDO HINCAPIE CASTRO' },
  { id: '38667607', asegurado: 'CLAUDIA PATRICIA RENDON' },
  { id: '67031803', asegurado: 'NATALY GARCIA (dup)' },
  { id: '16636073', asegurado: 'ALVARO JOSE CASTRO' },
  { id: '1062278812', asegurado: 'YEISON ANDRES GOMEZ' },
  { id: '14608201', asegurado: 'RUBEN DARIO GOMEZ' },
  { id: '1144142069', asegurado: 'JUAN MANUEL BALLESTEROS' },
  { id: '1130676892', asegurado: 'DANIELA SERNA' },
  { id: '1107065745', asegurado: 'DIANA MARCELA RIASCOS' },
  { id: '66909687', asegurado: 'ANDREA CAROLINA CANO' },
  { id: '1144044153', asegurado: 'FREDDY ALEXANDER' },
  { id: '1130596626', asegurado: 'JAVIER LEONARDO GRANADOS' },
  { id: '10215248', asegurado: 'JORGE ARMANDO GUERRERO' },
  { id: '1130640825', asegurado: 'JUAN CARLOS CASTRO' },
  { id: '36348067', asegurado: 'GLORIA ELENA JARAMILLO' },
  { id: '31323813', asegurado: 'MARIA FERNANDA' },
  { id: '94074917', asegurado: 'JAIRO ANDRES' },
  { id: '67016170', asegurado: 'MARIA ALEJANDRA' },
  { id: '38550592', asegurado: 'MARIA ISABEL' },
  { id: '66764818', asegurado: 'LIGIA FERNANDA' },
  { id: '1115065574', asegurado: 'ESTEBAN GOMEZ' },
  { id: '66848883', asegurado: 'DIANA CAROLINA' },
  { id: '66717407', asegurado: 'MARIA EUGENIA' },
  { id: '1144079428', asegurado: 'JUAN DAVID' },
  { id: '728461', asegurado: 'JAIRO SALVADOR' },
  { id: '1107065772', asegurado: 'JUAN CARLOS' },
  { id: '31324640', asegurado: 'CLAUDIA PATRICIA' },
  { id: '1144178016', asegurado: 'LAURA VALENTINA' },
  { id: '38868434', asegurado: 'MARIA FERNANDA' },
  { id: '1144055327', asegurado: 'ANDRES FELIPE' },
  { id: '1115073315', asegurado: 'JUAN SEBASTIAN' },
  { id: '94153185', asegurado: 'CARLOS ANDRES' },
  { id: '1107053992', asegurado: 'HAROLD ANDRES' },
  { id: '1144074674', asegurado: 'SEBASTIAN' },
  { id: '66759317', asegurado: 'DIANA MARCELA' },
  { id: '1143831590', asegurado: 'JUAN PABLO' },
  { id: '1130634071', asegurado: 'ANDRES FELIPE' },
  { id: '16587280', asegurado: 'JOSE LUIS' },
  { id: '1130618991', asegurado: 'CRISTIAN CAMILO' },
  { id: '1085289714', asegurado: 'JUAN DAVID' },
  { id: '1143825823', asegurado: 'DANIEL FELIPE' },
  { id: '63526492', asegurado: 'ANA MARIA' },
  { id: '44005241', asegurado: 'LUZ ANGELA' },
  { id: '1144162585', asegurado: 'JUAN ESTEBAN' },
  { id: '30386858', asegurado: 'MARIA DEL PILAR' },
  { id: '31712373', asegurado: 'CLAUDIA MARCELA' },
  { id: '1130592395', asegurado: 'JUAN CAMILO' },
  { id: '6136796', asegurado: 'CARLOS ALBERTO' },
  { id: '1144027261', asegurado: 'SANTIAGO' },
  { id: '94366160', asegurado: 'ANDRES FELIPE' },
  { id: '16849846', asegurado: 'JORGE IVAN' },
  { id: '31978035', asegurado: 'MARCELA' },
  { id: '14572652', asegurado: 'FERNANDO' },
];

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 60000,
});

const ids = [...new Set(LISTA.map((x) => normalizeIdentification(x.id)).filter(Boolean))];

const casos = await SegurosAlfaCaso.find({
  excluidoBaseAlfa: { $ne: true },
  $or: ids.flatMap((id) => [
    { identificacion: id },
    { identificacion: Number(id) },
    { identificacion: new RegExp(`^0*${id}$`) },
  ]),
})
  .select('consecutivo identificacion asegurado estado estadoGestion tomador')
  .lean();

// Also load all and match by normalize (safer)
const todos = await SegurosAlfaCaso.find({ excluidoBaseAlfa: { $ne: true } })
  .select('consecutivo identificacion asegurado estado estadoGestion tomador')
  .lean();
const byId = new Map();
for (const c of todos) {
  const id = normalizeIdentification(c.identificacion);
  if (!id) continue;
  if (!byId.has(id)) byId.set(id, []);
  byId.get(id).push(c);
}

const resultado = [];
let si = 0;
let no = 0;
const vistos = new Set();

for (let i = 0; i < LISTA.length; i += 1) {
  const raw = LISTA[i];
  const id = normalizeIdentification(raw.id);
  const casosId = byId.get(id) || [];
  const enAlfa = casosId.length > 0;
  const dup = vistos.has(id);
  if (!dup) {
    if (enAlfa) si += 1;
    else no += 1;
    vistos.add(id);
  }
  resultado.push({
    n: i + 1,
    identificacion: id,
    aseguradoPantalla: raw.asegurado,
    duplicadaEnLista: dup ? 'SI' : 'NO',
    enAlfa: enAlfa ? 'SI' : 'NO',
    nCasos: casosId.length,
    consecutivos: casosId.map((c) => c.consecutivo).join(' | '),
    aseguradoAlfa: [...new Set(casosId.map((c) => c.asegurado).filter(Boolean))].join(' | '),
    estados: casosId.map((c) => `${c.estado || ''}/${c.estadoGestion || ''}`).join(' | '),
  });
}

const outDir = path.join(process.cwd(), 'scripts', '_out');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, '54-cedulas-bogota-vs-alfa.xlsx');
const outWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  outWb,
  XLSX.utils.json_to_sheet([
    { clave: 'filasLista', valor: LISTA.length },
    { clave: 'cedulasUnicas', valor: vistos.size },
    { clave: 'enAlfa', valor: si },
    { clave: 'noEnAlfa', valor: no },
    { clave: 'generado', valor: new Date().toISOString() },
  ]),
  'Meta'
);
XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(resultado), 'Las54');
XLSX.utils.book_append_sheet(
  outWb,
  XLSX.utils.json_to_sheet(resultado.filter((r) => r.enAlfa === 'SI' && r.duplicadaEnLista === 'NO')),
  'EnAlfa'
);
XLSX.utils.book_append_sheet(
  outWb,
  XLSX.utils.json_to_sheet(resultado.filter((r) => r.enAlfa === 'NO' && r.duplicadaEnLista === 'NO')),
  'NoEnAlfa'
);
XLSX.writeFile(outWb, outPath);
const desk = path.join(process.env.USERPROFILE || '', 'Desktop', '54-cedulas-bogota-vs-alfa.xlsx');
try {
  fs.copyFileSync(outPath, desk);
} catch {
  /* */
}

console.log('\n========== RESUMEN 54 CÉDULAS ==========');
console.log(`Filas en lista: ${LISTA.length} | Únicas: ${vistos.size}`);
console.log(`EN ALFA: ${si}`);
console.log(`NO EN ALFA: ${no}`);
console.log('\n--- EN ALFA ---');
for (const r of resultado.filter((x) => x.enAlfa === 'SI')) {
  console.log(`${r.n}. ${r.identificacion} | ${r.aseguradoAlfa || r.aseguradoPantalla} | ${r.consecutivos} | ${r.estados}`);
}
console.log('\n--- NO EN ALFA ---');
for (const r of resultado.filter((x) => x.enAlfa === 'NO' && x.duplicadaEnLista === 'NO')) {
  console.log(`${r.n}. ${r.identificacion} | ${r.aseguradoPantalla}`);
}
console.log('\nExcel:', desk);

await mongoose.disconnect();
// silence unused
void casos;
