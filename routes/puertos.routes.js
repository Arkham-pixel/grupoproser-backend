import express from 'express';

import {

  listarRegistrosPuertos,

  crearPuertosCaso,

  obtenerPuertosCasos,

  obtenerPuertosCasoPorId,

  actualizarPuertosCaso,

  eliminarPuertosCaso,

  subirImagenesPuertosCaso,

  crearPuertosActa,

  obtenerPuertosActas,

  obtenerPuertosActaPorId,

  actualizarPuertosActa,

  eliminarPuertosActa,

} from '../controllers/puertos.controller.js';

import {
  actualizarCatalogoPuertos,
  crearCatalogoPuertos,
  ejecutarSeedCatalogosPuertos,
  eliminarCatalogoPuertos,
  listarCatalogoPuertos,
  listarTodosCatalogosPuertos,
  obtenerTiposCatalogoPuertos,
} from '../controllers/puertosCatalogo.controller.js';
import { verificarToken } from '../middleware/verificarToken.js';
import { verificarCatalogosPuertos } from '../middleware/verificarCatalogosPuertos.js';

import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';

import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';



const router = express.Router();



const uploadPuertosImages = createMulterUpload({

  category: STORAGE_CATEGORIES.PUERTOS,

  multerOptions: {

    limits: { fileSize: 6 * 1024 * 1024, files: 1 },

    fileFilter: (_req, file, cb) => {

      if (file.mimetype.startsWith('image/')) {

        cb(null, true);

      } else {

        cb(new Error('Solo se permiten archivos de imagen'), false);

      }

    },

  },

});



const persistPuertosImages = attachPersistedFileMiddleware({

  category: STORAGE_CATEGORIES.PUERTOS,

  ownerIdFromReq: (req) => req.query.casoId || 'general',

});



// Listado unificado (Actas + Casos exportación)

router.get('/registros', listarRegistrosPuertos);

// Catálogos (inspectores, empaques, tipos de avería, etc.)
router.get('/catalogos/tipos', obtenerTiposCatalogoPuertos);
router.get('/catalogos', listarTodosCatalogosPuertos);
router.get('/catalogos/:tipo', listarCatalogoPuertos);
router.post('/catalogos', verificarCatalogosPuertos, crearCatalogoPuertos);
router.post('/catalogos/seed/defaults', verificarCatalogosPuertos, ejecutarSeedCatalogosPuertos);
router.put('/catalogos/:id', verificarCatalogosPuertos, actualizarCatalogoPuertos);
router.delete('/catalogos/:id', verificarCatalogosPuertos, eliminarCatalogoPuertos);



// Subida de imágenes a S3 / disco (antes de guardar el caso)

router.post(

  '/casos/upload-images',

  verificarToken,

  (req, res, next) => {

    uploadPuertosImages.array('imagenes', 100)(req, res, (err) => {

      if (!err) return next();

      if (err?.code === 'LIMIT_FILE_SIZE') {

        return res.status(413).json({

          error: 'La imagen supera el tamaño máximo permitido (6 MB).',

          code: err.code,

        });

      }

      return res.status(400).json({

        error: err.message || 'Error al subir imágenes',

        code: err.code,

      });

    });

  },

  (req, res, next) => {
    const n = Array.isArray(req.files) ? req.files.length : 0;
    console.log(`📷 Puertos upload-images: ${n} archivo(s) recibido(s), casoId=${req.query.casoId || 'general'}`);
    next();
  },

  persistPuertosImages,

  subirImagenesPuertosCaso,

  (err, req, res, _next) => {
    if (!err) return;
    console.error('❌ upload-images Puertos:', err.message || err);
    const status = err.storageError ? 502 : 500;
    res.status(status).json({
      error: err.message || 'Error al subir imágenes del caso Puertos',
      detalles: process.env.NODE_ENV === 'development' ? String(err.stack || '') : undefined,
    });
  }

);



// Casos — informe exportación / trazabilidad

router.post('/casos', crearPuertosCaso);

router.get('/casos', obtenerPuertosCasos);

router.get('/casos/:id', obtenerPuertosCasoPorId);

router.put('/casos/:id', actualizarPuertosCaso);

router.delete('/casos/:id', eliminarPuertosCaso);



// Actas BV

router.post('/actas', crearPuertosActa);

router.get('/actas', obtenerPuertosActas);

router.get('/actas/:id', obtenerPuertosActaPorId);

router.put('/actas/:id', actualizarPuertosActa);

router.delete('/actas/:id', eliminarPuertosActa);



export default router;

