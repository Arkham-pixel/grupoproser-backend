import express from 'express';
import {
  crearCasoListadoAllianz,
  listarCasosListadoAllianz,
  obtenerCasoListadoAllianz,
  actualizarCasoListadoAllianz,
  eliminarCasoListadoAllianz,
  importarCasosListadoAllianz,
  subirArchivoListadoAllianz,
  eliminarArchivoListadoAllianz,
} from '../controllers/allianzListado.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.ALLIANZ,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistListado = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ALLIANZ,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosListadoAllianz);
router.post('/importar', importarCasosListadoAllianz);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistListado,
  subirArchivoListadoAllianz
);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoListadoAllianz);

router.get('/:id', obtenerCasoListadoAllianz);
router.post('/', crearCasoListadoAllianz);
router.put('/:id', verificarToken, actualizarCasoListadoAllianz);
router.delete('/:id', eliminarCasoListadoAllianz);

export default router;
