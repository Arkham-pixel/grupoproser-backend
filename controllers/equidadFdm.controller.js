import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';
import { ejecutarImportacionFdm } from '../services/fdmImportService.js';
import { deleteStoredFile } from '../services/fileStorageService.js';
import {
  runEquidadFdmExcelSharePointDetectCycle,
  getEquidadFdmExcelSharePointStatus,
  dismissEquidadFdmExcelSharePointNotification,
  executeEquidadFdmExcelImport,
  markEquidadFdmExcelSharePointExecuted,
  getEquidadFdmExcelImportSession,
} from '../services/equidadFdmExcelSharePointService.js';
import { enqueueEquidadFdmExcelOutboundFromCaseUpdate } from '../services/equidadFdmExcelOutboundService.js';
import { normalizarMunicipioFdm } from '../utils/fdmExcelParse.js';

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
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback ?? null;
  }
  let numero = String(value).replace(/[^\d.,-]/g, '').trim();
  if (!numero || numero === '-' || numero === '.' || numero === ',') return fallback ?? null;

  if (numero.includes(',') && numero.includes('.')) {
    // 1.313.178,75 (es-CO) vs 1,313,178.75 (en-US)
    if (numero.lastIndexOf(',') > numero.lastIndexOf('.')) {
      numero = numero.replace(/\./g, '').replace(',', '.');
    } else {
      numero = numero.replace(/,/g, '');
    }
  } else if (numero.includes(',')) {
    // 1313178,75 → decimal; 1,313,178 → miles
    const partes = numero.split(',');
    if (partes.length === 2 && partes[1].length > 0 && partes[1].length <= 2) {
      numero = `${partes[0].replace(/\./g, '')}.${partes[1]}`;
    } else {
      numero = numero.replace(/,/g, '');
    }
  } else if (numero.includes('.')) {
    const partes = numero.split('.');
    // 1.750.905 (miles) vs 1313178.75 (decimal)
    if (partes.length > 2 || (partes[1] && partes[1].length === 3)) {
      numero = numero.replace(/\./g, '');
    }
  }

  const n = Number(numero);
  return Number.isFinite(n) ? n : fallback ?? null;
};

const toStringOrNull = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  return String(value).trim();
};

const parseLiquidadorPayload = (valor, fallback = null) => {
  if (valor === undefined || valor === null || valor === '') return fallback ?? null;
  if (typeof valor === 'object' && !Array.isArray(valor)) return valor;
  if (typeof valor === 'string') {
    try {
      const parsed = JSON.parse(valor);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return fallback ?? null;
    }
  }
  return fallback ?? null;
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
  correo: toStringOrNull(data.correo, base.correo ?? null),
  direccionAfectada: toStringOrNull(data.direccionAfectada, base.direccionAfectada ?? null),
  municipio: normalizarMunicipioFdm(toStringOrNull(data.municipio, base.municipio ?? null)),
  departamento: toStringOrNull(data.departamento, base.departamento ?? null),
  oficinaRadicadora: toStringOrNull(data.oficinaRadicadora, base.oficinaRadicadora ?? null),
  fechaRegistro: parseDateFlexible(data.fechaRegistro, base.fechaRegistro ?? null),
  evento: toStringOrNull(data.evento, base.evento ?? null),
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
  esNuevo: data.esNuevo === true || data.esNuevo === 'true' || base.esNuevo === true,
  liquidador: parseLiquidadorPayload(data.liquidador, base.liquidador ?? null),
  // El check del reporte es del caso: no se pisa al editar otros campos.
  checklistHecho: base.checklistHecho === true,
  checklistHechoAt: base.checklistHechoAt ?? null,
  checklistHechoPor: base.checklistHechoPor ?? null,
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
    payload.esNuevo = true;

    const faltantes = validarRequeridos(payload);
    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    const documento = await EquidadFdmCaso.create(payload);

    try {
      await enqueueEquidadFdmExcelOutboundFromCaseUpdate(
        documento._id,
        {},
        documento.toObject(),
        { force: true }
      );
    } catch (outErr) {
      console.warn('⚠️ Encolado outbound Excel Equidad FDM (alta) omitido:', outErr.message);
    }

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

    try {
      await enqueueEquidadFdmExcelOutboundFromCaseUpdate(
        registroActual._id,
        base,
        actualizado.toObject()
      );
    } catch (outErr) {
      console.warn('⚠️ Encolado outbound Excel Equidad FDM omitido:', outErr.message);
    }

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

/** Toggle check «hecho» del reporte (persistente en BD). */
export const toggleChecklistHechoFdm = async (req, res) => {
  try {
    const registro = await buscarCasoPorId(req.params.id);
    if (!registro) {
      return res.status(404).json({ success: false, error: 'Caso Equidad FDM no encontrado' });
    }

    const bodyHecho = req.body?.hecho;
    const hecho =
      bodyHecho === undefined || bodyHecho === null
        ? !Boolean(registro.checklistHecho)
        : bodyHecho === true || bodyHecho === 'true' || bodyHecho === 1 || bodyHecho === '1';

    const login =
      String(
        req.usuario?.login ||
          req.usuario?.usuario ||
          req.user?.login ||
          req.user?.usuario ||
          req.body?.login ||
          ''
      ).trim() || null;

    registro.checklistHecho = hecho;
    registro.checklistHechoAt = hecho ? new Date() : null;
    registro.checklistHechoPor = hecho ? login : null;
    await registro.save();

    res.json({
      success: true,
      data: {
        _id: registro._id,
        checklistHecho: registro.checklistHecho,
        checklistHechoAt: registro.checklistHechoAt,
        checklistHechoPor: registro.checklistHechoPor,
      },
    });
  } catch (error) {
    console.error('❌ Error checklist hecho Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar el check del reporte',
      detalle: error.message,
    });
  }
};

export const getBaseTerremotoFdmStatus = async (req, res) => {
  try {
    const data = await getEquidadFdmExcelSharePointStatus();
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ Error status Excel Equidad FDM:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const postBaseTerremotoFdmCheck = async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runEquidadFdmExcelSharePointDetectCycle({ force });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error check Excel Equidad FDM:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const postBaseTerremotoFdmDismissNotification = async (req, res) => {
  try {
    const data = await dismissEquidadFdmExcelSharePointNotification();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getBaseTerremotoFdmImportSession = async (req, res) => {
  try {
    const session = await getEquidadFdmExcelImportSession(req.params.sessionId);
    res.json({ success: true, data: session });
  } catch (error) {
    const status = error.code === 'SESSION_NOT_FOUND' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
};

export const postBaseTerremotoFdmExecute = async (req, res) => {
  try {
    const sessionId = req.body?.sessionId || req.body?.importSessionId;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId requerido' });
    }
    const usuario = {
      id: req.usuario?.id || req.user?.id,
      login: req.usuario?.login || req.user?.login,
      nombre: req.usuario?.nombre || req.user?.nombre,
    };
    const excelRows = Array.isArray(req.body?.excelRows) ? req.body.excelRows : undefined;
    const result = await executeEquidadFdmExcelImport(sessionId, { usuario, excelRows });
    if (!result.alreadyExecuted) {
      await markEquidadFdmExcelSharePointExecuted(sessionId);
    }
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error execute Excel Equidad FDM:', error);
    const status =
      error.code === 'NO_ROWS_SELECTED' || error.code === 'SESSION_NOT_FOUND' ? 400 : 500;
    res.status(status).json({ success: false, error: error.message });
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

/**
 * POST /api/equidad-fdm/importar
 * Crea o actualiza sin borrar la colección. Un terremoto no pisa la ola invernal.
 */
export const importarCasosFdm = async (req, res) => {
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

    const normalizadas = filas.map((fila) => buildFdmPayload({ ...fila }));
    const resumen = await ejecutarImportacionFdm(normalizadas);
    res.json({ success: true, data: resumen });
  } catch (error) {
    console.error('❌ Error al importar casos Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: 'Error al importar los casos Equidad FDM',
      detalle: error.message,
    });
  }
};

const usuarioDesdeReq = (req) => {
  const u = req.usuario || req.user || {};
  return {
    id: String(u.id || u._id || ''),
    login: String(u.login || u.email || 'usuario'),
    nombre: String(u.nombre || u.name || u.login || 'Usuario'),
  };
};

const buildArchivoFromUpload = (req, etiqueta, { descripcion = '', orden = 0 } = {}) => {
  const file = req.file;
  const usuario = usuarioDesdeReq(req);
  const base = {
    etiqueta: etiqueta || 'GENERAL',
    descripcion: descripcion != null ? String(descripcion) : '',
    orden: Number.isFinite(Number(orden)) ? Number(orden) : 0,
    subidoPor: usuario,
    fechaSubida: new Date(),
  };
  if (req.fileStorage?.driver === 's3') {
    return {
      nombreOriginal: file.originalname,
      nombreArchivo: req.fileStorage.filename,
      ruta: req.fileStorage.publicPath,
      tamaño: req.fileStorage.size,
      tipoMime: req.fileStorage.mimetype,
      ...base,
    };
  }
  return {
    nombreOriginal: file.originalname,
    nombreArchivo: file.filename,
    ruta: `/uploads/equidad-fdm/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
    ...base,
  };
};

const siguienteOrdenArchivos = (archivos = []) => {
  let max = -1;
  for (const a of archivos || []) {
    const n = Number(a?.orden);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
};

/** POST /api/equidad-fdm/:id/archivos */
export const subirArchivoFdm = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se proporcionó ningún archivo' });
    }

    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Equidad FDM no encontrado' });
    }

    const etiqueta = toStringOrNull(req.body?.etiqueta) || 'GENERAL';
    const descripcion =
      req.body?.descripcion != null ? String(req.body.descripcion) : '';
    const reemplazarMismaEtiqueta =
      req.body?.reemplazarMismaEtiqueta === true ||
      req.body?.reemplazarMismaEtiqueta === 'true';

    caso.archivos = caso.archivos || [];

    if (reemplazarMismaEtiqueta && etiqueta) {
      const previos = caso.archivos.filter((a) => a.etiqueta === etiqueta);
      for (const prev of previos) {
        if (prev.ruta) {
          await deleteStoredFile(prev.ruta).catch((err) => {
            console.warn('No se pudo eliminar archivo FDM previo:', err.message);
          });
        }
        prev.deleteOne();
      }
    }

    const orden = siguienteOrdenArchivos(caso.archivos);
    const archivo = buildArchivoFromUpload(req, etiqueta, { descripcion, orden });
    caso.archivos.push(archivo);
    caso.fechaUltimoDocumento = new Date();
    await caso.save();

    const creado = caso.archivos[caso.archivos.length - 1];
    res.status(201).json({ success: true, data: creado, casoId: caso._id });
  } catch (error) {
    console.error('❌ Error subiendo archivo Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: error?.storageError
        ? 'Error al guardar el archivo en almacenamiento'
        : 'Error al subir el archivo',
      detalle: error.message,
    });
  }
};

/** DELETE /api/equidad-fdm/:id/archivos/:archivoId */
export const eliminarArchivoFdm = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Equidad FDM no encontrado' });
    }

    const archivo = caso.archivos?.id?.(req.params.archivoId);
    if (!archivo) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    if (archivo.ruta) {
      await deleteStoredFile(archivo.ruta).catch((err) => {
        console.warn('No se pudo eliminar archivo FDM del almacenamiento:', err.message);
      });
    }
    archivo.deleteOne();
    await caso.save();

    res.json({ success: true, message: 'Archivo eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error eliminando archivo Equidad FDM:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el archivo',
      detalle: error.message,
    });
  }
};

