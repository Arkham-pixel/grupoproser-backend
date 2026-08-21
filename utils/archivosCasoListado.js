import { deleteStoredFile } from '../services/fileStorageService.js';

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

const buildArchivoFromUpload = (req, etiqueta, rutaLocalPrefix, { descripcion = '', orden = 0 } = {}) => {
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
  const prefix = String(rutaLocalPrefix || '/uploads/').replace(/\/?$/, '/');
  return {
    nombreOriginal: file.originalname,
    nombreArchivo: file.filename,
    ruta: `${prefix}${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
    ...base,
  };
};

/**
 * Handlers POST/DELETE de archivos para casos de listado (Allianz, Previsora, BBVA).
 */
export function crearControladoresArchivosListado({
  Model,
  nombreModulo,
  rutaLocalPrefix,
}) {
  const etiquetaCaso = `Caso del listado ${nombreModulo}`;

  const subir = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No se proporcionó ningún archivo' });
      }

      const caso = await Model.findById(req.params.id);
      if (!caso) {
        return res.status(404).json({ success: false, error: `${etiquetaCaso} no encontrado` });
      }

      const etiqueta = String(req.body?.etiqueta || 'GENERAL').trim() || 'GENERAL';
      const descripcion =
        req.body?.descripcion != null ? String(req.body.descripcion) : '';
      caso.archivos = caso.archivos || [];
      const orden = siguienteOrdenArchivos(caso.archivos);
      caso.archivos.push(
        buildArchivoFromUpload(req, etiqueta, rutaLocalPrefix, { descripcion, orden })
      );
      await caso.save();

      const creado = caso.archivos[caso.archivos.length - 1];
      res.status(201).json({ success: true, data: creado, casoId: caso._id });
    } catch (error) {
      console.error(`❌ Error subiendo archivo listado ${nombreModulo}:`, error);
      res.status(500).json({
        success: false,
        error: error?.storageError
          ? 'Error al guardar el archivo en almacenamiento'
          : 'Error al subir el archivo',
        detalle: error.message,
      });
    }
  };

  const eliminar = async (req, res) => {
    try {
      const caso = await Model.findById(req.params.id);
      if (!caso) {
        return res.status(404).json({ success: false, error: `${etiquetaCaso} no encontrado` });
      }

      const archivo = caso.archivos?.id?.(req.params.archivoId);
      if (!archivo) {
        return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
      }

      if (archivo.ruta) {
        await deleteStoredFile(archivo.ruta).catch((err) => {
          console.warn(
            `No se pudo eliminar archivo del listado ${nombreModulo} del almacenamiento:`,
            err.message
          );
        });
      }
      archivo.deleteOne();
      await caso.save();

      res.json({ success: true, message: 'Archivo eliminado correctamente' });
    } catch (error) {
      console.error(`❌ Error eliminando archivo listado ${nombreModulo}:`, error);
      res.status(500).json({
        success: false,
        error: 'Error al eliminar el archivo',
        detalle: error.message,
      });
    }
  };

  return { subir, eliminar };
}
