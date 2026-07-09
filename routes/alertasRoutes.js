import express from 'express';
import {
  getAlertasAjustador,
  getAlertasTodosAjustadores,
  postEnviarAlertasEmail,
  postEnviarAlertasTodosAjustadores,
  getResumenAlertas,
  getAlertasPorPrioridad,
  getAlertasPorTipo,
  getProtocoloSiniestros,
  putProtocoloSiniestros,
  postRestaurarProtocoloSiniestros,
  getMisAlertas,
  getAlertasCaso,
  getHistorialProtocolo,
} from '../controllers/alertasController.js';

const router = express.Router();

// 🔍 OBTENER ALERTAS
// GET /api/alertas/resumen - Resumen general de alertas (para dashboard)
router.get('/resumen', getResumenAlertas);

// GET /api/alertas/todos - Todas las alertas de todos los ajustadores
router.get('/todos', getAlertasTodosAjustadores);

// GET /api/alertas/mis-casos - Alertas del ajustador logueado (fase 2 in-app)
router.get('/mis-casos', getMisAlertas);

// GET /api/alertas/caso/:identificador - Alertas de un caso específico
router.get('/caso/:identificador', getAlertasCaso);

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

// 📋 PROTOCOLO DE TIEMPOS (parametrización)
router.get('/protocolo', getProtocoloSiniestros);
router.put('/protocolo', putProtocoloSiniestros);
router.post('/protocolo/restaurar', postRestaurarProtocoloSiniestros);
router.get('/protocolo/historial', getHistorialProtocolo);

export default router;

