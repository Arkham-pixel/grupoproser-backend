import Ciudad from '../models/Ciudad.js';

export const obtenerCiudades = async (req, res) => {
  try {
    console.log('🔍 Intentando obtener ciudades...');
    console.log('📊 Modelo Ciudad:', Ciudad);
    console.log('🔗 Conexión:', Ciudad.db.name);

    const ciudades = await Ciudad.find();
    console.log('✅ Ciudades encontradas:', ciudades.length);
    console.log('📋 Primera ciudad:', ciudades[0]);
    res.json(ciudades);
  } catch (error) {
    console.error('❌ Error al obtener ciudades:', error);
    console.error('📋 Detalles del error:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    res.status(500).json({ error: 'Error al obtener ciudades', details: error.message });
  }
};
