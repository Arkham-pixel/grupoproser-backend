import express from 'express';
import {
  crearCasoListadoAllias,
  listarCasosListadoAllias,
  obtenerCasoListadoAllias,
  actualizarCasoListadoAllias,
  eliminarCasoListadoAllias,
  importarCasosListadoAllias,
} from '../controllers/alliasListado.controller.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', listarCasosListadoAllias);
router.post('/importar', importarCasosListadoAllias);
router.get('/:id', obtenerCasoListadoAllias);
router.post('/', crearCasoListadoAllias);
router.put('/:id', verificarToken, actualizarCasoListadoAllias);
router.delete('/:id', eliminarCasoListadoAllias);

export default router;
