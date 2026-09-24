/**
 * Pone en $0 el control de horas de casos Cancelado SURA / dado de baja.
 * No se cobran.
 *
 *   node scripts/ponerCeroCanceladosSura.js
 *   node scripts/ponerCeroCanceladosSura.js --dry
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const DRY = process.argv.includes('--dry');

function norm(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
}

function esCanceladoSura(caso) {
  return [caso.estadoFacilitador, caso.estado, caso.descripcionEstado].some((v) => {
    const e = norm(v);
    if (!e) return false;
    if (e.includes('CANCELADO SURA') || e.includes('CANCELADO POR SURA')) return true;
    if (e === 'CANCELADO' || e.startsWith('CANCELADO ')) return true;
    if (e.includes('DADO DE BAJA')) return true;
    return false;
  });
}

function ceroHorasEnFilas(filas = []) {
  return (Array.isArray(filas) ? filas : []).map((f) => ({
    ...f,
    horas_viaje: 0,
    horas_campo: 0,
    horas_oficina: 0,
    horas_secretaria: 0,
  }));
}

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.db.collection('gsk3cAppsegurosSuraCasos');

const candidatos = await col
  .find({
    $or: [
      { estadoFacilitador: { $regex: /CANCELADO/i } },
      { estado: { $regex: /CANCELADO|DADO DE BAJA/i } },
      { descripcionEstado: { $regex: /CANCELADO SURA|DADO DE BAJA/i } },
    ],
  })
  .project({
    consecutivo: 1,
    siniestro: 1,
    estado: 1,
    estadoFacilitador: 1,
    control_horas: 1,
    vlorServcios: 1,
  })
  .toArray();

let actualizados = 0;
const lista = [];

for (const caso of candidatos) {
  if (!esCanceladoSura(caso)) continue;

  const controlActual = caso.control_horas && typeof caso.control_horas === 'object'
    ? caso.control_horas
    : {};
  const filas = ceroHorasEnFilas(controlActual.filas);
  const control = {
    ...controlActual,
    valor_hora: controlActual.valor_hora ?? 187400,
    valor_hora_origen: controlActual.valor_hora_origen || 'tarifa',
    tipo_liquidador: controlActual.tipo_liquidador || 'unico',
    gastos: 0,
    filas: filas.length
      ? filas
      : [
          {
            id: `fila-cero-${String(caso._id).slice(-6)}`,
            fecha: null,
            descripcion: 'Cancelado SURA — sin cobro.',
            nombre_funcionario: '',
            cargo: 'Ajustador',
            horas_viaje: 0,
            horas_campo: 0,
            horas_oficina: 0,
            horas_secretaria: 0,
            catalogo_id: '',
            tipo_item: 'extra',
            fijo: false,
          },
        ],
    actualizado_en: new Date(),
    actualizado_por: 'sistema-cancelado-sura-cero',
    _tipo_honorarios: 'cancelado_sura',
    _honorarios_sugeridos: 0,
    _tope: 0,
  };

  lista.push({
    c: caso.consecutivo,
    sin: caso.siniestro,
    estado: caso.estado,
    fac: caso.estadoFacilitador,
    antes: caso.vlorServcios,
  });

  if (!DRY) {
    await col.updateOne(
      { _id: caso._id },
      {
        $set: {
          control_horas: control,
          fcha_control_horas: caso.fcha_control_horas || new Date(),
          vlorServcios: 0,
          vlorGastos: 0,
        },
      }
    );
  }
  actualizados += 1;
}

console.log(
  JSON.stringify(
    {
      dry: DRY,
      actualizados,
      casos: lista,
    },
    null,
    2
  )
);

await mongoose.disconnect();
