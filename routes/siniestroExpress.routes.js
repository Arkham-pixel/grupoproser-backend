import express from 'express';
import {
  crearSiniestroExpress,
  listarSiniestrosExpress,
  obtenerSiniestroExpress,
  actualizarSiniestroExpress,
  eliminarSiniestroExpress,
} from '../controllers/siniestroExpress.controller.js';
import {
  getAlertasExpressCaso,
  getAlertasExpressResumen,
  getAlertasExpressTodas,
  getProtocoloExpress,
  postEnviarAlertasExpressResponsable,
  postEnviarAlertasExpressTodas,
} from '../controllers/alertasExpress.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';

const router = express.Router();

const upload = createMulterUpload({ category: STORAGE_CATEGORIES.EXPRESS });
const persistExpressFiles = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.EXPRESS,
});

const uploadExpress = upload.fields([
  { name: 'anexos', maxCount: 30 },
  { name: 'salvamentoAnexos', maxCount: 30 },
]);

router.get('/', listarSiniestrosExpress);
router.get('/alertas/todas', getAlertasExpressTodas);
router.get('/alertas/resumen', getAlertasExpressResumen);
router.get('/alertas/protocolo', getProtocoloExpress);
router.get('/alertas/caso/:id', getAlertasExpressCaso);
router.post('/alertas/enviar', postEnviarAlertasExpressTodas);
router.post('/alertas/enviar/:codigoResponsable', postEnviarAlertasExpressResponsable);
router.get('/:id', obtenerSiniestroExpress);
router.post('/', uploadExpress, persistExpressFiles, crearSiniestroExpress);
router.put('/:id', uploadExpress, persistExpressFiles, actualizarSiniestroExpress);
router.delete('/:id', eliminarSiniestroExpress);

export default router;
