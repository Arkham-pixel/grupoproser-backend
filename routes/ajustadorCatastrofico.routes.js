import express from 'express';
import {
  listarAjustadoresCatastrofico,
  obtenerAjustadorCatastroficoPorId,
  crearAjustadorCatastrofico,
  actualizarAjustadorCatastrofico,
  eliminarAjustadorCatastrofico,
} from '../controllers/ajustadorCatastrofico.controller.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';

const router = express.Router();

router.get('/', listarAjustadoresCatastrofico);
router.get('/:id', obtenerAjustadorCatastroficoPorId);
router.post('/', verificarAdminSoporte, crearAjustadorCatastrofico);
router.put('/:id', verificarAdminSoporte, actualizarAjustadorCatastrofico);
router.delete('/:id', verificarAdminSoporte, eliminarAjustadorCatastrofico);

export default router;
