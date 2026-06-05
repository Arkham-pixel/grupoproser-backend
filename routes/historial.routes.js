import express from 'express';
import historialController from '../controllers/historialController.js';
import { verificarToken } from '../middleware/verificarToken.js';
import path from 'path';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';

const router = express.Router();

const uploadHistorialImages = createMulterUpload({
  category: STORAGE_CATEGORIES.HISTORIAL,
  multerOptions: {
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten archivos de imagen'), false);
      }
    },
  },
});

const uploadHistorialWord = createMulterUpload({
  category: STORAGE_CATEGORIES.HISTORIAL,
  multerOptions: {
    fileFilter: (_req, file, cb) => {
      const allowedMimes = [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/octet-stream',
      ];
      const allowedExtensions = ['.docx', '.doc'];
      const ext = path.extname(file.originalname).toLowerCase();

      if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten archivos Word (.docx, .doc)'), false);
      }
    },
  },
});

const persistHistorialImages = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.HISTORIAL,
  ownerIdFromReq: (req) => req.query.casoId || 'general',
});

const persistHistorialWord = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.HISTORIAL,
  ownerIdFromReq: (req) => req.params.id || 'general',
});

router.use(verificarToken);

router.post('/upload-images', (req, res, next) => {
  uploadHistorialImages.array('imagenes', 100)(req, res, (err) => {
    if (!err) return next();

    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: 'La imagen supera el tamaño máximo permitido (25MB).',
        code: err.code,
      });
    }

    return res.status(400).json({
      success: false,
      error: err.message || 'Error al subir imágenes',
      code: err.code,
    });
  });
}, persistHistorialImages, historialController.subirImagenes);

router.get('/', historialController.obtenerHistorial);
router.get('/estadisticas', historialController.obtenerEstadisticas);
router.get('/casos-organizados', historialController.obtenerCasosOrganizados);
router.get('/caso/:casoId', historialController.obtenerFormulariosPorCaso);
router.get('/secuencia/:numeroAjuste', historialController.obtenerSecuenciaPorNumeroAjuste);
router.put('/secuencia/:numeroAjuste', historialController.upsertSecuenciaPorNumeroAjuste);
router.get('/carpeta/:casoId', historialController.obtenerFormulariosPorCarpeta);
router.get('/buscar', historialController.buscarFormularios);
router.get('/:id', historialController.obtenerFormulario);
router.post('/', historialController.crearFormulario);
router.put('/:id', historialController.actualizarFormulario);
router.delete('/:id', historialController.eliminarFormulario);
router.get('/:id/descargar', historialController.descargarFormulario);
router.post(
  '/:id/archivo',
  uploadHistorialWord.single('archivo'),
  persistHistorialWord,
  historialController.subirArchivoFormulario
);
router.post('/:id/comentarios', historialController.agregarComentario);
router.post('/:id/archivar', historialController.archivarFormulario);

export default router;
