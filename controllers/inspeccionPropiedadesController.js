import HistorialFormulario from '../models/HistorialFormulario.js';

// Función auxiliar para capitalizar
const capitalizeFirstLetter = (str) => {
  if (!str || typeof str !== "string") return str || "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

// Procesar formulario de inspección de propiedades
export const procesarFormularioInspeccion = async (req, res) => {
  try {
    const data = req.body;
    
    // Obtener información del usuario del token o headers
    const nombreUsuario = req.user?.nombre || req.headers['x-user-name'] || 'Usuario';
    const userId = req.user?.login || req.user?.id || req.headers['x-user-id'] || 'unknown';
    
    // Guardar en historial de formularios
    const nombreCliente = data.nombreInmueble ? capitalizeFirstLetter(data.nombreInmueble) : "Sin Nombre";
    
    const historialData = {
      tipo: 'inspeccion-propiedades',
      titulo: `Inspección de Propiedades - ${nombreCliente}`,
      usuario: nombreUsuario,
      userId: userId,
      estado: 'completado',
      datos: data,
      fechaCreacion: new Date(),
    };

    // Guardar en historial
    const historial = new HistorialFormulario(historialData);
    await historial.save();

    console.log('✅ Formulario de inspección de propiedades guardado en historial:', historial._id);

    res.status(200).json({
      success: true,
      message: 'Formulario procesado correctamente y reporte generado.',
      historialId: historial._id,
      data: data
    });
  } catch (error) {
    console.error('❌ Error procesando formulario de inspección de propiedades:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar el formulario',
      error: error.message
    });
  }
};

