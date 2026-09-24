import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import { restringirVideoperitaje } from '../config/videoperitajePermitidos.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import {
  crearSesion,
  listarSesiones,
  obtenerSesion,
  tokenLivekitPerito,
  finalizarSesion,
  cancelarSesion,
  eliminarSesion,
  vaciarHistorialSesiones,
  reenviarInvitacion,
  listarModulosCasoVideoperitaje,
  buscarCasosVideoperitaje,
  asignarSesionACaso,
  obtenerCupoVideoperitaje,
  obtenerPublica,
  joinPublico,
  subirFotoPublica,
  completarPasoPublico,
  presignUploadPublico,
  completarUploadPublico,
  subirFotoPerito,
  presignUploadPerito,
  completarUploadPerito,
  listarPlantillas,
  crearPlantilla,
  actualizarPlantilla,
  archivarPlantilla,
} from '../controllers/videoperitaje.controller.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.VIDEOPERITAJE,
  multerOptions: {
    limits: { fileSize: 400 * 1024 * 1024 },
  },
});

const persistPublico = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.VIDEOPERITAJE,
  ownerIdFromReq: (req) => req.params.token,
});

const persistPerito = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.VIDEOPERITAJE,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/public/:token', obtenerPublica);
router.post('/public/:token/join', joinPublico);
router.post('/public/:token/fotos', upload.single('archivo'), persistPublico, subirFotoPublica);
router.post('/public/:token/uploads/presign', presignUploadPublico);
router.post('/public/:token/uploads/completar', completarUploadPublico);
router.post('/public/:token/pasos/completar', completarPasoPublico);

router.use(verificarToken);
router.use(restringirVideoperitaje);

router.get('/sesiones', listarSesiones);
router.post('/sesiones', crearSesion);
router.delete('/sesiones', vaciarHistorialSesiones);
router.get(`/sesiones/:id(${ID_MONGO})`, obtenerSesion);
router.delete(`/sesiones/:id(${ID_MONGO})`, eliminarSesion);
router.post(`/sesiones/:id(${ID_MONGO})/token-livekit`, tokenLivekitPerito);
router.post(`/sesiones/:id(${ID_MONGO})/finalizar`, finalizarSesion);
router.post(`/sesiones/:id(${ID_MONGO})/cancelar`, cancelarSesion);
router.post(`/sesiones/:id(${ID_MONGO})/reenviar`, reenviarInvitacion);
router.post(`/sesiones/:id(${ID_MONGO})/asignar-caso`, asignarSesionACaso);
router.get('/casos/modulos', listarModulosCasoVideoperitaje);
router.get('/casos/buscar', buscarCasosVideoperitaje);
router.get('/cupo', obtenerCupoVideoperitaje);
router.post(
  `/sesiones/:id(${ID_MONGO})/fotos`,
  upload.single('archivo'),
  persistPerito,
  subirFotoPerito
);
router.post(`/sesiones/:id(${ID_MONGO})/uploads/presign`, presignUploadPerito);
router.post(`/sesiones/:id(${ID_MONGO})/uploads/completar`, completarUploadPerito);

router.get('/plantillas', listarPlantillas);
router.post('/plantillas', crearPlantilla);
router.put(`/plantillas/:id(${ID_MONGO})`, actualizarPlantilla);
router.post(`/plantillas/:id(${ID_MONGO})/archivar`, archivarPlantilla);

export default router;
