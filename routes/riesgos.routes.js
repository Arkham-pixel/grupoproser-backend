import express from 'express';
import multer from 'multer';
import path from 'path';
import {
  crearRiesgo,
  obtenerRiesgos,
  obtenerRiesgoPorId,
  actualizarRiesgo,
  eliminarRiesgo,
  buscarRiesgos
} from '../controllers/riesgoController.js';
import { enviarEmailPrueba } from '../services/emailService.js';
import { RIESGOS_UPLOADS_DIR, ensureUploadDir } from '../config/uploadsRoot.js';

const router = express.Router();

const riesgoUploadsDir = ensureUploadDir(RIESGOS_UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, riesgoUploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });
const procesarArchivosRiesgo = upload.fields([
  { name: 'adjuntoAsignacion', maxCount: 1 },
  { name: 'adjuntoInspeccion', maxCount: 1 },
  { name: 'anxoInfoFnal', maxCount: 1 },
  { name: 'anxoFactra', maxCount: 1 },
]);

router.post('/', procesarArchivosRiesgo, crearRiesgo);
router.get('/', obtenerRiesgos);
router.get('/buscar', buscarRiesgos);
router.get('/:id', obtenerRiesgoPorId);
router.put('/:id', procesarArchivosRiesgo, actualizarRiesgo);
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