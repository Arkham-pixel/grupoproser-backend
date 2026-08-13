import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import { verificarAdminSoporte } from '../middleware/verificarAdminSoporte.js';
import { sharepointHealth } from '../controllers/sharepoint.controller.js';

const router = express.Router();

/**
 * Integración SharePoint (réplica documental).
 * Montado en: /api/integrations/sharepoint
 *
 * Fase 1: solo health. No altera uploads ni S3.
 */
router.get('/health', verificarToken, verificarAdminSoporte, sharepointHealth);

export default router;
