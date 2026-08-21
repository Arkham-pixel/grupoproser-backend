import express from 'express';
import {
  crearCasoAllias,
  listarCasosAllias,
  obtenerCasoAllias,
  actualizarCasoAllias,
  eliminarCasoAllias,
  importarCasosAllias,
  syncDesdeExpress,
  subirArchivoAllias,
  actualizarArchivoAllias,
  reordenarArchivosAllias,
  eliminarArchivoAllias,
  getAlertasAllias,
  postEnviarAlertasAlliasTodas,
  postEnviarAlertasAlliasAjustador,
} from '../controllers/allias.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.ALLIAS,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistAllias = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ALLIAS,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosAllias);
router.post('/importar', importarCasosAllias);
router.post('/sync-express', syncDesdeExpress);

router.get('/alertas', getAlertasAllias);
router.post('/alertas/enviar', postEnviarAlertasAlliasTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasAlliasAjustador);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistAllias,
  subirArchivoAllias
);
router.put(`/:id(${ID_MONGO})/archivos/orden`, reordenarArchivosAllias);
router.patch(`/:id(${ID_MONGO})/archivos/:archivoId`, actualizarArchivoAllias);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoAllias);
router.get(`/:id(${ID_MONGO})`, obtenerCasoAllias);
router.post('/', crearCasoAllias);
router.put(`/:id(${ID_MONGO})`, verificarToken, actualizarCasoAllias);
router.delete(`/:id(${ID_MONGO})`, eliminarCasoAllias);

export default router;
