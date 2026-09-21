import express from 'express';
import {
  crearCasoListadoAllianz,
  listarCasosListadoAllianz,
  obtenerCasoListadoAllianz,
  actualizarCasoListadoAllianz,
  eliminarCasoListadoAllianz,
  importarCasosListadoAllianz,
  subirArchivoListadoAllianz,
  eliminarArchivoListadoAllianz,
} from '../controllers/allianzListado.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES, getPublicPathForSingle } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';
import { notificarControlHorasCat, notificarGerenciaCat } from '../controllers/catFacturacion.controller.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.ALLIANZ,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistListado = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ALLIANZ,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/', listarCasosListadoAllianz);
router.post('/importar', importarCasosListadoAllianz);

const persistAllianzListadoUpload = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ALLIANZ,
});
router.post('/upload', upload.single('file'), persistAllianzListadoUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
  const url = getPublicPathForSingle(req, (f) => `/uploads/allianz/${f.filename}`);
  res.json({ url, filename: req.file.originalname, ruta: url });
});
router.post('/notificaciones/control-horas', verificarToken, notificarControlHorasCat);
router.post('/notificaciones/gerencia', verificarToken, notificarGerenciaCat);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistListado,
  subirArchivoListadoAllianz
);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoListadoAllianz);

router.get('/:id', obtenerCasoListadoAllianz);
router.post('/', crearCasoListadoAllianz);
router.put('/:id', verificarToken, actualizarCasoListadoAllianz);
router.delete('/:id', eliminarCasoListadoAllianz);

export default router;
