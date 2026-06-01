import Cliente from '../models/Cliente.js';

// Obtener todos los clientes
export const obtenerClientes = async (req, res) => {
  try {
    const clientes = await Cliente.find({}).sort({ rzonSocial: 1 });
    res.json({ success: true, data: clientes });
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ success: false, error: 'Error al obtener clientes', detalle: error.message });
  }
};

// Obtener un cliente por ID
export const obtenerClientePorId = async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await Cliente.findById(id);
    if (!cliente) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }
    res.json({ success: true, data: cliente });
  } catch (error) {
    console.error('Error al obtener cliente:', error);
    res.status(500).json({ success: false, error: 'Error al obtener cliente', detalle: error.message });
  }
};

// Crear un nuevo cliente
export const crearCliente = async (req, res) => {
  try {
    const datosCliente = req.body;
    
    // Validar campos requeridos
    if (!datosCliente.rzonSocial || !datosCliente.codiAsgrdra) {
      return res.status(400).json({ 
        success: false, 
        error: 'Los campos rzonSocial y codiAsgrdra son requeridos' 
      });
    }

    // Verificar si ya existe un cliente con el mismo codiAsgrdra
    const clienteExistente = await Cliente.findOne({ codiAsgrdra: datosCliente.codiAsgrdra });
    if (clienteExistente) {
      return res.status(400).json({ 
        success: false, 
        error: 'Ya existe un cliente con este código de aseguradora' 
      });
    }

    const nuevoCliente = new Cliente(datosCliente);
    await nuevoCliente.save();
    
    res.status(201).json({ success: true, data: nuevoCliente, mensaje: 'Cliente creado exitosamente' });
  } catch (error) {
    console.error('Error al crear cliente:', error);
    res.status(500).json({ success: false, error: 'Error al crear cliente', detalle: error.message });
  }
};

// Actualizar un cliente
export const actualizarCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const datosActualizacion = req.body;

    // Si se intenta cambiar el codiAsgrdra, verificar que no exista otro cliente con ese código
    if (datosActualizacion.codiAsgrdra) {
      const clienteExistente = await Cliente.findOne({ 
        codiAsgrdra: datosActualizacion.codiAsgrdra,
        _id: { $ne: id }
      });
      if (clienteExistente) {
        return res.status(400).json({ 
          success: false, 
          error: 'Ya existe otro cliente con este código de aseguradora' 
        });
      }
    }

    const clienteActualizado = await Cliente.findByIdAndUpdate(
      id,
      { $set: datosActualizacion },
      { new: true, runValidators: true }
    );

    if (!clienteActualizado) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    res.json({ success: true, data: clienteActualizado, mensaje: 'Cliente actualizado exitosamente' });
  } catch (error) {
    console.error('Error al actualizar cliente:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar cliente', detalle: error.message });
  }
};

// Eliminar un cliente
export const eliminarCliente = async (req, res) => {
  try {
    const { id } = req.params;
    const clienteEliminado = await Cliente.findByIdAndDelete(id);
    
    if (!clienteEliminado) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    res.json({ success: true, mensaje: 'Cliente eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar cliente:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar cliente', detalle: error.message });
  }
};

