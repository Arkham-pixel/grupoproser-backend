/**
 * Corrige "Sin ciudad" inflado: lotes Córdoba/Lorica fuera del Excel
 * terremoto, y alinea YOJANIS / Lui Arien con la hoja 4_Avisados-FDM.
 *
 * Uso: node scripts/fixFdmSinCiudadVsExcel.js [--apply]
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import {
  parsearCasosFdmDesdeArchivo,
  normalizarMunicipioFdm,
} from '../utils/fdmExcelParse.js';
import { sonElMismoCasoFdm } from '../services/fdmImportService.js';

const apply = process.argv.includes('--apply');
const file =
  process.argv.find((a) => a.endsWith('.xlsx')) ||
  'C:\\Users\\GP-TI\\Downloads\\Terremoto 10 de agosto 2026-20.xlsx';

await mongoose.connect(process.env.MONGO_URI);

const { casos: filas } = parsearCasosFdmDesdeArchivo(file, 'excel', {
  preferredSheet: '4_Avisados-FDM',
});

const excelSinCiudad = filas.filter((f) => !normalizarMunicipioFdm(f.municipio));

const all = await EquidadFdmCaso.find({})
  .select('consecutivo nombre cedula municipio evento departamento')
  .lean();

const sinCiudad = all.filter((c) => !normalizarMunicipioFdm(c.municipio));

const fueraExcel = [];
const enExcelVacios = [];
for (const caso of sinCiudad) {
  const fila = filas.find((f) => sonElMismoCasoFdm(caso, f));
  if (!fila) fueraExcel.push(caso);
  else enExcelVacios.push({ caso, fila });
}

// Lui Arien por cédula (puede no matchear por tildes en nombre)
const lui = await EquidadFdmCaso.find({
  $or: [
    { cedula: /1076324774/ },
    { nombre: /arien/i },
    { nombre: /lui\s+arien/i },
  ],
})
  .select('consecutivo nombre cedula municipio evento')
  .lean();

const yojanis = await EquidadFdmCaso.find({ nombre: /yojanis/i })
  .select('consecutivo nombre cedula municipio evento')
  .lean();

console.log(
  JSON.stringify(
    {
      dryRun: !apply,
      excelFilas: filas.length,
      excelSinCiudad: excelSinCiudad.length,
      dbSinCiudad: sinCiudad.length,
      fueraExcel: fueraExcel.length,
      enExcelVacios: enExcelVacios.map((x) => ({
        consecutivo: x.caso.consecutivo,
        nombre: x.caso.nombre,
        cedula: x.caso.cedula,
      })),
      lui,
      yojanis,
      plan: {
        asignarLorica: fueraExcel.map((c) => c.consecutivo),
        limpiarYojanisSiTieneCiudad: yojanis
          .filter((c) => normalizarMunicipioFdm(c.municipio))
          .map((c) => ({ consecutivo: c.consecutivo, actual: c.municipio })),
      },
    },
    null,
    2
  )
);

if (apply) {
  const idsLorica = fueraExcel.map((c) => c._id);
  if (idsLorica.length) {
    const r = await EquidadFdmCaso.updateMany(
      { _id: { $in: idsLorica } },
      {
        $set: {
          municipio: 'LORICA',
          departamento: 'CÓRDOBA',
        },
      }
    );
    console.log('LORICA asignado:', r.modifiedCount);
  }

  // YOJANIS: Excel sin ciudad → dejar vacío (no inventar QUIBDÓ)
  for (const c of yojanis) {
    if (normalizarMunicipioFdm(c.municipio)) {
      await EquidadFdmCaso.updateOne(
        { _id: c._id },
        { $set: { municipio: null } }
      );
      console.log('YOJANIS municipio limpiado:', c.consecutivo);
    }
  }

  // Lui Arien: asegurar sin ciudad si está en BD
  for (const c of lui) {
    if (normalizarMunicipioFdm(c.municipio)) {
      await EquidadFdmCaso.updateOne(
        { _id: c._id },
        { $set: { municipio: null } }
      );
      console.log('Lui Arien municipio limpiado:', c.consecutivo);
    }
  }

  const after = await EquidadFdmCaso.countDocuments({
    $or: [
      { municipio: null },
      { municipio: '' },
      { municipio: { $exists: false } },
      { municipio: /^\s*$/ },
    ],
  });
  console.log('sin ciudad después:', after);
}

await mongoose.disconnect();
