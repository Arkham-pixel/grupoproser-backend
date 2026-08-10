import { ZipArchive } from 'archiver';
import SgSstCaso from '../models/SgSstCaso.js';
import { deleteStoredFile, deleteStoredFiles, resolveFileForRead } from '../services/fileStorageService.js';
import { tieneAccesoGlobalSgSst } from '../middleware/sgSstAccess.js';

function usuarioDesdeReq(req) {
  const u = req.usuario || req.user || {};
  return {
    id: String(u.id || u._id || ''),
    login: String(u.login || u.email || 'usuario'),
    nombre: String(u.nombre || u.name || u.login || 'Usuario'),
  };
}

export function normalizarNit(nit) {
  return String(nit || '')
    .replace(/[.\s-]/g, '')
    .trim()
    .toUpperCase();
}

async function siguienteNumeroCaso(nitNormalizado, anio) {
  const ultimo = await SgSstCaso.findOne({
    'empresa.nitNormalizado': nitNormalizado,
    anio,
  })
    .sort({ secuencia: -1 })
    .select('secuencia')
    .lean();

  const secuencia = (ultimo?.secuencia || 0) + 1;
  const numeroCaso = `SGSST-${nitNormalizado}-${anio}-${String(secuencia).padStart(4, '0')}`;
  return { secuencia, numeroCaso, anio };
}

function buildArchivoFromUpload(req, itemId) {
  const file = req.file;
  const usuario = usuarioDesdeReq(req);
  if (req.fileStorage?.driver === 's3') {
    return {
      nombreOriginal: file.originalname,
      nombreArchivo: req.fileStorage.filename,
      ruta: req.fileStorage.publicPath,
      tamaño: req.fileStorage.size,
      tipoMime: req.fileStorage.mimetype,
      itemId,
      subidoPor: usuario,
      fechaSubida: new Date(),
    };
  }
  return {
    nombreOriginal: file.originalname,
    nombreArchivo: file.filename,
    ruta: `/uploads/sg-sst/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
    itemId,
    subidoPor: usuario,
    fechaSubida: new Date(),
  };
}

/** GET /api/sg-sst/casos */
export async function listarCasos(req, res) {
  try {
    const { nit, q } = req.query;
    const filtro = { activo: true };
    const usuario = req.usuario || req.user;
    if (!tieneAccesoGlobalSgSst(usuario)) {
      filtro['creadoPor.id'] = String(usuario?.id || usuario?._id || '');
    }
    if (nit) filtro['empresa.nitNormalizado'] = normalizarNit(nit);
    if (q) {
      const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filtro.$or = [
        { numeroCaso: rx },
        { 'empresa.nombre': rx },
        { 'empresa.nit': rx },
        { 'empresa.nitNormalizado': rx },
      ];
    }

    const casos = await SgSstCaso.find(filtro)
      .sort({ createdAt: -1 })
      .select('-__v')
      .lean();

    return res.json({ casos });
  } catch (error) {
    console.error('Error listando casos SG-SST:', error);
    return res.status(500).json({ message: 'Error al listar casos SG-SST' });
  }
}

/** GET /api/sg-sst/casos/:id */
export async function obtenerCaso(req, res) {
  try {
    const caso = req.sgSstCaso;
    return res.json({ caso });
  } catch (error) {
    console.error('Error obteniendo caso SG-SST:', error);
    return res.status(500).json({ message: 'Error al obtener el caso' });
  }
}

/** POST /api/sg-sst/casos */
export async function crearCaso(req, res) {
  try {
    const {
      nombreEmpresa,
      nit,
      numTrabajadores,
      numTrabajadoresIndirectos = 0,
      claseRiesgo,
      perfilId,
      respuestas = [],
      ciudad = '',
      departamento = '',
      sectorEconomico = '',
      realizadoPor = '',
      cargoRealizadoPor = '',
      asesoradoPor = '',
      cargoAsesoradoPor = '',
      anioAutoevaluacion,
    } = req.body || {};

    const nitNormalizado = normalizarNit(nit);
    if (!nombreEmpresa?.trim()) {
      return res.status(400).json({ message: 'El nombre de la empresa es obligatorio' });
    }
    if (!nitNormalizado) {
      return res.status(400).json({ message: 'El NIT de la empresa es obligatorio' });
    }
    const n = Number(numTrabajadores);
    if (!Number.isFinite(n) || n < 1) {
      return res.status(400).json({ message: 'Número de trabajadores inválido' });
    }
    if (!['I', 'II', 'III', 'IV', 'V'].includes(String(claseRiesgo || '').toUpperCase())) {
      return res.status(400).json({ message: 'Clase de riesgo inválida' });
    }
    if (!['CAP1', 'CAP2', 'CAP3'].includes(perfilId)) {
      return res.status(400).json({ message: 'Perfil de evaluación inválido' });
    }

    const anio = new Date().getFullYear();
    const { secuencia, numeroCaso } = await siguienteNumeroCaso(nitNormalizado, anio);
    const creadoPor = usuarioDesdeReq(req);

    const caso = await SgSstCaso.create({
      numeroCaso,
      secuencia,
      anio,
      empresa: {
        nombre: String(nombreEmpresa).trim(),
        nit: String(nit).trim(),
        nitNormalizado,
        numTrabajadores: n,
        numTrabajadoresIndirectos: Number(numTrabajadoresIndirectos) || 0,
        claseRiesgo: String(claseRiesgo).toUpperCase(),
        ciudad: String(ciudad || '').trim(),
        departamento: String(departamento || '').trim(),
        sectorEconomico: String(sectorEconomico || '').trim(),
        realizadoPor: String(realizadoPor || '').trim(),
        cargoRealizadoPor: String(cargoRealizadoPor || '').trim(),
        asesoradoPor: String(asesoradoPor || '').trim(),
        cargoAsesoradoPor: String(cargoAsesoradoPor || '').trim(),
        anioAutoevaluacion: Number(anioAutoevaluacion) || anio,
      },
      perfilId,
      respuestas: Array.isArray(respuestas) ? respuestas : [],
      archivos: [],
      estadoCaso: 'en_progreso',
      creadoPor,
    });

    return res.status(201).json({ caso });
  } catch (error) {
    console.error('Error creando caso SG-SST:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Conflicto al generar el número de caso. Intenta de nuevo.' });
    }
    return res.status(500).json({ message: 'Error al crear el caso SG-SST' });
  }
}

/** PUT /api/sg-sst/casos/:id */
export async function actualizarCaso(req, res) {
  try {
    const caso = req.sgSstCaso;

    const { respuestas, estadoCaso, nombreEmpresa } = req.body || {};
    if (Array.isArray(respuestas)) caso.respuestas = respuestas;
    if (estadoCaso && ['borrador', 'en_progreso', 'cerrado'].includes(estadoCaso)) {
      caso.estadoCaso = estadoCaso;
    }
    if (nombreEmpresa?.trim()) caso.empresa.nombre = String(nombreEmpresa).trim();

    await caso.save();
    return res.json({ caso });
  } catch (error) {
    console.error('Error actualizando caso SG-SST:', error);
    return res.status(500).json({ message: 'Error al actualizar el caso' });
  }
}

/** POST /api/sg-sst/casos/:id/items/:itemId/archivos */
export async function subirEvidencia(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se proporcionó ningún archivo' });
    }

    const caso = req.sgSstCaso;

    const itemId = String(req.params.itemId || '').trim();
    if (!itemId) return res.status(400).json({ message: 'itemId requerido' });

    const archivo = buildArchivoFromUpload(req, itemId);
    caso.archivos.push(archivo);
    if (caso.estadoCaso === 'borrador') caso.estadoCaso = 'en_progreso';
    await caso.save();

    const creado = caso.archivos[caso.archivos.length - 1];
    return res.status(201).json({ archivo: creado, casoId: caso._id, numeroCaso: caso.numeroCaso });
  } catch (error) {
    console.error('Error subiendo evidencia SG-SST:', error);
    return res.status(500).json({
      message: error?.storageError
        ? 'Error al guardar el archivo en almacenamiento'
        : 'Error al subir la evidencia',
    });
  }
}

/** DELETE /api/sg-sst/casos/:id/archivos/:archivoId */
export async function eliminarEvidencia(req, res) {
  try {
    const caso = req.sgSstCaso;

    const archivo = caso.archivos.id(req.params.archivoId);
    if (!archivo) return res.status(404).json({ message: 'Archivo no encontrado' });

    if (archivo.ruta) {
      await deleteStoredFile(archivo.ruta).catch((err) => {
        console.warn('No se pudo eliminar evidencia SG-SST del almacenamiento:', err.message);
      });
    }
    archivo.deleteOne();
    await caso.save();
    return res.json({ message: 'Archivo eliminado', caso });
  } catch (error) {
    console.error('Error eliminando evidencia SG-SST:', error);
    return res.status(500).json({ message: 'Error al eliminar el archivo' });
  }
}

/** GET /api/sg-sst/casos/:id/paquete — ZIP con resumen + evidencias */
export async function descargarPaquete(req, res) {
  try {
    const caso = req.sgSstCaso.toObject();

    const zipName = `${caso.numeroCaso}_paquete.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`
    );

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Error armando ZIP SG-SST:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error al generar el paquete' });
      } else {
        res.end();
      }
    });
    archive.pipe(res);

    const resumen = {
      numeroCaso: caso.numeroCaso,
      secuencia: caso.secuencia,
      empresa: caso.empresa,
      perfilId: caso.perfilId,
      estadoCaso: caso.estadoCaso,
      respuestas: caso.respuestas,
      archivos: (caso.archivos || []).map((a) => ({
        id: a._id,
        itemId: a.itemId,
        nombreOriginal: a.nombreOriginal,
        tamaño: a.tamaño,
        tipoMime: a.tipoMime,
        fechaSubida: a.fechaSubida,
      })),
      generadoEn: new Date().toISOString(),
    };
    archive.append(JSON.stringify(resumen, null, 2), { name: 'resumen_evaluacion.json' });

    const usados = new Set();
    for (const archivo of caso.archivos || []) {
      try {
        const resolved = await resolveFileForRead(archivo.ruta);
        const itemFolder = `evidencias/${archivo.itemId || 'sin-item'}`;
        let entryName = `${itemFolder}/${archivo.nombreOriginal || archivo.nombreArchivo}`;
        if (usados.has(entryName)) {
          entryName = `${itemFolder}/${archivo._id}_${archivo.nombreOriginal || archivo.nombreArchivo}`;
        }
        usados.add(entryName);

        if (resolved.driver === 's3' && resolved.stream) {
          archive.append(resolved.stream, { name: entryName });
        } else if (resolved.exists && resolved.localPath) {
          archive.file(resolved.localPath, { name: entryName });
        }
      } catch (fileErr) {
        console.warn(`No se pudo incluir archivo ${archivo.nombreOriginal}:`, fileErr.message);
        archive.append(
          `No se pudo incluir: ${archivo.nombreOriginal}\nRuta: ${archivo.ruta}\nError: ${fileErr.message}`,
          { name: `evidencias/_errores/${archivo._id || 'archivo'}.txt` }
        );
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('Error descargando paquete SG-SST:', error);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Error al descargar el paquete' });
    }
  }
}

/** DELETE /api/sg-sst/casos/:id — soft delete */
export async function eliminarCaso(req, res) {
  try {
    const caso = req.sgSstCaso;
    await deleteStoredFiles(caso.archivos.map((archivo) => archivo.ruta)).catch((err) => {
      console.warn('No se pudieron eliminar evidencias SG-SST del almacenamiento:', err.message);
    });
    caso.activo = false;
    await caso.save();
    return res.json({ message: 'Caso eliminado' });
  } catch (error) {
    console.error('Error eliminando caso SG-SST:', error);
    return res.status(500).json({ message: 'Error al eliminar el caso' });
  }
}
