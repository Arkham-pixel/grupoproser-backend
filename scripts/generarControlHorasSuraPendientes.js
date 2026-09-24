/**
 * Genera control_horas sugerido (tarifario Oscar) en casos SURA facturables
 * que aún no tienen control con datos.
 *
 * Incluye: informe único/final, objetado, desistido (y variantes en estado).
 * No pisa controles que ya tengan horas o descripción.
 *
 * Uso:
 *   node scripts/generarControlHorasSuraPendientes.js          # aplica
 *   node scripts/generarControlHorasSuraPendientes.js --dry    # solo cuenta
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const VALOR_HORA = 187400;
const TOPES = {
  preliminar_final: 3_000_000,
  unico: 2_500_000,
  objetado: 2_000_000,
  desistido: 1_000_000,
  cancelado_sura: 0,
};

const FRANJAS = [
  { kmHasta: 80, factor: 0.78 },
  { kmHasta: 200, factor: 0.88 },
  { kmHasta: Infinity, factor: 0.96 },
];

const DRY = process.argv.includes('--dry');

function norm(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
}

function zona(caso) {
  const depto = norm(caso.departamento || caso.departamentoCiudad);
  const ciudad = norm(caso.ciudad || caso.ciudadSiniestro);
  if (depto.includes('CHOCO') || ciudad.includes('QUIBDO')) return 'Choco';
  if (depto.includes('CALDAS') || depto.includes('RISARALDA')) return 'Cafetera';
  if (depto.includes('VALLE') || depto.includes('CAUCA') || depto.includes('NARINO')) {
    return 'Occidente';
  }
  return 'Otros';
}

function kmEstimado(caso) {
  const z = zona(caso);
  if (z === 'Cafetera') return 45;
  if (z === 'Occidente') return 140;
  if (z === 'Choco') return 280;
  return 180;
}

function jitter(caso) {
  const clave = String(caso.siniestro || caso.consecutivo || caso._id || '');
  let h = 0;
  for (let i = 0; i < clave.length; i += 1) h = (h * 31 + clave.charCodeAt(i)) % 1000;
  return (h / 1000 - 0.5) * 0.05;
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

function tipoHonorarios(caso) {
  if (esCanceladoSura(caso)) return 'cancelado_sura';
  const estado = norm(caso.estado || caso.descripcionEstado || caso.estadoFacilitador);
  if (estado.includes('DESIST')) return 'desistido';
  if (estado.includes('OBJET')) return 'objetado';

  const tipoInf = String(caso.informeUnico?.tipoInforme || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  const tienePrelim =
    Boolean(caso.fchaInfoPrelm) ||
    tipoInf.includes('prelim') ||
    estado.includes('PRELIMINAR');
  const tieneFinal =
    Boolean(caso.fchaInfoFnal) ||
    tipoInf.includes('final') ||
    tipoInf.includes('unic') ||
    estado.includes('UNICO') ||
    estado.includes('FINAL');

  if (tipoInf.includes('unic') && !tienePrelim) return 'unico';
  if (tienePrelim && tieneFinal) return 'preliminar_final';
  if (tieneFinal && !tienePrelim) return 'unico';
  return 'preliminar_final';
}

function tipoLiquidador(tipo) {
  if (
    tipo === 'unico' ||
    tipo === 'objetado' ||
    tipo === 'desistido' ||
    tipo === 'cancelado_sura'
  ) {
    return 'unico';
  }
  return 'preliminar';
}

function plantilla(tipoLiq, ajustador) {
  const nombre = String(ajustador || 'Ajustador').trim() || 'Ajustador';
  const base = (desc, oficina, campo = 0, viaje = 0) => ({
    id: `fila-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fecha: null,
    descripcion: desc,
    nombre_funcionario: nombre,
    cargo: 'Ajustador',
    horas_viaje: viaje,
    horas_campo: campo,
    horas_oficina: oficina,
    horas_secretaria: 0,
    catalogo_id: '',
    tipo_item: 'extra',
    fijo: false,
  });

  if (tipoLiq === 'unico') {
    return [
      base('Verificación de póliza y condiciones particulares.', 1.5),
      base('Coordinación e inspección / verificación en sitio.', 0.5, 2, 1),
      base('Elaboración de informe único.', 3),
      base('Presentación de cifras, labores administrativas y otras.', 1.5),
    ];
  }
  return [
    base('Verificación de póliza y condiciones particulares.', 1),
    base('Coordinación e inspección / verificación en sitio.', 0.5, 2, 1),
    base('Elaboración de informe preliminar.', 2),
    base('Elaboración de informe final.', 2.5),
    base('Presentación de cifras, labores administrativas y otras.', 1.5),
  ];
}

function totalFila(f) {
  return (
    Number(f.horas_viaje || 0) +
    Number(f.horas_campo || 0) +
    Number(f.horas_oficina || 0) +
    Number(f.horas_secretaria || 0)
  );
}

function escalar(filas, horasObjetivo) {
  const objetivo = Number(horasObjetivo);
  if (!Number.isFinite(objetivo) || objetivo <= 0) return filas;
  const horasVar = filas.reduce((a, f) => a + totalFila(f), 0);
  if (horasVar <= 0.001) return filas;
  const ratio = objetivo / horasVar;
  const esc = (v) => Math.round(Number(v || 0) * ratio * 4) / 4;
  return filas.map((f) => ({
    ...f,
    horas_viaje: esc(f.horas_viaje),
    horas_campo: esc(f.horas_campo),
    horas_oficina: esc(f.horas_oficina),
    horas_secretaria: esc(f.horas_secretaria),
  }));
}

function tieneDatos(control) {
  if (!control?.filas?.length) return false;
  return control.filas.some((f) => totalFila(f) > 0 || String(f.descripcion || '').trim());
}

function esFacturable(caso) {
  const e = norm(caso.estado || caso.descripcionEstado);
  if (e.includes('ANULADO') && !e.includes('DESIST')) return false;
  if (e.includes('DESIST') || e.includes('OBJET')) return true;
  if (e.includes('UNICO') || e.includes('FINAL')) return true;
  const tipoInf = String(caso.informeUnico?.tipoInforme || '').toLowerCase();
  if (tipoInf.includes('unico') || tipoInf.includes('final')) return true;
  if (caso.fchaInfoFnal) return true;
  return false;
}

function armarControl(caso) {
  const tipo = tipoHonorarios(caso);
  const max = TOPES[tipo] ?? TOPES.preliminar_final;
  const km = kmEstimado(caso);
  const franja = FRANJAS.find((f) => km <= f.kmHasta) || FRANJAS.at(-1);

  if (tipo === 'cancelado_sura' || max <= 0) {
    return {
      control: {
        valor_hora: VALOR_HORA,
        valor_hora_origen: 'tarifa',
        tipo_liquidador: 'unico',
        gastos: 0,
        filas: [
          {
            id: `fila-cero-${Date.now().toString(36)}`,
            fecha: null,
            descripcion: 'Cancelado SURA — sin cobro.',
            nombre_funcionario: String(caso.ajustador || caso.codiRespnsble || '').trim(),
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
        actualizado_por: 'sistema-tarifario-sura',
        _tipo_honorarios: 'cancelado_sura',
        _honorarios_sugeridos: 0,
        _tope: 0,
        _distancia_km: km,
      },
      meta: { tipo, sugerido: 0, max: 0, horasSugeridas: 0, km },
    };
  }

  const factor = Math.min(0.99, Math.max(0.7, franja.factor * (1 + jitter(caso))));
  const sugerido = Math.min(max, Math.round((max * factor) / 1000) * 1000);
  const horasSugeridas = Math.round((sugerido / VALOR_HORA) * 100) / 100;
  const tipoLiq = tipoLiquidador(tipo);
  const filas = escalar(
    plantilla(tipoLiq, caso.ajustador || caso.codiRespnsble),
    horasSugeridas
  );

  return {
    control: {
      valor_hora: VALOR_HORA,
      valor_hora_origen: 'tarifa',
      tipo_liquidador: tipoLiq,
      gastos: 0,
      filas,
      actualizado_en: new Date(),
      actualizado_por: 'sistema-tarifario-sura',
      _tipo_honorarios: tipo,
      _honorarios_sugeridos: sugerido,
      _tope: max,
      _distancia_km: km,
    },
    meta: { tipo, sugerido, max, horasSugeridas, km },
  };
}

const filtroCandidatos = {
  $or: [
    { estado: { $regex: /UNICO|FINAL|DESIST|OBJET/i } },
    { 'informeUnico.tipoInforme': { $regex: /unico|final/i } },
    { fchaInfoFnal: { $exists: true, $nin: [null, ''] } },
  ],
};

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.db.collection('gsk3cAppsegurosSuraCasos');

const docs = await col
  .find(filtroCandidatos)
  .project({
    consecutivo: 1,
    siniestro: 1,
    estado: 1,
    descripcionEstado: 1,
    estadoFacilitador: 1,
    ajustador: 1,
    codiRespnsble: 1,
    ciudad: 1,
    departamento: 1,
    departamentoCiudad: 1,
    ciudadSiniestro: 1,
    fchaInfoPrelm: 1,
    fchaInfoFnal: 1,
    informeUnico: 1,
    control_horas: 1,
  })
  .toArray();

let skippedYaTiene = 0;
let skippedNoFacturable = 0;
let generados = 0;
const resumen = { preliminar_final: 0, unico: 0, objetado: 0, desistido: 0 };

for (const caso of docs) {
  if (!esFacturable(caso)) {
    skippedNoFacturable += 1;
    continue;
  }
  if (tieneDatos(caso.control_horas)) {
    skippedYaTiene += 1;
    continue;
  }

  const { control, meta } = armarControl(caso);
  resumen[meta.tipo] = (resumen[meta.tipo] || 0) + 1;

  if (!DRY) {
    await col.updateOne(
      { _id: caso._id },
      {
        $set: {
          control_horas: control,
          fcha_control_horas: new Date(),
          vlorServcios: meta.sugerido,
          vlorGastos: 0,
        },
      }
    );
  }
  generados += 1;
}

console.log(
  JSON.stringify(
    {
      dry: DRY,
      revisados: docs.length,
      generados,
      skippedYaTiene,
      skippedNoFacturable,
      resumen,
    },
    null,
    2
  )
);

await mongoose.disconnect();
