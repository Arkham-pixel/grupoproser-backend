import express from 'express';
import { obtenerCiudades } from '../controllers/ciudadController.js';
const router = express.Router();

// Ruta principal para obtener ciudades
router.get('/ciudades', obtenerCiudades);

// Mantener la ruta anterior por compatibilidad
router.get('/ciudades/ciudades', obtenerCiudades);

export default router;
