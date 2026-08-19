import ZurichListadoCaso from '../models/ZurichListadoCaso.js';

const esVacio = (valor) =>
  valor === undefined || valor === null || valor === '' || valor === 'null';

const toStr = (valor, fallback = null) => {
  if (esVacio(valor)) return fallback ?? null;
  return String(valor).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim() || fallback || null;
};

const normClave = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const completarIdentificacion = (payload = {}) => {
  if (payload.identificacion) return payload;
  if (payload.zc) payload.identificacion = String(payload.zc);
  else if (payload.siniestro) payload.identificacion = String(payload.siniestro);
  return payload;
};

const buildPayload = (data = {}, base = {}) =>
  completarIdentificacion({
    consecutivo: base.consecutivo ?? null,
    zc: toStr(data.zc, base.zc ?? null),
    siniestro: toStr(data.siniestro, base.siniestro ?? null),
    identificacion: toStr(data.identificacion, base.identificacion ?? null),
    tipoIdentificacion: toStr(data.tipoIdentificacion, base.tipoIdentificacion ?? null),
    numeroPoliza: toStr(data.numeroPoliza, base.numeroPoliza ?? null),
    tipoPoliza: toStr(data.tipoPoliza, base.tipoPoliza ?? null),
    causa: toStr(data.causa, base.causa ?? null),
    asegurado: toStr(data.asegurado, base.asegurado ?? null),
    contactoIntermediario: toStr(data.contactoIntermediario, base.contactoIntermediario ?? null),
    contactoAsegurado: toStr(data.contactoAsegurado, base.contactoAsegurado ?? null),
    observaciones: toStr(data.observaciones, base.observaciones ?? null),
    ciudad: toStr(data.ciudad, base.ciudad ?? null),
    departamento: toStr(data.departamento, base.departamento ?? null),
    ajustadorLider: toStr(data.ajustadorLider, base.ajustadorLider ?? null),
    ajustador: toStr(data.ajustador, base.ajustador ?? null),
    inspector: toStr(data.inspector, base.inspector ?? null),
    estado: toStr(data.estado, base.estado ?? 'PENDIENTE') || 'PENDIENTE',
  });

const obtenerMaxSecuencial = async () => {
  const patron = /^ZURICH-LST-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await ZurichListadoCaso.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();
  let max = 0;
  for (const reg of registros) {
    const match = String(reg.consecutivo || '').trim().match(patron);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max;
};

const generarConsecutivo = async () => {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const max = await obtenerMaxSecuencial();
  return `ZURICH-LST-${año}-${mes}-${max + 1}`;
};

export const crearCasoListadoZurich = async (req, res) => {
  try {
    const payload = buildPayload(req.body);
    if (!payload.zc && !payload.siniestro) {
      return res.status(400).json({
        success: false,
        error: 'Indique ZC o STRO (siniestro)',
      });
    }
    payload.consecutivo = await generarConsecutivo();
    const documento = await ZurichListadoCaso.create(payload);
    res.status(201).json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al crear caso listado Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar el caso del listado Zurich',
      detalle: error.message,
    });
  }
};

export const listarCasosListadoZurich = async (req, res) => {
  try {
    const { limit = 25, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [total, documentos] = await Promise.all([
      ZurichListadoCaso.countDocuments({}),
      ZurichListadoCaso.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
    ]);
    res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      data: documentos,
    });
  } catch (error) {
    console.error('❌ Error al listar listado Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener los casos del listado Zurich',
      detalle: error.message,
    });
  }
};

export const obtenerCasoListadoZurich = async (req, res) => {
  try {
    const documento = await ZurichListadoCaso.findById(req.params.id);
    if (!documento) {
      return res.status(404).json({ success: false, error: 'Caso del listado no encontrado' });
    }
    res.json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al obtener listado Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener el caso del listado Zurich',
      detalle: error.message,
    });
  }
};

export const actualizarCasoListadoZurich = async (req, res) => {
  try {
    const actual = await ZurichListadoCaso.findById(req.params.id);
    if (!actual) {
      return res.status(404).json({ success: false, error: 'Caso del listado no encontrado' });
    }
    const payload = buildPayload(req.body, actual.toObject());
    if (!payload.consecutivo) payload.consecutivo = actual.consecutivo || (await generarConsecutivo());
    const actualizado = await ZurichListadoCaso.findByIdAndUpdate(
      actual._id,
      { $set: payload },
      { new: true, runValidators: false }
    );
    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('❌ Error al actualizar listado Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el caso del listado Zurich',
      detalle: error.message,
    });
  }
};

export const eliminarCasoListadoZurich = async (req, res) => {
  try {
    const registro = await ZurichListadoCaso.findById(req.params.id);
    if (!registro) {
      return res.status(404).json({ success: false, error: 'Caso del listado no encontrado' });
    }
    await ZurichListadoCaso.deleteOne({ _id: registro._id });
    res.json({ success: true, message: 'Caso del listado eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar listado Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el caso del listado Zurich',
      detalle: error.message,
    });
  }
};

/**
 * Importación del listado cliente. Empareja SOLO por ZC.
 * No toca gsk3cAppzurichCasos (inspección CAT).
 */
export const importarCasosListadoZurich = async (req, res) => {
  try {
    const filas = Array.isArray(req.body?.casos) ? req.body.casos : null;
    if (!filas || filas.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Debe enviar un arreglo "casos" con al menos un registro',
      });
    }
    if (filas.length > 5000) {
      return res.status(400).json({
        success: false,
        error: 'El lote supera el máximo de 5000 casos por importación',
      });
    }

    const existentes = await ZurichListadoCaso.find().lean();
    const indice = new Map();
    for (const doc of existentes) {
      const zc = normClave(doc.zc);
      if (zc && !indice.has(zc)) indice.set(zc, doc);
    }

    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    let secuencial = await obtenerMaxSecuencial();

    const resumen = {
      totalRecibidos: filas.length,
      creados: 0,
      actualizados: 0,
      omitidos: 0,
      errores: [],
    };

    for (let i = 0; i < filas.length; i += 1) {
      const filaNum = i + 1;
      try {
        const payload = buildPayload({ ...filas[i], estado: filas[i]?.estado || 'PENDIENTE' });
        if (!payload.zc && !payload.siniestro && !payload.asegurado) {
          resumen.omitidos += 1;
          resumen.errores.push({ fila: filaNum, motivo: 'Falta ZC, STRO o asegurado' });
          continue;
        }
        const clave = normClave(payload.zc);
        const existente = clave ? indice.get(clave) : null;
        if (existente) {
          const merge = buildPayload(payload, existente);
          if (!merge.consecutivo) {
            secuencial += 1;
            merge.consecutivo = `ZURICH-LST-${año}-${mes}-${secuencial}`;
          }
          const actualizado = await ZurichListadoCaso.findByIdAndUpdate(existente._id, merge, {
            new: true,
          }).lean();
          resumen.actualizados += 1;
          if (clave) indice.set(clave, actualizado);
        } else {
          secuencial += 1;
          payload.consecutivo = `ZURICH-LST-${año}-${mes}-${secuencial}`;
          const creado = await ZurichListadoCaso.create(payload);
          const lean = creado.toObject();
          resumen.creados += 1;
          if (clave) indice.set(clave, lean);
        }
      } catch (errFila) {
        resumen.omitidos += 1;
        resumen.errores.push({
          fila: filaNum,
          motivo: errFila.message || 'Error al procesar la fila',
        });
      }
    }

    res.json({ success: true, data: resumen });
  } catch (error) {
    console.error('❌ Error al importar listado Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al importar el listado Zurich',
      detalle: error.message,
    });
  }
};
