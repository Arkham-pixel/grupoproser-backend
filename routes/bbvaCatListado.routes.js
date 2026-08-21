import express from 'express';
import {
  crearCasoListadoBbvaCat,
  listarCasosListadoBbvaCat,
  obtenerCasoListadoBbvaCat,
  actualizarCasoListadoBbvaCat,
  eliminarCasoListadoBbvaCat,
  importarCasosListadoBbvaCat,
} from '../controllers/bbvaCatListado.controller.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', listarCasosListadoBbvaCat);
router.post('/importar', importarCasosListadoBbvaCat);
router.get('/:id', obtenerCasoListadoBbvaCat);
router.post('/', crearCasoListadoBbvaCat);
router.put('/:id', verificarToken, actualizarCasoListadoBbvaCat);
router.delete('/:id', eliminarCasoListadoBbvaCat);

export default router;
