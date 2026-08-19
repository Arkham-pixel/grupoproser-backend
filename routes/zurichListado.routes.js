import express from 'express';
import {
  crearCasoListadoZurich,
  listarCasosListadoZurich,
  obtenerCasoListadoZurich,
  actualizarCasoListadoZurich,
  eliminarCasoListadoZurich,
  importarCasosListadoZurich,
} from '../controllers/zurichListado.controller.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', listarCasosListadoZurich);
router.post('/importar', importarCasosListadoZurich);
router.get('/:id', obtenerCasoListadoZurich);
router.post('/', crearCasoListadoZurich);
router.put('/:id', verificarToken, actualizarCasoListadoZurich);
router.delete('/:id', eliminarCasoListadoZurich);

export default router;
