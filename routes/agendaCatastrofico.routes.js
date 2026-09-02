import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import {
  getDisponibilidadAgendaCatastrofico,
  getEventosAgendaCatastrofico,
  getHoyAgendaCatastrofico,
  getPersonasAgendaCatastrofico,
} from '../controllers/agendaCatastrofico.controller.js';

const router = express.Router();

router.get('/', verificarToken, getEventosAgendaCatastrofico);
router.get('/disponibilidad', verificarToken, getDisponibilidadAgendaCatastrofico);
router.get('/hoy', verificarToken, getHoyAgendaCatastrofico);
router.get('/personas', verificarToken, getPersonasAgendaCatastrofico);

export default router;
