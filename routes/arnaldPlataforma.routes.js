import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import { listarLogsArnald, registrarEventoCliente } from '../controllers/arnaldAudit.controller.js';
import {
  borrarMiBorrador,
  guardarBorrador,
  guardarBorradorBeacon,
  listarBorradoresAdmin,
  listarMisBorradores,
  obtenerMiBorrador,
} from '../controllers/arnaldFormDraft.controller.js';

const router = express.Router();

router.get('/arnald-logs', verificarToken, listarLogsArnald);
router.post('/arnald-logs/evento', verificarToken, registrarEventoCliente);

router.get('/arnald-drafts', verificarToken, obtenerMiBorrador);
router.get('/arnald-drafts/mios', verificarToken, listarMisBorradores);
router.get('/arnald-drafts/admin', verificarToken, listarBorradoresAdmin);
router.put('/arnald-drafts', verificarToken, guardarBorrador);
router.delete('/arnald-drafts', verificarToken, borrarMiBorrador);
router.post('/arnald-drafts/beacon', guardarBorradorBeacon);

export default router;
