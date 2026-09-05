import express from 'express';
import multer from 'multer';
import {
  crearCasoSura,
  listarCasosSura,
  obtenerCasoSura,
  actualizarCasoSura,
  eliminarCasoSura,
  importarCasosSura,
  subirArchivoSura,
  eliminarArchivoSura,
  actualizarArchivoSura,
  listarDocumentosSharePointSura,
  listarPolizasImportadasSura,
  reintentarSyncSharePointSura,
  previewImportExcelSura,
  executeImportExcelSura,
  statusImportExcelSura,
  reportImportExcelSura,
  getAlertasSura,
  postEnviarAlertasSuraTodas,
  postEnviarAlertasSuraAjustador,
  getControlSeguimientoSuraStatus,
  postControlSeguimientoSuraCheck,
  postControlSeguimientoSuraDismissNotification,
  postGeocodePendientesSura,
  postUbicacionesPredioSura,
  getBloquesCercaniaSura,
  obtenerBandejaFacturacionSura,
  corregirEnvioBandejaFacturacionSura,
  eliminarEnvioBandejaFacturacionSura,
  notificarHonorariosSura,
  notificarControlHorasSura,
  notificarGerenciaSura,
  solicitarCorreccionControlHorasSura,
} from '../controllers/segurosSura.controller.js';
import {
  actualizarFacilitadorSura,
  importarFacilitadoresSura,
  listarFacilitadoresSura,
  sugerirFacilitadoresDesdeArnald,
  validarFacilitadoresSura,
} from '../controllers/suraFacilitadores.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES, getPublicPathForSingle } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';
import { poblarUsuarioOpcional } from '../middleware/usuarioOpcional.js';
import { verificarAdminSoporteOLiderSura } from '../middleware/verificarAdminSoporte.js';

const router = express.Router();

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.SEGUROS_SURA,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistSura = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.SEGUROS_SURA,
  ownerIdFromReq: (req) => req.params.id,
});

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.get('/', poblarUsuarioOpcional, listarCasosSura);

router.get('/facilitadores', poblarUsuarioOpcional, listarFacilitadoresSura);
router.get('/facilitadores/validar', poblarUsuarioOpcional, validarFacilitadoresSura);
router.post('/facilitadores/importar', verificarToken, importarFacilitadoresSura);
router.post('/facilitadores/sugerir-arnald', verificarToken, sugerirFacilitadoresDesdeArnald);
router.patch('/facilitadores/:id', verificarToken, actualizarFacilitadorSura);

const persistSuraUpload = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.SEGUROS_SURA,
});

router.post('/upload', upload.single('file'), persistSuraUpload, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo' });
  }
  const url = getPublicPathForSingle(req, (f) => `/uploads/sura/${f.filename}`);
  res.json({ url, filename: req.file.originalname });
});

router.get('/bandeja-facturacion', obtenerBandejaFacturacionSura);
router.patch('/bandeja-facturacion/envio', corregirEnvioBandejaFacturacionSura);
router.post('/bandeja-facturacion/envio/corregir', corregirEnvioBandejaFacturacionSura);
router.delete('/bandeja-facturacion/envio', eliminarEnvioBandejaFacturacionSura);
router.post('/bandeja-facturacion/envio/eliminar', eliminarEnvioBandejaFacturacionSura);

router.post('/notificaciones/honorarios', notificarHonorariosSura);
router.post('/notificaciones/control-horas', notificarControlHorasSura);
router.post('/notificaciones/control-horas/correccion', solicitarCorreccionControlHorasSura);
router.post('/notificaciones/gerencia', notificarGerenciaSura);

/** Bloques de cercanía (solo ARNALD; no SharePoint) — DEBE ir antes de /:id */
router.get('/bloques-cercania', getBloquesCercaniaSura);
router.post('/geocode-pendientes', verificarToken, postGeocodePendientesSura);
router.post('/ubicaciones-predio', verificarToken, postUbicacionesPredioSura);

/** Legacy JSON import (mantener compat); preferir /import/preview + /import/execute */
router.post('/importar', importarCasosSura);

router.post(
  '/import/preview',
  verificarToken,
  verificarAdminSoporteOLiderSura,
  excelUpload.single('file'),
  previewImportExcelSura
);
router.post(
  '/import/execute',
  verificarToken,
  verificarAdminSoporteOLiderSura,
  executeImportExcelSura
);
router.get(
  '/import/:importSessionId/report.xlsx',
  verificarToken,
  verificarAdminSoporteOLiderSura,
  reportImportExcelSura
);
router.get(
  '/import/:importSessionId',
  verificarToken,
  verificarAdminSoporteOLiderSura,
  statusImportExcelSura
);

router.get('/alertas', getAlertasSura);
router.post('/alertas/enviar', postEnviarAlertasSuraTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasSuraAjustador);

/** Control y Seguimiento — detección automática Excel SharePoint (solo preview) */
router.get(
  '/control-seguimiento/status',
  verificarToken,
  getControlSeguimientoSuraStatus
);
router.post(
  '/control-seguimiento/check',
  verificarToken,
  verificarAdminSoporteOLiderSura,
  postControlSeguimientoSuraCheck
);
router.post(
  '/control-seguimiento/notification/dismiss',
  verificarToken,
  postControlSeguimientoSuraDismissNotification
);

router.get('/:id/documentos-sharepoint', listarDocumentosSharePointSura);
router.get('/:id/polizas-importadas', listarPolizasImportadasSura);
router.post(
  '/:id/archivos/:archivoId/sharepoint/retry',
  verificarToken,
  verificarAdminSoporteOLiderSura,
  reintentarSyncSharePointSura
);

router.post(
  '/:id/archivos',
  upload.single('archivo'),
  persistSura,
  subirArchivoSura
);
router.patch('/:id/archivos/:archivoId', verificarToken, actualizarArchivoSura);
router.delete('/:id/archivos/:archivoId', eliminarArchivoSura);
router.get('/:id', poblarUsuarioOpcional, obtenerCasoSura);
router.post('/', crearCasoSura);
router.put('/:id', verificarToken, actualizarCasoSura);
router.delete('/:id', eliminarCasoSura);

export default router;
