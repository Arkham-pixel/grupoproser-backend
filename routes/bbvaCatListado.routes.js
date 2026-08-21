import express from 'express';
import {
  crearCasoListadoBbvaCat,
  listarCasosListadoBbvaCat,
  obtenerCasoListadoBbvaCat,
  actualizarCasoListadoBbvaCat,
  eliminarCasoListadoBbvaCat,
  importarCasosListadoBbvaCat,
  subirArchivoListadoBbvaCat,
  eliminarArchivoListadoBbvaCat,
} from '../controllers/bbvaCatListado.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.BBVA_CAT,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistListado = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.BBVA_CAT,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosListadoBbvaCat);
router.post('/importar', importarCasosListadoBbvaCat);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistListado,
  subirArchivoListadoBbvaCat
);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoListadoBbvaCat);

router.get('/:id', obtenerCasoListadoBbvaCat);
router.post('/', crearCasoListadoBbvaCat);
router.put('/:id', verificarToken, actualizarCasoListadoBbvaCat);
router.delete('/:id', eliminarCasoListadoBbvaCat);

export default router;
