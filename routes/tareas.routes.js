import express from 'express';
import {
  getTareas,
  crearTarea,
  editarTarea,
  marcarCumplida,
  eliminarTarea,
  getTareasPorPrioridad,
  getResumenTareas
} from '../controllers/tareasController.js';
import { AlertasTareasService } from '../services/alertasTareasService.js';
// import { verificarToken } from '../middleware/auth.js'; // Descomenta si tienes auth

const router = express.Router();

// 📋 GESTIÓN DE TAREAS
// GET /api/tareas - Listar tareas por login
router.get('/', getTareas);

// POST /api/tareas - Crear tarea
router.post('/', crearTarea);

// PUT /api/tareas/:id - Editar tarea
router.put('/:id', editarTarea);

// PATCH /api/tareas/:id/cumplida - Marcar cumplida/no cumplida
router.patch('/:id/cumplida', marcarCumplida);

// DELETE /api/tareas/:id - Eliminar tarea
router.delete('/:id', eliminarTarea);

// 📊 REPORTES Y CONSULTAS
// GET /api/tareas/prioridad/:prioridad - Tareas por prioridad
router.get('/prioridad/:prioridad', getTareasPorPrioridad);

// GET /api/tareas/resumen - Resumen de tareas
router.get('/resumen', getResumenTareas);

// 🔔 ALERTAS AUTOMÁTICAS
// POST /api/tareas/procesar-alertas - Ejecutar alertas manualmente (para pruebas)
router.post('/procesar-alertas', async (req, res) => {
  try {
    const resultado = await AlertasTareasService.procesarAlertasTareas();
    res.json({
      success: true,
      message: 'Alertas procesadas correctamente',
      data: resultado
    });
  } catch (error) {
    console.error('❌ Error procesando alertas:', error);
    res.status(500).json({
      success: false,
      message: 'Error procesando alertas',
      error: error.message
    });
  }
});

// GET /api/tareas/con-alerta-final - Obtener tareas con alerta final enviada
router.get('/con-alerta-final', async (req, res) => {
  try {
    const tareas = await AlertasTareasService.obtenerTareasConAlertaFinal();
    res.json({
      success: true,
      data: tareas
    });
  } catch (error) {
    console.error('❌ Error obteniendo tareas con alerta final:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo tareas con alerta final',
      error: error.message
    });
  }
});

// PATCH /api/tareas/:id/desactivar-alertas - Desactivar alertas de una tarea
router.patch('/:id/desactivar-alertas', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await AlertasTareasService.desactivarAlertas(id);
    res.json(resultado);
  } catch (error) {
    console.error('❌ Error desactivando alertas:', error);
    res.status(500).json({
      success: false,
      message: 'Error desactivando alertas',
      error: error.message
    });
  }
});

export default router; 