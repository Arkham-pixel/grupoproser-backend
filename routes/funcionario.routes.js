import express from 'express';
import { 
  obtenerFuncionarios, 
  obtenerFuncionario, 
  crearFuncionario, 
  actualizarFuncionario, 
  eliminarFuncionario,
  actualizarFirmaFuncionario 
} from '../controllers/funcionarioController.js';
import { verificarToken } from '../middleware/verificarToken.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(verificarToken);

// GET /api/funcionarios - Obtener todos los funcionarios
router.get('/', obtenerFuncionarios);

// GET /api/funcionarios/:id - Obtener un funcionario por ID
router.get('/:id', obtenerFuncionario);

// POST /api/funcionarios - Crear nuevo funcionario
router.post('/', crearFuncionario);

// PUT /api/funcionarios/:id - Actualizar funcionario
router.put('/:id', actualizarFuncionario);

// DELETE /api/funcionarios/:id - Eliminar funcionario (soft delete)
router.delete('/:id', eliminarFuncionario);

// PUT /api/funcionarios/:id/firma - Actualizar firma de funcionario
router.put('/:id/firma', actualizarFirmaFuncionario);

export default router;
