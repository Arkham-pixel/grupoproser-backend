import express from 'express';
import {
  crearRiesgo,
  obtenerRiesgos,
  obtenerRiesgoPorId,
  actualizarRiesgo,
  eliminarRiesgo,
  buscarRiesgos
} from '../controllers/riesgoController.js';
import { enviarEmailPrueba } from '../services/emailService.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';

const router = express.Router();

const upload = createMulterUpload({ category: STORAGE_CATEGORIES.RIESGOS });
const persistRiesgoFiles = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.RIESGOS,
});

const procesarArchivosRiesgo = upload.fields([
  { name: 'adjuntoAsignacion', maxCount: 1 },
  { name: 'adjuntoContIni', maxCount: 1 },
  { name: 'adjuntoInspeccion', maxCount: 1 },
  { name: 'anxoInfoFnal', maxCount: 1 },
  { name: 'anxoFactra', maxCount: 1 },
]);

router.post('/', procesarArchivosRiesgo, persistRiesgoFiles, crearRiesgo);
router.get('/', obtenerRiesgos);
router.get('/buscar', buscarRiesgos);
router.get('/:id', obtenerRiesgoPorId);
router.put('/:id', procesarArchivosRiesgo, persistRiesgoFiles, actualizarRiesgo);
router.delete('/:id', eliminarRiesgo);

// Ruta de prueba para email
router.post('/test-email', async (req, res) => {
  try {
    const { emailDestino } = req.body;
    const resultado = await enviarEmailPrueba(emailDestino);
    res.json(resultado);
  } catch (error) {
    console.error('❌ Error en prueba de email:', error);
    res.status(500).json({ 
      success: false, 
      message: "Error enviando email de prueba",
      error: error.message 
    });
  }
});

export default router;
