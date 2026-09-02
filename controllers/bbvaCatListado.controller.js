import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { resolverAsignacionCatastrofico } from '../utils/resolverAsignacionCatastrofico.js';
import { resolverLiquidadorParaUpdate } from '../utils/protegerPresupuestoNsr10.js';
import { aplicarFechaAccionEstadoBbvaCat, homologarEstadoBbvaCat } from '../utils/estadosBbvaCat.js';
import { homologarCiudadBbvaCat } from '../utils/ciudadesBbvaCat.js';
import { crearControladoresArchivosListado } from '../utils/archivosCasoListado.js';
import { rutaArchivoSigueEnUsoBbvaCat } from '../utils/espejarArchivoBbvaCatEnListado.js';
import { mapearFranjaAgenda } from '../utils/agendaCatastrofico.js';
import { rechazarSiFranjaOcupada } from '../services/agendaCatastroficoService.js';
import { aplicarValorLiquidadoDesdeLiquidadorBbva } from '../utils/valoresLiquidadorBbvaCat.js';

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
    causa: pick(data.causa, base.causa ?? null),
    asegurado: pick(data.asegurado, base.asegurado ?? null),
    intermediario: pick(data.intermediario, base.intermediario ?? null),
    correoIntermediario: pick(data.correoIntermediario, base.correoIntermediario ?? null),
    telefonoIntermediario: pick(data.telefonoIntermediario, base.telefonoIntermediario ?? null),
    contactoIntermediario: pick(data.contactoIntermediario, base.contactoIntermediario ?? null),
    correoAsegurado: pick(data.correoAsegurado, base.correoAsegurado ?? null),
    telefonoAsegurado: pick(data.telefonoAsegurado, base.telefonoAsegurado ?? null),
    contactoAsegurado: pick(data.contactoAsegurado, base.contactoAsegurado ?? null),
    observaciones: pick(data.observaciones, base.observaciones ?? null),
    ciudad: homologarCiudadBbvaCat(pick(data.ciudad, base.ciudad ?? null)) || pick(data.ciudad, base.ciudad ?? null),
    departamento: pick(data.departamento, base.departamento ?? null),
    ajustadorLider: pick(data.ajustadorLider, base.ajustadorLider ?? null),
    ajustador: pick(data.ajustador, base.ajustador ?? null),
    inspector: pick(data.inspector, base.inspector ?? null),
    fechaAsignacion: pickFecha(data.fechaAsignacion, base.fechaAsignacion ?? null),
    fechaVisita: pickFecha(data.fechaVisita, base.fechaVisita ?? null),
    reserva:
      data.reserva !== undefined
        ? parseNumero(data.reserva, base.reserva ?? null)
        : (base.reserva ?? null),
    valorEstimadoAseguradora: parseNumero(
      data.valorEstimadoAseguradora,
      base.valorEstimadoAseguradora ?? null
    ),
    valorAseguradoInmueble: parseNumero(
      data.valorAseguradoInmueble,
      base.valorAseguradoInmueble ?? null
    ),
    valorReclamado: parseNumero(data.valorReclamado, base.valorReclamado ?? null),
    valorLiquidado: parseNumero(data.valorLiquidado, base.valorLiquidado ?? null),
    valorALiquidar: parseNumero(data.valorALiquidar, base.valorALiquidar ?? null),
    valorAseguradoContenidos: parseNumero(
      data.valorAseguradoContenidos,
      base.valorAseguradoContenidos ?? null
    ),
    valorReservaPreventivaPromedio: parseNumero(
      data.valorReservaPreventivaPromedio,
      base.valorReservaPreventivaPromedio ?? null
    ),
    valorComercialInmueble: parseNumero(
      data.valorComercialInmueble,
      base.valorComercialInmueble ?? null
    ),
    observacionReserva: pick(data.observacionReserva, base.observacionReserva ?? null),
    estado: homologarEstadoBbvaCat(pick(data.estado, base.estado ?? 'CASO NUEVO') || 'CASO NUEVO'),
    modalidadAtencion: pick(data.modalidadAtencion, base.modalidadAtencion ?? null),
    fechaCasoNuevo: pickFecha(data.fechaCasoNuevo, base.fechaCasoNuevo ?? null),
    fechaCoordinandoInspeccion: pickFecha(
      data.fechaCoordinandoInspeccion,
      base.fechaCoordinandoInspeccion ?? null
    ),
    ...mapearFranjaAgenda(data, base, pick),
    fechaAnalisisCaso: pickFecha(data.fechaAnalisisCaso, base.fechaAnalisisCaso ?? null),
    fechaSolicitudDocumento: pickFecha(
      data.fechaSolicitudDocumento,
      base.fechaSolicitudDocumento ?? null
    ),
    fechaRecepcionDocumento: pickFecha(
      data.fechaRecepcionDocumento,
      base.fechaRecepcionDocumento ?? null
    ),
    fechaObjecion: pickFecha(data.fechaObjecion, base.fechaObjecion ?? null),
    fechaObjetado: pickFecha(data.fechaObjetado, base.fechaObjetado ?? null),
    fechaAutorizacionAnalista: pickFecha(
      data.fechaAutorizacionAnalista,
      base.fechaAutorizacionAnalista ?? null
    ),
    fechaCasoParaPago: pickFecha(data.fechaCasoParaPago, base.fechaCasoParaPago ?? null),
    fechaCasoPagado: pickFecha(data.fechaCasoPagado, base.fechaCasoPagado ?? null),
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
    informeUnico: pickObjeto(data.informeUnico, base.informeUnico ?? null),
  });
  aplicarValorLiquidadoDesdeLiquidadorBbva(payload);
  return aplicarFechaAccionEstadoBbvaCat(
    armarContactoAsegurado(armarContactoIntermediario(payload)),
    base
  );
};

const obtenerMaxSecuencial = async () => {
  const patron = /^BBVA-CAT-LST-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await BbvaCatListadoCaso.find({
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
  return `BBVA-CAT-LST-${año}-${mes}-${max + 1}`;
};

export const crearCasoListadoBbvaCat = async (req, res) => {
  try {
    const payload = buildPayload(req.body, {}, { pisar: true });
    if (!payload.zc && !payload.siniestro) {
      return res.status(400).json({
        success: false,
        error: 'Indique ZC o STRO (siniestro)',
      });
    }
    payload.consecutivo = await generarConsecutivo();
    if (await rechazarSiFranjaOcupada(res, payload)) return;
    const documento = await BbvaCatListadoCaso.create(payload);
    res.status(201).json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al crear caso listado BbvaCat:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar el caso del listado BbvaCat',
      detalle: error.message,
    });
  }
};

export const listarCasosListadoBbvaCat = async (req, res) => {
  try {
    const { limit = 25, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [total, documentos] = await Promise.all([
      BbvaCatListadoCaso.countDocuments({}),
      BbvaCatListadoCaso.find({})
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
    console.error('❌ Error al listar listado BbvaCat:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener los casos del listado BbvaCat',
      detalle: error.message,
    });
  }
};

export const obtenerCasoListadoBbvaCat = async (req, res) => {
  try {
    const documento = await BbvaCatListadoCaso.findById(req.params.id);
    if (!documento) {
      return res.status(404).json({ success: false, error: 'Caso del listado no encontrado' });
    }
    res.json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al obtener listado BbvaCat:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener el caso del listado BbvaCat',
      detalle: error.message,
    });
  }
};

export const actualizarCasoListadoBbvaCat = async (req, res) => {
  try {
    const actual = await BbvaCatListadoCaso.findById(req.params.id);
    if (!actual) {
      return res.status(404).json({ success: false, error: 'Caso del listado no encontrado' });
    }
    const payload = buildPayload(req.body, actual.toObject(), { pisar: true });
    if (!payload.consecutivo) payload.consecutivo = actual.consecutivo || (await generarConsecutivo());
    if (await rechazarSiFranjaOcupada(res, payload, { excludeId: actual._id })) return;
    const actualizado = await BbvaCatListadoCaso.findByIdAndUpdate(
      actual._id,
      { $set: payload },
      { new: true, runValidators: false }
    );
    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('❌ Error al actualizar listado BbvaCat:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el caso del listado BbvaCat',
      detalle: error.message,
    });
  }
};

export const eliminarCasoListadoBbvaCat = async (req, res) => {
  try {
    const registro = await BbvaCatListadoCaso.findById(req.params.id);
    if (!registro) {
      return res.status(404).json({ success: false, error: 'Caso del listado no encontrado' });
    }
    await BbvaCatListadoCaso.deleteOne({ _id: registro._id });
    res.json({ success: true, message: 'Caso del listado eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar listado BbvaCat:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el caso del listado BbvaCat',
      detalle: error.message,
    });
  }
};

/**
 * Importación del listado cliente. Empareja SOLO por ZC.
 * No toca gsk3cAppbbvaCatCasos (inspección CAT).
 */
export const importarCasosListadoBbvaCat = async (req, res) => {
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

    const existentes = await BbvaCatListadoCaso.find().lean();
    const ajustadoresRaw = await AjustadorCatastrofico.find({}).lean();
    const esBbva = (d) =>
      (d.modulos || []).some(
        (m) => String(m).toLowerCase().replace(/[-_\s]/g, '') === 'bbvacat'
      );
    const ajustadores = ajustadoresRaw.filter(esBbva);
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
          inspectorExcel: '',
          ajustadorExcel: filas[i]?.ajustador || filas[i]?.inspector,
          inspectores: [],
          ajustadores,
        });
        const payload = buildPayload({
          ...filas[i],
          inspector: null,
          ajustador: asignacion.ajustador,
          estado: homologarEstadoBbvaCat(filas[i]?.estado),
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
            merge.consecutivo = `BBVA-CAT-LST-${año}-${mes}-${secuencial}`;
          }
          const actualizado = await BbvaCatListadoCaso.findByIdAndUpdate(existente._id, merge, {
            new: true,
          }).lean();
          resumen.actualizados += 1;
          if (clave) indice.set(clave, actualizado);
        } else {
          secuencial += 1;
          payload.consecutivo = `BBVA-CAT-LST-${año}-${mes}-${secuencial}`;
          const creado = await BbvaCatListadoCaso.create(payload);
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
    console.error('❌ Error al importar listado BbvaCat:', error);
    res.status(500).json({
      success: false,
      error: 'Error al importar el listado BbvaCat',
      detalle: error.message,
    });
  }
};

const archivosListadoBbvaCat = crearControladoresArchivosListado({
  Model: BbvaCatListadoCaso,
  nombreModulo: 'BBVA CAT',
  rutaLocalPrefix: '/uploads/bbva-cat/',
  skipDeleteStorage: async (ruta, caso) =>
    rutaArchivoSigueEnUsoBbvaCat(ruta, { coleccion: 'listado', casoId: caso?._id }),
});

export const subirArchivoListadoBbvaCat = archivosListadoBbvaCat.subir;
export const eliminarArchivoListadoBbvaCat = archivosListadoBbvaCat.eliminar;

