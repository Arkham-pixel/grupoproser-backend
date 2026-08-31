import mongoose from 'mongoose';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { resolverAsignacionCatastrofico } from '../utils/resolverAsignacionCatastrofico.js';
import { catalogoPerteneceAModulo } from '../utils/filtrarCatalogoPorModulo.js';
import { deleteStoredFile } from '../services/fileStorageService.js';
import { rutaArchivoSigueEnUsoZurich } from '../utils/espejarArchivoZurichCatEnListado.js';
import { resolverLiquidadorParaUpdate } from '../utils/protegerPresupuestoNsr10.js';
import {
  aplicarEstadoDesdeTipoInformeZurich,
  aplicarFechaAccionEstadoZurich,
  homologarEstadoZurich,
} from '../utils/estadosZurich.js';
import { homologarCiudadZurich } from '../utils/ciudadesBbvaCat.js';
import { homologarCausaZurich } from '../utils/causasZurich.js';
import { aplicarReservaDesdePresupuestoZurich, fusionarInformeUnicoZurich } from '../utils/reservaPresupuestoZurich.js';
import { aplicarLiderZurich } from '../utils/filtrarCatalogoPorModulo.js';
import { TORRE_CONFIG_ZURICH } from '../config/zurichListadoTorre.js';

if (ZurichListadoCaso?.schema) {
  ZurichListadoCaso.schema.add({
    tomador: String,
    direccionPredio: String,
    fechaInicioPoliza: Date,
    fechaFinPoliza: Date,
    cobertura: String,
    departamento: String,
  });
  ZurichListadoCaso.schema.set('strict', false);
}

const esVacio = (valor) =>
  valor === undefined || valor === null || valor === '' || valor === 'null';

const esPlaceholder = (valor) => {
  if (esVacio(valor)) return true;
  const t = String(valor)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  return !t || /^(N\/?A|NA|NULL|-|0|POR CONFIRMAR|SIN DATO)$/.test(t);
};

const toStr = (valor, fallback = null) => {
  if (esVacio(valor)) return fallback ?? null;
  return String(valor).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim() || fallback || null;
};

/** Incoming útil completa huecos; no pisa un dato ya guardado. */
const completarCampo = (incoming, existing) => {
  const a = toStr(incoming, null);
  const b = toStr(existing, null);
  if (b && !esPlaceholder(b)) return b;
  if (a && !esPlaceholder(a)) return a;
  return b || a || null;
};

const partirContactoIntermediario = (texto) => {
  const out = { intermediario: null, correoIntermediario: null, telefonoIntermediario: null };
  const partes = String(texto || '')
    .split('|')
    .map((p) => p.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const parte of partes) {
    if (parte.includes('@')) {
      if (!out.correoIntermediario) out.correoIntermediario = parte;
    } else if ((parte.replace(/\D/g, '').length >= 7)) {
      if (!out.telefonoIntermediario) out.telefonoIntermediario = parte;
    } else if (!out.intermediario) {
      out.intermediario = parte;
    }
  }
  return out;
};

const armarContactoAsegurado = (payload = {}) => {
  const texto = String(payload.contactoAsegurado || '');
  if (!payload.correoAsegurado || !payload.telefonoAsegurado) {
    const email = texto.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email && !payload.correoAsegurado) payload.correoAsegurado = email[0];
    const resto = email ? texto.replace(email[0], ' ').replace(/[|,;]/g, ' ').trim() : texto;
    if (!payload.telefonoAsegurado && resto.replace(/\D/g, '').length >= 7) {
      payload.telefonoAsegurado = resto;
    }
  }
  const armado = [payload.telefonoAsegurado, payload.correoAsegurado].filter(Boolean);
  if (armado.length) payload.contactoAsegurado = armado.join(' | ');
  return payload;
};

const armarContactoIntermediario = (payload = {}) => {
  const partido = partirContactoIntermediario(payload.contactoIntermediario);
  if (!payload.intermediario) payload.intermediario = partido.intermediario;
  if (!payload.correoIntermediario) payload.correoIntermediario = partido.correoIntermediario;
  if (!payload.telefonoIntermediario) payload.telefonoIntermediario = partido.telefonoIntermediario;
  const partes = [
    payload.intermediario,
    payload.correoIntermediario,
    payload.telefonoIntermediario,
  ].filter(Boolean);
  if (partes.length) payload.contactoIntermediario = partes.join(' | ');
  return payload;
};

const parseFecha = (valor, fallback = null) => {
  if (valor === undefined) return fallback ?? null;
  if (esPlaceholder(valor) || esVacio(valor)) return fallback ?? null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;
  const texto = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
    const d = new Date(`${texto.slice(0, 10)}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? fallback ?? null : d;
  }
  const n = Number(valor);
  if (Number.isFinite(n) && n > 20000) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(n * 86400000);
    return new Date(utc);
  }
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? fallback ?? null : d;
};

const completarFecha = (incoming, existing) => {
  if (existing instanceof Date && !Number.isNaN(existing.getTime())) return existing;
  return parseFecha(incoming, existing ?? null);
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

const pickObjeto = (incoming, existing) => {
  if (incoming === undefined) return existing ?? null;
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) return incoming;
  return existing ?? null;
};

const parseNumero = (valor, fallback = null) => {
  if (valor === undefined) return fallback ?? null;
  if (valor === null || valor === '') return fallback ?? null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  const n = Number(String(valor).replace(/\./g, '').replace(/[^\d-]/g, ''));
  return Number.isNaN(n) ? fallback ?? null : n;
};

const buildPayload = (data = {}, base = {}, { pisar = false } = {}) => {
  const pick = pisar ? toStr : completarCampo;
  const pickFecha = pisar ? parseFecha : completarFecha;
  const payload = completarIdentificacion({
    consecutivo: base.consecutivo ?? null,
    zc: pick(data.zc, base.zc ?? null),
    siniestro: pick(data.siniestro, base.siniestro ?? null),
    identificacion: pick(data.identificacion, base.identificacion ?? null),
    tipoIdentificacion: pick(data.tipoIdentificacion, base.tipoIdentificacion ?? null),
    numeroPoliza: pick(data.numeroPoliza, base.numeroPoliza ?? null),
    tipoPoliza: pick(data.tipoPoliza, base.tipoPoliza ?? null),
    tipoPolizaOtro: pick(data.tipoPolizaOtro, base.tipoPolizaOtro ?? null),
    causa: homologarCausaZurich(pick(data.causa, base.causa ?? null)),
    asegurado: pick(data.asegurado, base.asegurado ?? null),
    intermediario: pick(data.intermediario, base.intermediario ?? null),
    correoIntermediario: pick(data.correoIntermediario, base.correoIntermediario ?? null),
    telefonoIntermediario: pick(data.telefonoIntermediario, base.telefonoIntermediario ?? null),
    contactoIntermediario: pick(data.contactoIntermediario, base.contactoIntermediario ?? null),
    correoAsegurado: pick(data.correoAsegurado, base.correoAsegurado ?? null),
    telefonoAsegurado: pick(data.telefonoAsegurado, base.telefonoAsegurado ?? null),
    contactoAsegurado: pick(data.contactoAsegurado, base.contactoAsegurado ?? null),
    observaciones: pick(data.observaciones, base.observaciones ?? null),
    observacionesCat: pick(data.observacionesCat, base.observacionesCat ?? null),
    ciudad: homologarCiudadZurich(pick(data.ciudad, base.ciudad ?? null)) || pick(data.ciudad, base.ciudad ?? null),
    departamento: pick(data.departamento, base.departamento ?? null),
    tomador: pick(data.tomador, base.tomador ?? null),
    direccionPredio: pick(
      data.direccionPredio ?? data.direccion ?? data.direccionRiesgo,
      base.direccionPredio ?? null
    ),
    fechaInicioPoliza: pickFecha(
      data.fechaInicioPoliza ?? data.vigenciaDesde,
      base.fechaInicioPoliza ?? null
    ),
    fechaFinPoliza: pickFecha(
      data.fechaFinPoliza ?? data.vigenciaHasta,
      base.fechaFinPoliza ?? null
    ),
    cobertura: pick(data.cobertura ?? data.amparo ?? data.evento, base.cobertura ?? null),
    ajustadorLider: aplicarLiderZurich(pick(data.ajustadorLider, base.ajustadorLider ?? null)),
    ajustador: pick(data.ajustador, base.ajustador ?? null),
    inspector: pick(data.inspector, base.inspector ?? null),
    fechaAsignacion: pickFecha(data.fechaAsignacion, base.fechaAsignacion ?? null),
    fechaVisita: pickFecha(data.fechaVisita, base.fechaVisita ?? null),
    fechaSiniestro: pickFecha(
      data.fechaSiniestro ?? data.fechaOcurrencia,
      base.fechaSiniestro ?? null
    ),
    reserva: data.reserva !== undefined ? parseNumero(data.reserva, base.reserva ?? null) : (base.reserva ?? null),
    valorAseguradoInmueble: parseNumero(data.valorAseguradoInmueble, base.valorAseguradoInmueble ?? null),
    valorReclamado: parseNumero(data.valorReclamado, base.valorReclamado ?? null),
    valorLiquidado: parseNumero(data.valorLiquidado, base.valorLiquidado ?? null),
    estado: homologarEstadoZurich(pick(data.estado, base.estado ?? 'CASO NUEVO') || 'CASO NUEVO'),
    modalidadAtencion: pick(data.modalidadAtencion, base.modalidadAtencion ?? null),
    fechaCasoNuevo: pickFecha(data.fechaCasoNuevo, base.fechaCasoNuevo ?? null),
    fechaCoordinandoInspeccion: pickFecha(
      data.fechaCoordinandoInspeccion,
      base.fechaCoordinandoInspeccion ?? null
    ),
    fechaInspeccionado: pickFecha(data.fechaInspeccionado, base.fechaInspeccionado ?? null),
    fechaVerificado: pickFecha(data.fechaVerificado, base.fechaVerificado ?? null),
    fechaAnalisisCaso: pickFecha(data.fechaAnalisisCaso, base.fechaAnalisisCaso ?? null),
    fechaSolicitudDocumento: pickFecha(
      data.fechaSolicitudDocumento,
      base.fechaSolicitudDocumento ?? null
    ),
    fechaRecepcionDocumento: pickFecha(
      data.fechaRecepcionDocumento,
      base.fechaRecepcionDocumento ?? null
    ),
    fechaInformePreliminar: pickFecha(
      data.fechaInformePreliminar,
      base.fechaInformePreliminar ?? null
    ),
    fechaInformeFinal: pickFecha(data.fechaInformeFinal, base.fechaInformeFinal ?? null),
    fechaAutoridadDelegada: pickFecha(
      data.fechaAutoridadDelegada,
      base.fechaAutoridadDelegada ?? null
    ),
    fechaAceptacionCliente: pickFecha(
      data.fechaAceptacionCliente,
      base.fechaAceptacionCliente ?? null
    ),
    fechaFinalizado: pickFecha(data.fechaFinalizado, base.fechaFinalizado ?? null),
    fechaObjecion: pickFecha(data.fechaObjecion, base.fechaObjecion ?? null),
    fechaLiquidado: pickFecha(data.fechaLiquidado, base.fechaLiquidado ?? null),
    fechaAutorizacionAnalista: pickFecha(
      data.fechaAutorizacionAnalista,
      base.fechaAutorizacionAnalista ?? null
    ),
    fechaCasoParaPago: pickFecha(data.fechaCasoParaPago, base.fechaCasoParaPago ?? null),
    documentoFaltante: pick(data.documentoFaltante, base.documentoFaltante ?? null),
    observacionPendienteDocumento: pick(
      data.observacionPendienteDocumento,
      base.observacionPendienteDocumento ?? null
    ),
    motivoObjecion: pick(data.motivoObjecion, base.motivoObjecion ?? null),
    responsableAporteDocumento: pick(
      data.responsableAporteDocumento,
      base.responsableAporteDocumento ?? null
    ),
    liquidador: resolverLiquidadorParaUpdate(data.liquidador, base.liquidador),
    informeUnico: fusionarInformeUnicoZurich(
      pickObjeto(data.informeUnico, base.informeUnico ?? null),
      base.informeUnico
    ),
  });
  if (!toStr(payload.departamento) && homologarCiudadZurich(payload.ciudad) === 'CALI') {
    payload.departamento = 'VALLE DEL CAUCA';
  }
  return aplicarReservaDesdePresupuestoZurich(
    aplicarFechaAccionEstadoZurich(
      aplicarEstadoDesdeTipoInformeZurich(
        armarContactoAsegurado(armarContactoIntermediario(payload)),
        base
      ),
      base
    )
  );
};

const sinUndefined = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
};

/** Persiste en Mongo sin que mongoose strict descarte tomador/vigencia/cobertura. */
const persistirListadoZurich = async (id, payload, { crear = false } = {}) => {
  const $set = sinUndefined(payload);
  const now = new Date();
  $set.updatedAt = now;
  if (crear) {
    const _id = new mongoose.Types.ObjectId();
    await ZurichListadoCaso.collection.insertOne({
      _id,
      archivos: [],
      ...$set,
      createdAt: now,
    });
    return ZurichListadoCaso.findById(_id).lean();
  }
  await ZurichListadoCaso.collection.updateOne({ _id: id }, { $set });
  return ZurichListadoCaso.findById(id).lean();
};

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
    const payload = buildPayload(req.body, {}, { pisar: true });
    if (!payload.zc && !payload.siniestro) {
      return res.status(400).json({
        success: false,
        error: 'Indique ZC o STRO (siniestro)',
      });
    }
    payload.consecutivo = await generarConsecutivo();
    const documento = await persistirListadoZurich(null, payload, { crear: true });
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

/**
 * Listado / dashboard / reporte: no mandar blobs Mixed.
 * Con strict:false, `.select('-informeUnico')` de Mongoose no recorta el documento
 * y un GET de 170 casos llega a ~20 MB (informes NSR-10) → Failed to fetch en el navegador.
 * Proyección nativa de inclusión: solo campos de cartera.
 */
const PROYECCION_LISTA_ZURICH = {
  consecutivo: 1,
  zc: 1,
  siniestro: 1,
  identificacion: 1,
  tipoIdentificacion: 1,
  numeroPoliza: 1,
  tipoPoliza: 1,
  tipoPolizaOtro: 1,
  causa: 1,
  asegurado: 1,
  intermediario: 1,
  correoIntermediario: 1,
  telefonoIntermediario: 1,
  contactoIntermediario: 1,
  correoAsegurado: 1,
  telefonoAsegurado: 1,
  contactoAsegurado: 1,
  observaciones: 1,
  observacionesCat: 1,
  ciudad: 1,
  departamento: 1,
  tomador: 1,
  direccionPredio: 1,
  fechaInicioPoliza: 1,
  fechaFinPoliza: 1,
  cobertura: 1,
  ajustadorLider: 1,
  ajustador: 1,
  inspector: 1,
  fechaAsignacion: 1,
  fechaVisita: 1,
  fechaSiniestro: 1,
  fechaLlamada: 1,
  fechaInspeccion: 1,
  fechaUltimoDocumento: 1,
  reserva: 1,
  valorAseguradoInmueble: 1,
  valorReclamado: 1,
  valorLiquidado: 1,
  estado: 1,
  modalidadAtencion: 1,
  fechaCasoNuevo: 1,
  fechaCoordinandoInspeccion: 1,
  fechaInspeccionado: 1,
  fechaVerificado: 1,
  fechaAnalisisCaso: 1,
  fechaSolicitudDocumento: 1,
  fechaRecepcionDocumento: 1,
  fechaInformePreliminar: 1,
  fechaInformeFinal: 1,
  fechaAutoridadDelegada: 1,
  fechaAceptacionCliente: 1,
  fechaAceptacionLiquidacion: 1,
  fechaFinalizado: 1,
  fechaObjecion: 1,
  fechaLiquidado: 1,
  fechaCasoParaPago: 1,
  documentoFaltante: 1,
  observacionPendienteDocumento: 1,
  motivoObjecion: 1,
  responsableAporteDocumento: 1,
  createdAt: 1,
  updatedAt: 1,
};

const PIPELINE_BANDERAS_LISTA_ZURICH = {
  $addFields: {
    tieneInforme: { $eq: [{ $type: '$informeUnico' }, 'object'] },
    tieneLiquidador: { $eq: [{ $type: '$liquidador' }, 'object'] },
    nArchivos: {
      $cond: [{ $isArray: '$archivos' }, { $size: '$archivos' }, 0],
    },
    tipoInforme: '$informeUnico.tipoInforme',
  },
};

export const listarCasosListadoZurich = async (req, res) => {
  try {
    const { limit = 25, page = 1, completo } = req.query;
    const limite = Math.max(1, Number(limit) || 25);
    const pagina = Math.max(1, Number(page) || 1);
    const skip = (pagina - 1) * limite;
    const quiereCompleto = String(completo || '') === '1' || String(completo || '') === 'true';

    const [total, documentos] = await Promise.all([
      ZurichListadoCaso.countDocuments({}),
      quiereCompleto
        ? ZurichListadoCaso.find({}).sort({ createdAt: -1 }).skip(skip).limit(limite).lean()
        : ZurichListadoCaso.aggregate([
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limite },
            PIPELINE_BANDERAS_LISTA_ZURICH,
            {
              $project: {
                ...PROYECCION_LISTA_ZURICH,
                tieneInforme: 1,
                tieneLiquidador: 1,
                nArchivos: 1,
                tipoInforme: 1,
              },
            },
          ]),
    ]);
    res.json({
      success: true,
      total,
      page: pagina,
      limit: limite,
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

export const obtenerTorreConfigZurich = async (_req, res) => {
  res.json({ success: true, data: TORRE_CONFIG_ZURICH });
};

export const obtenerCasoListadoZurich = async (req, res) => {
  try {
    const documento = await ZurichListadoCaso.findById(req.params.id).lean();
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
    const payload = buildPayload(req.body, actual.toObject(), { pisar: true });
    if (!payload.consecutivo) payload.consecutivo = actual.consecutivo || (await generarConsecutivo());
    const actualizado = await persistirListadoZurich(actual._id, payload);
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
    for (const archivo of registro.archivos || []) {
      if (archivo?.ruta) {
        const enUso = await rutaArchivoSigueEnUsoZurich(archivo.ruta, {
          coleccion: 'listado',
          casoId: registro._id,
        });
        if (!enUso) {
          await deleteStoredFile(archivo.ruta).catch((err) => {
            console.warn('No se pudo eliminar archivo del listado Zurich:', err.message);
          });
        }
      }
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
    const [inspectoresRaw, ajustadoresRaw] = await Promise.all([
      InspectorCatastrofico.find({}).lean(),
      AjustadorCatastrofico.find({}).lean(),
    ]);
    const inspectores = inspectoresRaw.filter((d) => catalogoPerteneceAModulo(d, 'zurich'));
    const ajustadores = ajustadoresRaw.filter((d) => catalogoPerteneceAModulo(d, 'zurich'));
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
        const asignacion = resolverAsignacionCatastrofico({
          inspectorExcel: filas[i]?.inspector,
          ajustadorExcel: filas[i]?.ajustador,
          inspectores,
          ajustadores,
        });
        const payload = buildPayload({
          ...filas[i],
          inspector: asignacion.inspector,
          ajustador: asignacion.ajustador,
          estado: filas[i]?.estado || 'CASO NUEVO',
        });
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
          const actualizado = await persistirListadoZurich(existente._id, merge);
          resumen.actualizados += 1;
          if (clave) indice.set(clave, actualizado);
        } else {
          secuencial += 1;
          payload.consecutivo = `ZURICH-LST-${año}-${mes}-${secuencial}`;
          const creado = await persistirListadoZurich(null, payload, { crear: true });
          resumen.creados += 1;
          if (clave) indice.set(clave, creado);
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

const usuarioDesdeReq = (req) => {
  const u = req.usuario || req.user || {};
  return {
    id: String(u.id || u._id || ''),
    login: String(u.login || u.email || 'usuario'),
    nombre: String(u.nombre || u.name || u.login || 'Usuario'),
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
    ruta: `/uploads/zurich-listado/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
    ...base,
  };
};

/** POST /api/zurich-listado/:id/archivos */
export const subirArchivoListadoZurich = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se proporcionó ningún archivo' });
    }

    const caso = await ZurichListadoCaso.findById(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso del listado no encontrado' });
    }

    const etiqueta = toStr(req.body?.etiqueta, 'GENERAL') || 'GENERAL';
    const descripcion =
      req.body?.descripcion != null ? String(req.body.descripcion) : '';
    caso.archivos = caso.archivos || [];
    const orden = siguienteOrdenArchivos(caso.archivos);
    caso.archivos.push(buildArchivoFromUpload(req, etiqueta, { descripcion, orden }));
    await caso.save();

    const creado = caso.archivos[caso.archivos.length - 1];
    res.status(201).json({ success: true, data: creado, casoId: caso._id });
  } catch (error) {
    console.error('❌ Error subiendo archivo listado Zurich:', error);
    res.status(500).json({
      success: false,
      error: error?.storageError
        ? 'Error al guardar el archivo en almacenamiento'
        : 'Error al subir el archivo',
      detalle: error.message,
    });
  }
};

/** DELETE /api/zurich-listado/:id/archivos/:archivoId */
export const eliminarArchivoListadoZurich = async (req, res) => {
  try {
    const caso = await ZurichListadoCaso.findById(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso del listado no encontrado' });
    }

    const archivo = caso.archivos?.id?.(req.params.archivoId);
    if (!archivo) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    if (archivo.ruta) {
      const enUso = await rutaArchivoSigueEnUsoZurich(archivo.ruta, {
        coleccion: 'listado',
        casoId: caso._id,
      });
      if (!enUso) {
        await deleteStoredFile(archivo.ruta).catch((err) => {
          console.warn('No se pudo eliminar archivo del listado Zurich del almacenamiento:', err.message);
        });
      }
    }
    archivo.deleteOne();
    await caso.save();

    res.json({ success: true, message: 'Archivo eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error eliminando archivo listado Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el archivo',
      detalle: error.message,
    });
  }
};
