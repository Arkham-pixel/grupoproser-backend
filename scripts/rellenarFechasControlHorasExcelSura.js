/**
 * Rellena fechas vacías en filas de control_horas (casos del Excel Control Facturación).
 *
 *   node scripts/rellenarFechasControlHorasExcelSura.js --dry
 *   node scripts/rellenarFechasControlHorasExcelSura.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import XLSX from 'xlsx';

dotenv.config();

const DRY = process.argv.includes('--dry');
const EXCEL_ARG = process.argv.find((a) => a.startsWith('--excel='));
const EXCEL =
  (EXCEL_ARG && EXCEL_ARG.slice('--excel='.length)) ||
  'C:/Users/GP-TI/Downloads/Contol Facturación - 24-09-2026 (3).xlsx';

function digits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/** yyyy-MM-dd para input date / Excel control. */
function fechaParaInput(valor) {
  if (valor == null || valor === '') return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, '0');
    const d = String(valor.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return fechaParaInput(new Date(t));
  return '';
}

function primerFecha(...valores) {
  for (const v of valores) {
    const f = fechaParaInput(v);
    if (f) return f;
  }
  return '';
}

function fechasCaso(caso) {
  const asig = primerFecha(caso.fchaAsgncion, caso.fechaAsignacion);
  const contacto = primerFecha(caso.fchaContIni, caso.fechaLlamada);
  const inspeccion = primerFecha(
    caso.fechaInspeccion,
    caso.fchaInspccion,
    caso.fchaProgInspeccion,
    contacto
  );
  const prelim = primerFecha(
    caso.fchaInfoPrelm,
    caso.informeUnico?.fechaInformePreliminar,
    caso.informeUnico?.tipoInforme === 'preliminar' ? caso.informeUnico?.fechaInforme : null
  );
  const finalOUnico = primerFecha(
    caso.fchaInfoFnal,
    caso.fechaLiquidado,
    caso.fechaEnvioAseguradora,
    caso.informeUnico?.fechaInforme,
    prelim,
    inspeccion
  );
  const cifras = primerFecha(
    caso.fchaPresentacionCifras,
    caso.fechaAceptacionLiquidacion,
    finalOUnico
  );
  return { asig, contacto, inspeccion, prelim, finalOUnico, cifras };
}

function fechaParaDescripcion(desc, fechas) {
  const d = String(desc || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  if (d.includes('verificacion de poliza') || d.includes('condiciones particulares')) {
    return fechas.asig || fechas.contacto || fechas.inspeccion;
  }
  if (
    d.includes('inspecci') ||
    d.includes('coordinacion') ||
    d.includes('verificacion en sitio') ||
    d.includes('visita')
  ) {
    return fechas.inspeccion || fechas.contacto || fechas.asig;
  }
  if (d.includes('informe preliminar')) {
    return fechas.prelim || fechas.inspeccion || fechas.finalOUnico;
  }
  if (d.includes('informe final')) {
    return fechas.finalOUnico || fechas.prelim || fechas.inspeccion;
  }
  if (d.includes('informe unico') || d.includes('informe único')) {
    return fechas.finalOUnico || fechas.prelim || fechas.inspeccion;
  }
  if (d.includes('presentacion de cifras') || d.includes('administrativ')) {
    return fechas.cifras || fechas.finalOUnico || fechas.inspeccion;
  }
  if (d.includes('cancelado')) {
    return fechas.asig || fechas.finalOUnico;
  }
  return fechas.inspeccion || fechas.asig || fechas.finalOUnico;
}

function leerReclamacionesExcel(ruta) {
  const wb = XLSX.readFile(ruta, { cellDates: true, raw: false });
  const sheet = wb.Sheets.Plantilla || wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils
    .sheet_to_json(sheet, { defval: '', raw: false })
    .map((r) => digits(r.RECLAMACION))
    .filter((r) => r.length >= 10);
}

async function main() {
  const recs = leerReclamacionesExcel(EXCEL);
  console.log(JSON.stringify({ excel: EXCEL, n: recs.length, dry: DRY }, null, 2));

  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.collection('gsk3cAppsegurosSuraCasos');
  const casos = await col.find({ siniestro: { $in: recs } }).toArray();

  let actualizados = 0;
  let filasConFecha = 0;
  let filasSinFuente = 0;
  const sinFuente = [];

  for (const caso of casos) {
    const ch = caso.control_horas;
    if (!ch || !Array.isArray(ch.filas) || !ch.filas.length) continue;

    const fechas = fechasCaso(caso);
    let cambio = false;
    const filas = ch.filas.map((f) => {
      const ya = fechaParaInput(f.fecha);
      if (ya) {
        filasConFecha += 1;
        return { ...f, fecha: ya };
      }
      const sugerida = fechaParaDescripcion(f.descripcion, fechas);
      if (!sugerida) {
        filasSinFuente += 1;
        sinFuente.push({
          s: caso.siniestro,
          desc: String(f.descripcion || '').slice(0, 40),
        });
        return f;
      }
      cambio = true;
      filasConFecha += 1;
      return { ...f, fecha: sugerida };
    });

    if (!cambio) continue;
    actualizados += 1;
    if (!DRY) {
      await col.updateOne(
        { _id: caso._id },
        {
          $set: {
            'control_horas.filas': filas,
            'control_horas.actualizado_en': new Date(),
          },
        }
      );
    }
  }

  console.log({
    casos: casos.length,
    controlesActualizados: actualizados,
    filasConFecha,
    filasSinFuente,
    muestraSinFuente: sinFuente.slice(0, 10),
  });

  // Muestra 2 casos
  if (!DRY) {
    for (const s of ['9260001730521', '9260001726870']) {
      const c = await col.findOne({ siniestro: s });
      console.log(
        s,
        (c?.control_horas?.filas || []).map((f) => ({
          f: f.fecha,
          d: String(f.descripcion || '').slice(0, 35),
        }))
      );
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
