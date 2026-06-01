import express from 'express';
import {
  getAlertasAjustador,
  getAlertasTodosAjustadores,
  postEnviarAlertasEmail,
  postEnviarAlertasTodosAjustadores,
  getResumenAlertas,
  getAlertasPorPrioridad,
  getAlertasPorTipo
} from '../controllers/alertasController.js';

const router = express.Router();

// 🔍 OBTENER ALERTAS
// GET /api/alertas/resumen - Resumen general de alertas (para dashboard)
router.get('/resumen', getResumenAlertas);

// GET /api/alertas/todos - Todas las alertas de todos los ajustadores
router.get('/todos', getAlertasTodosAjustadores);

// GET /api/alertas/ajustador/:codigoResponsable - Alertas de un ajustador específico
router.get('/ajustador/:codigoResponsable', getAlertasAjustador);

// GET /api/alertas/prioridad/:prioridad - Alertas por prioridad (ALTA, MEDIA, BAJA)
router.get('/prioridad/:prioridad', getAlertasPorPrioridad);

// GET /api/alertas/tipo/:tipo - Alertas por tipo específico
router.get('/tipo/:tipo', getAlertasPorTipo);

// 📧 ENVIAR ALERTAS POR EMAIL
// POST /api/alertas/enviar/ajustador/:codigoResponsable - Enviar alertas a un ajustador
router.post('/enviar/ajustador/:codigoResponsable', postEnviarAlertasEmail);

// POST /api/alertas/enviar/todos - Enviar alertas a todos los ajustadores
router.post('/enviar/todos', postEnviarAlertasTodosAjustadores);

export default router;

