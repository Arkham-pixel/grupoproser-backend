import mongoose from 'mongoose';
import SiniestroExpress from '../models/SiniestroExpress.js';
import {
  buildCatalogMaps,
  normalizarConMapas,
} from '../services/expressCatalogoService.js';
import { normalizarResponsable } from '../services/responsableResolverService.js';
import { normalizarAseguradora } from '../services/clienteResolverService.js';
import { normalizarEstadoExpress } from '../services/estadoExpressResolverService.js';
import { deleteStoredFile, getPublicPathForField } from '../services/fileStorageService.js';
import {
  collectPathsFromExpressAnexos,
  deleteOrphanedStoredFiles,
} from '../utils/storedFileCleanup.js';

const borrarArchivoFisicoExpress = async (url) => {
  if (!url || typeof url !== 'string') return;
  await deleteStoredFile(url).catch(() => {});
};

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

const parseNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
};

const parseDateFlexible = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  const parsed = parseDate(value);
  return parsed ?? fallback ?? null;
};

const parseNumberFlexible = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  const parsed = parseNumber(value);
  return parsed ?? fallback ?? null;
};

const toStringOrNull = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  return String(value).trim();
};

const cleanRelativeUrl = (valor = '') => {
  if (!valor || typeof valor !== 'string') return '';
  let url = valor;
  if (url.startsWith('http')) {
    try {
      const parsed = new URL(url);
      url = parsed.pathname || '';
    } catch {
      // Ignorar errores y mantener la URL original
    }
  }
  if (!url.startsWith('/')) {
    url = `/${url}`;
  }
  return url.replace(/\/{2,}/g, '/');
};

const parseAnexosExistentes = (valor) => {
  if (valor === undefined || valor === null) return [];
  let lista = valor;
  if (typeof valor === 'string') {
    try {
      lista = JSON.parse(valor);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(lista)) return [];
  return lista
    .map((anexo, index) => {
      if (!anexo) return null;
      const url = cleanRelativeUrl(anexo.url || anexo.ruta || anexo.path || '');
      if (!url) return null;
      const nombre =
        anexo.nombre ||
        anexo.fileName ||
        anexo.originalname ||
        url.split('/').pop() ||
        `Anexo-${index + 1}`;
      const tamanoBase = anexo.tamano ?? anexo.size ?? null;
      const tamano =
        tamanoBase === null || tamanoBase === undefined ? undefined : Number(tamanoBase) || undefined;
      const fechaSubidaValor = anexo.fechaSubida ?? anexo.fecha_subida ?? null;
      const fechaSubida = fechaSubidaValor ? parseDateFlexible(fechaSubidaValor, undefined) : undefined;
      return {
        nombre,
        url,
        tamano,
        tipo: anexo.tipo ?? anexo.mime ?? anexo.mimetype ?? '',
        ...(fechaSubida ? { fechaSubida } : {}),
      };
    })
    .filter(Boolean);
};

/** Formato: EXP-YYYY-MM-N (asignado solo al crear; no editable por el usuario) */
const generarConsecutivoExpress = async () => {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const patronNuevo = /^EXP-(\d{4})-(\d{2})-(\d+)$/i;

  const registros = await SiniestroExpress.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();

  let maxSecuencial = 0;
  for (const reg of registros) {
    const valor = String(reg.consecutivo || '').trim();
    const match = valor.match(patronNuevo);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > maxSecuencial) maxSecuencial = n;
    } else if (/^\d+$/.test(valor)) {
      const n = parseInt(valor, 10);
      if (!Number.isNaN(n) && n > maxSecuencial) maxSecuencial = n;
    }
  }

  return `EXP-${año}-${mes}-${maxSecuencial + 1}`;
};

const mapArchivoSubido = (req, file, fieldName) => {
  const files = req.files?.[fieldName] || [];
  const index = Math.max(0, files.indexOf(file));
  const url =
    getPublicPathForField(req, fieldName, index, (f) => `/uploads/express/${f.filename}`) ||
    `/uploads/express/${file.filename}`;
  return {
    nombre: file.originalname,
    url,
    tamano: file.size,
    tipo: file.mimetype,
  };
};

const mapArchivosSubidos = (req, filesPayload = {}) => {
  const listaAnexos = Array.isArray(filesPayload.anexos) ? filesPayload.anexos : [];
  const listaSalvamento = Array.isArray(filesPayload.salvamentoAnexos)
    ? filesPayload.salvamentoAnexos
    : [];
  return {
    anexos: listaAnexos.map((file) => mapArchivoSubido(req, file, 'anexos')),
    anexosSalvamento: listaSalvamento.map((file) => mapArchivoSubido(req, file, 'salvamentoAnexos')),
  };
};

const normalizarSalvamentoEnPayload = (payload) => {
  if (payload.salvamentoAplica === 'no_aplica') {
    payload.valorSalvamento = null;
    payload.anexosSalvamento = [];
  }
  return payload;
};

const asegurarConsecutivo = async (payload, base = {}) => {
  if (!payload.consecutivo && !base.consecutivo) {
    payload.consecutivo = await generarConsecutivoExpress();
  } else if (!payload.consecutivo && base.consecutivo) {
    payload.consecutivo = base.consecutivo;
  }
  return payload;
};

/** Localiza registro por ObjectId, _id numérico legacy o campo id */
const buscarSiniestroExpressPorId = async (idParam) => {
  if (idParam == null || idParam === '') return null;
  const id = String(idParam).trim();

  if (mongoose.Types.ObjectId.isValid(id)) {
    const porObjectId = await SiniestroExpress.findById(id);
    if (porObjectId) return porObjectId;
  }

  const numerico = Number(id);
  if (!Number.isNaN(numerico) && String(numerico) === id) {
    const porIdNumerico = await SiniestroExpress.findOne({ _id: numerico });
    if (porIdNumerico) return porIdNumerico;
    const porCampoId = await SiniestroExpress.findOne({ id: numerico });
    if (porCampoId) return porCampoId;
  }

  const porCampoIdTexto = await SiniestroExpress.findOne({ id });
  if (porCampoIdTexto) return porCampoIdTexto;

  return null;
};

const validarSalvamentoAplica = (valor) => {
  const v = toStringOrNull(valor);
  if (!v || (v !== 'aplica' && v !== 'no_aplica')) {
    return 'debe indicar si el salvamento aplica o no aplica';
  }
  return null;
};

const buildExpressPayload = (
  data = {},
  { anexos = [], anexosSalvamento = [] } = {},
  base = {}
) => ({
  consecutivo: base.consecutivo ?? null,
  responsable: toStringOrNull(data.responsable, base.responsable ?? null),
  codigoWorkflow: toStringOrNull(data.codigoWorkflow, base.codigoWorkflow ?? null),
  numeroSiniestro: toStringOrNull(data.numeroSiniestro, base.numeroSiniestro ?? null),
  fechaSiniestro: parseDateFlexible(data.fechaSiniestro, base.fechaSiniestro ?? null),
  avisoSiniestro: parseDateFlexible(data.avisoSiniestro, base.avisoSiniestro ?? null),
  avisoSiniestroCompania: parseDateFlexible(
    data.avisoSiniestroCompania,
    base.avisoSiniestroCompania ?? null
  ),
  fechaReciboDocumentos: parseDateFlexible(
    data.fechaReciboDocumentos,
    base.fechaReciboDocumentos ?? null
  ),
  fechaCargueFiniquito: parseDateFlexible(
    data.fechaCargueFiniquito,
    base.fechaCargueFiniquito ?? null
  ),
  amparo: toStringOrNull(data.amparo, base.amparo ?? null),
  valorIndemnizacion: parseNumberFlexible(
    data.valorIndemnizacion,
    base.valorIndemnizacion ?? null
  ),
  observacionesSeguimiento: toStringOrNull(
    data.observacionesSeguimiento,
    base.observacionesSeguimiento ?? null
  ),
  anexos,
  anexosSalvamento,
  aseguradora: toStringOrNull(data.aseguradora, base.aseguradora ?? null),
  intermediario: toStringOrNull(data.intermediario, base.intermediario ?? null),
  ciudadSiniestro: toStringOrNull(data.ciudadSiniestro, base.ciudadSiniestro ?? null),
  aseguradoBeneficiario: toStringOrNull(
    data.aseguradoBeneficiario,
    base.aseguradoBeneficiario ?? null
  ),
  nit: toStringOrNull(data.nit, base.nit ?? null),
  analista: toStringOrNull(data.analista, base.analista ?? null),
  fechaEnvioAutorizacion: parseDateFlexible(
    data.fechaEnvioAutorizacion,
    base.fechaEnvioAutorizacion ?? null
  ),
  fechaRespuestaAnalista: parseDateFlexible(
    data.fechaRespuestaAnalista,
    base.fechaRespuestaAnalista ?? null
  ),
  correoNotificacion: toStringOrNull(data.correoNotificacion, base.correoNotificacion ?? null),
  fechaCierre: parseDateFlexible(data.fechaCierre, base.fechaCierre ?? null),
  fechaSolicitudDocumentos: parseDateFlexible(
    data.fechaSolicitudDocumentos,
    base.fechaSolicitudDocumentos ?? null
  ),
  fechaPresentacionCifras: parseDateFlexible(
    data.fechaPresentacionCifras,
    base.fechaPresentacionCifras ?? null
  ),
  fechaFiniquitosFirmado: parseDateFlexible(
    data.fechaFiniquitosFirmado,
    base.fechaFiniquitosFirmado ?? null
  ),
  reserva: parseNumberFlexible(data.reserva, base.reserva ?? null),
  estadoProceso: toStringOrNull(data.estadoProceso, base.estadoProceso ?? null),
  salvamentoAplica: toStringOrNull(data.salvamentoAplica, base.salvamentoAplica ?? null),
  valorSalvamento: parseNumberFlexible(data.valorSalvamento, base.valorSalvamento ?? null),
});

const aplicarCatalogosExpress = async (payload) => {
  const maps = await buildCatalogMaps();
  for (const tipo of ['amparo', 'analista', 'intermediario']) {
    const raw = payload[tipo];
    if (raw) {
      payload[tipo] = normalizarConMapas(maps, tipo, raw) ?? raw;
    }
  }
  if (payload.responsable) {
    payload.responsable = await normalizarResponsable(payload.responsable);
  }
  if (payload.aseguradora) {
    payload.aseguradora = await normalizarAseguradora(payload.aseguradora);
  }
  if (payload.estadoProceso) {
    payload.estadoProceso = await normalizarEstadoExpress(payload.estadoProceso);
  }
  return payload;
};

export const crearSiniestroExpress = async (req, res) => {
  try {
    const { anexos, anexosSalvamento } = mapArchivosSubidos(req, req.files || {});

    const payload = await aplicarCatalogosExpress(
      normalizarSalvamentoEnPayload(
        buildExpressPayload(req.body, { anexos, anexosSalvamento })
      )
    );
    await asegurarConsecutivo(payload);

    const errorSalvamento = validarSalvamentoAplica(payload.salvamentoAplica);
    if (errorSalvamento) {
      return res.status(400).json({
        success: false,
        error: `Salvamento: ${errorSalvamento}.`,
      });
    }

    const camposRequeridos = [
      ['numeroSiniestro', 'número de siniestro'],
      ['amparo', 'amparo'],
      ['aseguradora', 'aseguradora'],
      ['ciudadSiniestro', 'ciudad del siniestro'],
      ['aseguradoBeneficiario', 'asegurado / beneficiario'],
      ['estadoProceso', 'estado del proceso'],
    ];

    const faltantes = camposRequeridos
      .map(([campo, etiqueta]) => (!payload[campo] ? etiqueta : null))
      .filter(Boolean);

    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    const documento = await SiniestroExpress.create(payload);
    res.status(201).json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al crear siniestro express:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar el siniestro express',
      detalle: error.message,
    });
  }
};

export const listarSiniestrosExpress = async (req, res) => {
  try {
    const { limit = 25, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [total, documentos] = await Promise.all([
      SiniestroExpress.countDocuments(),
      SiniestroExpress.find()
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
    console.error('❌ Error al listar siniestros express:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener los siniestros express',
      detalle: error.message,
    });
  }
};

export const actualizarSiniestroExpress = async (req, res) => {
  try {
    const { id } = req.params;
    const registroActual = await buscarSiniestroExpressPorId(id);

    if (!registroActual) {
      return res.status(404).json({
        success: false,
        error: 'Siniestro express no encontrado',
      });
    }

    const anexosExistentes = parseAnexosExistentes(req.body.anexosExistentes);
    const salvamentoExistentes = parseAnexosExistentes(req.body.salvamentoAnexosExistentes);
    const { anexos: anexosNuevos, anexosSalvamento: salvamentoNuevos } = mapArchivosSubidos(
      req,
      req.files || {}
    );

    const tieneCampoAnexos = Object.prototype.hasOwnProperty.call(req.body, 'anexosExistentes');
    let anexosFinales;
    if (tieneCampoAnexos) {
      anexosFinales = [...anexosExistentes, ...anexosNuevos];
    } else if (anexosNuevos.length > 0) {
      anexosFinales = [...(registroActual.anexos ?? []), ...anexosNuevos];
    } else {
      anexosFinales = registroActual.anexos ?? [];
    }

    const tieneCampoSalvamentoAnexos = Object.prototype.hasOwnProperty.call(
      req.body,
      'salvamentoAnexosExistentes'
    );
    let anexosSalvamentoFinales;
    if (tieneCampoSalvamentoAnexos) {
      anexosSalvamentoFinales = [...salvamentoExistentes, ...salvamentoNuevos];
    } else if (salvamentoNuevos.length > 0) {
      anexosSalvamentoFinales = [...(registroActual.anexosSalvamento ?? []), ...salvamentoNuevos];
    } else {
      anexosSalvamentoFinales = registroActual.anexosSalvamento ?? [];
    }

    const base = registroActual.toObject();
    const payload = await aplicarCatalogosExpress(
      normalizarSalvamentoEnPayload(
        buildExpressPayload(
          req.body,
          { anexos: anexosFinales, anexosSalvamento: anexosSalvamentoFinales },
          base
        )
      )
    );
    await asegurarConsecutivo(payload, base);

    const errorSalvamento = validarSalvamentoAplica(payload.salvamentoAplica);
    if (errorSalvamento) {
      return res.status(400).json({
        success: false,
        error: `Salvamento: ${errorSalvamento}.`,
      });
    }

    const camposRequeridos = [
      ['numeroSiniestro', 'número de siniestro'],
      ['amparo', 'amparo'],
      ['aseguradora', 'aseguradora'],
      ['ciudadSiniestro', 'ciudad del siniestro'],
      ['aseguradoBeneficiario', 'asegurado / beneficiario'],
      ['estadoProceso', 'estado del proceso'],
    ];

    const faltantes = camposRequeridos
      .map(([campo, etiqueta]) => (!payload[campo] ? etiqueta : null))
      .filter(Boolean);

    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    if (tieneCampoAnexos || tieneCampoSalvamentoAnexos) {
      const rutasAnteriores = [
        ...collectPathsFromExpressAnexos(registroActual.anexos),
        ...collectPathsFromExpressAnexos(registroActual.anexosSalvamento),
      ];
      const rutasNuevas = [
        ...collectPathsFromExpressAnexos(anexosFinales),
        ...collectPathsFromExpressAnexos(anexosSalvamentoFinales),
      ];
      await deleteOrphanedStoredFiles(rutasAnteriores, rutasNuevas).catch(() => {});
    }

    const actualizado = await SiniestroExpress.findByIdAndUpdate(registroActual._id, payload, {
      new: true,
    });

    res.json({
      success: true,
      data: actualizado,
    });
  } catch (error) {
    console.error('❌ Error al actualizar siniestro express:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el siniestro express',
      detalle: error.message,
    });
  }
};

export const eliminarSiniestroExpress = async (req, res) => {
  try {
    const { id } = req.params;
    const registro = await buscarSiniestroExpressPorId(id);

    if (!registro) {
      return res.status(404).json({
        success: false,
        error: 'Siniestro express no encontrado',
      });
    }

    const todosAnexos = [...(registro.anexos ?? []), ...(registro.anexosSalvamento ?? [])];
    await Promise.all(todosAnexos.map((anexo) => borrarArchivoFisicoExpress(anexo?.url)));

    await SiniestroExpress.deleteOne({ _id: registro._id });

    res.json({
      success: true,
      message: 'Siniestro express eliminado correctamente',
    });
  } catch (error) {
    console.error('❌ Error al eliminar siniestro express:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el siniestro express',
      detalle: error.message,
    });
  }
};

