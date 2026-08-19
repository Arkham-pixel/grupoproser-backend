/**
 * Repara casos Alfa con columnas corridas cuando NO hay fila buena en Excel:
 *   credito=CIUDAD, contacto=crédito real, correo=teléfono, poliza=día (1-31)
 *
 * Uso: node scripts/repairAlfaColumnShiftHeuristic.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';

function isCityLikeCredit(cred, ciudad) {
  const c = String(cred || '').trim().toUpperCase();
  const city = String(ciudad || '').trim().toUpperCase();
  return Boolean(c && city && c === city);
}

function isDayPolicy(pol) {
  const p = String(pol || '').trim();
  return /^\d{1,2}$/.test(p) && Number(p) >= 1 && Number(p) <= 31;
}

function isPhone(v) {
  return /^\d{7,15}$/.test(String(v || '').trim());
}

function isCreditDigits(v) {
  return /^\d{5,}$/.test(String(v || '').trim());
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const all = await SegurosAlfaCaso.find({});
  let fixed = 0;
  let skipped = 0;

  for (const caso of all) {
    const cred = caso.numeroCredito;
    const contact = caso.informacionContacto;
    const correo = caso.correo;
    const pol = caso.numeroPoliza;

    const shifted =
      isCityLikeCredit(cred, caso.ciudad) &&
      (isDayPolicy(pol) || isPhone(correo) || isCreditDigits(contact));

    if (!shifted) {
      skipped += 1;
      continue;
    }

    // crédito real suele estar en contacto
    if (isCreditDigits(contact)) {
      caso.numeroCredito = String(contact).trim();
    } else {
      caso.numeroCredito = null;
    }

    // teléfono suele estar en correo (sin @)
    if (isPhone(correo)) {
      caso.informacionContacto = String(correo).trim();
      caso.correo = null;
    } else if (String(correo || '').includes('@')) {
      caso.informacionContacto = isCreditDigits(contact) ? null : contact;
    } else {
      caso.informacionContacto = null;
    }

    if (isDayPolicy(pol)) {
      caso.numeroPoliza = 'PORCONFIRMAROPERACIONES';
    }

    await caso.save();
    fixed += 1;
  }

  const stillCali = await SegurosAlfaCaso.countDocuments({ numeroCredito: /^CALI$/i });
  const dayPol = await SegurosAlfaCaso.countDocuments({
    numeroPoliza: { $in: ['10', '11', '12', '13', '14', '15'] },
  });
  console.log(JSON.stringify({ fixed, skipped, stillCali, dayPolLeft: dayPol }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
