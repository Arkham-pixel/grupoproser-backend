import express from 'express';
import {
  crearCasoListadoZurich,
  listarCasosListadoZurich,
  obtenerCasoListadoZurich,
  obtenerTorreConfigZurich,
  actualizarCasoListadoZurich,
  eliminarCasoListadoZurich,
  importarCasosListadoZurich,
  subirArchivoListadoZurich,
  eliminarArchivoListadoZurich,
} from '../controllers/zurichListado.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES, getPublicPathForSingle } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';
import {
  notificarControlHorasZurich,
  notificarGerenciaZurich,
} from '../controllers/zurichFacturacion.controller.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.ZURICH_LISTADO,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistListado = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ZURICH_LISTADO,
  ownerIdFromReq: (req) => req.params.id,
});

router.get('/torre-config', verificarToken, obtenerTorreConfigZurich);
router.get('/', verificarToken, listarCasosListadoZurich);
router.post('/importar', importarCasosListadoZurich);

const persistListadoUpload = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ZURICH_LISTADO,
});

router.post('/upload', upload.single('file'), persistListadoUpload, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo' });
  }
  const url = getPublicPathForSingle(req, (f) => `/uploads/zurich-listado/${f.filename}`);
  res.json({ url, filename: req.file.originalname, ruta: url });
});

router.post('/notificaciones/control-horas', verificarToken, notificarControlHorasZurich);
router.post('/notificaciones/gerencia', verificarToken, notificarGerenciaZurich);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistListado,
  subirArchivoListadoZurich
);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoListadoZurich);

router.get(`/:id(${ID_MONGO})`, verificarToken, obtenerCasoListadoZurich);
router.post('/', crearCasoListadoZurich);
router.put('/:id', verificarToken, actualizarCasoListadoZurich);
router.delete('/:id', eliminarCasoListadoZurich);

export default router;
