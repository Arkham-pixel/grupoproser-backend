import express from 'express';
import {
  actualizarCatalogoExpress,
  crearCatalogoExpress,
  eliminarCatalogoExpress,
  ejecutarSeedCatalogosExpress,
  listarCatalogoExpress,
} from '../controllers/expressCatalogo.controller.js';
import { verificarCatalogosExpress } from '../middleware/verificarCatalogosExpress.js';

const router = express.Router();

router.get('/:tipo', listarCatalogoExpress);
router.post('/', verificarCatalogosExpress, crearCatalogoExpress);
router.post('/seed/defaults', verificarCatalogosExpress, ejecutarSeedCatalogosExpress);
router.put('/:id', verificarCatalogosExpress, actualizarCatalogoExpress);
router.delete('/:id', verificarCatalogosExpress, eliminarCatalogoExpress);

export default router;
