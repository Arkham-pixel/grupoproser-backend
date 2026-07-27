import express from 'express';
import {
  crearCasoPropiedades,
  listarCasosPropiedades,
  obtenerCasoPropiedades,
  actualizarCasoPropiedades,
  vincularInspeccionCasoPropiedades,
  eliminarCasoPropiedades,
} from '../controllers/propiedades.controller.js';

const router = express.Router();

router.get('/', listarCasosPropiedades);
router.get('/:id', obtenerCasoPropiedades);
router.post('/', crearCasoPropiedades);
router.put('/:id', actualizarCasoPropiedades);
router.patch('/:id/inspeccion', vincularInspeccionCasoPropiedades);
router.delete('/:id', eliminarCasoPropiedades);

export default router;
