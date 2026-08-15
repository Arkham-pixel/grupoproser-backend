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
} from '../controllers/equidadFdm.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';

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
