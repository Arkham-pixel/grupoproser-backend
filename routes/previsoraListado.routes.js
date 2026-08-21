import express from 'express';
import {
  crearCasoListadoPrevisora,
  listarCasosListadoPrevisora,
  obtenerCasoListadoPrevisora,
  actualizarCasoListadoPrevisora,
  eliminarCasoListadoPrevisora,
  importarCasosListadoPrevisora,
} from '../controllers/previsoraListado.controller.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', listarCasosListadoPrevisora);
router.post('/importar', importarCasosListadoPrevisora);
router.get('/:id', obtenerCasoListadoPrevisora);
router.post('/', crearCasoListadoPrevisora);
router.put('/:id', verificarToken, actualizarCasoListadoPrevisora);
router.delete('/:id', eliminarCasoListadoPrevisora);

export default router;
