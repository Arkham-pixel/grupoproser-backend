import {
  TIPOS,
  actualizarItem,
  crearItem,
  eliminarItem,
  listarPorTipo,
  seedDefaults,
} from '../services/expressCatalogoService.js';

export const listarCatalogoExpress = async (req, res) => {
  try {
    const { tipo } = req.params;
    if (!TIPOS.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo no válido', tipos: TIPOS });
    }
    const items = await listarPorTipo(tipo);
    res.json(items);
  } catch (error) {
    console.error('❌ listarCatalogoExpress:', error);
    res.status(500).json({ error: 'Error al listar catálogo Express', detalle: error.message });
  }
};

export const crearCatalogoExpress = async (req, res) => {
  try {
    const { tipo, nombre } = req.body ?? {};
    const item = await crearItem({ tipo, nombre });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    const status = /obligatorio|válido|existe/i.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
};

export const actualizarCatalogoExpress = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body ?? {};
    const item = await actualizarItem(id, { nombre });
    res.json({ success: true, data: item });
  } catch (error) {
    const status = /obligatorio|encontrado|existe/i.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
};

export const eliminarCatalogoExpress = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await eliminarItem(id);
    res.json({ success: true, data: item });
  } catch (error) {
    const status = error.message === 'Registro no encontrado' ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
};

export const ejecutarSeedCatalogosExpress = async (req, res) => {
  try {
    const resultado = await seedDefaults();
    res.json({ success: true, ...resultado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
