import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import {
  agregarComentario,
  actualizarTicket,
  crearTicket,
  listarTickets,
  obtenerTicket,
} from '../controllers/tickets.controller.js';
import {
  createMulterUpload,
  attachPersistedFileMiddleware,
} from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';

const router = express.Router();

const uploadTickets = createMulterUpload({
  category: STORAGE_CATEGORIES.TICKETS,
  multerOptions: {
    limits: {
      fileSize: 8 * 1024 * 1024, // 8 MB por archivo
      files: 5,
    },
    fileFilter: (_req, file, cb) => {
      const ok =
        /^image\//i.test(file.mimetype) ||
        file.mimetype === 'application/pdf' ||
        /\.(jpe?g|png|gif|webp|heic|heif|pdf)$/i.test(file.originalname || '');
      if (!ok) {
        return cb(new Error('Solo se permiten imágenes o PDF'));
      }
      cb(null, true);
    },
  },
});

const persistTickets = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.TICKETS,
  ownerType: 'ticket',
  ownerIdFromReq: (req) => req.usuario?.login || req.user?.login || 'anon',
});

router.use(verificarToken);

router.get('/', listarTickets);
router.get('/:id', obtenerTicket);
router.post(
  '/',
  (req, res, next) => {
    // Adjuntos son opcionales: si fallan, el ticket de texto se crea igual
    uploadTickets.array('adjuntos', 5)(req, res, (err) => {
      if (err) {
        console.warn('⚠️ [tickets] adjuntos omitidos:', err.message);
        req.files = [];
        req.ticketAdjuntosOmitidos = err.message || 'Error al subir adjuntos';
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      await new Promise((resolve, reject) => {
        persistTickets(req, res, (err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      console.warn('⚠️ [tickets] persistencia de adjuntos omitida:', err.message);
      req.files = [];
      req.ticketAdjuntosOmitidos =
        req.ticketAdjuntosOmitidos || err.message || 'Error persistiendo adjuntos';
    }
    next();
  },
  crearTicket
);
router.patch('/:id', actualizarTicket);
router.post('/:id/comentarios', agregarComentario);

export default router;
