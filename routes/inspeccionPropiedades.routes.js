import express from 'express';
import { procesarFormularioInspeccion } from '../controllers/inspeccionPropiedadesController.js';

const router = express.Router();

router.post('/', procesarFormularioInspeccion);

export default router;

