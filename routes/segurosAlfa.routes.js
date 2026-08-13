import express from 'express';
import {
  crearCasoAlfa,
  listarCasosAlfa,
  obtenerCasoAlfa,
  actualizarCasoAlfa,
  eliminarCasoAlfa,
  importarCasosAlfa,
  subirArchivoAlfa,
  eliminarArchivoAlfa,
  getAlertasAlfa,
  postEnviarAlertasAlfaTodas,
  postEnviarAlertasAlfaAjustador,
  postGeocodePendientesAlfa,
  postUbicacionesPredioAlfa,
  getBloquesCercaniaAlfa,
} from '../controllers/segurosAlfa.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.SEGUROS_ALFA,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistAlfa = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.SEGUROS_ALFA,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosAlfa);

/** Bloques de cercanía (solo ARNALD) — DEBE ir antes de /:id */
router.get('/bloques-cercania', getBloquesCercaniaAlfa);
router.post('/geocode-pendientes', verificarToken, postGeocodePendientesAlfa);
router.post('/ubicaciones-predio', verificarToken, postUbicacionesPredioAlfa);

router.post('/importar', importarCasosAlfa);

router.get('/alertas', getAlertasAlfa);
router.post('/alertas/enviar', postEnviarAlertasAlfaTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasAlfaAjustador);

router.post(
  '/:id/archivos',
  upload.single('archivo'),
  persistAlfa,
  subirArchivoAlfa
);
router.delete('/:id/archivos/:archivoId', eliminarArchivoAlfa);
router.get('/:id', obtenerCasoAlfa);
router.post('/', crearCasoAlfa);
router.put('/:id', actualizarCasoAlfa);
router.delete('/:id', eliminarCasoAlfa);

export default router;
