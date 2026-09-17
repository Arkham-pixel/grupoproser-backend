/**
 * Asigna masivamente el equipo Allianz de los casos del listado operativo
 * (Excel: inspector Alvaro Grueso, Valle del Cauca).
 *
 * Ajustador líder = Mario Alberto Pinilla de la Torre
 * Ajustador       = Mario Alberto Pinilla de la Torre
 * Inspector       = Alvaro Grueso
 *
 * Uso:
 *   node scripts/asignarAlvaroGruesoAllianz.js            # dry-run
 *   node scripts/asignarAlvaroGruesoAllianz.js --apply
 */
import '../config/loadEnv.js';
import '../config/mongoDns.js';
import mongoose from 'mongoose';

const APLICAR = process.argv.includes('--apply');
const LIDER = 'Mario Alberto Pinilla de la Torre';
const AJUSTADOR = 'Mario Alberto Pinilla de la Torre';
const INSPECTOR = 'Alvaro Grueso';

/** Siniestros del Excel (Allianz, inspector Alvaro Grueso). */
const SINIESTROS = [
  '231679411', // AGUACLARA S.A.S. / ARIAS SARMIENTO
  '231685651', // SORIA ESCOBAR, DIEGO FERNANDO
  '231699890', // GIRALDO GIRALDO, ANDRES FELIPE / RFC SEGUROS
  '231702184', // LARA BEDOYA, ADRIANA / FINANCICOL
  '231746887', // AGUDELO VARON / RIVEROS CHARRY
  '231841759', // EDIFICIO CENTRO VERSALLES / SALAZAR DE JURADO
  '231865966', // AMEZQUITA PALOMINO / AGUADO GRISALES
  '231884324', // TRANSPORTES ILLERA SARRIA / VARGAS ORTIZ
  '231897399', // RODRIGUEZ REALPE / ALSEGUROS
  '231645941', // SANCHEZ BEDOYA, MICHELLE / AHL ASESORES
  '231650677', // LEDESMA VALVERDE / OCAMPO ARANGO
  '231651875', // INVERSIONES PROGREZZO / ARIAS SARMIENTO
  '231652596', // PEREZ PORRAS, GUILLERMO / GARCIA ROJAS
  '231666364', // ELEXA REAL ESTATE / MUÑOZ GUZMAN
  '231666077', // HERNANDEZ MURIEL / VITALIZIA
];

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 20000,
});
const db = mongoose.connection.db;
const listado = db.collection('gsk3cAppallianzListadoCasos');
const cat = db.collection('gsk3cAppallianzCasos');

const proj = {
  consecutivo: 1,
  siniestro: 1,
  asegurado: 1,
  ciudad: 1,
  estado: 1,
  ajustadorLider: 1,
  ajustador: 1,
  inspector: 1,
};

const filtro = { siniestro: { $in: SINIESTROS } };
const setCampos = {
  $set: {
    ajustadorLider: LIDER,
    ajustador: AJUSTADOR,
    inspector: INSPECTOR,
    updatedAt: new Date(),
  },
};

const [antesLst, antesCat] = await Promise.all([
  listado.find(filtro).project(proj).toArray(),
  cat.find(filtro).project(proj).toArray(),
]);

const hallados = new Set(antesLst.map((d) => String(d.siniestro)));
const faltantes = SINIESTROS.filter((s) => !hallados.has(s));

let resLst = { matchedCount: 0, modifiedCount: 0 };
let resCat = { matchedCount: 0, modifiedCount: 0 };
if (APLICAR) {
  resLst = await listado.updateMany(filtro, setCampos);
  resCat = await cat.updateMany(filtro, setCampos);
}

const [despuesLst, despuesCat] = await Promise.all([
  listado.find(filtro).project(proj).toArray(),
  cat.find(filtro).project(proj).toArray(),
]);

const ordenar = (a, b) =>
  String(a.consecutivo || '').localeCompare(String(b.consecutivo || ''), 'es', {
    numeric: true,
  });
despuesLst.sort(ordenar);
despuesCat.sort(ordenar);

console.log(
  JSON.stringify(
    {
      modo: APLICAR ? 'APPLY' : 'DRY-RUN',
      equipo: { ajustadorLider: LIDER, ajustador: AJUSTADOR, inspector: INSPECTOR },
      pedidos: SINIESTROS.length,
      encontradosListado: antesLst.length,
      encontradosCat: antesCat.length,
      faltantes,
      matchedListado: APLICAR ? resLst.matchedCount : antesLst.length,
      modifiedListado: APLICAR ? resLst.modifiedCount : 0,
      matchedCat: APLICAR ? resCat.matchedCount : antesCat.length,
      modifiedCat: APLICAR ? resCat.modifiedCount : 0,
      antes: antesLst.sort(ordenar).map((d) => ({
        consecutivo: d.consecutivo,
        siniestro: d.siniestro,
        asegurado: d.asegurado,
        ciudad: d.ciudad,
        estado: d.estado,
        lider: d.ajustadorLider,
        ajustador: d.ajustador,
        inspector: d.inspector,
      })),
      despues: despuesLst.map((d) => ({
        consecutivo: d.consecutivo,
        siniestro: d.siniestro,
        asegurado: d.asegurado,
        ciudad: d.ciudad,
        estado: d.estado,
        lider: d.ajustadorLider,
        ajustador: d.ajustador,
        inspector: d.inspector,
      })),
    },
    null,
    2
  )
);

await mongoose.disconnect();
