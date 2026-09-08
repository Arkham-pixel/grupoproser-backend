import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import {
  crearInvitacion,
  listarInvitaciones,
  reenviarInvitacion,
  obtenerPublica,
  descargarPlantilla,
  firmarAcuerdo,
  registrarCuenta,
  subirDocumentoHr,
  descargarFirmado,
} from '../controllers/onboarding.controller.js';

const router = express.Router();

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.DOCUMENTOS,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistDoc = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.DOCUMENTOS,
});

const persistRegistro = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.DOCUMENTOS,
});

// ——— Públicas (sin JWT) ———
router.get('/public/:token', obtenerPublica);
router.get('/public/:token/plantilla/:tipo', descargarPlantilla);
router.get('/public/:token/firmado/:tipo', descargarFirmado);
router.post('/public/:token/firmar', firmarAcuerdo);
router.post(
  '/public/:token/registrar',
  upload.fields([
    { name: 'politicaPdf', maxCount: 1 },
    { name: 'confidencialidadPdf', maxCount: 1 },
  ]),
  persistRegistro,
  registrarCuenta
);
router.post(
  '/public/:token/documentos',
  upload.single('archivo'),
  persistDoc,
  subirDocumentoHr
);

// ——— Admin / soporte ———
router.use(verificarToken);
router.get('/invitaciones', listarInvitaciones);
router.post('/invitar', crearInvitacion);
router.post('/invitaciones/:id/reenviar', reenviarInvitacion);

export default router;
