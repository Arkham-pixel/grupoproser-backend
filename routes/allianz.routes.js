import express from 'express';
import {
  crearCasoAllianz,
  listarCasosAllianz,
  obtenerCasoAllianz,
  actualizarCasoAllianz,
  eliminarCasoAllianz,
  importarCasosAllianz,
  syncDesdeExpress,
  subirArchivoAllianz,
  actualizarArchivoAllianz,
  reordenarArchivosAllianz,
  eliminarArchivoAllianz,
  getAlertasAllianz,
  postEnviarAlertasAllianzTodas,
  postEnviarAlertasAllianzAjustador,
} from '../controllers/allianz.controller.js';
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

const persistAllianz = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ALLIANZ,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosAllianz);
router.post('/importar', importarCasosAllianz);
router.post('/sync-express', syncDesdeExpress);

router.get('/alertas', getAlertasAllianz);
router.post('/alertas/enviar', postEnviarAlertasAllianzTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasAllianzAjustador);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistAllianz,
  subirArchivoAllianz
);
router.put(`/:id(${ID_MONGO})/archivos/orden`, reordenarArchivosAllianz);
router.patch(`/:id(${ID_MONGO})/archivos/:archivoId`, actualizarArchivoAllianz);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoAllianz);
router.get(`/:id(${ID_MONGO})`, obtenerCasoAllianz);
router.post('/', crearCasoAllianz);
router.put(`/:id(${ID_MONGO})`, verificarToken, actualizarCasoAllianz);
router.delete(`/:id(${ID_MONGO})`, eliminarCasoAllianz);

export default router;
