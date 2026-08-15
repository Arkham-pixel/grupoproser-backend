import express from 'express';
import {
  crearCasoFdm,
  listarCasosFdm,
  obtenerCasoFdm,
  actualizarCasoFdm,
  eliminarCasoFdm,
  importarCasosFdm,
  subirArchivoFdm,
  eliminarArchivoFdm,
  getBaseTerremotoFdmStatus,
  postBaseTerremotoFdmCheck,
  postBaseTerremotoFdmDismissNotification,
  getBaseTerremotoFdmImportSession,
  postBaseTerremotoFdmExecute,
} from '../controllers/equidadFdm.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';

const router = express.Router();

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.EQUIDAD_FDM,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistFdm = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.EQUIDAD_FDM,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosFdm);
router.post('/importar', importarCasosFdm);

/** Sync Excel SharePoint SEGUROS EQUIDAD (BASE TERREMOTO) */
router.get('/base-terremoto/status', verificarToken, getBaseTerremotoFdmStatus);
router.post(
  '/base-terremoto/check',
  verificarToken,
  verificarAdminSoporte,
  postBaseTerremotoFdmCheck
);
router.post(
  '/base-terremoto/notification/dismiss',
  verificarToken,
  postBaseTerremotoFdmDismissNotification
);
router.get(
  '/base-terremoto/import/:sessionId',
  verificarToken,
  getBaseTerremotoFdmImportSession
);
router.post(
  '/base-terremoto/execute',
  verificarToken,
  verificarAdminSoporte,
  postBaseTerremotoFdmExecute
);

router.post(
  '/:id/archivos',
  upload.single('archivo'),
  persistFdm,
  subirArchivoFdm
);
router.delete('/:id/archivos/:archivoId', eliminarArchivoFdm);

router.get('/:id', obtenerCasoFdm);
router.post('/', crearCasoFdm);
router.put('/:id', actualizarCasoFdm);
router.delete('/:id', eliminarCasoFdm);

export default router;
