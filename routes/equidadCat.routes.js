import express from 'express';
import {
  crearCasoListadoEquidadCat,
  listarCasosListadoEquidadCat,
  obtenerCasoListadoEquidadCat,
  actualizarCasoListadoEquidadCat,
  eliminarCasoListadoEquidadCat,
  importarCasosListadoEquidadCat,
  subirArchivoListadoEquidadCat,
  eliminarArchivoListadoEquidadCat,
} from '../controllers/equidadCat.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.EQUIDAD_CAT,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistListado = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.EQUIDAD_CAT,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosListadoEquidadCat);
router.post('/importar', importarCasosListadoEquidadCat);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistListado,
  subirArchivoListadoEquidadCat
);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoListadoEquidadCat);

router.get('/:id', obtenerCasoListadoEquidadCat);
router.post('/', crearCasoListadoEquidadCat);
router.put('/:id', verificarToken, actualizarCasoListadoEquidadCat);
router.delete('/:id', eliminarCasoListadoEquidadCat);

export default router;
