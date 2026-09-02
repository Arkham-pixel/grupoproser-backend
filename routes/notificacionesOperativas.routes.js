import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import {
  getMisNotificacionesOperativas,
  patchLeerNotificacionOperativa,
  postLeerTodasNotificacionesOperativas,
} from '../controllers/notificacionesOperativas.controller.js';

const router = express.Router();

router.get('/mias', verificarToken, getMisNotificacionesOperativas);
router.post('/leer-todas', verificarToken, postLeerTodasNotificacionesOperativas);
router.patch('/:id/leer', verificarToken, patchLeerNotificacionOperativa);

export default router;
