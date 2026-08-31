import { getCiudadesCached } from '../services/ciudadesCache.js';

export const obtenerCiudades = async (req, res) => {
  try {
    const { ciudades } = await getCiudadesCached();
    res.json(ciudades);
  } catch (error) {
    console.error('❌ Error al obtener ciudades:', error.message);
    res.status(500).json({ error: 'Error al obtener ciudades', details: error.message });
  }
};
