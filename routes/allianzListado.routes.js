import express from 'express';
import {
  crearCasoListadoAllianz,
  listarCasosListadoAllianz,
  obtenerCasoListadoAllianz,
  actualizarCasoListadoAllianz,
  eliminarCasoListadoAllianz,
  importarCasosListadoAllianz,
} from '../controllers/allianzListado.controller.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', listarCasosListadoAllianz);
router.post('/importar', importarCasosListadoAllianz);
router.get('/:id', obtenerCasoListadoAllianz);
router.post('/', crearCasoListadoAllianz);
router.put('/:id', verificarToken, actualizarCasoListadoAllianz);
router.delete('/:id', eliminarCasoListadoAllianz);

export default router;
