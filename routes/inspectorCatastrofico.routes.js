import express from 'express';
import {
  listarInspectoresCatastrofico,
  obtenerInspectorCatastroficoPorId,
  crearInspectorCatastrofico,
  actualizarInspectorCatastrofico,
  eliminarInspectorCatastrofico,
} from '../controllers/inspectorCatastrofico.controller.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';

const router = express.Router();

router.get('/', listarInspectoresCatastrofico);
router.get('/:id', obtenerInspectorCatastroficoPorId);
router.post('/', verificarAdminSoporte, crearInspectorCatastrofico);
router.put('/:id', verificarAdminSoporte, actualizarInspectorCatastrofico);
router.delete('/:id', verificarAdminSoporte, eliminarInspectorCatastrofico);

export default router;
