import mongoose from 'mongoose';
import SegurosSuraCaso from '../models/SegurosSuraCaso.js';
import Responsable from '../models/Responsable.js';
import SecurUser from '../models/SecurUser.js';
import Estado from '../models/Estado.js';
import Cliente from '../models/Cliente.js';
import { deleteStoredFile } from '../services/fileStorageService.js';
import {
  obtenerAlertasSuraPorAjustadores,
  enviarAlertasTodosSura,
  enviarAlertasSuraAjustador,
} from '../services/alertasSuraService.js';
import { generarConsecutivoSura } from '../services/suraCasoService.js';
import {
  geocodeCasosSuraPendientes,
  aplicarUbicacionesPredioSura,
  obtenerBloquesCercaniaSura,
} from '../services/suraBloquesCercaniaService.js';
import {
  enviarNotificacionHonorarios,
  enviarNotificacionControlHoras,
  enviarNotificacionGerencia,
  enviarSolicitudCorreccionControlHoras,
} from '../services/emailService.js';
import {
  listarBandejaFacturacion,
  persistirEnvioFacturacionTrasCorreo,
  corregirDestinatarioEnvioFacturacion,
  eliminarRegistroEnvioFacturacion,
} from '../services/facturacionBandejaService.js';
import {
  normalizarClaveGerente,
  resolverGerenteDesdeLogin,
  usuarioPuedeVerBandejaFacturacion,
  puedeElegirGerenteEnBandeja,
  puedeAdministrarBandejaFacturacion,
} from '../config/gerentesFacturacion.js';

const SURA_RAZON_SOCIAL = 'SEGUROS GENERALES SURAMERICANA S.A.';

const CAMPOS_NO_COPIAR_COMPLEX = new Set([
  '_id',
  '__v',
  'id',
  'createdAt',
  'updatedAt',
  'consecutivo',
  'liquidador',
  'informeUnico',
  'archivos',
  'ubicacionPredio',
]);

const CAMPOS_IDENTIDAD_SURA = new Set([
  'siniestro',
  'identificacion',
  'asegurado',
  'tomador',
  'ajustador',
  'numeroPoliza',
  'direccionPredio',
  'ciudad',
  'departamento',
  'fechaSiniestro',
  'fechaInspeccion',
  'reserva',
  'valorReclamado',
  'estado',
]);

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

const obtenerMaxSecuencialSura = async () => {
  const patron = /^SURA-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await SegurosSuraCaso.find({
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

/** Formato: SURA-YYYY-MM-N (asignado solo al crear) — contador atómico compartido */
const generarConsecutivoSuraLocal = generarConsecutivoSura;

const buscarCasoPorId = async (idParam) => {
  if (idParam == null || idParam === '') return null;
  const id = String(idParam).trim();
  if (mongoose.Types.ObjectId.isValid(id)) {
    const porObjectId = await SegurosSuraCaso.findById(id);
    if (porObjectId) return porObjectId;
  }
  return null;
};

const primerTexto = (...valores) => {
  for (const valor of valores) {
    if (valor === undefined) continue;
    const texto = toStringOrNull(valor);
    if (texto) return texto;
  }
  return null;
};

const primerNumero = (...valores) => {
  for (const valor of valores) {
    if (valor === undefined) continue;
    const n = parseNumberFlexible(valor);
    if (n !== null) return n;
  }
  return null;
};

const primerFecha = (...valores) => {
  for (const valor of valores) {
    if (valor === undefined) continue;
    const f = parseDateFlexible(valor);
    if (f) return f;
  }
  return null;
};

const buildSuraPayload = (data = {}, base = {}) => {
  const identificacion = primerTexto(
    data.identificacion,
    data.numDocumento,
    base.identificacion,
    base.numDocumento
  );
  const siniestro = primerTexto(data.siniestro, data.nmroSinstro, base.siniestro, base.nmroSinstro);
  const estado =
    primerTexto(data.descripcionEstado, data.estado, base.descripcionEstado, base.estado) ||
    'PENDIENTE';

  const payload = {
    consecutivo: base.consecutivo ?? null,
    siniestro,
    identificacion,
    asegurado: primerTexto(data.asegurado, data.asgrBenfcro, base.asegurado, base.asgrBenfcro),
    tomador: primerTexto(data.tomador, data.nombIntermediario, base.tomador, base.nombIntermediario),
    ajustador: primerTexto(data.ajustador, data.codiRespnsble, base.ajustador, base.codiRespnsble),
    numeroPoliza: primerTexto(data.numeroPoliza, data.nmroPolza, base.numeroPoliza, base.nmroPolza),
    direccionPredio: toStringOrNull(data.direccionPredio, base.direccionPredio ?? null),
    numeroCredito: toStringOrNull(data.numeroCredito, base.numeroCredito ?? null),
    informacionContacto: toStringOrNull(data.informacionContacto, base.informacionContacto ?? null),
    correo: toStringOrNull(data.correo, base.correo ?? null),
    canalRadicacion: toStringOrNull(data.canalRadicacion, base.canalRadicacion ?? null),
    ciudad: primerTexto(
      data.ciudad,
      data.nombreCiudad,
      data.ciudadSiniestro,
      base.ciudad,
      base.nombreCiudad,
      base.ciudadSiniestro
    ),
    departamento: primerTexto(
      data.departamento,
      data.departamentoCiudad,
      base.departamento,
      base.departamentoCiudad
    ),
    fechaSiniestro:
      primerFecha(data.fechaSiniestro, data.fchaSinstro) ||
      parseDateFlexible(undefined, base.fechaSiniestro ?? base.fchaSinstro ?? null),
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
    reserva:
      primerNumero(data.reserva, data.vlorResrva) ??
      parseNumberFlexible(undefined, base.reserva ?? base.vlorResrva ?? null),
    valorReclamado:
      primerNumero(data.valorReclamado, data.vlorReclmo) ??
      parseNumberFlexible(undefined, base.valorReclamado ?? base.vlorReclmo ?? null),
    valorLiquidado: parseNumberFlexible(data.valorLiquidado, base.valorLiquidado ?? null),
    fechaLlamada: parseDateFlexible(data.fechaLlamada, base.fechaLlamada ?? null),
    observacionLlamada: toStringOrNull(data.observacionLlamada, base.observacionLlamada ?? null) || '',
    fechaInspeccion:
      primerFecha(data.fechaInspeccion, data.fchaInspccion) ||
      parseDateFlexible(undefined, base.fechaInspeccion ?? base.fchaInspccion ?? null),
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
    estado,
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
  };

  for (const [clave, valor] of Object.entries(data || {})) {
    if (CAMPOS_NO_COPIAR_COMPLEX.has(clave) || CAMPOS_IDENTIDAD_SURA.has(clave)) continue;
    if (valor !== undefined) payload[clave] = valor;
  }

  if (data.control_horas !== undefined) payload.control_horas = data.control_horas;
  if (data.historialDocs !== undefined) {
    if (Array.isArray(data.historialDocs) && data.historialDocs.length === 0 && base.historialDocs?.length) {
      payload.historialDocs = base.historialDocs;
    } else {
      payload.historialDocs = data.historialDocs;
    }
  }
  if (data.envios_facturacion !== undefined) payload.envios_facturacion = data.envios_facturacion;

  const valorServicio = primerNumero(data.vlorServcios, data.valor_servicio, data.valorServicio);
  if (valorServicio !== null) payload.vlorServcios = valorServicio;
  const valorGastos = primerNumero(data.vlorGastos, data.valor_gastos, data.valorGastos);
  if (valorGastos !== null) payload.vlorGastos = valorGastos;

  const fechaControlHoras = primerFecha(
    data.fcha_control_horas,
    data.fecha_control_horas,
    data.fchaControlHoras,
    data.fechaControlHoras
  );
  if (fechaControlHoras) payload.fcha_control_horas = fechaControlHoras;

  if (!payload.nmroSinstro && siniestro) payload.nmroSinstro = siniestro;
  if (!payload.asgrBenfcro && payload.asegurado) payload.asgrBenfcro = payload.asegurado;
  if (!payload.nmroPolza && payload.numeroPoliza) payload.nmroPolza = payload.numeroPoliza;
  if (!payload.numDocumento && identificacion) payload.numDocumento = identificacion;
  if (!payload.codiRespnsble && payload.ajustador) payload.codiRespnsble = payload.ajustador;
  if (!payload.descripcionEstado) payload.descripcionEstado = estado;
  if (!payload.nombreCliente && !payload.nombreAseguradora) {
    payload.nombreCliente = SURA_RAZON_SOCIAL;
    payload.nombreAseguradora = SURA_RAZON_SOCIAL;
  }

  return payload;
};

/** Une fila Excel con caso existente: solo pisa placeholders / vacíos / errores parseados. */
const mergeImportacionSura = (incomingPayload = {}, existente = {}) => {
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

export const crearCasoSura = async (req, res) => {
  try {
    const payload = buildSuraPayload(req.body);
    payload.consecutivo = await generarConsecutivoSuraLocal();

    const faltantes = validarRequeridos(payload);
    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    if (!payload.nmroAjste) payload.nmroAjste = payload.consecutivo;
    if (!payload.nombreCliente) payload.nombreCliente = SURA_RAZON_SOCIAL;
    if (!payload.nombreAseguradora) payload.nombreAseguradora = SURA_RAZON_SOCIAL;

    const documento = await SegurosSuraCaso.create(payload);
    res.status(201).json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al crear caso Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar el caso Seguros Sura',
      detalle: error.message,
    });
  }
};

export const listarCasosSura = async (req, res) => {
  try {
    const { limit = 25, page = 1, nmroAjste, consecutivo } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filtro = {};
    const numero = String(nmroAjste || consecutivo || '').trim();
    if (numero) {
      filtro.$or = [{ nmroAjste: numero }, { consecutivo: numero }, { siniestro: numero }];
    }
    const [total, documentos] = await Promise.all([
      SegurosSuraCaso.countDocuments(filtro),
      SegurosSuraCaso.find(filtro)
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
    console.error('❌ Error al listar casos Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener los casos Seguros Sura',
      detalle: error.message,
    });
  }
};

export const obtenerCasoSura = async (req, res) => {
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
      'upload',
      'bandeja-facturacion',
      'notificaciones',
    ]);
    if (reservados.has(id)) {
      return res.status(404).json({ success: false, error: `Ruta no encontrada: ${id}` });
    }

    const documento = await buscarCasoPorId(id);
    if (!documento) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Sura no encontrado' });
    }
    res.json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al obtener caso Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener el caso Seguros Sura',
      detalle: error.message,
    });
  }
};

export const actualizarCasoSura = async (req, res) => {
  try {
    const registroActual = await buscarCasoPorId(req.params.id);
    if (!registroActual) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Sura no encontrado' });
    }

    const base = registroActual.toObject();
    const payload = buildSuraPayload(req.body, base);
    if (!payload.consecutivo) {
      payload.consecutivo = base.consecutivo || (await generarConsecutivoSura());
    }
    if (!payload.nmroAjste) {
      payload.nmroAjste = base.nmroAjste || payload.consecutivo;
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

    const actualizado = await SegurosSuraCaso.findByIdAndUpdate(
      registroActual._id,
      { $set: payload },
      {
        new: true,
        runValidators: true,
      }
    );

    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('❌ Error al actualizar caso Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el caso Seguros Sura',
      detalle: error.message,
    });
  }
};

export const eliminarCasoSura = async (req, res) => {
  try {
    const registro = await buscarCasoPorId(req.params.id);
    if (!registro) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Sura no encontrado' });
    }

    await SegurosSuraCaso.deleteOne({ _id: registro._id });
    res.json({ success: true, message: 'Caso Seguros Sura eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar caso Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el caso Seguros Sura',
      detalle: error.message,
    });
  }
};

/**
 * Importación masiva con deduplicación.
 * Si el caso ya existe (siniestro, o identificación+crédito/póliza/dirección), se actualiza; no se duplica.
 */
export const importarCasosSura = async (req, res) => {
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
      await SegurosSuraCaso.deleteMany({});
    }

    const existentes = await SegurosSuraCaso.find().lean();
    const indice = new Map();
    for (const doc of existentes) {
      for (const clave of clavesDeduplicacion(doc)) {
        if (!indice.has(clave)) indice.set(clave, doc);
      }
    }

    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    let secuencial = await obtenerMaxSecuencialSura();

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
        const payloadBase = buildSuraPayload({
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
          const merge = mergeImportacionSura(payloadBase, existente);
          if (!merge.consecutivo) {
            secuencial += 1;
            merge.consecutivo = `SURA-${año}-${mes}-${secuencial}`;
          }

          const actualizado = await SegurosSuraCaso.findByIdAndUpdate(existente._id, merge, {
            new: true,
          }).lean();

          resumen.actualizados += 1;
          for (const clave of clavesDeduplicacion(actualizado)) {
            indice.set(clave, actualizado);
          }
        } else {
          secuencial += 1;
          payloadBase.consecutivo = `SURA-${año}-${mes}-${secuencial}`;
          const creado = await SegurosSuraCaso.create(payloadBase);
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
    console.error('❌ Error al importar casos Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: 'Error al importar los casos Seguros Sura',
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
    ruta: `/uploads/sura/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
    etiqueta: etiqueta || 'GENERAL',
    subidoPor: usuario,
    fechaSubida: new Date(),
  };
};

/** POST /api/sura/:id/archivos */
export const subirArchivoSura = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se proporcionó ningún archivo' });
    }

    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Sura no encontrado' });
    }

    const etiqueta = toStringOrNull(req.body?.etiqueta) || 'GENERAL';
    const archivo = buildArchivoFromUpload(req, etiqueta);
    caso.archivos = caso.archivos || [];
    caso.archivos.push(archivo);
    caso.fechaUltimoDocumento = new Date();
    await caso.save();

    const creado = caso.archivos[caso.archivos.length - 1];

    res.status(201).json({ success: true, data: creado, casoId: caso._id });
  } catch (error) {
    console.error('❌ Error subiendo archivo Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: error?.storageError
        ? 'Error al guardar el archivo en almacenamiento'
        : 'Error al subir el archivo',
      detalle: error.message,
    });
  }
};

/** PATCH /api/sura/:id/archivos/:archivoId — p.ej. descripción/leyenda de foto */
export const actualizarArchivoSura = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Sura no encontrado' });
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
    console.error('❌ Error actualizando archivo Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el archivo',
      detalle: error.message,
    });
  }
};

/** DELETE /api/sura/:id/archivos/:archivoId */
export const eliminarArchivoSura = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Sura no encontrado' });
    }

    const archivo = caso.archivos?.id?.(req.params.archivoId);
    if (!archivo) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    if (archivo.ruta) {
      await deleteStoredFile(archivo.ruta).catch((err) => {
        console.warn('No se pudo eliminar archivo Sura del almacenamiento:', err.message);
      });
    }
    archivo.deleteOne();
    await caso.save();

    res.json({ success: true, message: 'Archivo eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error eliminando archivo Seguros Sura:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el archivo',
      detalle: error.message,
    });
  }
};

/** GET /api/sura/:id/documentos-sharepoint — SURA aún no replica a SharePoint. */
export const listarDocumentosSharePointSura = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Sura no encontrado' });
    }
    return res.json({
      success: true,
      casoId: caso._id,
      documents: [],
      summary: { synced: 0, pending: 0, failed: 0, none: (caso.archivos || []).length },
      total: 0,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Error al obtener estado SharePoint',
      detalle: error.message,
    });
  }
};

/**
 * GET /api/sura/:id/polizas-importadas
 * Archivero unificado: ARNALD + importados Sura/SharePoint.
 */
export const listarPolizasImportadasSura = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Seguros Sura no encontrado' });
    }

    const polizasImportadas = [];
    const archivosCaso = (caso.archivos || []).map((arch) => {
      const estado = 'none';

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
        estadoLabel: '—',
        sharepoint: { webUrl: null, path: null },
        canRetry: false,
        archivoId: String(arch._id),
      };
    });

    const documentos = [...archivosCaso].sort(
      (a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0)
    );

    return res.json({
      success: true,
      casoId: caso._id,
      numeroPoliza: caso.numeroPoliza || null,
      archivosCaso,
      polizasImportadas,
      documentos,
    });
  } catch (error) {
    console.error('❌ Error listando pólizas importadas Sura:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener pólizas importadas',
      detalle: error.message,
    });
  }
};

const suraExcelNoConfigurado = (res) =>
  res.status(501).json({
    success: false,
    error: 'La importación Excel de SURA se hace desde el formulario (carga local). SharePoint aún no está configurado.',
    code: 'SURA_EXCEL_NOT_CONFIGURED',
  });

/** POST /api/sura/import/preview */
export const previewImportExcelSura = async (_req, res) => suraExcelNoConfigurado(res);

/** POST /api/sura/import/execute */
export const executeImportExcelSura = async (_req, res) => suraExcelNoConfigurado(res);

/** GET /api/sura/import/:importSessionId */
export const statusImportExcelSura = async (_req, res) => suraExcelNoConfigurado(res);

/** GET /api/sura/import/:importSessionId/report.xlsx */
export const reportImportExcelSura = async (_req, res) => suraExcelNoConfigurado(res);

/** POST /api/sura/:id/archivos/:archivoId/sharepoint/retry */
export const reintentarSyncSharePointSura = async (_req, res) =>
  res.status(501).json({
    success: false,
    error: 'SURA aún no replica documentos a SharePoint.',
    code: 'SURA_SHAREPOINT_NOT_CONFIGURED',
  });

/** GET /api/sura/alertas */
export const getAlertasSura = async (_req, res) => {
  try {
    const data = await obtenerAlertasSuraPorAjustadores();
    return res.json(data);
  } catch (error) {
    console.error('Error alertas Seguros Sura:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** POST /api/sura/alertas/enviar */
export const postEnviarAlertasSuraTodas = async (req, res) => {
  try {
    const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
    const data = await enviarAlertasTodosSura({ forzar });
    return res.json(data);
  } catch (error) {
    console.error('Error enviando alertas Sura (todas):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** POST /api/sura/alertas/enviar/:ajustador */
export const postEnviarAlertasSuraAjustador = async (req, res) => {
  try {
    const { ajustador } = req.params;
    if (!ajustador) {
      return res.status(400).json({ success: false, error: 'Código de ajustador requerido' });
    }
    const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
    const data = await enviarAlertasSuraAjustador(ajustador, { forzar });
    return res.json(data);
  } catch (error) {
    console.error('Error enviando alertas Sura (ajustador):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** GET /api/sura/control-seguimiento/status */
export const getControlSeguimientoSuraStatus = async (_req, res) => {
  return res.json({
    success: true,
    uiStatus: 'disabled',
    headline: 'Control y Seguimiento SURA pendiente de configurar',
    detail: 'La integración SharePoint de SURA se conectará en una siguiente etapa.',
    tone: 'neutral',
    canReview: false,
    canConfirm: false,
    source: null,
  });
};

/** POST /api/sura/control-seguimiento/check */
export const postControlSeguimientoSuraCheck = async (_req, res) => {
  return getControlSeguimientoSuraStatus(_req, res);
};

/** POST /api/sura/control-seguimiento/notification/dismiss */
export const postControlSeguimientoSuraDismissNotification = async (_req, res) => {
  return res.json({ success: true, dismissed: true });
};

/** POST /api/sura/geocode-pendientes — geocodifica predios sin coords (no SharePoint) */
export const postGeocodePendientesSura = async (req, res) => {
  try {
    const limit = req.body?.limit ?? req.query?.limit ?? 40;
    const force = req.body?.force === true || req.query?.force === 'true';
    const data = await geocodeCasosSuraPendientes({ limit, force });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error geocode pendientes Sura:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/sura/ubicaciones-predio
 * Aplica coords geocodificadas en el cliente (fallback si el backend no tiene API key).
 * Body: { items: [{ casoId, lat, lng, geocodeStatus, geocodeQuery, direccionHash }] }
 */
export const postUbicacionesPredioSura = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'items[] requerido' });
    }
    const data = await aplicarUbicacionesPredioSura(items);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error aplicando ubicaciones Sura:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** GET /api/sura/bloques-cercania?radioKm=2.5&ciudad=&estado= */
export const getBloquesCercaniaSura = async (req, res) => {
  try {
    const radioKm = req.query?.radioKm ?? 2.5;
    const ciudad = req.query?.ciudad || '';
    const estado = req.query?.estado || '';
    const data = await obtenerBloquesCercaniaSura({ radioKm, ciudad, estado });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error bloques cercanía Sura:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

const buscarCasoSuraPorAjuste = async ({ casoId, numeroCaso }) => {
  if (casoId && mongoose.Types.ObjectId.isValid(String(casoId))) {
    const porId = await SegurosSuraCaso.findById(casoId);
    if (porId) return porId;
  }
  const num = String(numeroCaso || '').trim();
  if (!num || num === 'Sin número') return null;
  return SegurosSuraCaso.findOne({
    $or: [{ nmroAjste: num }, { consecutivo: num }, { siniestro: num }],
  });
};

export const obtenerBandejaFacturacionSura = async (req, res) => {
  try {
    const login = String(req.query.login || '').trim();
    if (!usuarioPuedeVerBandejaFacturacion({ login })) {
      return res.status(403).json({
        success: false,
        error: 'No tiene permiso para consultar la bandeja de facturación',
      });
    }

    let gerente = normalizarClaveGerente(req.query.gerente);
    const esSupervisor = puedeElegirGerenteEnBandeja(login);
    if (!gerente) gerente = resolverGerenteDesdeLogin(login);
    if (!gerente) {
      if (esSupervisor) {
        return res.status(400).json({
          success: false,
          error: 'Seleccione el gerente o jefe para ver su bandeja',
        });
      }
      return res.status(403).json({
        success: false,
        error: 'Su usuario no está asociado a un jefe de facturación',
      });
    }

    const gerentePropio = resolverGerenteDesdeLogin(login);
    if (!esSupervisor && gerentePropio && gerente !== gerentePropio) {
      return res.status(403).json({
        success: false,
        error: 'Solo puede consultar su propia bandeja',
      });
    }

    let responsables = [];
    let estados = [];
    let aseguradoras = [];
    try {
      [responsables, estados, aseguradoras] = await Promise.all([
        Responsable.find().select('codiRespnsble nmbrRespnsble').lean(),
        Estado.find().select('codiEstdo codiEstado descEstdo descEstado descripcion').lean(),
        Cliente.find().select('codiAsgrdra cod1Asgrdra rzonSocial').lean(),
      ]);
    } catch (errCat) {
      console.warn('⚠️ Bandeja facturación SURA: catálogos parciales:', errCat.message);
    }

    const resultado = await listarBandejaFacturacion({
      gerente,
      tipo: req.query.tipo || 'todos',
      desde: req.query.desde,
      hasta: req.query.hasta,
      q: req.query.q,
      responsables,
      estados,
      aseguradoras,
      coleccion: 'sura',
    });

    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error obteniendo bandeja de facturación SURA:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const corregirEnvioBandejaFacturacionSura = async (req, res) => {
  try {
    const login = String(req.body?.login || req.query?.login || '').trim();
    if (!puedeAdministrarBandejaFacturacion(login)) {
      return res.status(403).json({
        success: false,
        error: 'Solo el supervisor autorizado puede corregir envíos de la bandeja',
      });
    }
    const { casoId, nuevoGerente, envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor } =
      req.body || {};
    const resultado = await corregirDestinatarioEnvioFacturacion({
      casoId,
      nuevoGerente,
      corregidoPor: login,
      selector: { envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor },
    });
    if (!resultado.ok) {
      const status =
        resultado.motivo === 'caso_no_encontrado' || resultado.motivo === 'envio_no_encontrado'
          ? 404
          : 400;
      return res.status(status).json({ success: false, error: resultado.motivo });
    }
    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error corrigiendo envío bandeja SURA:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const eliminarEnvioBandejaFacturacionSura = async (req, res) => {
  try {
    const login = String(req.body?.login || req.query?.login || '').trim();
    if (!puedeAdministrarBandejaFacturacion(login)) {
      return res.status(403).json({
        success: false,
        error: 'Solo el supervisor autorizado puede eliminar registros de la bandeja',
      });
    }
    const { casoId, envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor } =
      req.body || {};
    const resultado = await eliminarRegistroEnvioFacturacion({
      casoId,
      eliminadoPor: login,
      selector: { envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor },
    });
    if (!resultado.ok) {
      const status =
        resultado.motivo === 'caso_no_encontrado' || resultado.motivo === 'envio_no_encontrado'
          ? 404
          : 400;
      return res.status(status).json({ success: false, error: resultado.motivo });
    }
    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error eliminando envío bandeja SURA:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const notificarHonorariosSura = async (req, res) => {
  try {
    const { numeroCaso, numeroSiniestro, responsable, archivos = [], usuario } = req.body || {};
    if (!archivos.length) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron archivos para notificar' });
    }
    const resultado = await enviarNotificacionHonorarios({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      usuario,
    });
    res.json({ success: true, resultado });
  } catch (error) {
    console.error('❌ Error enviando notificación de honorarios SURA:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const notificarControlHorasSura = async (req, res) => {
  try {
    const {
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos = [],
      archivosConRuta = [],
      controlHoras,
      resumenControlHoras,
      usuario,
      gerente,
      casoId,
    } = req.body || {};

    const tieneArchivos = archivos.length > 0 || archivosConRuta.length > 0;
    const tieneControlHorasRegistrado = Boolean(controlHoras?.filas?.length);
    if (!tieneArchivos && !tieneControlHorasRegistrado) {
      return res.status(400).json({
        success: false,
        error: 'Debe registrar el control de horas en el sistema o adjuntar documentos para notificar',
      });
    }
    if (!gerente) {
      return res.status(400).json({ success: false, error: 'No se especificó el gerente destinatario' });
    }
    const gerenteNorm = normalizarClaveGerente(gerente);
    if (gerenteNorm === 'adriana') {
      return res.status(400).json({
        success: false,
        error:
          'Facturación no recibe el control de horas en esta fase. Envíe la evidencia en "Envío de Control de Horas" (fase 2) y seleccione a Adriana.',
      });
    }

    const resultado = await enviarNotificacionControlHoras({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      archivosConRuta,
      controlHoras: tieneControlHorasRegistrado ? controlHoras : null,
      resumenControlHoras,
      usuario,
      gerente,
      casoId,
    });

    let persistencia = null;
    if (resultado?.success !== false) {
      persistencia = await persistirEnvioFacturacionTrasCorreo({
        casoId,
        numeroCaso,
        tipo: 'control_horas',
        gerente,
        usuario,
        emailDestinatario: resultado.destinatarioPrincipal,
        copias: [],
        controlHoras: tieneControlHorasRegistrado ? controlHoras : null,
        resumenControlHoras,
      });
    }

    res.json({
      success: true,
      resultado,
      envioRegistrado: Boolean(persistencia?.ok),
      casoId: persistencia?.casoId || casoId || null,
      motivoNoRegistro: persistencia?.ok ? undefined : persistencia?.motivo,
    });
  } catch (error) {
    console.error('❌ Error enviando notificación de control de horas SURA:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const notificarGerenciaSura = async (req, res) => {
  try {
    const {
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos = [],
      archivosConRuta = [],
      usuario,
      gerente,
      casoId,
    } = req.body || {};

    if (!archivos.length && !archivosConRuta.length) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron archivos para notificar' });
    }
    if (!gerente) {
      return res.status(400).json({ success: false, error: 'No se especificó el gerente destinatario' });
    }

    const gerenteNorm = String(gerente || '').trim().toLowerCase();
    const esFacturacion =
      gerenteNorm === 'adriana' ||
      gerenteNorm.includes('adriana') ||
      gerenteNorm.includes('facturacion');
    const emailFacturacion =
      process.env.EMAIL_FACTURACION_AJUSTES?.trim() ||
      'facturacion.ajustes@proserpuertos.com.co';

    const resultado = await enviarNotificacionGerencia({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      archivosConRuta,
      usuario,
      gerente,
      casoId,
      ...(esFacturacion && {
        emailDestinatario: emailFacturacion,
        nombreDestinatario: 'Adriana Angulo Funes',
      }),
    });

    let persistencia = null;
    if (resultado?.success !== false) {
      persistencia = await persistirEnvioFacturacionTrasCorreo({
        casoId,
        numeroCaso,
        tipo: 'gerencia',
        gerente: esFacturacion ? 'adriana' : gerente,
        usuario,
        emailDestinatario:
          resultado?.destinatarios?.[0] || resultado?.destinatarioPrincipal || emailFacturacion,
        nombreDestinatario: esFacturacion ? 'Adriana Angulo Funes' : undefined,
      });
    }

    res.json({
      success: true,
      resultado,
      emailEnviado: resultado?.destinatarios?.[0] || resultado?.destinatarioPrincipal,
      envioRegistrado: Boolean(persistencia?.ok),
      casoId: persistencia?.casoId || casoId || null,
      motivoNoRegistro: persistencia?.ok ? undefined : persistencia?.motivo,
    });
  } catch (error) {
    console.error('❌ Error enviando notificación de gerencia SURA:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

async function resolverEmailAjustadorSura(codiRespnsble) {
  const codigo = String(codiRespnsble || '').trim();
  if (!codigo) return { email: '', nombre: '' };

  const responsable = await Responsable.findOne({ codiRespnsble: codigo }).lean();
  if (responsable?.email?.trim()) {
    return { email: responsable.email.trim(), nombre: responsable.nmbrRespnsble || codigo };
  }

  const usuario = await SecurUser.findOne({ $or: [{ login: codigo }, { cedula: codigo }] }).lean();
  return {
    email: usuario?.email?.trim() || '',
    nombre: usuario?.nombre || usuario?.name || codigo,
  };
}

export const solicitarCorreccionControlHorasSura = async (req, res) => {
  try {
    const { casoId, numeroCaso, mensaje, solicitadoPor, solicitadoPorNombre } = req.body || {};
    if (!casoId && !numeroCaso) {
      return res.status(400).json({
        success: false,
        error: 'Debe indicar el caso (casoId o numeroCaso)',
      });
    }

    const caso = await buscarCasoSuraPorAjuste({ casoId, numeroCaso });
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso SURA no encontrado' });
    }

    const { email, nombre } = await resolverEmailAjustadorSura(caso.codiRespnsble || caso.ajustador);
    if (!email) {
      return res.status(400).json({
        success: false,
        error:
          'El ajustador del caso no tiene correo registrado. Contacte al responsable o actualice su correo en el catálogo.',
      });
    }

    const resultado = await enviarSolicitudCorreccionControlHoras({
      casoId: String(caso._id),
      numeroCaso: caso.nmroAjste || caso.consecutivo || numeroCaso,
      numeroSiniestro: caso.nmroSinstro || caso.siniestro,
      emailDestino: email,
      nombreAjustador: nombre,
      mensaje,
      solicitadoPor: solicitadoPor || req.headers['x-usuario-login'] || '',
      solicitadoPorNombre:
        solicitadoPorNombre || req.headers['x-usuario-nombre'] || solicitadoPor || '',
    });

    return res.json({
      success: true,
      resultado,
      emailEnviado: email,
      ajustador: nombre,
    });
  } catch (error) {
    console.error('❌ Error solicitando corrección de control de horas SURA:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
