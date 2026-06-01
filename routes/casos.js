import express from 'express';
import { crearCaso, obtenerCasos, obtenerCasoPorId, actualizarCaso, eliminarCaso, buscarCasos } from '../controllers/casoController.js';

const router = express.Router();

router.post('/', crearCaso);
router.get('/', obtenerCasos);
router.get('/buscar', buscarCasos);
router.get('/:id', obtenerCasoPorId);
router.put('/:id', actualizarCaso);
router.delete('/:id', eliminarCaso);

export default router;