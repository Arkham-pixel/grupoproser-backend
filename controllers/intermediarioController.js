import Intermediario from '../models/Intermediario.js';

const normalizarNombre = (nombre) =>
  String(nombre || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

async function generarCodigoIntermediario() {
  const existentes = await Intermediario.find({}, { codigo: 1 }).lean();
  let max = 100000;
  for (const item of existentes) {
    const n = parseInt(String(item.codigo || '').replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

// Obtener todos los intermediarios
export const obtenerIntermediarios = async (req, res) => {
  try {
    const intermediarios = await Intermediario.find({}).sort({ nombre: 1 });
    res.json({ success: true, data: intermediarios });
  } catch (error) {
    console.error('Error al obtener intermediarios:', error);
    res.status(500).json({ success: false, error: 'Error al obtener intermediarios', detalle: error.message });
  }
};

// Obtener un intermediario por ID
export const obtenerIntermediarioPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const intermediario = await Intermediario.findById(id);
    if (!intermediario) {
      return res.status(404).json({ success: false, error: 'Intermediario no encontrado' });
    }
    res.json({ success: true, data: intermediario });
  } catch (error) {
    console.error('Error al obtener intermediario:', error);
    res.status(500).json({ success: false, error: 'Error al obtener intermediario', detalle: error.message });
  }
};

// Crear un nuevo intermediario
export const crearIntermediario = async (req, res) => {
  try {
    const datosIntermediario = { ...req.body };
    const nombre = String(datosIntermediario.nombre || '').trim();

    if (!nombre) {
      return res.status(400).json({
        success: false,
        error: 'El campo nombre es requerido',
      });
    }

    datosIntermediario.nombre = nombre;

    // Evitar duplicados por nombre (mismo banco)
    const mismoNombre = await Intermediario.find({}).lean();
    const nombreNorm = normalizarNombre(nombre);
    const duplicado = mismoNombre.find((i) => normalizarNombre(i.nombre) === nombreNorm);
    if (duplicado) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un intermediario con este nombre',
        data: duplicado,
      });
    }

    if (!datosIntermediario.codigo) {
      datosIntermediario.codigo = await generarCodigoIntermediario();
    }

    const intermediarioExistente = await Intermediario.findOne({ codigo: datosIntermediario.codigo });
    if (intermediarioExistente) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un intermediario con este código',
      });
    }

    if (datosIntermediario.estado == null) {
      datosIntermediario.estado = 1;
    }

    const nuevoIntermediario = new Intermediario(datosIntermediario);
    await nuevoIntermediario.save();

    res.status(201).json({ success: true, data: nuevoIntermediario, mensaje: 'Intermediario creado exitosamente' });
  } catch (error) {
    console.error('Error al crear intermediario:', error);
    res.status(500).json({ success: false, error: 'Error al crear intermediario', detalle: error.message });
  }
};

// Actualizar un intermediario
export const actualizarIntermediario = async (req, res) => {
  try {
    const { id } = req.params;
    const datosActualizacion = req.body;

    // Si se intenta cambiar el código, verificar que no exista otro intermediario con ese código
    if (datosActualizacion.codigo) {
      const intermediarioExistente = await Intermediario.findOne({ 
        codigo: datosActualizacion.codigo,
        _id: { $ne: id }
      });
      if (intermediarioExistente) {
        return res.status(400).json({ 
          success: false, 
          error: 'Ya existe otro intermediario con este código' 
        });
      }
    }

    const intermediarioActualizado = await Intermediario.findByIdAndUpdate(
      id,
      { $set: datosActualizacion },
      { new: true, runValidators: true }
    );

    if (!intermediarioActualizado) {
      return res.status(404).json({ success: false, error: 'Intermediario no encontrado' });
    }

    res.json({ success: true, data: intermediarioActualizado, mensaje: 'Intermediario actualizado exitosamente' });
  } catch (error) {
    console.error('Error al actualizar intermediario:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar intermediario', detalle: error.message });
  }
};

// Eliminar un intermediario
export const eliminarIntermediario = async (req, res) => {
  try {
    const { id } = req.params;
    const intermediarioEliminado = await Intermediario.findByIdAndDelete(id);
    
    if (!intermediarioEliminado) {
      return res.status(404).json({ success: false, error: 'Intermediario no encontrado' });
    }

    res.json({ success: true, mensaje: 'Intermediario eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar intermediario:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar intermediario', detalle: error.message });
  }
};
