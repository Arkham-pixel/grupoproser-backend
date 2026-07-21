import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';

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

const parseNumberFlexible = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  const number = Number(String(value).replace(/[^\d.,-]/g, '').replace(/,/g, ''));
  return Number.isNaN(number) ? fallback ?? null : number;
};

const toStringOrNull = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  return String(value).trim();
};

/** Formato: FDM-YYYY-MM-N (asignado solo al crear) */
const generarConsecutivoFdm = async () => {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const patron = /^FDM-(\d{4})-(\d{2})-(\d+)$/i;

  const registros = await EquidadFdmCaso.find({
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

  return `FDM-${año}-${mes}-${maxSecuencial + 1}`;
};

const buscarCasoPorId = async (idParam) => {
  if (idParam == null || idParam === '') return null;
  const id = String(idParam).trim();
  if (mongoose.Types.ObjectId.isValid(id)) {
    const porObjectId = await EquidadFdmCaso.findById(id);
    if (porObjectId) return porObjectId;
  }
  return null;
};

const buildFdmPayload = (data = {}, base = {}) => ({
  consecutivo: base.consecutivo ?? null,
  numero: parseNumberFlexible(data.numero, base.numero ?? null),
  nombre: toStringOrNull(data.nombre, base.nombre ?? null),
  cedula: toStringOrNull(data.cedula, base.cedula ?? null),
  celular: toStringOrNull(data.celular, base.celular ?? null),
  direccionAfectada: toStringOrNull(data.direccionAfectada, base.direccionAfectada ?? null),
  municipio: toStringOrNull(data.municipio, base.municipio ?? null),
  ajustador: toStringOrNull(data.ajustador, base.ajustador ?? null),
  aif: toStringOrNull(data.aif, base.aif ?? null),
  polizaDanosVigente: toStringOrNull(data.polizaDanosVigente, base.polizaDanosVigente ?? null),
  polizaAfectar: toStringOrNull(data.polizaAfectar, base.polizaAfectar ?? null),
  orden: toStringOrNull(data.orden, base.orden ?? null),
  vigenciaPoliza: toStringOrNull(data.vigenciaPoliza, base.vigenciaPoliza ?? null),
  afectacionesAnteriores: toStringOrNull(data.afectacionesAnteriores, base.afectacionesAnteriores ?? null),
  siniestroIndemnizado: toStringOrNull(data.siniestroIndemnizado, base.siniestroIndemnizado ?? null),
  valorEdificio: parseNumberFlexible(data.valorEdificio, base.valorEdificio ?? null),
  valorContenido: parseNumberFlexible(data.valorContenido, base.valorContenido ?? null),
  valoresIndemnizables: parseNumberFlexible(data.valoresIndemnizables, base.valoresIndemnizables ?? null),
  subsidioEmpresarial: toStringOrNull(data.subsidioEmpresarial, base.subsidioEmpresarial ?? null),
  cobertura: toStringOrNull(data.cobertura, base.cobertura ?? null),
  primas: toStringOrNull(data.primas, base.primas ?? null),
  tipoNegocio: toStringOrNull(data.tipoNegocio, base.tipoNegocio ?? null),
  perdidaContenidos: parseNumberFlexible(data.perdidaContenidos, base.perdidaContenidos ?? null),
  perdidaEdificio: parseNumberFlexible(data.perdidaEdificio, base.perdidaEdificio ?? null),
  totalPerdida: parseNumberFlexible(data.totalPerdida, base.totalPerdida ?? null),
  deducible: parseNumberFlexible(data.deducible, base.deducible ?? null),
  totalLiquidado: parseNumberFlexible(data.totalLiquidado, base.totalLiquidado ?? null),
  subsidio: parseNumberFlexible(data.subsidio, base.subsidio ?? null),
  valorIndemnizadoAjustador: parseNumberFlexible(
    data.valorIndemnizadoAjustador,
    base.valorIndemnizadoAjustador ?? null
  ),
  caso: toStringOrNull(data.caso, base.caso ?? null),
  siniestro: toStringOrNull(data.siniestro, base.siniestro ?? null),
  fechaLiquidacion: parseDateFlexible(data.fechaLiquidacion, base.fechaLiquidacion ?? null),
  fechaAviso: parseDateFlexible(data.fechaAviso, base.fechaAviso ?? null),
  valorObjecion: toStringOrNull(data.valorObjecion, base.valorObjecion ?? null),
  fechaCausacion: parseDateFlexible(data.fechaCausacion, base.fechaCausacion ?? null),
  valorIndemnizado: parseNumberFlexible(data.valorIndemnizado, base.valorIndemnizado ?? null),
  fechaGiro: parseDateFlexible(data.fechaGiro, base.fechaGiro ?? null),
  estado: toStringOrNull(data.estado, base.estado ?? null),
  observaciones: toStringOrNull(data.observaciones, base.observaciones ?? null),
  detalle: toStringOrNull(data.detalle, base.detalle ?? null),
});

const validarRequeridos = (payload) => {
  const camposRequeridos = [
    ['nombre', 'nombre del asegurado'],
    ['estado', 'estado'],
  ];
  return camposRequeridos
    .map(([campo, etiqueta]) => (!payload[campo] ? etiqueta : null))
    .filter(Boolean);
};

export const crearCasoFdm = async (req, res) => {
  try {
    const payload = buildFdmPayload(req.body);
    payload.consecutivo = await generarConsecutivoFdm();

    const faltantes = validarRequeridos(payload);
    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    const documento = await EquidadFdmCaso.create(payload);
    res.status(201).json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al crear caso Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar el caso Equidad FDM',
      detalle: error.message,
    });
  }
};

export const listarCasosFdm = async (req, res) => {
  try {
    const { limit = 25, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [total, documentos] = await Promise.all([
      EquidadFdmCaso.countDocuments(),
      EquidadFdmCaso.find()
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
    console.error('❌ Error al listar casos Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener los casos Equidad FDM',
      detalle: error.message,
    });
  }
};

export const obtenerCasoFdm = async (req, res) => {
  try {
    const documento = await buscarCasoPorId(req.params.id);
    if (!documento) {
      return res.status(404).json({ success: false, error: 'Caso Equidad FDM no encontrado' });
    }
    res.json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al obtener caso Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener el caso Equidad FDM',
      detalle: error.message,
    });
  }
};

export const actualizarCasoFdm = async (req, res) => {
  try {
    const registroActual = await buscarCasoPorId(req.params.id);
    if (!registroActual) {
      return res.status(404).json({ success: false, error: 'Caso Equidad FDM no encontrado' });
    }

    const base = registroActual.toObject();
    const payload = buildFdmPayload(req.body, base);
    if (!payload.consecutivo) {
      payload.consecutivo = base.consecutivo || (await generarConsecutivoFdm());
    }

    const faltantes = validarRequeridos(payload);
    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    const actualizado = await EquidadFdmCaso.findByIdAndUpdate(registroActual._id, payload, {
      new: true,
    });

    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('❌ Error al actualizar caso Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el caso Equidad FDM',
      detalle: error.message,
    });
  }
};

export const eliminarCasoFdm = async (req, res) => {
  try {
    const registro = await buscarCasoPorId(req.params.id);
    if (!registro) {
      return res.status(404).json({ success: false, error: 'Caso Equidad FDM no encontrado' });
    }

    await EquidadFdmCaso.deleteOne({ _id: registro._id });
    res.json({ success: true, message: 'Caso Equidad FDM eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar caso Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el caso Equidad FDM',
      detalle: error.message,
    });
  }
};
