import express from 'express';
import {
  crearCasoBbvaCat,
  listarCasosBbvaCat,
  obtenerCasoBbvaCat,
  actualizarCasoBbvaCat,
  eliminarCasoBbvaCat,
  importarCasosBbvaCat,
  syncDesdeExpress,
  subirArchivoBbvaCat,
  actualizarArchivoBbvaCat,
  reordenarArchivosBbvaCat,
  eliminarArchivoBbvaCat,
  getAlertasBbvaCat,
  postEnviarAlertasBbvaCatTodas,
  postEnviarAlertasBbvaCatAjustador,
  postGeocodePendientesBbvaCat,
  postUbicacionesPredioBbvaCat,
  getBloquesCercaniaBbvaCat,
} from '../controllers/bbvaCat.controller.js';
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

const persistBbvaCat = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.BBVA_CAT,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosBbvaCat);
router.get('/bloques-cercania', getBloquesCercaniaBbvaCat);
router.post('/geocode-pendientes', verificarToken, postGeocodePendientesBbvaCat);
router.post('/ubicaciones-predio', verificarToken, postUbicacionesPredioBbvaCat);
router.post('/importar', importarCasosBbvaCat);
router.post('/sync-express', syncDesdeExpress);

router.get('/alertas', getAlertasBbvaCat);
router.post('/alertas/enviar', postEnviarAlertasBbvaCatTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasBbvaCatAjustador);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistBbvaCat,
  subirArchivoBbvaCat
);
router.put(`/:id(${ID_MONGO})/archivos/orden`, reordenarArchivosBbvaCat);
router.patch(`/:id(${ID_MONGO})/archivos/:archivoId`, actualizarArchivoBbvaCat);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoBbvaCat);
router.get(`/:id(${ID_MONGO})`, obtenerCasoBbvaCat);
router.post('/', crearCasoBbvaCat);
router.put(`/:id(${ID_MONGO})`, verificarToken, actualizarCasoBbvaCat);
router.delete(`/:id(${ID_MONGO})`, eliminarCasoBbvaCat);

export default router;
