import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import { autorizarCasoSgSst, autorizarOperacionSgSst } from '../middleware/sgSstAccess.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import {
  listarCasos,
  obtenerCaso,
  crearCaso,
  actualizarCaso,
  subirEvidencia,
  eliminarEvidencia,
  descargarPaquete,
  eliminarCaso,
} from '../controllers/sgSstController.js';

const router = express.Router();

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.SGSST,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistSgSst = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.SGSST,
  ownerIdFromReq: (req) => req.params.id,
});

router.use(verificarToken);

router.get('/casos', autorizarOperacionSgSst, listarCasos);
router.post('/casos', autorizarOperacionSgSst, crearCaso);
router.get('/casos/:id', autorizarCasoSgSst, obtenerCaso);
router.put('/casos/:id', autorizarCasoSgSst, actualizarCaso);
router.delete('/casos/:id', autorizarCasoSgSst, eliminarCaso);
router.post(
  '/casos/:id/items/:itemId/archivos',
  autorizarCasoSgSst,
  upload.single('archivo'),
  persistSgSst,
  subirEvidencia
);
router.delete('/casos/:id/archivos/:archivoId', autorizarCasoSgSst, eliminarEvidencia);
router.get('/casos/:id/paquete', autorizarCasoSgSst, descargarPaquete);

export default router;
