import mongoose from 'mongoose';
import PropiedadCaso from '../models/PropiedadCaso.js';

const esValorVacio = (valor) =>
  valor === undefined || valor === null || valor === '' || valor === 'null' || valor === 'undefined';

const parseDate = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.trim().split('-').map(Number);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
      return new Date(year, month - 1, day, 12, 0, 0);
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseDateFlexible = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  return parseDate(value) ?? fallback ?? null;
};

const toStringOrNull = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  return String(value).trim();
};

/** Formato: PROP-YYYY-MM-N */
const generarConsecutivoProp = async () => {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const patron = /^PROP-(\d{4})-(\d{2})-(\d+)$/i;

  const registros = await PropiedadCaso.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();

  let maxSecuencial = 0;
  for (const reg of registros) {
    const match = String(reg.consecutivo || '').trim().match(patron);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > maxSecuencial) maxSecuencial = n;
    }
  }

  return `PROP-${año}-${mes}-${maxSecuencial + 1}`;
};

const buscarCasoPorId = async (idParam) => {
  if (idParam == null || idParam === '') return null;
  const id = String(idParam).trim();
  if (mongoose.Types.ObjectId.isValid(id)) {
    return PropiedadCaso.findById(id);
  }
  return null;
};

const buildPayload = (data = {}, base = {}) => ({
  consecutivo: base.consecutivo ?? null,
  nombreCliente: toStringOrNull(data.nombreCliente, base.nombreCliente ?? null),
  documento: toStringOrNull(data.documento, base.documento ?? null),
  celular: toStringOrNull(data.celular, base.celular ?? null),
  email: toStringOrNull(data.email, base.email ?? null),
  direccion: toStringOrNull(data.direccion, base.direccion ?? null),
  localizacion: toStringOrNull(data.localizacion, base.localizacion ?? null),
  ciudad: toStringOrNull(data.ciudad, base.ciudad ?? null),
  departamento: toStringOrNull(data.departamento, base.departamento ?? null),
  claseInmueble: toStringOrNull(data.claseInmueble, base.claseInmueble ?? null),
  tipoInmueble: toStringOrNull(data.tipoInmueble, base.tipoInmueble ?? null),
  destinacion: toStringOrNull(data.destinacion, base.destinacion ?? null),
  aseguradora: toStringOrNull(data.aseguradora, base.aseguradora ?? null),
  poliza: toStringOrNull(data.poliza, base.poliza ?? null),
  numeroSiniestro: toStringOrNull(data.numeroSiniestro, base.numeroSiniestro ?? null),
  numeroCaso: toStringOrNull(data.numeroCaso, base.numeroCaso ?? null),
  responsable: toStringOrNull(data.responsable, base.responsable ?? null),
  fechaSolicitud: parseDateFlexible(data.fechaSolicitud, base.fechaSolicitud ?? null),
  observaciones: toStringOrNull(data.observaciones, base.observaciones ?? null),
  inspeccionId:
    data.inspeccionId === undefined
      ? base.inspeccionId ?? null
      : toStringOrNull(data.inspeccionId, null),
  inspeccionTitulo:
    data.inspeccionTitulo === undefined
      ? base.inspeccionTitulo ?? null
      : toStringOrNull(data.inspeccionTitulo, null),
  inspeccionFecha:
    data.inspeccionFecha === undefined
      ? base.inspeccionFecha ?? null
      : parseDateFlexible(data.inspeccionFecha, null),
});

export const crearCasoPropiedades = async (req, res) => {
  try {
    const payload = buildPayload(req.body);
    payload.consecutivo = await generarConsecutivoProp();

    if (!payload.nombreCliente) {
      return res.status(400).json({
        success: false,
        error: 'El nombre del cliente es obligatorio',
      });
    }

    const documento = await PropiedadCaso.create(payload);
    return res.status(201).json({ success: true, data: documento });
  } catch (error) {
    console.error('Error al crear caso Propiedades:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al guardar el caso de propiedades',
      detalle: error.message,
    });
  }
};

export const listarCasosPropiedades = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || '100', 10)));
    const skip = (page - 1) * limit;

    const [total, documentos] = await Promise.all([
      PropiedadCaso.countDocuments(),
      PropiedadCaso.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    return res.json({
      success: true,
      total,
      page,
      limit,
      data: documentos,
    });
  } catch (error) {
    console.error('Error listando casos Propiedades:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al listar casos de propiedades',
    });
  }
};

export const obtenerCasoPropiedades = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso de propiedades no encontrado' });
    }
    return res.json({ success: true, data: caso });
  } catch (error) {
    console.error('Error obteniendo caso Propiedades:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener el caso',
    });
  }
};

export const actualizarCasoPropiedades = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso de propiedades no encontrado' });
    }

    const payload = buildPayload(req.body, caso.toObject());
    payload.consecutivo = caso.consecutivo;

    if (!payload.nombreCliente) {
      return res.status(400).json({
        success: false,
        error: 'El nombre del cliente es obligatorio',
      });
    }

    Object.assign(caso, payload);
    await caso.save();
    return res.json({ success: true, data: caso });
  } catch (error) {
    console.error('Error actualizando caso Propiedades:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al actualizar el caso',
    });
  }
};

/** Vincula el historial de inspección al caso (tras guardar el formulario). */
export const vincularInspeccionCasoPropiedades = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso de propiedades no encontrado' });
    }

    const inspeccionId = toStringOrNull(req.body?.inspeccionId);
    if (!inspeccionId) {
      return res.status(400).json({ success: false, error: 'inspeccionId es obligatorio' });
    }

    caso.inspeccionId = inspeccionId;
    caso.inspeccionTitulo = toStringOrNull(req.body?.inspeccionTitulo, caso.inspeccionTitulo);
    caso.inspeccionFecha = parseDateFlexible(req.body?.inspeccionFecha, new Date());

    // Si el formulario actualizó datos básicos, sincronizar al caso
    const syncKeys = [
      'nombreCliente',
      'direccion',
      'localizacion',
      'ciudad',
      'departamento',
      'claseInmueble',
      'tipoInmueble',
      'destinacion',
      'documento',
    ];
    for (const key of syncKeys) {
      if (!esValorVacio(req.body?.[key])) {
        caso[key] = toStringOrNull(req.body[key]);
      }
    }

    await caso.save();
    return res.json({ success: true, data: caso });
  } catch (error) {
    console.error('Error vinculando inspección al caso Propiedades:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al vincular la inspección',
    });
  }
};

export const eliminarCasoPropiedades = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso de propiedades no encontrado' });
    }
    await caso.deleteOne();
    return res.json({ success: true, mensaje: 'Caso eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando caso Propiedades:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al eliminar el caso',
    });
  }
};
