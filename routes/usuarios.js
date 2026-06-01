// routes/usuario.js  (ahora en ESM)
import { Router } from 'express';
import Usuario from '../models/Usuario.js';
import multer from 'multer';
import path from 'path';
import { UPLOADS_ROOT, ensureUploadDir } from '../config/uploadsRoot.js';

const router = Router();
const uploadsDir = ensureUploadDir(UPLOADS_ROOT);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Le dice a multer: guarda el archivo dentro de uploadsDir
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Le dice a multer cómo nombrar el archivo:
    // <userId>-<timestamp><extensión original>
    const ext = path.extname(file.originalname);
    cb(null, `${req.usuario.id}-${Date.now()}${ext}`);
  }
});
export const upload = multer({ storage });


// POST /api/usuarios/crear
router.post(
  '/crear',
  verificarToken, 
  upload.single('foto'),
  async (req, res) => {
    try {
      const {
        nombre,
        correo,
        celular,
        cedula,
        fechaNacimiento,
        rol
      } = req.body;

      let fotoUrl = null;
      if (req.file) {
        // serviremos /uploads estático
        fotoUrl = `/uploads/${req.file.filename}`;
      }

      const nuevoUsuario = new Usuario({
        nombre,
        correo,
        celular,
        cedula,
        fechaNacimiento,
        rol,
        foto: fotoUrl
      });

      await nuevoUsuario.save();
      res.status(201).json({ message: 'Usuario creado exitosamente', usuario: nuevoUsuario });
    } catch (error) {
      console.error('Error al crear usuario:', error);
      res.status(500).json({ message: 'Error al crear el usuario' });
    }
  }
);

export default router;
