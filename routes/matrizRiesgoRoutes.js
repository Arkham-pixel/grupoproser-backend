import express from 'express';
import {
  crearMatrizRiesgo,
  obtenerMatricesRiesgo,
  obtenerMatrizRiesgo,
  actualizarMatrizRiesgo,
  convertirAFinal,
  eliminarMatrizRiesgo,
  obtenerHistorialMatriz
} from '../controllers/matrizRiesgoController.js';
import { verificarToken } from '../middleware/verificarToken.js';

const router = express.Router();

// Aplicar middleware de autenticación a todas las rutas
router.use(verificarToken);

// Rutas para matrices de riesgo
router.post('/', crearMatrizRiesgo);
router.get('/', obtenerMatricesRiesgo);
router.get('/:id', obtenerMatrizRiesgo);
router.put('/:id', actualizarMatrizRiesgo);
router.post('/:id/convertir-final', convertirAFinal);
router.delete('/:id', eliminarMatrizRiesgo);
router.get('/:id/historial', obtenerHistorialMatriz);

export default router;

