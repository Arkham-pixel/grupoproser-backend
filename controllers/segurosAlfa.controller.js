import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import { deleteStoredFile } from '../services/fileStorageService.js';
import {
  obtenerAlertasAlfaPorAjustadores,
  enviarAlertasTodosAlfa,
  enviarAlertasAlfaAjustador,
} from '../services/alertasAlfaService.js';
import {
  enqueueAlfaClaimDocumentAfterUpload,
  onAlfaCasePolicyMaybeReady,
} from '../services/alfaClaimDocumentEnqueueService.js';
import {
  buildAlfaSharePointDocumentsStatus,
  markAlfaClaimDocumentForRetry,
} from '../services/alfaSharePointStatusService.js';
import { listImportedAlfaPoliciesForCase } from '../services/alfaPolicyImportService.js';
import {
  previewAlfaExcelImport,
  executeAlfaExcelImport,
  getAlfaExcelImportStatus,
  buildAlfaExcelImportReportRows,
} from '../services/alfaExcelImportService.js';
import {
  getAlfaExcelSharePointStatus,
  runAlfaExcelSharePointDetectCycle,
  dismissAlfaExcelSharePointNotification,
  markAlfaExcelSharePointExecuted,
} from '../services/alfaExcelSharePointImportService.js';
import AlfaExcelSharePointSource from '../models/AlfaExcelSharePointSource.js';
import { getAlfaExcelSharePointImportConfig } from '../config/alfaExcelSharePointImport.js';
import { enqueueAlfaExcelOutboundFromCaseUpdate } from '../services/alfaExcelOutboundService.js';
import { generarConsecutivoAlfa } from '../services/alfaCasoService.js';
import {
  geocodeCasosAlfaPendientes,
  aplicarUbicacionesPredioAlfa,
  obtenerBloquesCercaniaAlfa,
} from '../services/alfaBloquesCercaniaService.js';
import * as XLSX from 'xlsx';

const esValorVacio = (valor) =>
  valor === undefined || valor === null || valor === '' || valor === 'null' || valor === 'undefined';

/** Vacío / «por confirmar» / N/A / desiste → pendiente de dato real (no pisa lo bueno). */
const esPlaceholderOPendiente = (valor) => {
  if (esValorVacio(valor)) return true;
  if (valor instanceof Date) return Number.isNaN(valor.getTime());
  if (typeof valor === 'number') return !Number.isFinite(valor);
  const t = String(valor)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!t) return true;
  if (/^POR CONFIRM/.test(t)) return true; // POR CONFIRMAR, POR CONFIRMAR OPERACIONES…
  if (/^(N\/?A|NA|NULL|UNDEFINED|DESISTE|-|SIN DATO|PENDIENTE)$/i.test(t)) return true;
  return false;
};

const esValorUtil = (valor) => !esPlaceholderOPendiente(valor);

/**
 * Excel trae dato real → actualiza (incluye reemplazar «por confirmar» / vacío).
 * Excel vacío / por confirmar / error parseado → conserva lo útil ya guardado.
 */
const mergeCampoImport = (incoming, existing) => {
  if (esValorUtil(incoming)) return incoming;
  if (esValorUtil(existing)) return existing;
  if (!esValorVacio(incoming)) return incoming;
  return existing ?? null;
};

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

/**
 * undefined → conserva fallback (campo no enviado).
 * '' / null / placeholder → limpia a null (el usuario borró el dato en el formulario).
 */
const parseDateFlexible = (value, fallback = null) => {
  if (value === undefined) return fallback ?? null;
  if (esValorVacio(value) || esPlaceholderOPendiente(value)) return null;
  return parseDate(value) ?? null;
};

const parseNumberFlexible = (value, fallback = null) => {
  if (value === undefined) return fallback ?? null;
  if (esValorVacio(value) || esPlaceholderOPendiente(value)) return null;
  const texto = String(value).trim();
  if (!/\d/.test(texto) && typeof value !== 'number') return null;
  const limpio = texto.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!limpio || limpio === '-' || limpio === '.' || limpio === '-.') return null;
  const number = Number(limpio);
  return Number.isNaN(number) ? null : number;
};

const toStringOrNull = (value, fallback = null) => {
  if (value === undefined) return fallback ?? null;
  if (esValorVacio(value)) return null;
  return String(value).trim();
};

const normClave = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

/** Claves de deduplicación (prioridad: siniestro → id+crédito → id+póliza → id+dirección). */
const clavesDeduplicacion = (caso = {}) => {
  const claves = [];
  const siniestro = normClave(caso.siniestro);
  const identificacion = normClave(caso.identificacion);
  const numeroCredito = normClave(caso.numeroCredito);
  const numeroPoliza = normClave(caso.numeroPoliza);
  const direccionPredio = normClave(caso.direccionPredio);

  if (siniestro) claves.push(`S:${siniestro}`);
  if (identificacion && numeroCredito) claves.push(`I:${identificacion}|C:${numeroCredito}`);
  if (identificacion && numeroPoliza) claves.push(`I:${identificacion}|P:${numeroPoliza}`);
  if (identificacion && direccionPredio) claves.push(`I:${identificacion}|D:${direccionPredio}`);
  return claves;
};

const obtenerMaxSecuencialAlfa = async () => {
  const patron = /^ALFA-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await SegurosAlfaCaso.find({
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
  return maxSecuencial;
};

/** Formato: ALFA-YYYY-MM-N (asignado solo al crear) — contador atómico compartido */
const generarConsecutivoAlfaLocal = generarConsecutivoAlfa;

const buscarCasoPorId = async (idParam) => {
  if (idParam == null || idParam === '') return null;
  const id = String(idParam).trim();
  if (mongoose.Types.ObjectId.isValid(id)) {
    const porObjectId = await SegurosAlfaCaso.findById(id);
    if (porObjectId) return porObjectId;
  }
  return null;
};

const buildAlfaPayload = (data = {}, base = {}) => ({
  consecutivo: base.consecutivo ?? null,
  siniestro: toStringOrNull(data.siniestro, base.siniestro ?? null),
  identificacion: toStringOrNull(data.identificacion, base.identificacion ?? null),
  asegurado: toStringOrNull(data.asegurado, base.asegurado ?? null),
  tomador: toStringOrNull(data.tomador, base.tomador ?? null),
  ajustador: toStringOrNull(data.ajustador, base.ajustador ?? null),
  numeroPoliza: toStringOrNull(data.numeroPoliza, base.numeroPoliza ?? null),
  direccionPredio: toStringOrNull(data.direccionPredio, base.direccionPredio ?? null),
  numeroCredito: toStringOrNull(data.numeroCredito, base.numeroCredito ?? null),
  informacionContacto: toStringOrNull(data.informacionContacto, base.informacionContacto ?? null),
  correo: toStringOrNull(data.correo, base.correo ?? null),
  canalRadicacion: toStringOrNull(data.canalRadicacion, base.canalRadicacion ?? null),
  ciudad: toStringOrNull(data.ciudad, base.ciudad ?? null),
  departamento: toStringOrNull(data.departamento, base.departamento ?? null),
  fechaSiniestro: parseDateFlexible(data.fechaSiniestro, base.fechaSiniestro ?? null),
  fechaInicioPoliza: parseDateFlexible(data.fechaInicioPoliza, base.fechaInicioPoliza ?? null),
  fechaFinPoliza: parseDateFlexible(data.fechaFinPoliza, base.fechaFinPoliza ?? null),
  valorAseguradoInmueble: parseNumberFlexible(
    data.valorAseguradoInmueble,
    base.valorAseguradoInmueble ?? null
  ),
  valorAseguradoContenidos: parseNumberFlexible(
    data.valorAseguradoContenidos,
    base.valorAseguradoContenidos ?? null
  ),
  cobertura: toStringOrNull(data.cobertura, base.cobertura ?? null),
  estadoPagoPrimas: toStringOrNull(data.estadoPagoPrimas, base.estadoPagoPrimas ?? null),
  valorReservaPreventivaPromedio: parseNumberFlexible(
    data.valorReservaPreventivaPromedio,
    base.valorReservaPreventivaPromedio ?? null
  ),
  valorComercialInmueble: parseNumberFlexible(
    data.valorComercialInmueble,
    base.valorComercialInmueble ?? null
  ),
  reserva: parseNumberFlexible(data.reserva, base.reserva ?? null),
  valorReclamado: parseNumberFlexible(data.valorReclamado, base.valorReclamado ?? null),
  valorLiquidado: parseNumberFlexible(data.valorLiquidado, base.valorLiquidado ?? null),
  fechaLlamada: parseDateFlexible(data.fechaLlamada, base.fechaLlamada ?? null),
  observacionLlamada: toStringOrNull(data.observacionLlamada, base.observacionLlamada ?? null) || '',
  fechaInspeccion: parseDateFlexible(data.fechaInspeccion, base.fechaInspeccion ?? null),
  fechaUltimoDocumento: parseDateFlexible(
    data.fechaUltimoDocumento,
    base.fechaUltimoDocumento ?? null
  ),
  fechaLiquidado: parseDateFlexible(data.fechaLiquidado, base.fechaLiquidado ?? null),
  fechaAceptacionLiquidacion: parseDateFlexible(
    data.fechaAceptacionLiquidacion,
    base.fechaAceptacionLiquidacion ?? null
  ),
  fechaEnvioAseguradora: parseDateFlexible(
    data.fechaEnvioAseguradora,
    base.fechaEnvioAseguradora ?? null
  ),
  estado: toStringOrNull(data.estado, base.estado ?? null),
  liquidador:
    data.liquidador !== undefined
      ? data.liquidador && typeof data.liquidador === 'object'
        ? data.liquidador
        : null
      : base.liquidador ?? null,
  informeUnico:
    data.informeUnico !== undefined
      ? data.informeUnico && typeof data.informeUnico === 'object'
        ? data.informeUnico
        : null
      : base.informeUnico ?? null,
});

/** Une fila Excel con caso existente: solo pisa placeholders / vacíos / errores parseados. */
const mergeImportacionAlfa = (incomingPayload = {}, existente = {}) => {
  const campos = [
    'siniestro',
    'identificacion',
    'asegurado',
    'tomador',
    'ajustador',
    'numeroPoliza',
    'direccionPredio',
    'numeroCredito',
    'informacionContacto',
    'correo',
    'canalRadicacion',
    'ciudad',
    'departamento',
    'fechaSiniestro',
    'fechaInicioPoliza',
    'fechaFinPoliza',
    'valorAseguradoInmueble',
    'valorAseguradoContenidos',
    'cobertura',
    'estadoPagoPrimas',
    'valorReservaPreventivaPromedio',
    'valorComercialInmueble',
    'reserva',
    'valorReclamado',
    'valorLiquidado',
    'fechaInspeccion',
    'fechaUltimoDocumento',
    'fechaLiquidado',
    'fechaAceptacionLiquidacion',
    'fechaEnvioAseguradora',
    'estado',
  ];
  const out = {
    consecutivo: existente.consecutivo || null,
    archivos: existente.archivos || [],
    liquidador: existente.liquidador ?? null,
    informeUnico: existente.informeUnico ?? null,
    // Solo ARNALD: el Excel nunca los trae; no se deben perder en import.
    fechaLlamada: existente.fechaLlamada ?? null,
    observacionLlamada: existente.observacionLlamada || '',
    ubicacionPredio: existente.ubicacionPredio ?? undefined,
  };
  for (const campo of campos) {
    out[campo] = mergeCampoImport(incomingPayload[campo], existente[campo]);
  }
  if (!out.estado) out.estado = 'PENDIENTE';
  return out;
};

const validarRequeridos = (payload) => {
  const camposRequeridos = [
    ['identificacion', 'identificación'],
    ['estado', 'estado'],
  ];
  return camposRequeridos
    .map(([campo, etiqueta]) => (!payload[campo] ? etiqueta : null))
    .filter(Boolean);
};

export const crearCasoAlfa = async (req, res) => {
  try {
    const payload = buildAlfaPayload(req.body);
    payload.consecutivo = await generarConsecutivoAlfaLocal();

    const faltantes = validarRequeridos(payload);
    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    const documento = await SegurosAlfaCaso.create(payload);
    res.status(201).json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al crear caso Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar el caso Seguros Alfa',
      detalle: error.message,
    });
  }
};

export const listarCasosAlfa = async (req, res) => {
  try {
    const { limit = 25, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [total, documentos] = await Promise.all([
      SegurosAlfaCaso.countDocuments(),
      SegurosAlfaCaso.find()
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
    console.error('❌ Error al listar casos Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener los casos Seguros Alfa',
      detalle: error.message,
    });
  }
};

export const obtenerCasoAlfa = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    // Evita que rutas estáticas mal ordenadas se interpreten como ObjectId/caso
    const reservados = new Set([
      'bloques-cercania',
      'geocode-pendientes',
      'ubicaciones-predio',
      'alertas',
      'importar',
      'import',
      'control-seguimiento',
    ]);
    if (reservados.has(id)) {
      return res.status(404).json({ success: false, error: `Ruta no encontrada: ${id}` });
    }

    const documento = await buscarCasoPorId(id);
    if (!documento) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }
    res.json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al obtener caso Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener el caso Seguros Alfa',
      detalle: error.message,
    });
  }
};

export const actualizarCasoAlfa = async (req, res) => {
  try {
    const registroActual = await buscarCasoPorId(req.params.id);
    if (!registroActual) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }

    const base = registroActual.toObject();
    const payload = buildAlfaPayload(req.body, base);
    if (!payload.consecutivo) {
      payload.consecutivo = base.consecutivo || (await generarConsecutivoAlfa());
    }

    const faltantes = validarRequeridos(payload);
    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    // Si cambió la dirección del predio, invalidar coords cacheadas (re-geocode).
    const dirAntes = String(base.direccionPredio || '').trim();
    const dirDespues = String(payload.direccionPredio || '').trim();
    const ciudadAntes = String(base.ciudad || '').trim();
    const ciudadDespues = String(payload.ciudad || '').trim();
    if (dirAntes !== dirDespues || ciudadAntes !== ciudadDespues) {
      const prevUbic = base.ubicacionPredio || {};
      payload.ubicacionPredio = {
        ...prevUbic,
        geocodeStatus: dirDespues ? 'stale' : 'sin_direccion',
        geocodedAt: prevUbic.geocodedAt || null,
      };
      if (!dirDespues) {
        payload.ubicacionPredio.lat = undefined;
        payload.ubicacionPredio.lng = undefined;
      }
    }

    const actualizado = await SegurosAlfaCaso.findByIdAndUpdate(
      registroActual._id,
      { $set: payload },
      {
        new: true,
        runValidators: true,
      }
    );

    // Outbox asíncrono (solo columnas amarillas allowlist / piloto). No bloquea la respuesta.
    await enqueueAlfaExcelOutboundFromCaseUpdate({
      beforeDoc: registroActual,
      afterDoc: actualizado,
    });

    // Si llegó póliza real: liberar documentos PENDING_DESTINATION (sin re-subir a S3).
    try {
      await onAlfaCasePolicyMaybeReady(actualizado._id);
    } catch (releaseErr) {
      console.warn(
        JSON.stringify({
          event: 'ALFA_PENDING_DESTINATION_RELEASE_WARN',
          claimId: String(actualizado._id),
          message: String(releaseErr?.message || releaseErr).slice(0, 300),
        })
      );
    }

    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('❌ Error al actualizar caso Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el caso Seguros Alfa',
      detalle: error.message,
    });
  }
};

export const eliminarCasoAlfa = async (req, res) => {
  try {
    const registro = await buscarCasoPorId(req.params.id);
    if (!registro) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }

    await SegurosAlfaCaso.deleteOne({ _id: registro._id });
    res.json({ success: true, message: 'Caso Seguros Alfa eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar caso Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el caso Seguros Alfa',
      detalle: error.message,
    });
  }
};

/**
 * Importación masiva con deduplicación.
 * Si el caso ya existe (siniestro, o identificación+crédito/póliza/dirección), se actualiza; no se duplica.
 */
export const importarCasosAlfa = async (req, res) => {
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

    const reemplazarTodo = req.body?.reemplazarTodo === true;

    if (reemplazarTodo) {
      await SegurosAlfaCaso.deleteMany({});
    }

    const existentes = await SegurosAlfaCaso.find().lean();
    const indice = new Map();
    for (const doc of existentes) {
      for (const clave of clavesDeduplicacion(doc)) {
        if (!indice.has(clave)) indice.set(clave, doc);
      }
    }

    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    let secuencial = await obtenerMaxSecuencialAlfa();

    const resumen = {
      totalRecibidos: filas.length,
      creados: 0,
      actualizados: 0,
      omitidos: 0,
      reemplazados: reemplazarTodo,
      errores: [],
    };

    for (let i = 0; i < filas.length; i += 1) {
      const fila = filas[i] || {};
      const filaNum = i + 1;

      try {
        const payloadBase = buildAlfaPayload({
          ...fila,
          estado: fila.estado || 'PENDIENTE',
        });

        if (!payloadBase.identificacion) {
          resumen.omitidos += 1;
          resumen.errores.push({
            fila: filaNum,
            motivo: 'Falta identificación',
          });
          continue;
        }
        if (!payloadBase.estado) {
          payloadBase.estado = 'PENDIENTE';
        }

        const claves = clavesDeduplicacion(payloadBase);
        let existente = null;
        for (const clave of claves) {
          if (indice.has(clave)) {
            existente = indice.get(clave);
            break;
          }
        }

        if (existente) {
          const merge = mergeImportacionAlfa(payloadBase, existente);
          if (!merge.consecutivo) {
            secuencial += 1;
            merge.consecutivo = `ALFA-${año}-${mes}-${secuencial}`;
          }

          const actualizado = await SegurosAlfaCaso.findByIdAndUpdate(existente._id, merge, {
            new: true,
          }).lean();

          resumen.actualizados += 1;
          for (const clave of clavesDeduplicacion(actualizado)) {
            indice.set(clave, actualizado);
          }
        } else {
          secuencial += 1;
          payloadBase.consecutivo = `ALFA-${año}-${mes}-${secuencial}`;
          const creado = await SegurosAlfaCaso.create(payloadBase);
          const lean = creado.toObject();
          resumen.creados += 1;
          for (const clave of clavesDeduplicacion(lean)) {
            indice.set(clave, lean);
          }
        }
      } catch (errFila) {
        resumen.omitidos += 1;
        resumen.errores.push({
          fila: filaNum,
          motivo: errFila.message || 'Error al procesar la fila',
        });
      }
    }

    res.json({
      success: true,
      data: resumen,
    });
  } catch (error) {
    console.error('❌ Error al importar casos Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: 'Error al importar los casos Seguros Alfa',
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

const buildArchivoFromUpload = (req, etiqueta) => {
  const file = req.file;
  const usuario = usuarioDesdeReq(req);
  if (req.fileStorage?.driver === 's3') {
    return {
      nombreOriginal: file.originalname,
      nombreArchivo: req.fileStorage.filename,
      ruta: req.fileStorage.publicPath,
      tamaño: req.fileStorage.size,
      tipoMime: req.fileStorage.mimetype,
      etiqueta: etiqueta || 'GENERAL',
      subidoPor: usuario,
      fechaSubida: new Date(),
    };
  }
  return {
    nombreOriginal: file.originalname,
    nombreArchivo: file.filename,
    ruta: `/uploads/seguros-alfa/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
    etiqueta: etiqueta || 'GENERAL',
    subidoPor: usuario,
    fechaSubida: new Date(),
  };
};

/** POST /api/seguros-alfa/:id/archivos */
export const subirArchivoAlfa = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se proporcionó ningún archivo' });
    }

    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }

    const etiqueta = toStringOrNull(req.body?.etiqueta) || 'GENERAL';
    const archivo = buildArchivoFromUpload(req, etiqueta);
    caso.archivos = caso.archivos || [];
    caso.archivos.push(archivo);
    caso.fechaUltimoDocumento = new Date();
    await caso.save();

    const creado = caso.archivos[caso.archivos.length - 1];

    // Réplica SharePoint async: nunca debe tumbar el upload ni la respuesta 201
    try {
      await enqueueAlfaClaimDocumentAfterUpload({
        caso,
        archivo: creado,
        req,
        etiqueta,
      });
    } catch (enqErr) {
      console.warn(
        '⚠️ Encolado SharePoint Alfa omitido tras upload:',
        enqErr?.message || enqErr
      );
    }

    res.status(201).json({ success: true, data: creado, casoId: caso._id });
  } catch (error) {
    console.error('❌ Error subiendo archivo Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: error?.storageError
        ? 'Error al guardar el archivo en almacenamiento'
        : 'Error al subir el archivo',
      detalle: error.message,
    });
  }
};

/** PATCH /api/seguros-alfa/:id/archivos/:archivoId — p.ej. descripción/leyenda de foto */
export const actualizarArchivoAlfa = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }

    const archivo = caso.archivos?.id?.(req.params.archivoId);
    if (!archivo) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'descripcion')) {
      archivo.descripcion = toStringOrNull(req.body.descripcion, '') || '';
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'etiqueta')) {
      const et = toStringOrNull(req.body.etiqueta);
      if (et) archivo.etiqueta = et;
    }

    await caso.save();
    res.json({ success: true, data: archivo });
  } catch (error) {
    console.error('❌ Error actualizando archivo Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el archivo',
      detalle: error.message,
    });
  }
};

/** DELETE /api/seguros-alfa/:id/archivos/:archivoId */
export const eliminarArchivoAlfa = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }

    const archivo = caso.archivos?.id?.(req.params.archivoId);
    if (!archivo) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    if (archivo.ruta) {
      await deleteStoredFile(archivo.ruta).catch((err) => {
        console.warn('No se pudo eliminar archivo Alfa del almacenamiento:', err.message);
      });
    }
    archivo.deleteOne();
    await caso.save();

    res.json({ success: true, message: 'Archivo eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error eliminando archivo Seguros Alfa:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el archivo',
      detalle: error.message,
    });
  }
};

/** GET /api/seguros-alfa/:id/documentos-sharepoint */
export const listarDocumentosSharePointAlfa = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }

    const data = await buildAlfaSharePointDocumentsStatus(caso);
    return res.json({
      success: true,
      casoId: caso._id,
      ...data,
    });
  } catch (error) {
    console.error('❌ Error listando estado SharePoint Alfa:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener estado SharePoint',
      detalle: error.message,
    });
  }
};

/**
 * GET /api/seguros-alfa/:id/polizas-importadas
 * Archivero unificado: ARNALD + importados Alfa/SharePoint.
 */
export const listarPolizasImportadasAlfa = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }

    const polizasImportadas = await listImportedAlfaPoliciesForCase(caso);

    let syncByArchivo = {};
    try {
      const sp = await buildAlfaSharePointDocumentsStatus(caso);
      for (const doc of sp.documents || []) {
        syncByArchivo[String(doc.archivoId)] = doc.sync || {};
      }
    } catch {
      syncByArchivo = {};
    }

    const archivosCaso = (caso.archivos || []).map((arch) => {
      const sync = syncByArchivo[String(arch._id)] || {};
      const destPending = sync.destinationStatus === 'pending_destination';
      let estado = 'none';
      if (destPending) estado = 'pending_destination';
      else if (sync.status === 'synced') estado = 'synced';
      else if (sync.status === 'syncing') estado = 'syncing';
      else if (sync.status === 'pending') estado = 'pending';
      else if (sync.status === 'failed') estado = 'failed';

      return {
        id: String(arch._id),
        key: `arnald:${arch._id}`,
        origin: 'arnald',
        originLabel: 'ARNALD',
        nombre: arch.nombreOriginal || arch.nombreArchivo || 'documento',
        tipo: arch.etiqueta || 'GENERAL',
        documentType: arch.etiqueta || 'GENERAL',
        tamaño: arch.tamaño ?? null,
        tipoMime: arch.tipoMime || null,
        fecha: arch.fechaSubida || null,
        fechaSubida: arch.fechaSubida || null,
        ruta: arch.ruta || null,
        downloadUrl: arch.ruta || null,
        estado,
        estadoLabel: destPending
          ? 'Pendiente de destino'
          : sync.status === 'synced'
            ? 'Sincronizado'
            : sync.status === 'syncing'
              ? 'Sincronizando'
              : sync.status === 'pending'
                ? 'Pendiente'
                : sync.status === 'failed'
                  ? 'Error'
                  : '—',
        sharepoint: {
          webUrl: sync.webUrl || null,
          path: sync.path || null,
        },
        canRetry: sync.status === 'failed',
        archivoId: String(arch._id),
      };
    });

    const inbound = (polizasImportadas || []).map((p) => ({
      id: p.id,
      key: `alfa:${p.id}`,
      origin: 'sharepoint',
      originLabel: 'ALFA / SHAREPOINT',
      nombre: p.originalName,
      tipo: p.tipo || p.documentType || 'Póliza',
      documentType: p.documentType || 'poliza',
      tamaño: p.size ?? null,
      tipoMime: p.mimeType || null,
      fecha: p.importedAt || null,
      fechaSubida: p.importedAt || null,
      downloadUrl: p.downloadUrl || null,
      estado: 'imported',
      estadoLabel: 'Importado desde Alfa',
      sharepoint: p.sharepoint || {},
      canRetry: false,
      associatedBy: p.associatedBy || null,
      associatedByLabel: p.associatedByLabel || null,
      policyNumber: p.policyNumber || null,
    }));

    // Evitar duplicar visualmente por nombre+size si mismo S3 key aparece en ambos
    const seenKeys = new Set();
    const documentos = [];
    for (const d of [...archivosCaso, ...inbound]) {
      const dedupe = `${d.origin}|${d.nombre}|${d.tamaño || 0}`;
      if (seenKeys.has(dedupe) && d.origin === 'sharepoint') continue;
      seenKeys.add(dedupe);
      documentos.push(d);
    }
    documentos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));

    return res.json({
      success: true,
      casoId: caso._id,
      numeroPoliza: caso.numeroPoliza || null,
      archivosCaso,
      polizasImportadas,
      documentos,
    });
  } catch (error) {
    console.error('❌ Error listando pólizas importadas Alfa:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener pólizas importadas',
      detalle: error.message,
    });
  }
};

const usuarioImportDesdeReq = (req) => {
  const u = req.user || req.usuario || {};
  return {
    id: String(u.id || u._id || ''),
    login: String(u.login || u.email || ''),
    nombre: String(u.nombre || u.name || u.login || ''),
  };
};

/** POST /api/seguros-alfa/import/preview — multipart file excel */
export const previewImportExcelAlfa = async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer) {
      return res.status(400).json({
        success: false,
        error: 'Debe adjuntar un archivo Excel (campo "file")',
        code: 'MISSING_FILE',
      });
    }
    const data = await previewAlfaExcelImport({
      buffer: file.buffer,
      fileName: file.originalname,
      mimeType: file.mimetype,
      user: usuarioImportDesdeReq(req),
      source: 'manual',
    });
    return res.json({ success: true, ...data });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('❌ preview Excel Alfa:', error);
    return res.status(status).json({
      success: false,
      error: error.message || 'Error en preview',
      code: error.code || 'PREVIEW_ERROR',
    });
  }
};

/** POST /api/seguros-alfa/import/execute — { importSessionId, force? } */
export const executeImportExcelAlfa = async (req, res) => {
  try {
    const importSessionId = req.body?.importSessionId;
    const force = req.body?.force === true;
    const data = await executeAlfaExcelImport({
      importSessionId,
      force,
      user: usuarioImportDesdeReq(req),
    });

    // Si la sesión venía de SharePoint, actualizar checkpoint (nunca desde cron)
    try {
      const cfg = getAlfaExcelSharePointImportConfig();
      const src = await AlfaExcelSharePointSource.findOne({
        integrationKey: cfg.integrationKey,
      }).lean();
      if (
        src?.lastPreviewImportId &&
        String(src.lastPreviewImportId) === String(importSessionId)
      ) {
        await markAlfaExcelSharePointExecuted({
          importSessionId,
          eTag: src.lastPreviewedEtag,
        });
      }
    } catch (e) {
      console.warn('⚠️ Checkpoint SharePoint Excel no actualizado:', e.message);
    }

    return res.json({ success: true, ...data });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('❌ execute Excel Alfa:', error);
    return res.status(status).json({
      success: false,
      error: error.message || 'Error en execute',
      code: error.code || 'EXECUTE_ERROR',
    });
  }
};

/** GET /api/seguros-alfa/import/:importSessionId */
export const statusImportExcelAlfa = async (req, res) => {
  try {
    const data = await getAlfaExcelImportStatus(req.params.importSessionId);
    return res.json({ success: true, ...data });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      code: error.code || 'STATUS_ERROR',
    });
  }
};

/** GET /api/seguros-alfa/import/:importSessionId/report.xlsx */
export const reportImportExcelAlfa = async (req, res) => {
  try {
    const rows = await buildAlfaExcelImportReportRows(req.params.importSessionId);
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Resultados');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="alfa-import-${req.params.importSessionId}.xlsx"`
    );
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Error generando reporte',
    });
  }
};

/**
 * POST /api/seguros-alfa/:id/archivos/:archivoId/sharepoint/retry
 * Solo marca elegible para el worker; no sincroniza en el request.
 */
export const reintentarSyncSharePointAlfa = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Alfa no encontrado' });
    }

    const result = await markAlfaClaimDocumentForRetry({
      caso,
      archivoId: req.params.archivoId,
    });

    return res.json({
      success: true,
      message: 'Documento marcado para reintento. El worker lo procesará en el próximo ciclo.',
      data: result,
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('❌ Error retry SharePoint Alfa:', error);
    }
    return res.status(status).json({
      success: false,
      error: error.message || 'Error al reintentar sincronización',
      code: error.code || 'RETRY_ERROR',
    });
  }
};

/** GET /api/seguros-alfa/alertas */
export const getAlertasAlfa = async (_req, res) => {
  try {
    const data = await obtenerAlertasAlfaPorAjustadores();
    return res.json(data);
  } catch (error) {
    console.error('Error alertas Seguros Alfa:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** POST /api/seguros-alfa/alertas/enviar */
export const postEnviarAlertasAlfaTodas = async (req, res) => {
  try {
    const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
    const data = await enviarAlertasTodosAlfa({ forzar });
    return res.json(data);
  } catch (error) {
    console.error('Error enviando alertas Alfa (todas):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** POST /api/seguros-alfa/alertas/enviar/:ajustador */
export const postEnviarAlertasAlfaAjustador = async (req, res) => {
  try {
    const { ajustador } = req.params;
    if (!ajustador) {
      return res.status(400).json({ success: false, error: 'Código de ajustador requerido' });
    }
    const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
    const data = await enviarAlertasAlfaAjustador(ajustador, { forzar });
    return res.json(data);
  } catch (error) {
    console.error('Error enviando alertas Alfa (ajustador):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** GET /api/seguros-alfa/control-seguimiento/status */
export const getControlSeguimientoAlfaStatus = async (req, res) => {
  try {
    const data = await getAlfaExcelSharePointStatus();
    return res.json({ success: true, ...data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      code: 'CONTROL_SEGUIMIENTO_STATUS_ERROR',
      uiStatus: 'error',
      headline: '⚠ No fue posible consultar Control y Seguimiento',
      tone: 'error',
    });
  }
};

/** POST /api/seguros-alfa/control-seguimiento/check — fuerza ciclo detección+preview */
export const postControlSeguimientoAlfaCheck = async (req, res) => {
  try {
    const force = req.body?.force === true;
    const data = await runAlfaExcelSharePointDetectCycle({ force });
    const status = await getAlfaExcelSharePointStatus();
    return res.json({ success: true, cycle: data, ...status });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || 'CONTROL_SEGUIMIENTO_CHECK_ERROR',
      uiStatus: 'error',
      headline: '⚠ No fue posible consultar Control y Seguimiento',
      tone: 'error',
    });
  }
};

/** POST /api/seguros-alfa/control-seguimiento/notification/dismiss */
export const postControlSeguimientoAlfaDismissNotification = async (req, res) => {
  try {
    const data = await dismissAlfaExcelSharePointNotification();
    return res.json({ success: true, ...data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** POST /api/seguros-alfa/geocode-pendientes — geocodifica predios sin coords (no SharePoint) */
export const postGeocodePendientesAlfa = async (req, res) => {
  try {
    const limit = req.body?.limit ?? req.query?.limit ?? 40;
    const force = req.body?.force === true || req.query?.force === 'true';
    const data = await geocodeCasosAlfaPendientes({ limit, force });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error geocode pendientes Alfa:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/seguros-alfa/ubicaciones-predio
 * Aplica coords geocodificadas en el cliente (fallback si el backend no tiene API key).
 * Body: { items: [{ casoId, lat, lng, geocodeStatus, geocodeQuery, direccionHash }] }
 */
export const postUbicacionesPredioAlfa = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'items[] requerido' });
    }
    const data = await aplicarUbicacionesPredioAlfa(items);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error aplicando ubicaciones Alfa:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** GET /api/seguros-alfa/bloques-cercania?radioKm=2.5&ciudad=&estado= */
export const getBloquesCercaniaAlfa = async (req, res) => {
  try {
    const radioKm = req.query?.radioKm ?? 2.5;
    const ciudad = req.query?.ciudad || '';
    const estado = req.query?.estado || '';
    const data = await obtenerBloquesCercaniaAlfa({ radioKm, ciudad, estado });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error bloques cercanía Alfa:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
