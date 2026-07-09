import express from 'express';
import {
  crearComplex,
  obtenerTodos,
  obtenerPorId,
  actualizarComplex,
  eliminarComplex,
  obtenerIntermediarios,
  notificarHonorarios,
  notificarControlHoras,
  notificarGerencia,
  cambiarEstadosFinalizadosAFacturado,
  contarCasosAseguradoras,
  obtenerAutofillAjuste,
  obtenerBandejaFacturacion,
  corregirEnvioBandejaFacturacion,
  eliminarEnvioBandejaFacturacion,
} from '../controllers/complex.controller.js';
import { enviarEmailPrueba } from '../services/emailService.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES, getPublicPathForSingle } from '../services/fileStorageService.js';
import { poblarUsuarioOpcional } from '../middleware/usuarioOpcional.js';

const router = express.Router();

const upload = createMulterUpload({ category: STORAGE_CATEGORIES.COMPLEX });
const persistComplexFile = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.COMPLEX,
});

// Ruta para subir archivos
router.post('/upload', upload.single('file'), persistComplexFile, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo' });
  }
  const url = getPublicPathForSingle(req, (f) => `/uploads/${f.filename}`);
  res.json({ url, filename: req.file.originalname });
});

// Rutas para intermediarios (debe ir antes de las rutas con parámetros)
router.get('/intermediarios', obtenerIntermediarios);

// Bandeja de casos enviados a jefes para facturación (antes de /:id)
router.get('/bandeja-facturacion', obtenerBandejaFacturacion);
router.patch('/bandeja-facturacion/envio', corregirEnvioBandejaFacturacion);
router.post('/bandeja-facturacion/envio/corregir', corregirEnvioBandejaFacturacion);
router.delete('/bandeja-facturacion/envio', eliminarEnvioBandejaFacturacion);
router.post('/bandeja-facturacion/envio/eliminar', eliminarEnvioBandejaFacturacion);

// 📧 Ruta para probar emails de casos complex
router.post('/test-email', async (req, res) => {
  try {
    const { emailDestino } = req.body;
    const resultado = await enviarEmailPrueba(emailDestino);
    res.json(resultado);
  } catch (error) {
    console.error('❌ Error en test-email complex:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

router.post('/notificaciones/honorarios', notificarHonorarios);
router.post('/notificaciones/control-horas', notificarControlHoras);
router.post('/notificaciones/gerencia', notificarGerencia);

// Cambiar casos FINALIZADOS a FACTURADO (ejecución manual)
router.post('/cambiar-estados/finalizados-a-facturado', cambiarEstadosFinalizadosAFacturado);

// Contar casos por aseguradoras BBVA y Zurich
router.get('/contar-aseguradoras', contarCasosAseguradoras);

router.post('/', poblarUsuarioOpcional, crearComplex);
router.get('/', obtenerTodos);
router.get('/autofill/:idCaso', obtenerAutofillAjuste);
router.get('/:id', obtenerPorId);
router.put('/:id', poblarUsuarioOpcional, actualizarComplex);
router.delete('/:id', eliminarComplex);

export default router;
