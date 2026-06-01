import express from 'express';
import { 
  obtenerIntermediarios, 
  obtenerIntermediarioPorId, 
  crearIntermediario, 
  actualizarIntermediario, 
  eliminarIntermediario 
} from '../controllers/intermediarioController.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';

const router = express.Router();

console.log('✅ Rutas de intermediarios cargadas');

// Ruta de prueba para verificar que el router funciona
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Ruta de intermediarios funcionando correctamente' });
});

// Ruta para verificar el token y permisos (DEBE estar antes de /:id)
router.get('/verificar-token', verificarAdminSoporte, (req, res) => {
  res.json({ 
    success: true, 
    message: 'Token verificado correctamente',
    user: req.user
  });
});

// GET /api/intermediarios - Obtener todos los intermediarios (público para lectura)
router.get('/', obtenerIntermediarios);

// GET /api/intermediarios/:id - Obtener un intermediario por ID (público para lectura)
router.get('/:id', obtenerIntermediarioPorId);

// Rutas protegidas para admin/soporte
// POST /api/intermediarios - Crear nuevo intermediario
router.post('/', verificarAdminSoporte, crearIntermediario);

// PUT /api/intermediarios/:id - Actualizar intermediario
router.put('/:id', verificarAdminSoporte, actualizarIntermediario);

// DELETE /api/intermediarios/:id - Eliminar intermediario
router.delete('/:id', verificarAdminSoporte, eliminarIntermediario);

export default router;

