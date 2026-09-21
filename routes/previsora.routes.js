import express from 'express';
import {
  crearCasoPrevisora,
  listarCasosPrevisora,
  obtenerCasoPrevisora,
  actualizarCasoPrevisora,
  eliminarCasoPrevisora,
  importarCasosPrevisora,
  syncDesdeExpress,
  subirArchivoPrevisora,
  actualizarArchivoPrevisora,
  reordenarArchivosPrevisora,
  eliminarArchivoPrevisora,
  getAlertasPrevisora,
  postEnviarAlertasPrevisoraTodas,
  postEnviarAlertasPrevisoraAjustador,
} from '../controllers/previsora.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES, getPublicPathForSingle } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';
import {
  notificarControlHorasCat,
  notificarGerenciaCat,
  obtenerBandejaFacturacionCat,
  corregirEnvioBandejaFacturacionCat,
  eliminarEnvioBandejaFacturacionCat,
} from '../controllers/catFacturacion.controller.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.PREVISORA,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistPrevisora = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.PREVISORA,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosPrevisora);
router.post('/importar', importarCasosPrevisora);
router.post('/sync-express', syncDesdeExpress);

router.get('/alertas', getAlertasPrevisora);
router.post('/alertas/enviar', postEnviarAlertasPrevisoraTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasPrevisoraAjustador);

const persistPrevisoraUpload = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.PREVISORA,
});
router.post('/upload', upload.single('file'), persistPrevisoraUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  const url = getPublicPathForSingle(req, (f) => `/uploads/previsora/${f.filename}`);
  res.json({ url, filename: req.file.originalname, ruta: url });
});
router.post('/notificaciones/control-horas', verificarToken, notificarControlHorasCat);
router.post('/notificaciones/gerencia', verificarToken, notificarGerenciaCat);
router.get('/bandeja-facturacion', verificarToken, obtenerBandejaFacturacionCat);
router.patch('/bandeja-facturacion/envio', verificarToken, corregirEnvioBandejaFacturacionCat);
router.post('/bandeja-facturacion/envio/corregir', verificarToken, corregirEnvioBandejaFacturacionCat);
router.delete('/bandeja-facturacion/envio', verificarToken, eliminarEnvioBandejaFacturacionCat);
router.post('/bandeja-facturacion/envio/eliminar', verificarToken, eliminarEnvioBandejaFacturacionCat);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistPrevisora,
  subirArchivoPrevisora
);
router.put(`/:id(${ID_MONGO})/archivos/orden`, reordenarArchivosPrevisora);
router.patch(`/:id(${ID_MONGO})/archivos/:archivoId`, actualizarArchivoPrevisora);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoPrevisora);
router.get(`/:id(${ID_MONGO})`, obtenerCasoPrevisora);
router.post('/', crearCasoPrevisora);
router.put(`/:id(${ID_MONGO})`, verificarToken, actualizarCasoPrevisora);
router.delete(`/:id(${ID_MONGO})`, eliminarCasoPrevisora);

export default router;
