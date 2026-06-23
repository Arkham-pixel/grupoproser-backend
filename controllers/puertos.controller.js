import mongoose from 'mongoose';
import PuertosCaso from '../models/PuertosCaso.js';
import PuertosActa from '../models/PuertosActa.js';
import {
  deleteOrphanedStoredFiles,
  isStoredFileReference,
} from '../services/fileStorageService.js';

const CAMPOS_FECHA = [
  'fchaAsgncion',
  'fchaContIni',
  'fchaCoordInspeccion',
  'fchaProgInspeccion',
  'fchaInspccion',
  'fchaInfoFnal',
  'fchaFactra',
  'fechaActa',
  'fechaLlegada',
  'fechaConstruccion',
  'fechaInforme',
];

const convertirFechaLocal = (fechaString) => {
  if (!fechaString || fechaString === '' || fechaString === null || fechaString === undefined) {
    return null;
  }
  if (fechaString instanceof Date) {
    return fechaString;
  }
  const fechaStr = String(fechaString).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
    const [año, mes, dia] = fechaStr.split('-').map(Number);
    return new Date(año, mes - 1, dia, 12, 0, 0);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(fechaStr)) {
    const soloFecha = fechaStr.split('T')[0];
    const [año, mes, dia] = soloFecha.split('-').map(Number);
    return new Date(año, mes - 1, dia, 12, 0, 0);
  }
  const fecha = new Date(fechaString);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

const convertirFechasEnDatos = (datos = {}) => {
  const resultado = { ...datos };
  CAMPOS_FECHA.forEach((campo) => {
    if (resultado[campo] !== undefined) {
      resultado[campo] = convertirFechaLocal(resultado[campo]);
    }
  });
  return resultado;
};

const formatearFechaLista = (fecha) => {
  if (!fecha) return '';
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

function sanitizarImagenPersistida(img) {
  if (!img || typeof img !== 'object') return null;
  if (!isStoredFileReference(img.ruta)) return null;
  return {
    id: img.id,
    ruta: img.ruta,
    nombre: img.nombre || '',
    descripcion: img.descripcion || '',
    tamaño: img.tamaño,
    tipoMime: img.tipoMime,
  };
}

function collectPathsFromInformeExportacion(informe = {}) {
  const paths = [];
  const buqueImg = informe.buque?.imagenBuque;
  if (buqueImg?.ruta && isStoredFileReference(buqueImg.ruta)) {
    paths.push(buqueImg.ruta);
  }
  const arraysImagenes = [
    'imagenesContenidoCajas',
    'imagenesContenedoresMercancia',
    'imagenesVehiculosMercancia',
    'imagenesRegistroMercancia',
    'imagenesRegistroInicialSupervision',
    'imagenesCondicionCarga',
    'imagenesInspeccionArribo',
    'imagenesEquiposOperacion',
    'imagenesCondicionesMeteo',
    'imagenesRegistroSupervision',
  ];
  for (const key of arraysImagenes) {
    for (const img of informe[key] || []) {
      if (img?.ruta && isStoredFileReference(img.ruta)) paths.push(img.ruta);
    }
  }
  for (const reg of informe.registrosFotograficosContenedores || []) {
    for (const img of reg.imagenes || []) {
      if (img?.ruta && isStoredFileReference(img.ruta)) paths.push(img.ruta);
    }
  }
  return paths;
}

function sanitizarPuntos(puntos = []) {
  if (!Array.isArray(puntos)) return [];
  return puntos
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: p.id,
      texto: p.texto || '',
    }));
}

function sanitizarInformeExportacion(informe = {}) {
  if (!informe || typeof informe !== 'object') return informe;
  const buque = { ...(informe.buque || {}) };
  if (buque.imagenBuque) {
    const limpia = sanitizarImagenPersistida(buque.imagenBuque);
    buque.imagenBuque = limpia;
  }
  const sanitizarArrayImgs = (arr) => (arr || []).map(sanitizarImagenPersistida).filter(Boolean);

  const out = {
    ...informe,
    buque,
    imagenesContenidoCajas: sanitizarArrayImgs(informe.imagenesContenidoCajas),
    imagenesContenedoresMercancia: sanitizarArrayImgs(informe.imagenesContenedoresMercancia),
    imagenesVehiculosMercancia: sanitizarArrayImgs(informe.imagenesVehiculosMercancia),
    imagenesRegistroInicialSupervision: sanitizarArrayImgs(
      informe.imagenesRegistroInicialSupervision?.length
        ? informe.imagenesRegistroInicialSupervision
        : informe.imagenesRegistroSupervision
    ),
    imagenesCondicionCarga: sanitizarArrayImgs(informe.imagenesCondicionCarga),
    imagenesInspeccionArribo: sanitizarArrayImgs(informe.imagenesInspeccionArribo),
    imagenesEquiposOperacion: sanitizarArrayImgs(informe.imagenesEquiposOperacion),
    imagenesCondicionesMeteo: sanitizarArrayImgs(informe.imagenesCondicionesMeteo),
    inspeccionArriboPuntos: sanitizarPuntos(informe.inspeccionArriboPuntos),
    equiposOperacionPuntos: sanitizarPuntos(informe.equiposOperacionPuntos),
    conclusionesTexto: informe.conclusionesTexto || '',
    conclusionesPuntos: sanitizarPuntos(informe.conclusionesPuntos),
    registrosFotograficosContenedores: (informe.registrosFotograficosContenedores || [])
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({
        id: r.id,
        numeroContenedor: r.numeroContenedor || '',
        titulo: r.titulo || '',
        imagenes: sanitizarArrayImgs(r.imagenes),
      })),
  };
  delete out.imagenesRegistroSupervision;
  delete out.imagenesRegistroMercancia;
  delete out.condicionCarga;
  return out;
}

const generarConsecutivoCaso = async () => {
  const year = new Date().getFullYear();
  const prefix = `BT${year}`;
  const ultimo = await PuertosCaso.findOne({
    consecutivo: { $regex: `^${prefix}` },
  })
    .sort({ consecutivo: -1 })
    .select('consecutivo')
    .lean();

  let secuencia = 1;
  if (ultimo?.consecutivo) {
    const match = ultimo.consecutivo.match(/(\d+)(?:\/\d+)?$/);
    if (match) {
      secuencia = parseInt(match[1], 10) + 1;
    }
  }
  return `${prefix}${String(secuencia).padStart(3, '0')}/${year}`;
};

const mapCasoALista = (doc) => ({
  id: doc._id?.toString(),
  tipoRegistro: 'caso_exportacion',
  nroReferencia: doc.consecutivo || '',
  tipoInspeccion: doc.laborRealizada || 'INSPECCIÓN EXPORTACIÓN',
  tipoAveria: '',
  regional: doc.ciudadRiesgo || '',
  fecha: formatearFechaLista(doc.fchaInspccion || doc.fchaAsgncion || doc.createdAt),
  asegurado: doc.nombreAseguradora || doc.codiAsgrdra || '',
  mercancia: doc.asgrBenfcro || '',
  estado: doc.descripcionEstado || doc.codiEstdo || '',
  beneficiario: doc.asgrBenfcro || '',
});

const mapActaALista = (doc) => ({
  id: doc._id?.toString(),
  tipoRegistro: 'acta',
  nroReferencia: doc.nroActa || '',
  tipoInspeccion: doc.tipoInspeccion || '',
  tipoAveria: doc.detalleInspeccion?.tipoAveria || '',
  regional: doc.regional || '',
  fecha: formatearFechaLista(doc.fechaActa || doc.createdAt),
  asegurado: doc.asegurado || '',
  mercancia: doc.mercancia || '',
  estado: doc.estado || '',
  beneficiario: doc.asegurado || '',
});

export const listarRegistrosPuertos = async (req, res) => {
  try {
    const { tipo, q, limit = 100 } = req.query;
    const limite = Math.min(parseInt(limit, 10) || 100, 500);

    const filtrosCaso = {};
    const filtrosActa = {};
    if (q && String(q).trim()) {
      const regex = new RegExp(String(q).trim(), 'i');
      filtrosCaso.$or = [
        { consecutivo: regex },
        { asgrBenfcro: regex },
        { nombreAseguradora: regex },
        { numeroSolicitud: regex },
      ];
      filtrosActa.$or = [{ nroActa: regex }, { asegurado: regex }, { mercancia: regex }];
    }

    const incluirCasos = !tipo || tipo === 'caso_exportacion' || tipo === 'caso';
    const incluirActas = !tipo || tipo === 'acta';

    const [casos, actas] = await Promise.all([
      incluirCasos
        ? PuertosCaso.find(filtrosCaso).sort({ updatedAt: -1 }).limit(limite).lean()
        : [],
      incluirActas
        ? PuertosActa.find(filtrosActa).sort({ updatedAt: -1 }).limit(limite).lean()
        : [],
    ]);

    const registros = [
      ...casos.map(mapCasoALista),
      ...actas.map(mapActaALista),
    ].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    res.json({ total: registros.length, registros });
  } catch (error) {
    console.error('❌ listarRegistrosPuertos:', error);
    res.status(500).json({ error: 'Error al listar registros de Puertos' });
  }
};

export const crearPuertosCaso = async (req, res) => {
  try {
    if (req.body._id) {
      return actualizarPuertosCaso({ ...req, params: { id: req.body._id } }, res);
    }

    let datos = convertirFechasEnDatos({ ...req.body });
    if (!datos.consecutivo?.trim()) {
      datos.consecutivo = await generarConsecutivoCaso();
    }
    if (datos.informeExportacion) {
      datos.informeExportacion = sanitizarInformeExportacion(datos.informeExportacion);
    }

    const caso = new PuertosCaso(datos);
    await caso.save();
    res.status(201).json(caso);
  } catch (error) {
    console.error('❌ crearPuertosCaso:', error);
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Ya existe un caso con ese consecutivo' });
    }
    res.status(500).json({ error: 'Error al crear el caso Puertos' });
  }
};

export const obtenerPuertosCasos = async (req, res) => {
  try {
    const casos = await PuertosCaso.find().sort({ updatedAt: -1 }).lean();
    res.json(casos);
  } catch (error) {
    console.error('❌ obtenerPuertosCasos:', error);
    res.status(500).json({ error: 'Error al obtener casos Puertos' });
  }
};

export const obtenerPuertosCasoPorId = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Identificador de caso no válido' });
    }
    const caso = await PuertosCaso.findById(id).lean();
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json(caso);
  } catch (error) {
    console.error('❌ obtenerPuertosCasoPorId:', error);
    res.status(500).json({ error: 'Error al obtener el caso' });
  }
};

export const actualizarPuertosCaso = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Identificador de caso no válido' });
    }

    const datos = convertirFechasEnDatos({ ...req.body });
    delete datos._id;
    delete datos.createdAt;
    delete datos.updatedAt;
    if (datos.informeExportacion) {
      datos.informeExportacion = sanitizarInformeExportacion(datos.informeExportacion);
    }

    const casoAnterior = await PuertosCaso.findById(id).lean();
    if (casoAnterior?.informeExportacion && datos.informeExportacion) {
      const rutasAnteriores = collectPathsFromInformeExportacion(casoAnterior.informeExportacion);
      const rutasNuevas = collectPathsFromInformeExportacion(datos.informeExportacion);
      await deleteOrphanedStoredFiles(rutasAnteriores, rutasNuevas).catch((err) => {
        console.warn('⚠️ No se pudieron eliminar imágenes huérfanas del caso Puertos:', err.message);
      });
    }

    const caso = await PuertosCaso.findByIdAndUpdate(id, datos, {
      new: true,
      runValidators: false,
    }).lean();

    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json(caso);
  } catch (error) {
    console.error('❌ actualizarPuertosCaso:', error);
    res.status(500).json({ error: 'Error al actualizar el caso' });
  }
};

export const eliminarPuertosCaso = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Identificador de caso no válido' });
    }
    const caso = await PuertosCaso.findByIdAndDelete(id);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json({ ok: true, id });
  } catch (error) {
    console.error('❌ eliminarPuertosCaso:', error);
    res.status(500).json({ error: 'Error al eliminar el caso' });
  }
};

export const crearPuertosActa = async (req, res) => {
  try {
    if (req.body._id) {
      return actualizarPuertosActa({ ...req, params: { id: req.body._id } }, res);
    }
    const datos = convertirFechasEnDatos({ ...req.body });
    const acta = new PuertosActa(datos);
    await acta.save();
    res.status(201).json(acta);
  } catch (error) {
    console.error('❌ crearPuertosActa:', error);
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Ya existe un acta con ese número' });
    }
    res.status(500).json({ error: 'Error al crear el acta' });
  }
};

export const obtenerPuertosActas = async (req, res) => {
  try {
    const actas = await PuertosActa.find().sort({ updatedAt: -1 }).lean();
    res.json(actas);
  } catch (error) {
    console.error('❌ obtenerPuertosActas:', error);
    res.status(500).json({ error: 'Error al obtener actas' });
  }
};

export const obtenerPuertosActaPorId = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Identificador de acta no válido' });
    }
    const acta = await PuertosActa.findById(id).lean();
    if (!acta) return res.status(404).json({ error: 'Acta no encontrada' });
    res.json(acta);
  } catch (error) {
    console.error('❌ obtenerPuertosActaPorId:', error);
    res.status(500).json({ error: 'Error al obtener el acta' });
  }
};

export const actualizarPuertosActa = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Identificador de acta no válido' });
    }
    const datos = convertirFechasEnDatos({ ...req.body });
    delete datos._id;
    delete datos.createdAt;
    delete datos.updatedAt;
    const acta = await PuertosActa.findByIdAndUpdate(id, datos, { new: true }).lean();
    if (!acta) return res.status(404).json({ error: 'Acta no encontrada' });
    res.json(acta);
  } catch (error) {
    console.error('❌ actualizarPuertosActa:', error);
    res.status(500).json({ error: 'Error al actualizar el acta' });
  }
};

export const subirImagenesPuertosCaso = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron imágenes' });
    }

    const casoId = req.query.casoId || 'general';
    const imagenesSubidas = req.files.map((file, index) => {
      const persisted = req.filesStorage?.__array?.[index];
      const rutaRelativa = persisted?.publicPath || `/uploads/puertos/${casoId}/${file.filename}`;
      return {
        nombre: file.originalname,
        ruta: rutaRelativa,
        tamaño: persisted?.size ?? file.size,
        tipoMime: persisted?.mimetype ?? file.mimetype,
        filename: persisted?.filename ?? file.filename,
      };
    });

    res.json({
      imagenes: imagenesSubidas,
      mensaje: `${imagenesSubidas.length} imagen(es) subida(s) exitosamente`,
    });
  } catch (error) {
    console.error('❌ subirImagenesPuertosCaso:', error);
    res.status(500).json({
      error: 'Error al subir imágenes del caso Puertos',
      detalles: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

export const eliminarPuertosActa = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Identificador de acta no válido' });
    }
    const acta = await PuertosActa.findByIdAndDelete(id);
    if (!acta) return res.status(404).json({ error: 'Acta no encontrada' });
    res.json({ ok: true, id });
  } catch (error) {
    console.error('❌ eliminarPuertosActa:', error);
    res.status(500).json({ error: 'Error al eliminar el acta' });
  }
};
