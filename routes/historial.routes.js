import express from 'express';
import historialController from '../controllers/historialController.js';
import { verificarToken } from '../middleware/verificarToken.js';
import { UPLOADS_ROOT } from '../config/uploadsRoot.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Configuración de multer para guardar imágenes de historial
const historialStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Crear carpeta por caso si está disponible en query params
    const casoId = req.query.casoId || 'general';
    const uploadsDir = path.join(UPLOADS_ROOT, 'historial', casoId);
    
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const uniqueName = `historial_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const uploadHistorialImages = multer({ 
  storage: historialStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen'), false);
    }
  }
});

// Configuración de multer para guardar archivos Word del historial
const historialWordStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Directorio temporal, luego se moverá a la carpeta del caso
    const uploadsDir = path.join(UPLOADS_ROOT, 'temp');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.docx';
    const uniqueName = `word_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const uploadHistorialWord = multer({ 
  storage: historialWordStorage,
  fileFilter: (req, file, cb) => {
    // Permitir archivos Word
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'application/octet-stream' // A veces viene como octet-stream
    ];
    const allowedExtensions = ['.docx', '.doc'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos Word (.docx, .doc)'), false);
    }
  }
});

// Aplicar middleware de autenticación a todas las rutas
router.use(verificarToken); // AUTENTICACIÓN HABILITADA

// POST /api/historial-formularios/upload-images - Subir múltiples imágenes
router.post('/upload-images', (req, res, next) => {
  // Envolver multer para devolver errores en JSON (evita respuestas HTML silenciosas)
  uploadHistorialImages.array('imagenes', 100)(req, res, (err) => {
    if (!err) return next();

    // MulterError (por ejemplo, límite de tamaño)
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: 'La imagen supera el tamaño máximo permitido (25MB).',
        code: err.code
      });
    }

    return res.status(400).json({
      success: false,
      error: err.message || 'Error al subir imágenes',
      code: err.code
    });
  });
}, historialController.subirImagenes);

// GET /api/historial-formularios - Obtener historial con filtros
router.get('/', historialController.obtenerHistorial);

// GET /api/historial-formularios/estadisticas - Obtener estadísticas
router.get('/estadisticas', historialController.obtenerEstadisticas);

// GET /api/historial-formularios/casos-organizados - Obtener casos organizados por carpeta
router.get('/casos-organizados', historialController.obtenerCasosOrganizados);

// GET /api/historial-formularios/caso/:casoId - Obtener formularios de un caso específico
router.get('/caso/:casoId', historialController.obtenerFormulariosPorCaso);

// GET /api/historial-formularios/secuencia/:numeroAjuste - Obtener secuencia por número de ajuste
router.get('/secuencia/:numeroAjuste', historialController.obtenerSecuenciaPorNumeroAjuste);

// PUT /api/historial-formularios/secuencia/:numeroAjuste - Upsert secuencia por número de ajuste
router.put('/secuencia/:numeroAjuste', historialController.upsertSecuenciaPorNumeroAjuste);

// GET /api/historial-formularios/carpeta/:casoId - Obtener formularios por carpeta
router.get('/carpeta/:casoId', historialController.obtenerFormulariosPorCarpeta);

// GET /api/historial-formularios/buscar - Buscar formularios por texto
router.get('/buscar', historialController.buscarFormularios);

// GET /api/historial-formularios/:id - Obtener formulario específico
router.get('/:id', historialController.obtenerFormulario);

// POST /api/historial-formularios - Crear nuevo formulario
router.post('/', historialController.crearFormulario);

// PUT /api/historial-formularios/:id - Actualizar formulario
router.put('/:id', historialController.actualizarFormulario);

// DELETE /api/historial-formularios/:id - Eliminar formulario (soft delete)
router.delete('/:id', historialController.eliminarFormulario);

// GET /api/historial-formularios/:id/descargar - Descargar archivo del formulario
router.get('/:id/descargar', historialController.descargarFormulario);

// POST /api/historial-formularios/:id/archivo - Subir archivo Word del formulario
router.post('/:id/archivo', uploadHistorialWord.single('archivo'), historialController.subirArchivoFormulario);

// POST /api/historial-formularios/:id/comentarios - Agregar comentario
router.post('/:id/comentarios', historialController.agregarComentario);

// POST /api/historial-formularios/:id/archivar - Archivar formulario
router.post('/:id/archivar', historialController.archivarFormulario);

export default router;
