import express from 'express';
import { 
  obtenerFuncionarios, 
  obtenerFuncionarioPorId, 
  crearFuncionario, 
  actualizarFuncionario, 
  eliminarFuncionario 
} from '../controllers/funcionarioAseguradoraController.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';

const router = express.Router();

// GET /api/funcionarios-aseguradora - Obtener todos los funcionarios o filtrar por codiAsgrdra (público para lectura)
router.get('/', obtenerFuncionarios);

// GET /api/funcionarios-aseguradora/:id - Obtener un funcionario por ID (público para lectura)
router.get('/:id', obtenerFuncionarioPorId);

// Rutas protegidas para admin/soporte
// POST /api/funcionarios-aseguradora - Crear nuevo funcionario
router.post('/', verificarAdminSoporte, crearFuncionario);

// PUT /api/funcionarios-aseguradora/:id - Actualizar funcionario
router.put('/:id', verificarAdminSoporte, actualizarFuncionario);

// DELETE /api/funcionarios-aseguradora/:id - Eliminar funcionario
router.delete('/:id', verificarAdminSoporte, eliminarFuncionario);

export default router; 