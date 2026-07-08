import {
  TIPOS,
  actualizarItem,
  asegurarCatalogosIniciales,
  crearItem,
  eliminarItem,
  listarPorTipo,
  listarTodos,
  seedDefaults,
} from '../services/puertosCatalogoService.js';

export const listarCatalogoPuertos = async (req, res) => {
  try {
    const { tipo } = req.params;
    if (!TIPOS.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo no válido', tipos: TIPOS });
    }
    await asegurarCatalogosIniciales();
    const items = await listarPorTipo(tipo);
    res.json(items);
  } catch (error) {
    console.error('❌ listarCatalogoPuertos:', error);
    res.status(500).json({ error: 'Error al listar catálogo de Puertos', detalle: error.message });
  }
};

export const listarTodosCatalogosPuertos = async (req, res) => {
  try {
    await asegurarCatalogosIniciales();
    const items = await listarTodos();
    res.json(items);
  } catch (error) {
    console.error('❌ listarTodosCatalogosPuertos:', error);
    res.status(500).json({ error: 'Error al listar catálogos de Puertos', detalle: error.message });
  }
};

export const crearCatalogoPuertos = async (req, res) => {
  try {
    const { tipo, nombre } = req.body ?? {};
    const item = await crearItem({ tipo, nombre });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    const status = /obligatorio|válido|existe/i.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
};

export const actualizarCatalogoPuertos = async (req, res) => {
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

export const eliminarCatalogoPuertos = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await eliminarItem(id);
    res.json({ success: true, data: item });
  } catch (error) {
    const status = error.message === 'Registro no encontrado' ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
};

export const ejecutarSeedCatalogosPuertos = async (req, res) => {
  try {
    const resultado = await seedDefaults();
    res.json({ success: true, ...resultado });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const obtenerTiposCatalogoPuertos = async (_req, res) => {
  res.json({ tipos: TIPOS });
};
