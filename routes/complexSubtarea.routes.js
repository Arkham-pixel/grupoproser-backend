import express from 'express';
import {
  listarPorCaso,
  listarMias,
  crearSubtarea,
  actualizarSubtarea,
  cancelarSubtarea,
  reenviarNotificacion,
  subirArchivoAutenticado,
  obtenerPublica,
  actualizarPublica,
  subirArchivoPublico,
  resumenCaso,
  obtenerUna,
} from '../controllers/complexSubtarea.controller.js';
import { poblarUsuarioOpcional } from '../middleware/usuarioOpcional.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';

const router = express.Router();

const upload = createMulterUpload({ category: STORAGE_CATEGORIES.COMPLEX });
const persistComplexFile = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.COMPLEX,
});

// Públicas (sin JWT)
router.get('/public/:token', obtenerPublica);
router.patch('/public/:token', actualizarPublica);
router.post(
  '/public/:token/archivos',
  upload.single('file'),
  persistComplexFile,
  subirArchivoPublico
);

// Autenticadas
router.get('/mias', poblarUsuarioOpcional, listarMias);
router.get('/caso/:casoId/resumen', poblarUsuarioOpcional, resumenCaso);
router.get('/caso/:casoId', poblarUsuarioOpcional, listarPorCaso);
router.post('/caso/:casoId', poblarUsuarioOpcional, crearSubtarea);
router.get('/:id', poblarUsuarioOpcional, obtenerUna);
router.patch('/:id', poblarUsuarioOpcional, actualizarSubtarea);
router.delete('/:id', poblarUsuarioOpcional, cancelarSubtarea);
router.post('/:id/reenviar', poblarUsuarioOpcional, reenviarNotificacion);
router.post(
  '/:id/archivos',
  poblarUsuarioOpcional,
  upload.single('file'),
  persistComplexFile,
  subirArchivoAutenticado
);

export default router;
