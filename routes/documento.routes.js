import express from 'express';
import { verificarToken } from '../middleware/auth.js';
import { createMulterUpload, attachPersistedFileMiddleware } from '../storage/multerStorageFactory.js';
import { STORAGE_CATEGORIES } from '../services/fileStorageService.js';
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

const upload = createMulterUpload({ category: STORAGE_CATEGORIES.DOCUMENTOS });
const persistDocumento = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.DOCUMENTOS,
});
const persistDocumentoUsuario = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.DOCUMENTOS,
  ownerIdFromReq: (req) => req.params.usuarioId,
});

// Todas las rutas requieren autenticación y acceso restringido
router.use(verificarToken);
router.use(verificarAccesoDocumentos);

// Rutas - Las rutas específicas deben ir antes que las genéricas
router.post('/subir', upload.single('archivo'), persistDocumento, subirDocumento);
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
router.post('/usuario/:usuarioId/subir', upload.single('archivo'), persistDocumentoUsuario, subirDocumentoParaUsuario);
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

