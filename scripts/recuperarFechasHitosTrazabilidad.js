/**
 * Diagnóstico / recuperación de fechas de hito COMPLEX dañadas por sync de acta/ajuste.
 *
 * Fuentes (prioridad):
 *  1) HistorialFormulario.datos (fechaInspeccion, fechaReporte, etc.)
 *  2) historialDocs del caso: fechaCreacion / fecha más antigua por tipo (NO fechaSubida reciente)
 *
 * Uso (siempre inicia en modo revisión):
 *   node scripts/recuperarFechasHitosTrazabilidad.js
 *   node scripts/recuperarFechasHitosTrazabilidad.js --desde 2025-10-01
 *   node scripts/recuperarFechasHitosTrazabilidad.js --caso <nmroAjste|ObjectId>
 *   node scripts/recuperarFechasHitosTrazabilidad.js --aplicar   # escribe solo donde hay candidato distinto
 *
 * Genera: scripts/output/recuperacion-fechas-hitos-<timestamp>.json
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Complex from '../models/Complex.js';
import HistorialFormulario from '../models/HistorialFormulario.js';
import { CAMPOS_FECHA_HITOS_TRAZABILIDAD } from '../config/ajusteTrazabilidadComplexMap.js';

const MONGO_URI = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
const aplicar = process.argv.includes('--aplicar');
const argDesde = valorFlag('--desde');
const argCaso = valorFlag('--caso');

const MAPEO_TIPO_DOC_A_CAMPO = {
  contactoInicial: 'fchaContIni',
  inspeccion: 'fchaInspccion',
  solicitudDocs: 'fchaSoliDocu',
  informePreliminar: 'fchaInfoPrelm',
  ultimoDocumento: 'fchaRepoActi',
  informeFinal: 'fchaInfoFnal',
  presentacionCifras: 'fchaPresentacionCifras',
  envioFiniquito: 'fchaEnvioFiniquito',
};

const MAPEO_AJUSTE_ESTADO_A_CAMPO = {
  actaInspeccion: { campoCaso: 'fchaInspccion', camposForm: ['fechaInspeccion'] },
  inicial: { campoCaso: 'fchaInfoPrelm', camposForm: ['fechaReporte'] },
  preeliminar: { campoCaso: 'fchaInfoPrelm', camposForm: ['fechaReporte'] },
  actualizacion: { campoCaso: 'fchaRepoActi', camposForm: ['fechaActualizacion'] },
  informeFinal: { campoCaso: 'fchaInfoFnal', camposForm: ['fechaInformeFinal', 'fechaReporte'] },
};

function valorFlag(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return '';
  return String(process.argv[i + 1] || '').trim();
}

function diaISO(valor) {
  if (valor == null || valor === '') return '';
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`;
  }
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fechaMasAntigua(valores) {
  const dias = valores.map(diaISO).filter(Boolean).sort();
  return dias[0] || '';
}

function candidatosDesdeHistorialDocs(historialDocs = []) {
  const porCampo = {};
  for (const doc of historialDocs) {
    if (!doc) continue;
    const tipo = String(doc.tipo || doc.categoria || '').trim();
    const campo = MAPEO_TIPO_DOC_A_CAMPO[tipo];
    if (!campo) continue;
    // Preferir fechaCreacion / fecha de hito; ignorar solo fechaSubida si hay otra.
    const cand =
      diaISO(doc.fechaCreacion) ||
      diaISO(doc.fecha) ||
      (doc.fechaSubida ? diaISO(doc.fechaSubida) : '');
    if (!cand) continue;
    if (!porCampo[campo]) porCampo[campo] = [];
    porCampo[campo].push(cand);
  }
  const out = {};
  Object.entries(porCampo).forEach(([campo, lista]) => {
    out[campo] = { valor: fechaMasAntigua(lista), origen: 'historialDocs(más antigua)' };
  });
  return out;
}

function candidatosDesdeFormulariosAjuste(formularios = []) {
  const out = {};
  for (const form of formularios) {
    const estado = String(form.estadoActual || '').trim();
    const cfg = MAPEO_AJUSTE_ESTADO_A_CAMPO[estado];
    const datos = form.datos || {};
    if (cfg) {
      for (const campoForm of cfg.camposForm) {
        const val = diaISO(datos[campoForm]);
        if (!val) continue;
        const prev = out[cfg.campoCaso];
        if (!prev || val < prev.valor) {
          out[cfg.campoCaso] = {
            valor: val,
            origen: `ajuste/${estado}.${campoForm}`,
          };
        }
      }
    }
    // También mapear por campos sueltos aunque el estado no coincida.
    const extras = [
      ['fechaInspeccion', 'fchaInspccion'],
      ['fechaReporte', 'fchaInfoPrelm'],
      ['fechaActualizacion', 'fchaRepoActi'],
      ['fechaInformeFinal', 'fchaInfoFnal'],
    ];
    for (const [campoForm, campoCaso] of extras) {
      const val = diaISO(datos[campoForm]);
      if (!val) continue;
      const prev = out[campoCaso];
      if (!prev || val < prev.valor) {
        out[campoCaso] = { valor: val, origen: `ajuste/datos.${campoForm}` };
      }
    }
  }
  return out;
}

function elegirMejorCandidato(actual, ...fuentes) {
  const actualDia = diaISO(actual);
  const candidatos = [];
  for (const fuente of fuentes) {
    if (!fuente?.valor) continue;
    candidatos.push(fuente);
  }
  if (!candidatos.length) return null;

  // Preferir la más antigua (típicamente la inicial antes de sobrescrituras).
  candidatos.sort((a, b) => a.valor.localeCompare(b.valor));
  const mejor = candidatos[0];
  if (!actualDia) {
    return { ...mejor, accion: 'rellenar_vacia', actual: '' };
  }
  if (mejor.valor === actualDia) {
    return { ...mejor, accion: 'ok', actual: actualDia };
  }
  // Si el candidato es más antiguo que la actual, casi seguro hubo overwrite a fecha de edición.
  if (mejor.valor < actualDia) {
    return { ...mejor, accion: 'restaurar_mas_antigua', actual: actualDia };
  }
  // Candidato más nuevo: no tocar (podría ser corrección legítima).
  return { ...mejor, accion: 'omitir_candidato_mas_nuevo', actual: actualDia };
}

async function formulariosDeCaso(caso) {
  const nmro = String(caso.nmroAjste || '').trim();
  const id = String(caso._id || '').trim();
  const or = [];
  if (nmro) {
    or.push({ numeroCaso: nmro });
    or.push({ 'datos.numeroCaso': nmro });
    or.push({ 'datos.numeroAjuste': nmro });
    or.push({ 'metadata.numeroAjuste': nmro });
    or.push({ 'trazabilidadSecuencia.numeroAjuste': nmro });
  }
  if (id) {
    or.push({ casoId: id });
    or.push({ 'metadata.complexId': id });
    or.push({ 'datos.metadata.complexId': id });
  }
  if (!or.length) return [];
  return HistorialFormulario.find({
    $or: or,
    tipo: {
      $in: [
        'ajuste',
        'ajuste_inicial',
        'ajuste_preeliminar',
        'ajuste_actualizacion',
        'ajuste_informeFinal',
        'acta_inspeccion',
      ],
    },
  })
    .select('estadoActual datos fechaCreacion fechaModificacion tipo numeroCaso')
    .lean();
}

async function main() {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI no definido en .env');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log('✅ Conectado a MongoDB');
  console.log(aplicar ? '⚠️  MODO APLICAR: se escribirán fechas recuperables' : '🔎 MODO REVISIÓN (no escribe). Usa --aplicar para guardar.');

  const filtro = {};
  if (argCaso) {
    if (/^[a-fA-F0-9]{24}$/.test(argCaso)) filtro._id = argCaso;
    else filtro.nmroAjste = new RegExp(`^${argCaso.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  }
  if (argDesde) {
    const d = new Date(`${argDesde}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      filtro.$or = [{ fchaAsgncion: { $gte: d } }, { createdAt: { $gte: d } }];
    }
  }

  const casos = await Complex.find(filtro)
    .select(
      [
        'nmroAjste',
        'nmroSinstro',
        'historialDocs',
        ...CAMPOS_FECHA_HITOS_TRAZABILIDAD,
      ].join(' ')
    )
    .lean();

  console.log(`📦 Casos a revisar: ${casos.length}`);

  const reporte = [];
  let conCambios = 0;
  let aplicados = 0;

  for (const caso of casos) {
    const formularios = await formulariosDeCaso(caso);
    const desdeDocs = candidatosDesdeHistorialDocs(caso.historialDocs);
    const desdeAjuste = candidatosDesdeFormulariosAjuste(formularios);

    const cambios = {};
    const detalle = {};

    for (const campo of Object.keys({ ...desdeDocs, ...desdeAjuste, ...Object.fromEntries(CAMPOS_FECHA_HITOS_TRAZABILIDAD.map((c) => [c, 1])) })) {
      if (!CAMPOS_FECHA_HITOS_TRAZABILIDAD.includes(campo)) continue;
      const decision = elegirMejorCandidato(
        caso[campo],
        desdeAjuste[campo],
        desdeDocs[campo]
      );
      if (!decision) continue;
      detalle[campo] = decision;
      if (decision.accion === 'restaurar_mas_antigua' || decision.accion === 'rellenar_vacia') {
        cambios[campo] = decision.valor;
      }
    }

    if (Object.keys(cambios).length === 0 && Object.keys(detalle).length === 0) continue;

    const fila = {
      id: String(caso._id),
      nmroAjste: caso.nmroAjste || '',
      nmroSinstro: caso.nmroSinstro || '',
      cambiosPropuestos: cambios,
      detalle,
    };

    if (Object.keys(cambios).length > 0) {
      conCambios++;
      if (aplicar) {
        await Complex.findByIdAndUpdate(caso._id, {
          $set: {
            ...Object.fromEntries(
              Object.entries(cambios).map(([k, v]) => [k, new Date(`${v}T12:00:00`)])
            ),
            _recuperacionFechasHitos: {
              en: new Date(),
              cambios,
              nota: 'Restaurado por scripts/recuperarFechasHitosTrazabilidad.js',
            },
          },
        });
        aplicados++;
        fila.aplicado = true;
      }
    }

    reporte.push(fila);
  }

  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `recuperacion-fechas-hitos-${stamp}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        generadoEn: new Date().toISOString(),
        aplicar,
        totalCasosRevisados: casos.length,
        casosConCambiosPropuestos: conCambios,
        casosAplicados: aplicados,
        items: reporte.filter((r) => Object.keys(r.cambiosPropuestos || {}).length > 0),
        revisionCompleta: reporte,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`\n📊 Casos con cambios propuestos: ${conCambios}`);
  console.log(`📝 Aplicados: ${aplicados}`);
  console.log(`💾 Reporte: ${outFile}`);

  const muestra = reporte.filter((r) => Object.keys(r.cambiosPropuestos || {}).length > 0).slice(0, 15);
  if (muestra.length) {
    console.log('\nEjemplos:');
    for (const r of muestra) {
      console.log(` - ${r.nmroAjste || r.id}: ${JSON.stringify(r.cambiosPropuestos)}`);
    }
  } else {
    console.log('\nNo se detectaron restauraciones claras. Puede que falte fuente en ajuste/historial, o las fechas actuales ya son las más antiguas.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
