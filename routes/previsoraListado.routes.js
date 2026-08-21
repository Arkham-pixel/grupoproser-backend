import express from 'express';
import {
  crearCasoListadoPrevisora,
  listarCasosListadoPrevisora,
  obtenerCasoListadoPrevisora,
  actualizarCasoListadoPrevisora,
  eliminarCasoListadoPrevisora,
  importarCasosListadoPrevisora,
  subirArchivoListadoPrevisora,
  eliminarArchivoListadoPrevisora,
} from '../controllers/previsoraListado.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.PREVISORA,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistListado = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.PREVISORA,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosListadoPrevisora);
router.post('/importar', importarCasosListadoPrevisora);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistListado,
  subirArchivoListadoPrevisora
);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoListadoPrevisora);

router.get('/:id', obtenerCasoListadoPrevisora);
router.post('/', crearCasoListadoPrevisora);
router.put('/:id', verificarToken, actualizarCasoListadoPrevisora);
router.delete('/:id', eliminarCasoListadoPrevisora);

export default router;
