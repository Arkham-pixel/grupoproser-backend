import express from 'express';
import multer from 'multer';
import {
  crearCasoAlfa,
  listarCasosAlfa,
  obtenerCasoAlfa,
  actualizarCasoAlfa,
  eliminarCasoAlfa,
  importarCasosAlfa,
  subirArchivoAlfa,
  eliminarArchivoAlfa,
  actualizarArchivoAlfa,
  listarDocumentosSharePointAlfa,
  listarPolizasImportadasAlfa,
  reintentarSyncSharePointAlfa,
  previewImportExcelAlfa,
  executeImportExcelAlfa,
  statusImportExcelAlfa,
  reportImportExcelAlfa,
  getAlertasAlfa,
  postEnviarAlertasAlfaTodas,
  postEnviarAlertasAlfaAjustador,
  getControlSeguimientoAlfaStatus,
  postControlSeguimientoAlfaCheck,
  postControlSeguimientoAlfaDismissNotification,
  postGeocodePendientesAlfa,
  postUbicacionesPredioAlfa,
  getBloquesCercaniaAlfa,
  getCondicionesAlfa,
  downloadCondicionAlfa,
} from '../controllers/segurosAlfa.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';
import { getAlfaExcelImportConfig } from '../config/alfaExcelImport.js';

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

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getAlfaExcelImportConfig().maxFileBytes },
});

router.get('/', listarCasosAlfa);

/** Bloques de cercanía (solo ARNALD; no SharePoint) — DEBE ir antes de /:id */
router.get('/bloques-cercania', getBloquesCercaniaAlfa);
router.post('/geocode-pendientes', verificarToken, postGeocodePendientesAlfa);
router.post('/ubicaciones-predio', verificarToken, postUbicacionesPredioAlfa);

/** Condiciones (PDFs raíz SEGUROS ALFA/PÓLIZAS) — antes de /:id */
router.get('/condiciones', verificarToken, getCondicionesAlfa);
router.get('/condiciones/:itemId/download', verificarToken, downloadCondicionAlfa);

/** Legacy JSON import (mantener compat); preferir /import/preview + /import/execute */
router.post('/importar', importarCasosAlfa);

router.post(
  '/import/preview',
  verificarToken,
  verificarAdminSoporte,
  excelUpload.single('file'),
  previewImportExcelAlfa
);
router.post(
  '/import/execute',
  verificarToken,
  verificarAdminSoporte,
  executeImportExcelAlfa
);
router.get(
  '/import/:importSessionId/report.xlsx',
  verificarToken,
  verificarAdminSoporte,
  reportImportExcelAlfa
);
router.get(
  '/import/:importSessionId',
  verificarToken,
  verificarAdminSoporte,
  statusImportExcelAlfa
);

router.get('/alertas', getAlertasAlfa);
router.post('/alertas/enviar', postEnviarAlertasAlfaTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasAlfaAjustador);

/** Control y Seguimiento — detección automática Excel SharePoint (solo preview) */
router.get(
  '/control-seguimiento/status',
  verificarToken,
  getControlSeguimientoAlfaStatus
);
router.post(
  '/control-seguimiento/check',
  verificarToken,
  verificarAdminSoporte,
  postControlSeguimientoAlfaCheck
);
router.post(
  '/control-seguimiento/notification/dismiss',
  verificarToken,
  postControlSeguimientoAlfaDismissNotification
);

router.get('/:id/documentos-sharepoint', listarDocumentosSharePointAlfa);
router.get('/:id/polizas-importadas', listarPolizasImportadasAlfa);
router.post(
  '/:id/archivos/:archivoId/sharepoint/retry',
  verificarToken,
  verificarAdminSoporte,
  reintentarSyncSharePointAlfa
);

router.post(
  '/:id/archivos',
  upload.single('archivo'),
  persistAlfa,
  subirArchivoAlfa
);
router.patch('/:id/archivos/:archivoId', verificarToken, actualizarArchivoAlfa);
router.delete('/:id/archivos/:archivoId', eliminarArchivoAlfa);
router.get('/:id', obtenerCasoAlfa);
router.post('/', crearCasoAlfa);
router.put('/:id', actualizarCasoAlfa);
router.delete('/:id', eliminarCasoAlfa);

export default router;
