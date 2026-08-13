import express from 'express';
import {
  crearCasoFdm,
  listarCasosFdm,
  obtenerCasoFdm,
  actualizarCasoFdm,
  eliminarCasoFdm,
  importarCasosFdm,
} from '../controllers/equidadFdm.controller.js';

const router = express.Router();

router.get('/', listarCasosFdm);
router.post('/importar', importarCasosFdm);
router.get('/:id', obtenerCasoFdm);
router.post('/', crearCasoFdm);
router.put('/:id', actualizarCasoFdm);
router.delete('/:id', eliminarCasoFdm);

export default router;
