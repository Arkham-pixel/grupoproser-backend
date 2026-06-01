import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOCUMENTOS_UPLOADS_DIR } from '../config/uploadsRoot.js';
import { verificarToken } from '../middleware/auth.js';
import {
  verificarAccesoDocumentos,
  subirDocumento,
  obtenerDocumentos,
  obtenerDocumentoPorId,
  descargarDocumento,
  actualizarDocumento,
  eliminarDocumento,
  obtenerEtiquetas,
  obtenerDocumentosPorUsuario,
  subirDocumentoParaUsuario,
  obtenerPerfilesExternos,
  crearPerfilExterno,
  actualizarPerfilExterno,
  eliminarPerfilExterno,
  restaurarPerfilExterno,
  listarOcultosPlataforma,
  ocultarUsuarioPlataforma,
  mostrarUsuarioPlataformaEnDocumentos
} from '../controllers/documentoController.js';

const router = express.Router();

console.log('📦 Router de documentos inicializado');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Misma carpeta que express.static(/uploads) y descargarDocumento
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DOCUMENTOS_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage
  // Sin límite de tamaño de archivo
});

// Todas las rutas requieren autenticación y acceso restringido
router.use(verificarToken);
router.use(verificarAccesoDocumentos);

// Rutas - Las rutas específicas deben ir antes que las genéricas
router.post('/subir', upload.single('archivo'), subirDocumento);
router.get('/listar', obtenerDocumentos);
router.get('/etiquetas', obtenerEtiquetas);
router.get('/perfiles-externos', obtenerPerfilesExternos);
router.post('/perfiles-externos', crearPerfilExterno);
router.put('/perfiles-externos/:id', actualizarPerfilExterno);
router.delete('/perfiles-externos/:id', eliminarPerfilExterno);
router.put('/perfiles-externos/:id/restaurar', restaurarPerfilExterno);
router.get('/usuarios-ocultos-plataforma', listarOcultosPlataforma);
router.post('/usuarios-ocultos-plataforma', ocultarUsuarioPlataforma);
router.delete(
  '/usuarios-ocultos-plataforma/:usuarioId',
  mostrarUsuarioPlataformaEnDocumentos
);
// Rutas para documentos por usuario
router.get('/usuario/:usuarioId', obtenerDocumentosPorUsuario);
router.post('/usuario/:usuarioId/subir', upload.single('archivo'), subirDocumentoParaUsuario);
router.get('/:id/descargar', descargarDocumento);
router.get('/:id', obtenerDocumentoPorId);
router.put('/:id', actualizarDocumento);
router.delete('/:id', eliminarDocumento);

console.log('✅ Rutas de documentos registradas:', [
  'POST /subir',
  'GET /listar',
  'GET /etiquetas',
  'GET /perfiles-externos',
  'POST /perfiles-externos',
  'PUT /perfiles-externos/:id',
  'DELETE /perfiles-externos/:id',
  'PUT /perfiles-externos/:id/restaurar',
  'GET /usuarios-ocultos-plataforma',
  'POST /usuarios-ocultos-plataforma',
  'DELETE /usuarios-ocultos-plataforma/:usuarioId',
  'GET /usuario/:usuarioId',
  'POST /usuario/:usuarioId/subir',
  'GET /:id/descargar',
  'GET /:id',
  'PUT /:id',
  'DELETE /:id'
]);

export default router;

