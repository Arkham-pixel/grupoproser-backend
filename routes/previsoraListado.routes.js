import express from 'express';
import {
  crearCasoListadoPrevisora,
  listarCasosListadoPrevisora,
  obtenerCasoListadoPrevisora,
  actualizarCasoListadoPrevisora,
  eliminarCasoListadoPrevisora,
  importarCasosListadoPrevisora,
  subirArchivoListadoPrevisora,
  eliminarArchivoListadoPrevisora,
} from '../controllers/previsoraListado.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES, getPublicPathForSingle } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';
import { notificarControlHorasCat, notificarGerenciaCat } from '../controllers/catFacturacion.controller.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.PREVISORA,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistListado = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.PREVISORA,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosListadoPrevisora);
router.post('/importar', importarCasosListadoPrevisora);

const persistPrevisoraListadoUpload = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.PREVISORA,
});
router.post('/upload', upload.single('file'), persistPrevisoraListadoUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  const url = getPublicPathForSingle(req, (f) => `/uploads/previsora/${f.filename}`);
  res.json({ url, filename: req.file.originalname, ruta: url });
});
router.post('/notificaciones/control-horas', verificarToken, notificarControlHorasCat);
router.post('/notificaciones/gerencia', verificarToken, notificarGerenciaCat);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistListado,
  subirArchivoListadoPrevisora
);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoListadoPrevisora);

router.get('/:id', obtenerCasoListadoPrevisora);
router.post('/', crearCasoListadoPrevisora);
router.put('/:id', verificarToken, actualizarCasoListadoPrevisora);
router.delete('/:id', eliminarCasoListadoPrevisora);

export default router;
