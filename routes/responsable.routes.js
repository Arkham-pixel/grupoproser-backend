import express from 'express';
import {
  obtenerResponsables,
  obtenerResponsablePorId,
  crearResponsable,
  actualizarResponsable,
  eliminarResponsable
} from '../controllers/responsableController.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';

const router = express.Router();

console.log('✅ Rutas de responsables cargadas');

// GET /api/responsables - Obtener todos los responsables (público para lectura)
router.get('/', obtenerResponsables);

// GET /api/responsables/:id - Obtener un responsable por ID (público para lectura)
router.get('/:id', obtenerResponsablePorId);

// Rutas protegidas para admin/soporte
// POST /api/responsables - Crear nuevo responsable
router.post('/', verificarAdminSoporte, crearResponsable);

// PUT /api/responsables/:id - Actualizar responsable
router.put('/:id', verificarAdminSoporte, actualizarResponsable);

// DELETE /api/responsables/:id - Eliminar responsable
router.delete('/:id', verificarAdminSoporte, eliminarResponsable);

export default router; 