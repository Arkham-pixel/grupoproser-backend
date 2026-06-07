import Documento from '../models/Documento.js';
import DocumentoPerfilExterno from '../models/DocumentoPerfilExterno.js';
import DocumentoUsuarioOcultoGestion from '../models/DocumentoUsuarioOcultoGestion.js';
import { IDENTIFICADORES_GESTION_DOCUMENTOS } from '../config/gestionDocumentosPermitidos.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveDocumentoArchivoPath } from '../config/uploadsRoot.js';
import { deleteStoredFile, resolveFileForRead } from '../services/fileStorageService.js';
import { resolveBackendPublicUrl } from '../config/platformUrls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IDENTIFICADORES_PERMITIDOS = IDENTIFICADORES_GESTION_DOCUMENTOS;

function buildArchivoFromUpload(req) {
  const file = req.file;
  if (req.fileStorage?.driver === 's3') {
    return {
      nombreOriginal: file.originalname,
      nombreArchivo: req.fileStorage.filename,
      ruta: req.fileStorage.publicPath,
      tamaño: req.fileStorage.size,
      tipoMime: req.fileStorage.mimetype,
    };
  }
  return {
    nombreOriginal: file.originalname,
    nombreArchivo: file.filename,
    ruta: `/uploads/documentos/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
  };
}


// Middleware para verificar acceso
export const verificarAccesoDocumentos = async (req, res, next) => {
  try {
    const usuario = req.usuario || req.user;
    
    if (!usuario) {
      console.log('❌ Usuario no encontrado en req.usuario o req.user');
      return res.status(401).json({ 
        message: 'Usuario no autenticado' 
      });
    }

    console.log('🔍 Verificando acceso - Usuario del token:', {
      id: usuario.id || usuario._id,
      login: usuario.login,
      cedula: usuario.cedula
    });

    // JWT (Secur) suele traer solo id + login + role; la cédula autorizada puede estar solo en BD.
    let cedula = usuario.cedula;
    let login = usuario.login;
    const userId = usuario.id || usuario._id;

    if (userId) {
      try {
        const SecurUser = (await import('../models/SecurUser.js')).default;
        const Usuario = (await import('../models/Usuario.js')).default;

        let usuarioCompleto = null;
        try {
          usuarioCompleto = await SecurUser.findById(userId).select('cedula login name').lean();
        } catch (e) {
          usuarioCompleto = null;
        }
        if (!usuarioCompleto) {
          try {
            usuarioCompleto = await Usuario.findById(userId).select('cedula login nombre').lean();
          } catch (e2) {
            usuarioCompleto = null;
          }
        }

        if (usuarioCompleto) {
          if (usuarioCompleto.cedula != null && String(usuarioCompleto.cedula).trim() !== '') {
            cedula = usuarioCompleto.cedula;
          }
          if (usuarioCompleto.login || usuarioCompleto.nombre) {
            login = usuarioCompleto.login || usuarioCompleto.nombre || login;
          }
          console.log('✅ Usuario encontrado en BD:', {
            login: usuarioCompleto.login || usuarioCompleto.nombre,
            cedula: usuarioCompleto.cedula
          });
        } else {
          console.log('⚠️ Usuario no encontrado en BD con ID:', userId);
        }
      } catch (dbError) {
        console.error('❌ Error obteniendo usuario de BD:', dbError);
      }
    }

    const norm = (v) => String(v ?? '').trim();
    const candidatos = [
      norm(cedula),
      norm(login),
      norm(usuario.cedula),
      norm(usuario.login)
    ].filter(Boolean);

    const permitidos = IDENTIFICADORES_PERMITIDOS.map((x) => norm(x));
    const tieneAcceso = candidatos.some((c) => permitidos.includes(c));

    if (!tieneAcceso) {
      console.log(`🚫 Acceso denegado - Candidatos evaluados:`, candidatos);
      console.log(`📋 Identificadores permitidos:`, IDENTIFICADORES_PERMITIDOS);
      return res.status(403).json({ 
        message: 'No tienes permisos para acceder a esta funcionalidad. Solo usuarios autorizados pueden gestionar documentos.' 
      });
    }

    console.log(`✅ Acceso permitido - Coincidencia con lista (candidatos: ${candidatos.join(', ')})`);
    next();
  } catch (error) {
    console.error('❌ Error verificando acceso:', error);
    console.error('📋 Stack:', error.stack);
    return res.status(500).json({ 
      message: 'Error al verificar permisos' 
    });
  }
};

// Subir documento
export const subirDocumento = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        message: 'No se proporcionó ningún archivo' 
      });
    }

    const usuario = req.usuario || req.user;
    const { nombre, descripcion, etiquetas } = req.body;

    // Parsear etiquetas si vienen como string
    let etiquetasArray = [];
    if (etiquetas) {
      if (typeof etiquetas === 'string') {
        etiquetasArray = etiquetas.split(',').map(tag => tag.trim()).filter(tag => tag);
      } else if (Array.isArray(etiquetas)) {
        etiquetasArray = etiquetas.map(tag => String(tag).trim()).filter(tag => tag);
      }
    }

    const documento = new Documento({
      nombre: nombre || req.file.originalname,
      descripcion: descripcion || '',
      archivo: buildArchivoFromUpload(req),
      usuarioSubio: {
        id: usuario.id || usuario._id,
        login: usuario.login,
        nombre: usuario.name || usuario.nombre || usuario.login
      },
      etiquetas: etiquetasArray
    });

    await documento.save();

    res.status(201).json({
      message: 'Documento subido exitosamente',
      documento: {
        id: documento._id,
        nombre: documento.nombre,
        descripcion: documento.descripcion,
        archivo: documento.archivo,
        usuarioSubio: documento.usuarioSubio,
        etiquetas: documento.etiquetas,
        fechaSubida: documento.fechaSubida
      }
    });
  } catch (error) {
    console.error('Error subiendo documento:', error);
    res.status(500).json({ 
      message: 'Error al subir el documento',
      error: error.message 
    });
  }
};

// Obtener todos los documentos (con búsqueda opcional)
export const obtenerDocumentos = async (req, res) => {
  try {
    console.log('📄 Obteniendo documentos...');
    const { busqueda, etiqueta, fechaDesde, fechaHasta, limit = 50, skip = 0 } = req.query;

    const filtros = { activo: true };

    // Búsqueda por texto
    if (busqueda) {
      filtros.$or = [
        { nombre: { $regex: busqueda, $options: 'i' } },
        { descripcion: { $regex: busqueda, $options: 'i' } },
        { etiquetas: { $in: [new RegExp(busqueda, 'i')] } }
      ];
    }

    // Filtro por etiqueta
    if (etiqueta) {
      filtros.etiquetas = { $in: [new RegExp(etiqueta, 'i')] };
    }

    // Filtro por fecha
    if (fechaDesde || fechaHasta) {
      filtros.fechaSubida = {};
      if (fechaDesde) {
        filtros.fechaSubida.$gte = new Date(fechaDesde);
      }
      if (fechaHasta) {
        filtros.fechaSubida.$lte = new Date(fechaHasta);
      }
    }

    console.log('🔍 Buscando documentos con filtros:', filtros);
    const documentos = await Documento.find(filtros)
      .sort({ fechaSubida: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .select('-__v')
      .lean();

    console.log(`✅ Encontrados ${documentos.length} documentos`);
    const total = await Documento.countDocuments(filtros);

    res.json({
      documentos,
      total,
      pagina: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
      totalPaginas: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error('❌ Error obteniendo documentos:', error);
    res.status(500).json({ 
      message: 'Error al obtener documentos',
      error: error.message 
    });
  }
};

// Obtener un documento por ID
export const obtenerDocumentoPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const documento = await Documento.findById(id);

    if (!documento || !documento.activo) {
      return res.status(404).json({ 
        message: 'Documento no encontrado' 
      });
    }

    res.json(documento);
  } catch (error) {
    console.error('Error obteniendo documento:', error);
    res.status(500).json({ 
      message: 'Error al obtener el documento',
      error: error.message 
    });
  }
};

// Descargar documento
export const descargarDocumento = async (req, res) => {
  try {
    const { id } = req.params;

    const documento = await Documento.findById(id);

    if (!documento || !documento.activo) {
      return res.status(404).json({ 
        message: 'Documento no encontrado' 
      });
    }

    const rutaArchivo = documento.archivo.ruta || `/uploads/documentos/${documento.archivo.nombreArchivo}`;
    const resolved = await resolveFileForRead(rutaArchivo);

    if (resolved.driver === 's3' && resolved.stream) {
      const nombreDescarga = encodeURIComponent(
        documento.archivo.nombreOriginal || documento.nombre || 'documento'
      );
      res.setHeader(
        'Content-Type',
        resolved.contentType || documento.archivo.tipoMime || 'application/octet-stream'
      );
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${nombreDescarga}`);
      if (resolved.contentLength) {
        res.setHeader('Content-Length', resolved.contentLength);
      }
      resolved.stream.pipe(res);
      return;
    }

    const filePath =
      resolved.driver === 'local' && resolved.localPath
        ? resolved.localPath
        : resolveDocumentoArchivoPath(documento.archivo.nombreArchivo);

    if (!fs.existsSync(filePath)) {
      // En desarrollo es habitual trabajar con datos de producción pero sin los
      // archivos físicos locales. En ese caso, hacemos de proxy hacia el archivo
      // estático de producción para que la descarga funcione igual (misma-origin
      // para el navegador, sin CORS ni bloqueo de popups).
      const esProduccion = process.env.NODE_ENV === 'production';
      if (!esProduccion) {
        try {
          const PROD_URL = resolveBackendPublicUrl();
          const rutaArchivo = documento.archivo.ruta || `/uploads/documentos/${documento.archivo.nombreArchivo}`;
          const prodUrl = `${PROD_URL}${rutaArchivo.startsWith('/') ? '' : '/'}${rutaArchivo}`;

          const prodResponse = await fetch(prodUrl);
          if (prodResponse.ok && prodResponse.body) {
            const nombreDescarga = encodeURIComponent(documento.archivo.nombreOriginal || documento.nombre || 'documento');
            res.setHeader('Content-Type', documento.archivo.tipoMime || prodResponse.headers.get('content-type') || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${nombreDescarga}`);

            const arrayBuffer = await prodResponse.arrayBuffer();
            return res.send(Buffer.from(arrayBuffer));
          }
        } catch (proxyError) {
          console.error('Error obteniendo archivo desde producción (fallback DEV):', proxyError.message);
        }
      }

      return res.status(404).json({ 
        message: 'Archivo físico no encontrado en el servidor' 
      });
    }

    res.download(filePath, documento.archivo.nombreOriginal, (err) => {
      if (err) {
        console.error('Error descargando archivo:', err);
        if (!res.headersSent) {
          res.status(500).json({ 
            message: 'Error al descargar el archivo' 
          });
        }
      }
    });
  } catch (error) {
    console.error('Error descargando documento:', error);
    res.status(500).json({ 
      message: 'Error al descargar el documento',
      error: error.message 
    });
  }
};

// Actualizar documento (solo metadata, no el archivo)
export const actualizarDocumento = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, etiquetas } = req.body;

    const documento = await Documento.findById(id);

    if (!documento || !documento.activo) {
      return res.status(404).json({ 
        message: 'Documento no encontrado' 
      });
    }

    if (nombre) documento.nombre = nombre;
    if (descripcion !== undefined) documento.descripcion = descripcion;
    if (etiquetas) {
      if (typeof etiquetas === 'string') {
        documento.etiquetas = etiquetas.split(',').map(tag => tag.trim()).filter(tag => tag);
      } else if (Array.isArray(etiquetas)) {
        documento.etiquetas = etiquetas.map(tag => String(tag).trim()).filter(tag => tag);
      }
    }
    documento.fechaModificacion = new Date();

    await documento.save();

    res.json({
      message: 'Documento actualizado exitosamente',
      documento
    });
  } catch (error) {
    console.error('Error actualizando documento:', error);
    res.status(500).json({ 
      message: 'Error al actualizar el documento',
      error: error.message 
    });
  }
};

// Eliminar documento (soft delete)
export const eliminarDocumento = async (req, res) => {
  try {
    const { id } = req.params;

    const documento = await Documento.findById(id);

    if (!documento || !documento.activo) {
      return res.status(404).json({ 
        message: 'Documento no encontrado' 
      });
    }

    if (documento.archivo?.ruta) {
      await deleteStoredFile(documento.archivo.ruta).catch((err) => {
        console.warn('⚠️ No se pudo eliminar archivo del documento en almacenamiento:', err.message);
      });
    }

    // Soft delete
    documento.activo = false;
    documento.fechaModificacion = new Date();
    await documento.save();

    res.json({ 
      message: 'Documento eliminado exitosamente' 
    });
  } catch (error) {
    console.error('Error eliminando documento:', error);
    res.status(500).json({ 
      message: 'Error al eliminar el documento',
      error: error.message 
    });
  }
};

// Obtener etiquetas únicas
export const obtenerEtiquetas = async (req, res) => {
  try {
    console.log('🏷️ Obteniendo etiquetas...');
    const etiquetas = await Documento.distinct('etiquetas', { activo: true });
    const etiquetasFiltradas = etiquetas.filter(tag => tag && tag.trim());
    
    console.log(`✅ Encontradas ${etiquetasFiltradas.length} etiquetas`);
    res.json({ etiquetas: etiquetasFiltradas });
  } catch (error) {
    console.error('❌ Error obteniendo etiquetas:', error);
    // Si hay error, devolver array vacío en lugar de fallar
    res.json({ etiquetas: [] });
  }
};

// Obtener documentos por usuarioId
export const obtenerDocumentosPorUsuario = async (req, res) => {
  try {
    const { usuarioId } = req.params;
    console.log(`📄 Obteniendo documentos para usuario: ${usuarioId}`);
    console.log(`🔍 Tipo de usuarioId: ${typeof usuarioId}`);

    // Buscar documentos donde el usuarioSubio.id coincida (como string o como ObjectId)
    const documentos = await Documento.find({ 
      $or: [
        { 'usuarioSubio.id': usuarioId },
        { 'usuarioSubio.id': usuarioId.toString() }
      ],
      activo: true 
    })
      .sort({ fechaSubida: -1 })
      .select('-__v')
      .lean();

    console.log(`✅ Encontrados ${documentos.length} documentos para el usuario ${usuarioId}`);
    if (documentos.length === 0) {
      // Intentar buscar sin el filtro de activo para debug
      const todos = await Documento.find({ 
        $or: [
          { 'usuarioSubio.id': usuarioId },
          { 'usuarioSubio.id': usuarioId.toString() }
        ]
      }).countDocuments();
      console.log(`🔍 Total documentos (incluyendo inactivos) para este usuario: ${todos}`);
    }
    
    res.json({ documentos, total: documentos.length });
  } catch (error) {
    console.error('❌ Error obteniendo documentos por usuario:', error);
    res.status(500).json({ 
      message: 'Error al obtener documentos del usuario',
      error: error.message 
    });
  }
};

// Subir documento para un usuario específico
export const subirDocumentoParaUsuario = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        message: 'No se proporcionó ningún archivo' 
      });
    }

    const { usuarioId } = req.params;
    const usuarioActual = req.usuario || req.user;
    const { nombre, descripcion, etiquetas } = req.body;

    // Parsear etiquetas si vienen como string
    let etiquetasArray = [];
    if (etiquetas) {
      if (typeof etiquetas === 'string') {
        etiquetasArray = etiquetas.split(',').map(tag => tag.trim()).filter(tag => tag);
      } else if (Array.isArray(etiquetas)) {
        etiquetasArray = etiquetas.map(tag => String(tag).trim()).filter(tag => tag);
      }
    }

    const documento = new Documento({
      nombre: nombre || req.file.originalname,
      descripcion: descripcion || '',
      archivo: buildArchivoFromUpload(req),
      usuarioSubio: {
        id: usuarioId, // ID del usuario al que pertenece el documento
        login: usuarioActual.login,
        nombre: usuarioActual.name || usuarioActual.nombre || usuarioActual.login
      },
      etiquetas: etiquetasArray
    });

    await documento.save();

    res.status(201).json({
      message: 'Documento subido exitosamente',
      documento: {
        id: documento._id,
        nombre: documento.nombre,
        descripcion: documento.descripcion,
        archivo: documento.archivo,
        usuarioSubio: documento.usuarioSubio,
        etiquetas: documento.etiquetas,
        fechaSubida: documento.fechaSubida
      }
    });
  } catch (error) {
    console.error('Error subiendo documento:', error);
    res.status(500).json({ 
      message: 'Error al subir el documento',
      error: error.message 
    });
  }
};

// Obtener perfiles externos para documentos
export const obtenerPerfilesExternos = async (req, res) => {
  try {
    const incluirInactivos = String(req.query.incluirInactivos || '').toLowerCase() === 'true';
    const filtros = incluirInactivos ? {} : { activo: true };

    const perfiles = await DocumentoPerfilExterno.find(filtros)
      .sort({ activo: -1, nombre: 1 })
      .lean();

    res.json({ perfiles });
  } catch (error) {
    console.error('Error obteniendo perfiles externos:', error);
    res.status(500).json({
      message: 'Error al obtener perfiles externos',
      error: error.message
    });
  }
};

// Crear perfil externo para documentos
export const crearPerfilExterno = async (req, res) => {
  try {
    const {
      nombre, cedula, email, telefono, telefonoFijo, celulares, empresa, cargo, sucursal,
      fechaNacimiento, tipoSangre, direccion, fechaIngreso,
      salario, fechaModificacionSueldo, tipoContrato, fechaModificacionContrato, vencimiento,
      aportesSalud, aportesPension, aportesCesantias, aportesARL, aportesCCF, evaluacionPeriodoPrueba
    } = req.body;

    if (!String(nombre || '').trim()) {
      return res.status(400).json({ message: 'El nombre es obligatorio' });
    }
    if (!String(cedula || '').trim()) {
      return res.status(400).json({ message: 'El ID (cédula) es obligatorio' });
    }

    const telefonoFijoNormalizado = String(telefonoFijo || '').trim();
    const celularesNormalizado = String(celulares || telefono || '').trim();

    const nuevoPerfil = await DocumentoPerfilExterno.create({
      nombre: String(nombre || '').trim(),
      cedula: String(cedula || '').trim(),
      email: String(email || '').trim(),
      telefono: celularesNormalizado, // compatibilidad legado
      telefonoFijo: telefonoFijoNormalizado,
      celulares: celularesNormalizado,
      empresa: String(empresa || '').trim(),
      cargo: String(cargo || '').trim(),
      sucursal: String(sucursal || '').trim(),
      fechaNacimiento: fechaNacimiento ? new Date(fechaNacimiento) : null,
      tipoSangre: String(tipoSangre || '').trim(),
      direccion: String(direccion || '').trim(),
      fechaIngreso: fechaIngreso ? new Date(fechaIngreso) : null,
      salario: salario !== undefined && salario !== null && salario !== '' ? Number(salario) : null,
      fechaModificacionSueldo: fechaModificacionSueldo ? new Date(fechaModificacionSueldo) : null,
      tipoContrato: String(tipoContrato || '').trim(),
      fechaModificacionContrato: fechaModificacionContrato ? new Date(fechaModificacionContrato) : null,
      vencimiento: vencimiento ? new Date(vencimiento) : null,
      aportesSalud: String(aportesSalud || '').trim(),
      aportesPension: String(aportesPension || '').trim(),
      aportesCesantias: String(aportesCesantias || '').trim(),
      aportesARL: String(aportesARL || '').trim(),
      aportesCCF: String(aportesCCF || '').trim(),
      evaluacionPeriodoPrueba: String(evaluacionPeriodoPrueba || '').trim()
    });

    res.status(201).json({
      message: 'Persona agregada exitosamente',
      perfil: nuevoPerfil
    });
  } catch (error) {
    console.error('Error creando perfil externo:', error);
    res.status(500).json({
      message: 'Error al crear el perfil externo',
      error: error.message
    });
  }
};

// Actualizar perfil externo para documentos
export const actualizarPerfilExterno = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre, cedula, email, telefono, telefonoFijo, celulares, empresa, cargo, sucursal,
      fechaNacimiento, tipoSangre, direccion, fechaIngreso,
      salario, fechaModificacionSueldo, tipoContrato, fechaModificacionContrato, vencimiento,
      aportesSalud, aportesPension, aportesCesantias, aportesARL, aportesCCF, evaluacionPeriodoPrueba
    } = req.body;

    const perfil = await DocumentoPerfilExterno.findById(id);
    if (!perfil || !perfil.activo) {
      return res.status(404).json({ message: 'Perfil externo no encontrado' });
    }

    if (nombre !== undefined) perfil.nombre = String(nombre || '').trim();
    if (cedula !== undefined) perfil.cedula = String(cedula || '').trim();
    if (email !== undefined) perfil.email = String(email || '').trim();
    if (telefonoFijo !== undefined) perfil.telefonoFijo = String(telefonoFijo || '').trim();
    if (celulares !== undefined || telefono !== undefined) {
      const celularValor = String(celulares !== undefined ? celulares : (telefono || '')).trim();
      perfil.celulares = celularValor;
      perfil.telefono = celularValor; // compatibilidad legado
    }
    if (empresa !== undefined) perfil.empresa = String(empresa || '').trim();
    if (cargo !== undefined) perfil.cargo = String(cargo || '').trim();
    if (sucursal !== undefined) perfil.sucursal = String(sucursal || '').trim();
    if (fechaNacimiento !== undefined) perfil.fechaNacimiento = fechaNacimiento ? new Date(fechaNacimiento) : null;
    if (tipoSangre !== undefined) perfil.tipoSangre = String(tipoSangre || '').trim();
    if (direccion !== undefined) perfil.direccion = String(direccion || '').trim();
    if (fechaIngreso !== undefined) perfil.fechaIngreso = fechaIngreso ? new Date(fechaIngreso) : null;
    if (salario !== undefined) perfil.salario = salario !== null && salario !== '' ? Number(salario) : null;
    if (fechaModificacionSueldo !== undefined) perfil.fechaModificacionSueldo = fechaModificacionSueldo ? new Date(fechaModificacionSueldo) : null;
    if (tipoContrato !== undefined) perfil.tipoContrato = String(tipoContrato || '').trim();
    if (fechaModificacionContrato !== undefined) perfil.fechaModificacionContrato = fechaModificacionContrato ? new Date(fechaModificacionContrato) : null;
    if (vencimiento !== undefined) perfil.vencimiento = vencimiento ? new Date(vencimiento) : null;
    if (aportesSalud !== undefined) perfil.aportesSalud = String(aportesSalud || '').trim();
    if (aportesPension !== undefined) perfil.aportesPension = String(aportesPension || '').trim();
    if (aportesCesantias !== undefined) perfil.aportesCesantias = String(aportesCesantias || '').trim();
    if (aportesARL !== undefined) perfil.aportesARL = String(aportesARL || '').trim();
    if (aportesCCF !== undefined) perfil.aportesCCF = String(aportesCCF || '').trim();
    if (evaluacionPeriodoPrueba !== undefined) perfil.evaluacionPeriodoPrueba = String(evaluacionPeriodoPrueba || '').trim();

    if (!perfil.nombre) {
      return res.status(400).json({ message: 'El nombre es obligatorio' });
    }
    if (!perfil.cedula) {
      return res.status(400).json({ message: 'El ID (cédula) es obligatorio' });
    }

    await perfil.save();

    res.json({
      message: 'Perfil externo actualizado exitosamente',
      perfil
    });
  } catch (error) {
    console.error('Error actualizando perfil externo:', error);
    res.status(500).json({
      message: 'Error al actualizar el perfil externo',
      error: error.message
    });
  }
};

// Eliminar (desactivar) perfil externo para documentos
export const eliminarPerfilExterno = async (req, res) => {
  try {
    const { id } = req.params;
    const perfil = await DocumentoPerfilExterno.findById(id);

    if (!perfil || !perfil.activo) {
      return res.status(404).json({ message: 'Perfil externo no encontrado' });
    }

    perfil.activo = false;
    await perfil.save();

    res.json({ message: 'Perfil externo eliminado exitosamente' });
  } catch (error) {
    console.error('Error eliminando perfil externo:', error);
    res.status(500).json({
      message: 'Error al eliminar el perfil externo',
      error: error.message
    });
  }
};

// Restaurar perfil externo para documentos
export const restaurarPerfilExterno = async (req, res) => {
  try {
    const { id } = req.params;
    const perfil = await DocumentoPerfilExterno.findById(id);

    if (!perfil) {
      return res.status(404).json({ message: 'Perfil externo no encontrado' });
    }

    perfil.activo = true;
    await perfil.save();

    res.json({ message: 'Perfil externo restaurado exitosamente' });
  } catch (error) {
    console.error('Error restaurando perfil externo:', error);
    res.status(500).json({
      message: 'Error al restaurar el perfil externo',
      error: error.message
    });
  }
};

/** Ocultar usuario de plataforma solo en la vista de Gestión de Documentos (no borra el usuario). */
export const listarOcultosPlataforma = async (req, res) => {
  try {
    const origen = req.query.origen === 'normal' ? 'normal' : 'secur';
    const docs = await DocumentoUsuarioOcultoGestion.find({ origen }).lean();
    res.json({
      ocultos: docs.map((d) => ({ usuarioId: d.usuarioId, origen: d.origen }))
    });
  } catch (error) {
    console.error('Error listando ocultos plataforma:', error);
    res.status(500).json({
      message: 'Error al listar usuarios ocultos',
      error: error.message
    });
  }
};

export const ocultarUsuarioPlataforma = async (req, res) => {
  try {
    const { usuarioId, origen } = req.body;
    const o = origen === 'normal' ? 'normal' : 'secur';
    if (!usuarioId) {
      return res.status(400).json({ message: 'usuarioId es obligatorio' });
    }
    await DocumentoUsuarioOcultoGestion.findOneAndUpdate(
      { usuarioId: String(usuarioId), origen: o },
      { usuarioId: String(usuarioId), origen: o },
      { upsert: true, new: true }
    );
    res.json({ message: 'Usuario oculto solo en esta pantalla' });
  } catch (error) {
    console.error('Error ocultando usuario plataforma:', error);
    res.status(500).json({
      message: 'Error al ocultar usuario',
      error: error.message
    });
  }
};

export const mostrarUsuarioPlataformaEnDocumentos = async (req, res) => {
  try {
    const { usuarioId } = req.params;
    const origen = req.query.origen === 'normal' ? 'normal' : 'secur';
    await DocumentoUsuarioOcultoGestion.deleteOne({
      usuarioId: String(usuarioId),
      origen
    });
    res.json({ message: 'Usuario visible de nuevo en esta pantalla' });
  } catch (error) {
    console.error('Error restaurando usuario plataforma en documentos:', error);
    res.status(500).json({
      message: 'Error al restaurar visibilidad',
      error: error.message
    });
  }
};
