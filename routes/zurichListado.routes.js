import express from 'express';
import {
  crearCasoListadoZurich,
  listarCasosListadoZurich,
  obtenerCasoListadoZurich,
  actualizarCasoListadoZurich,
  eliminarCasoListadoZurich,
  importarCasosListadoZurich,
  subirArchivoListadoZurich,
  eliminarArchivoListadoZurich,
} from '../controllers/zurichListado.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.ZURICH_LISTADO,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistListado = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ZURICH_LISTADO,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosListadoZurich);
router.post('/importar', importarCasosListadoZurich);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistListado,
  subirArchivoListadoZurich
);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoListadoZurich);

router.get('/:id', obtenerCasoListadoZurich);
router.post('/', crearCasoListadoZurich);
router.put('/:id', verificarToken, actualizarCasoListadoZurich);
router.delete('/:id', eliminarCasoListadoZurich);

export default router;
