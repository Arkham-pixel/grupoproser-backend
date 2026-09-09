import express from 'express';
import {
  crearCasoAllianz,
  listarCasosAllianz,
  obtenerCasoAllianz,
  actualizarCasoAllianz,
  eliminarCasoAllianz,
  importarCasosAllianz,
  syncDesdeExpress,
  subirArchivoAllianz,
  actualizarArchivoAllianz,
  reordenarArchivosAllianz,
  eliminarArchivoAllianz,
  getAlertasAllianz,
  postEnviarAlertasAllianzTodas,
  postEnviarAlertasAllianzAjustador,
} from '../controllers/allianz.controller.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
import { verificarToken } from '../middleware/auth.js';

const router = express.Router();
const ID_MONGO = '[0-9a-fA-F]{24}';

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.ALLIANZ,
  multerOptions: {
    limits: { fileSize: 25 * 1024 * 1024 },
  },
});

const persistAllianz = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.ALLIANZ,
  ownerIdFromReq: (req) => req.params.id,
});

/** Proxy de Static Maps: evita el bloqueo CORS del navegador al generar la captura del Word. */
router.get('/mapa-estatico', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ message: 'Coordenadas inválidas' });
  }
  if (!apiKey) {
    return res.status(503).json({ message: 'GOOGLE_MAPS_API_KEY no configurada' });
  }

  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '18',
    size: '640x480',
    maptype: 'satellite',
    scale: '2',
    markers: `color:red|${lat},${lng}`,
    key: apiKey,
  });

  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`, {
      headers: { Referer: 'https://arnald.grupoproser.com.co/' },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return res.status(response.status).json({
        message: 'Google Maps rechazó la captura',
        detail: detail.slice(0, 200),
      });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    res.set({
      'Content-Type': response.headers.get('content-type') || 'image/png',
      'Cache-Control': 'private, max-age=300',
    });
    return res.send(bytes);
  } catch (error) {
    return res.status(502).json({ message: error.message || 'No se pudo obtener el mapa' });
  }
});

router.get('/', listarCasosAllianz);
router.post('/importar', importarCasosAllianz);
router.post('/sync-express', syncDesdeExpress);

router.get('/alertas', getAlertasAllianz);
router.post('/alertas/enviar', postEnviarAlertasAllianzTodas);
router.post('/alertas/enviar/:ajustador', postEnviarAlertasAllianzAjustador);

router.post(
  `/:id(${ID_MONGO})/archivos`,
  upload.single('archivo'),
  persistAllianz,
  subirArchivoAllianz
);
router.put(`/:id(${ID_MONGO})/archivos/orden`, reordenarArchivosAllianz);
router.patch(`/:id(${ID_MONGO})/archivos/:archivoId`, actualizarArchivoAllianz);
router.delete(`/:id(${ID_MONGO})/archivos/:archivoId`, eliminarArchivoAllianz);
router.get(`/:id(${ID_MONGO})`, obtenerCasoAllianz);
router.post('/', crearCasoAllianz);
router.put(`/:id(${ID_MONGO})`, verificarToken, actualizarCasoAllianz);
router.delete(`/:id(${ID_MONGO})`, eliminarCasoAllianz);

export default router;
