/**
 * Quita gestión del back (ítems fijos) de casos cuyo control de horas
 * YA se envió al cliente — deben quedar como se enviaron.
 *
 *   node scripts/quitarGestionBackCasosEnviadosSura.js --dry
 *   node scripts/quitarGestionBackCasosEnviadosSura.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const DRY = process.argv.includes('--dry');

/** Reclamaciones enviadas (lista del usuario). */
const ENVIADOS = [
  '9260001729093',
  '9260001729576',
  '9260001729868',
  '9260001730036',
  '9260001730630',
  '9260001730918',
  '9260001730949',
  '9260001730939',
  '9260001731597',
  '9260001734916',
  '9260001737148',
  '9260001739289',
  '9260001737448',
  '9260001739967',
  '9260001728841',
  '9260001729078',
];

function normDesc(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function esFijoBack(f) {
  const id = String(f.catalogo_id || '');
  if (id === 'recibo_back' || id === 'verificacion_poliza' || id === 'soporte_sistema') {
    return true;
  }
  if (f.fijo === true || f.tipo_item === 'fijo') {
    const d = normDesc(f.descripcion);
    if (d.includes('recibo back') || d.includes('recibo base')) return true;
    if (d.includes('soporte sistema') || d.includes('soporte tecnico')) return true;
    if (d.includes('verificacion de poliza') && d.includes('condiciones generales')) return true;
  }
  const d = normDesc(f.descripcion);
  if (d.includes('recibo back') || d.includes('recibo base')) return true;
  if (d.includes('soporte sistema') || d.includes('soporte tecnico')) return true;
  if (d.includes('verificacion de poliza') && d.includes('condiciones generales')) return true;
  return false;
}

function tieneVerifCorta(filas) {
  return filas.some((f) => {
    const d = normDesc(f.descripcion);
    return (
      d.includes('verificacion de poliza') &&
      d.includes('condiciones particulares') &&
      !d.includes('condiciones generales')
    );
  });
}

function uid() {
  return `fila-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function totalHoras(filas) {
  return (filas || []).reduce(
    (a, f) =>
      a +
      Number(f.horas_viaje || 0) +
      Number(f.horas_campo || 0) +
      Number(f.horas_oficina || 0) +
      Number(f.horas_secretaria || 0),
    0
  );
}

function restaurar(caso) {
  const ch = caso.control_horas;
  if (!ch || !Array.isArray(ch.filas)) return null;

  const quitados = ch.filas.filter(esFijoBack);
  if (!quitados.length) return null;

  let filas = ch.filas.filter((f) => !esFijoBack(f));
  const ajustador = String(caso.ajustador || caso.codiRespnsble || 'Ajustador').trim();
  const fechaAsig =
    (caso.fchaAsgncion && String(caso.fchaAsgncion).slice(0, 10)) ||
    filas[0]?.fecha ||
    null;

  // La plantilla enviada traía verificación corta; al inyectar back la quitamos.
  if (!tieneVerifCorta(filas)) {
    filas = [
      {
        id: uid(),
        fecha: fechaAsig,
        descripcion: 'Verificación de póliza y condiciones particulares.',
        nombre_funcionario: ajustador,
        cargo: 'Ajustador',
        horas_viaje: 0,
        horas_campo: 0,
        horas_oficina: 1.75,
        horas_secretaria: 0,
        catalogo_id: '',
        tipo_item: 'extra',
        fijo: false,
      },
      ...filas,
    ];
  }

  const valorHora = Number(ch.valor_hora) || 187400;
  const hrs = totalHoras(filas);

  return {
    control: {
      ...ch,
      filas,
      actualizado_en: new Date(),
      actualizado_por: 'quitar-back-casos-enviados',
      _honorarios_sugeridos: Math.round(hrs * valorHora),
      _nota: 'Sin gestión back: control ya enviado al cliente',
    },
    meta: {
      siniestro: caso.siniestro,
      quitados: quitados.map((f) => f.catalogo_id || String(f.descripcion).slice(0, 30)),
      horasAntes: Math.round(totalHoras(ch.filas) * 100) / 100,
      horasDespues: Math.round(hrs * 100) / 100,
    },
  };
}

async function main() {
  console.log(JSON.stringify({ n: ENVIADOS.length, dry: DRY }, null, 2));
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.collection('gsk3cAppsegurosSuraCasos');
  const casos = await col.find({ siniestro: { $in: ENVIADOS } }).toArray();

  let ok = 0;
  const faltan = ENVIADOS.filter((r) => !casos.some((c) => String(c.siniestro) === r));
  if (faltan.length) console.log('No en BD:', faltan);

  for (const caso of casos) {
    const r = restaurar(caso);
    if (!r) {
      console.log({ siniestro: caso.siniestro, skip: 'sin fijos back' });
      continue;
    }
    console.log(r.meta);
    if (!DRY) {
      await col.updateOne(
        { _id: caso._id },
        {
          $set: {
            control_horas: r.control,
            fcha_control_horas: new Date(),
          },
        }
      );
    }
    ok += 1;
  }

  console.log({ actualizados: ok });
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
