import express from 'express';
import {
  crearCasoZurich,
  listarCasosZurich,
  obtenerCasoZurich,
  actualizarCasoZurich,
  eliminarCasoZurich,
  importarCasosZurich,
  syncDesdeExpress,
  subirArchivoZurich,
  actualizarArchivoZurich,
  reordenarArchivosZurich,
  eliminarArchivoZurich,
  getAlertasZurich,
  postEnviarAlertasZurichTodas,
  postEnviarAlertasZurichAjustador,
} from '../controllers/zurich.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.ZURICH,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistZurich = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ZURICH,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosZurich);
router.post('/importar', importarCasosZurich);
router.post('/sync-express', syncDesdeExpress);

router.get('/alertas', getAlertasZurich);
router.post('/alertas/enviar', postEnviarAlertasZurichTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasZurichAjustador);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistZurich,
  subirArchivoZurich
);
router.put(`/:id(${ID_MONGO})/archivos/orden`, reordenarArchivosZurich);
router.patch(`/:id(${ID_MONGO})/archivos/:archivoId`, actualizarArchivoZurich);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoZurich);
router.get(`/:id(${ID_MONGO})`, obtenerCasoZurich);
router.post('/', crearCasoZurich);
router.put(`/:id(${ID_MONGO})`, verificarToken, actualizarCasoZurich);
router.delete(`/:id(${ID_MONGO})`, eliminarCasoZurich);

export default router;
