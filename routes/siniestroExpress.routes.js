import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  crearSiniestroExpress,
  listarSiniestrosExpress,
  actualizarSiniestroExpress,
  eliminarSiniestroExpress,
} from '../controllers/siniestroExpress.controller.js';
import { EXPRESS_UPLOADS_DIR, ensureUploadDir } from '../config/uploadsRoot.js';

const router = express.Router();

const expressUploadsDir = ensureUploadDir(EXPRESS_UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, expressUploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

const uploadExpress = upload.fields([
  { name: 'anexos', maxCount: 30 },
  { name: 'salvamentoAnexos', maxCount: 30 },
]);

router.get('/', listarSiniestrosExpress);
router.post('/', uploadExpress, crearSiniestroExpress);
router.put('/:id', uploadExpress, actualizarSiniestroExpress);
router.delete('/:id', eliminarSiniestroExpress);

export default router;


