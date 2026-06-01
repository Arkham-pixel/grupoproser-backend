import express from 'express';
import {
  obtenerEstados,
  obtenerEstadosRiesgo,
  obtenerClasificacionesRiesgo,
  obtenerEstadosExpress,
  crearEstadoExpress,
  actualizarEstadoExpress,
  eliminarEstadoExpress,
  crearEstado,
  eliminarEstado,
} from '../controllers/estadoController.js';
import { verificarCatalogosExpress } from '../middleware/verificarCatalogosExpress.js';

const router = express.Router();

// Log para verificar que las rutas se están registrando
console.log('✅ Rutas de estados registradas:');
console.log('  - GET /api/estados');
console.log('  - GET /api/estados/express');
console.log('  - POST /api/estados/express (admin)');
console.log('  - PUT /api/estados/express/:id (admin)');
console.log('  - DELETE /api/estados/express/:id (admin)');
console.log('  - POST /api/estados (Complex)');
console.log('  - DELETE /api/estados/:id (Complex)');

// GET /api/estados
router.get('/', obtenerEstados);
router.get('/estados-riesgos', obtenerEstadosRiesgo);
router.get('/clasificaciones-riesgo', obtenerClasificacionesRiesgo);
router.get('/express', obtenerEstadosExpress);
router.post('/express', verificarCatalogosExpress, crearEstadoExpress);
router.put('/express/:id', verificarCatalogosExpress, actualizarEstadoExpress);
router.delete('/express/:id', verificarCatalogosExpress, eliminarEstadoExpress);

// POST /api/estados - Crear nuevo estado (Complex)
router.post('/', (req, res, next) => {
  console.log('📝 POST /api/estados recibido');
  console.log('📝 Body:', req.body);
  next();
}, crearEstado);

// DELETE /api/estados/:id - Eliminar estado
router.delete('/:id', eliminarEstado);

export default router; 