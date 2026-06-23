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

import { verificarToken } from '../middleware/verificarToken.js';

import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';

import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';



const router = express.Router();



const uploadPuertosImages = createMulterUpload({

  category: STORAGE_CATEGORIES.PUERTOS,

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



const persistPuertosImages = attachPersistedFileMiddleware({

  category: STORAGE_CATEGORIES.PUERTOS,

  ownerIdFromReq: (req) => req.query.casoId || 'general',

});



// Listado unificado (Actas + Casos exportación)

router.get('/registros', listarRegistrosPuertos);



// Subida de imágenes a S3 / disco (antes de guardar el caso)

router.post(

  '/casos/upload-images',

  verificarToken,

  (req, res, next) => {

    uploadPuertosImages.array('imagenes', 100)(req, res, (err) => {

      if (!err) return next();

      if (err?.code === 'LIMIT_FILE_SIZE') {

        return res.status(413).json({

          error: 'La imagen supera el tamaño máximo permitido (25MB).',

          code: err.code,

        });

      }

      return res.status(400).json({

        error: err.message || 'Error al subir imágenes',

        code: err.code,

      });

    });

  },

  persistPuertosImages,

  subirImagenesPuertosCaso

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

