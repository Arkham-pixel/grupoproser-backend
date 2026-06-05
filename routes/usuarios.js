// routes/usuario.js  (ahora en ESM)
import { Router } from 'express';
import Usuario from '../models/Usuario.js';
import path from 'path';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES, getPublicPathForSingle } from '../services/fileStorageService.js';

const router = Router();

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.PERFILES,
  filenameFn: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.usuario.id}-${Date.now()}${ext}`);
  },
});
const persistFoto = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.PERFILES,
});

export { upload, persistFoto };

// POST /api/usuarios/crear
router.post(
  '/crear',
  verificarToken, 
  upload.single('foto'),
  persistFoto,
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
        fotoUrl = getPublicPathForSingle(req, (f) => `/uploads/${f.filename}`);
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
