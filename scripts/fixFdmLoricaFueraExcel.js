/**
 * Quita evento TERREMOTO de casos LORICA que no están en Excel 4_Avisados-FDM.
 * Uso: node scripts/fixFdmLoricaFueraExcel.js [--apply]
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import { parsearCasosFdmDesdeArchivo } from '../utils/fdmExcelParse.js';
import { sonElMismoCasoFdm } from '../services/fdmImportService.js';

const apply = process.argv.includes('--apply');
const file =
  process.argv.find((a) => a.endsWith('.xlsx')) ||
  'C:\\Users\\GP-TI\\Downloads\\Terremoto 10 de agosto 2026-20.xlsx';

await mongoose.connect(process.env.MONGO_URI);
const { casos: filas } = parsearCasosFdmDesdeArchivo(file, 'excel', {
  preferredSheet: '4_Avisados-FDM',
});

const loricaTerr = await EquidadFdmCaso.find({
  municipio: /lorica/i,
  evento: /terremoto/i,
}).lean();

const ids = [];
for (const c of loricaTerr) {
  if (!filas.find((f) => sonElMismoCasoFdm(c, f))) ids.push(c._id);
}

console.log(
  JSON.stringify(
    {
      dryRun: !apply,
      loricaConTerremoto: loricaTerr.length,
      aLimpiarEvento: ids.length,
      consecutivos: loricaTerr
        .filter((c) => ids.some((id) => String(id) === String(c._id)))
        .map((c) => c.consecutivo),
    },
    null,
    2
  )
);

if (apply && ids.length) {
  const r = await EquidadFdmCaso.updateMany(
    { _id: { $in: ids } },
    { $unset: { evento: 1 } }
  );
  console.log('evento limpiado:', r.modifiedCount);
}

await mongoose.disconnect();
