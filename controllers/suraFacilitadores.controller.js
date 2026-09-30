import SuraFacilitadorCaso from '../models/SuraFacilitadorCaso.js';
import SegurosSuraCaso from '../models/SegurosSuraCaso.js';
import { obtenerIdentidadUsuarioReq } from '../utils/permisosCasoPorRol.js';
import {
  aplicarPatchFacilitador,
  completarVacios,
  digitsReclamacion,
  erroresValidacionPortal,
  filaDesdePlantillaSura,
  fusionarDesdeCasoSura,
  PROVEEDOR_FACILITADORES_SURA,
  reclamacionTexto13,
  sugerenciaDesdeCasoSura,
} from '../utils/suraFacilitadores.js';

function actor(req, identidad) {
  return String(
    identidad?.nombre || identidad?.name || identidad?.login || req.user?.login || ''
  ).trim();
}

function casoPorSiniestro(casos, reclamacion) {
  const rec = digitsReclamacion(reclamacion);
  return casos.find((c) => digitsReclamacion(c.siniestro) === rec) || null;
}

async function cargarCasosSuraParaFacilitadores() {
  return SegurosSuraCaso.find({
    siniestro: { $exists: true, $nin: [null, ''] },
  })
    .select(
      'siniestro estado estadoFacilitador descripcionEstado estadoPagoPrimas tipoVivienda fechaLlamada observacionLlamada fechaInspeccion fchaInspccion fchaProgInspeccion fchaContIni fchaInfoFnal fchaInfoPrelm fchaRepoActi fechaUltimoDocumento fechaEnvioAseguradora fechaLiquidado informeUnico archivos.etiqueta archivos.fechaSubida archivos.createdAt fchaAsgncion createdAt updatedAt'
    )
    .lean();
}

function sonFechasIguales(a, b) {
  const tA = a ? new Date(a).getTime() : null;
  const tB = b ? new Date(b).getTime() : null;
  if (!tA && !tB) return true;
  return tA === tB;
}

function hayDiferenciasFacilitador(actual = {}, nuevo = {}) {
  const camposFecha = [
    'fechaAsignacion',
    'fechaPrimerContacto',
    'fechaVisita',
    'fechaInformePreliminar',
    'fechaInforme',
    'fechaDocumentacionCompleta',
    'fechaCierre',
  ];
  for (const f of camposFecha) {
    if (!sonFechasIguales(actual[f], nuevo[f])) return true;
  }
  const camposTexto = [
    'visitaRealizada',
    'criterioDetalle',
    'ultimoComentario',
    'informePreliminarEnviado',
    'informeEnviado',
    'documentacionCompleta',
    'casoCerrado',
    'estadoSiniestro',
    'tipoVivienda',
    'proveedor',
    'informacion',
  ];
  for (const c of camposTexto) {
    const vAct = String(actual[c] ?? '').trim();
    const vNue = String(nuevo[c] ?? '').trim();
    if (vAct !== vNue) return true;
  }
  if (String(actual.casoSuraId || '') !== String(nuevo.casoSuraId || '')) return true;
  return false;
}

/**
 * @param {{ quien?: string, fillVacios?: boolean }} opts
 * - Por defecto crea reclamaciones faltantes y sincroniza cambios desde casos SURA.
 */
async function sincronizarDesdeArnald({ quien = '', fillVacios = true } = {}) {
  const casos = await cargarCasosSuraParaFacilitadores();
  const porCaso = new Map();
  for (const caso of casos) {
    const rec = digitsReclamacion(caso.siniestro);
    if (rec.length < 10) continue;
    // Si hay duplicados de siniestro en Arnald, nos quedamos con el más reciente (ya vienen sin sort; último gana).
    porCaso.set(rec, caso);
  }

  const existentes = await SuraFacilitadorCaso.find({})
    .select('reclamacion')
    .lean();
  const yaHay = new Set(existentes.map((f) => digitsReclamacion(f.reclamacion)));

  const opsCreate = [];
  for (const [rec, caso] of porCaso) {
    if (yaHay.has(rec)) continue;
    const fila = aplicarPatchFacilitador({
      reclamacion: reclamacionTexto13(caso.siniestro),
      proveedor: PROVEEDOR_FACILITADORES_SURA,
      informacion: '1',
      ...sugerenciaDesdeCasoSura(caso),
    });
    opsCreate.push({
      updateOne: {
        filter: { reclamacion: fila.reclamacion },
        update: {
          $setOnInsert: {
            ...fila,
            actualizadoPor: quien,
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }

  let created = 0;
  if (opsCreate.length) {
    const result = await SuraFacilitadorCaso.bulkWrite(opsCreate, { ordered: false });
    created = result.upsertedCount || 0;
  }

  let filled = 0;
  if (fillVacios) {
    const filas = await SuraFacilitadorCaso.find({}).lean();
    const updates = [];
    const casoBackfills = [];
    for (const fila of filas) {
      const caso = porCaso.get(digitsReclamacion(fila.reclamacion));
      if (!caso) continue;

      // Rellenar fchaInfoPrelm en el caso si el informe ya existe pero la trazabilidad quedó vacía.
      const patchCaso = backfillFechasHitoCasoSura(caso);
      if (patchCaso) {
        casoBackfills.push({
          updateOne: {
            filter: { _id: caso._id },
            update: { $set: patchCaso },
          },
        });
        Object.assign(caso, patchCaso);
      }

      const mezclado = fusionarDesdeCasoSura(fila, caso);
      if (hayDiferenciasFacilitador(fila, mezclado)) {
        updates.push({
          updateOne: {
            filter: { _id: fila._id },
            update: { $set: { ...mezclado, actualizadoPor: quien || fila.actualizadoPor } },
          },
        });
        filled += 1;
      }
    }
    if (casoBackfills.length) {
      await SegurosSuraCaso.bulkWrite(casoBackfills, { ordered: false });
    }
    if (updates.length) {
      await SuraFacilitadorCaso.bulkWrite(updates, { ordered: false });
    }
  }

  return { created, filled, casos: porCaso.size };
}

/** Si hay informe guardado pero fchaInfoPrelm/fchaInfoFnal vacías, las completa. */
function backfillFechasHitoCasoSura(caso = {}) {
  const informe = caso.informeUnico;
  if (!informe || typeof informe !== 'object') return null;
  const tipo = String(informe.tipoInforme || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
  const patch = {};
  const fechaInforme = informe.fechaInforme || null;
  const fechaPrelim = informe.fechaInformePreliminar || null;

  if (!caso.fchaInfoPrelm) {
    if (tipo.includes('prelim') && fechaInforme) patch.fchaInfoPrelm = new Date(fechaInforme);
    else if (fechaPrelim) patch.fchaInfoPrelm = new Date(fechaPrelim);
    else if ((tipo.includes('final') || tipo.includes('unic')) && fechaInforme) {
      // Aproximación: ya hubo informe; si no hay fecha prelim, usar la del informe.
      patch.fchaInfoPrelm = new Date(fechaInforme);
    }
  }
  if (
    !caso.fchaInfoFnal &&
    (tipo.includes('final') || tipo.includes('unic')) &&
    fechaInforme
  ) {
    patch.fchaInfoFnal = new Date(fechaInforme);
  }

  // También desde archivero
  if (!patch.fchaInfoPrelm && !caso.fchaInfoPrelm && Array.isArray(caso.archivos)) {
    for (const a of caso.archivos) {
      const et = String(a?.etiqueta || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .trim()
        .toUpperCase();
      if (!et.includes('PRELIMINAR')) continue;
      const f = a.fechaSubida || a.createdAt;
      if (f) {
        patch.fchaInfoPrelm = new Date(f);
        break;
      }
    }
  }

  return Object.keys(patch).length ? patch : null;
}

export async function listarFacilitadoresSura(req, res) {
  try {
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const quien = actor(req, identidad);

    // Sincronización automática continua desde casos SURA (igual que el reporte listado)
    const syncInfo = await sincronizarDesdeArnald({ quien, fillVacios: true });
    const filas = await SuraFacilitadorCaso.find({}).sort({ reclamacion: 1 }).lean();

    res.json({
      success: true,
      total: filas.length,
      data: filas,
      sync: syncInfo,
    });
  } catch (error) {
    console.error('Error listar facilitadores SURA:', error);
    res.status(500).json({
      success: false,
      error: 'No se pudo listar la plantilla de facilitadores.',
      detalle: error.message,
    });
  }
}

export async function importarFacilitadoresSura(req, res) {
  try {
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const quien = actor(req, identidad);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ success: false, error: 'El archivo no tiene filas para importar.' });
    }

    const existentes = await SuraFacilitadorCaso.find({}).lean();
    const porRec = new Map(existentes.map((f) => [digitsReclamacion(f.reclamacion), f]));
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const raw of rows) {
      const fila = filaDesdePlantillaSura(raw);
      if (digitsReclamacion(fila.reclamacion).length < 10) {
        skipped += 1;
        continue;
      }
      fila.reclamacion = reclamacionTexto13(fila.reclamacion);
      const actual = porRec.get(digitsReclamacion(fila.reclamacion));
      if (!actual) {
        try {
          await SuraFacilitadorCaso.create({ ...fila, actualizadoPor: quien });
          created += 1;
        } catch (err) {
          if (err?.code !== 11000) throw err;
          skipped += 1;
        }
        continue;
      }
      // La plantilla de SURA manda: SI/NO/N/A, fechas y comentario pisan lo previo.
      const desdeExcel = aplicarPatchFacilitador({
        ...actual,
        ...Object.fromEntries(
          Object.entries(fila).filter(([, v]) => v !== undefined && v !== null && v !== '')
        ),
      });
      await SuraFacilitadorCaso.updateOne(
        { _id: actual._id },
        { $set: { ...desdeExcel, actualizadoPor: quien } }
      );
      updated += 1;
    }

    // Solo completa vacíos restantes desde Arnald (no pisa lo que trajo el Excel).
    await sincronizarDesdeArnald({ quien, fillVacios: true });

    const data = await SuraFacilitadorCaso.find({}).sort({ reclamacion: 1 }).lean();
    res.json({
      success: true,
      created,
      updated,
      skipped,
      total: data.length,
      data,
    });
  } catch (error) {
    console.error('Error importar facilitadores SURA:', error);
    res.status(500).json({ success: false, error: 'No se pudo importar la plantilla de SURA.' });
  }
}

export async function sugerirFacilitadoresDesdeArnald(req, res) {
  try {
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const quien = actor(req, identidad);
    const syncInfo = await sincronizarDesdeArnald({ quien, fillVacios: true });
    const data = await SuraFacilitadorCaso.find({}).sort({ reclamacion: 1 }).lean();
    res.json({
      success: true,
      created: syncInfo.created,
      filled: syncInfo.filled,
      total: data.length,
      data,
    });
  } catch (error) {
    console.error('Error sugerir facilitadores SURA:', error);
    res.status(500).json({ success: false, error: 'No se pudo completar desde Arnald.' });
  }
}

export async function actualizarFacilitadorSura(req, res) {
  try {
    const { id } = req.params;
    const actual = await SuraFacilitadorCaso.findById(id);
    if (!actual) {
      return res.status(404).json({ success: false, error: 'Fila no encontrada.' });
    }
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const next = aplicarPatchFacilitador(actual.toObject(), req.body || {});
    delete next._id;
    delete next.__v;
    next.actualizadoPor = actor(req, identidad);
    actual.set(next);
    await actual.save();

    // Sincronizar fecha de visita hacia el caso SURA (fchaInspccion y fechaInspeccion)
    const rec = digitsReclamacion(actual.reclamacion);
    if (rec.length >= 10) {
      const query = {
        $or: [
          { siniestro: new RegExp(rec) },
          ...(actual.casoSuraId ? [{ _id: actual.casoSuraId }] : []),
        ],
      };
      const caso = await SegurosSuraCaso.findOne(query);
      if (caso) {
        const patchCaso = {};
        if (req.body.fechaVisita !== undefined || req.body.visitaRealizada !== undefined) {
          if (next.visitaRealizada === 'SI' && next.fechaVisita) {
            patchCaso.fchaInspccion = next.fechaVisita;
            patchCaso.fechaInspeccion = next.fechaVisita;
          } else if (next.visitaRealizada === 'NO') {
            patchCaso.fchaInspccion = null;
          }
        }
        if (req.body.fechaPrimerContacto !== undefined) {
          patchCaso.fchaContIni = next.fechaPrimerContacto || null;
        }
        if (Object.keys(patchCaso).length > 0) {
          await SegurosSuraCaso.updateOne({ _id: caso._id }, { $set: patchCaso });
        }
      }
    }

    res.json({ success: true, data: actual.toObject() });
  } catch (error) {
    console.error('Error actualizar facilitador SURA:', error);
    res.status(500).json({ success: false, error: 'No se pudo guardar la fila.' });
  }
}

export async function validarFacilitadoresSura(_req, res) {
  try {
    const filas = await SuraFacilitadorCaso.find({}).sort({ reclamacion: 1 }).lean();
    const problemas = filas
      .map((fila) => ({
        id: fila._id,
        reclamacion: fila.reclamacion,
        errores: erroresValidacionPortal(fila),
      }))
      .filter((f) => f.errores.length);
    res.json({
      success: true,
      total: filas.length,
      invalid: problemas.length,
      problemas,
    });
  } catch (error) {
    console.error('Error validar facilitadores SURA:', error);
    res.status(500).json({ success: false, error: 'No se pudo validar la plantilla.' });
  }
}
