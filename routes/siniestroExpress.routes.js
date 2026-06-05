import express from 'express';
import {
  crearSiniestroExpress,
  listarSiniestrosExpress,
  actualizarSiniestroExpress,
  eliminarSiniestroExpress,
} from '../controllers/siniestroExpress.controller.js';
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
router.post('/', uploadExpress, persistExpressFiles, crearSiniestroExpress);
router.put('/:id', uploadExpress, persistExpressFiles, actualizarSiniestroExpress);
router.delete('/:id', eliminarSiniestroExpress);

export default router;
