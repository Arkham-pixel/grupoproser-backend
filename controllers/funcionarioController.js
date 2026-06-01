import Funcionario from '../models/Funcionario.js';

// Obtener todos los funcionarios
export const obtenerFuncionarios = async (req, res) => {
  try {
    const funcionarios = await Funcionario.find({ activo: true }).sort({ fechaCreacion: -1 });
    res.json(funcionarios);
  } catch (error) {
    console.error('Error al obtener funcionarios:', error);
    res.status(500).json({ error: 'Error al obtener funcionarios', detalle: error.message });
  }
};

// Obtener un funcionario por ID
export const obtenerFuncionario = async (req, res) => {
  try {
    const { id } = req.params;
    const funcionario = await Funcionario.findById(id);
    
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionario no encontrado' });
    }
    
    res.json(funcionario);
  } catch (error) {
    console.error('Error al obtener funcionario:', error);
    res.status(500).json({ error: 'Error al obtener funcionario', detalle: error.message });
  }
};

// Crear nuevo funcionario
export const crearFuncionario = async (req, res) => {
  try {
    const { nombre, cargo, telefono, email, firma } = req.body;
    
    if (!nombre || !cargo) {
      return res.status(400).json({ error: 'Nombre y cargo son obligatorios' });
    }
    
    const nuevoFuncionario = new Funcionario({
      nombre,
      cargo,
      telefono,
      email,
      firma
    });
    
    await nuevoFuncionario.save();
    res.status(201).json({ 
      message: 'Funcionario creado exitosamente', 
      funcionario: nuevoFuncionario 
    });
  } catch (error) {
    console.error('Error al crear funcionario:', error);
    res.status(500).json({ error: 'Error al crear funcionario', detalle: error.message });
  }
};

// Actualizar funcionario
export const actualizarFuncionario = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, cargo, telefono, email, firma } = req.body;
    
    const funcionario = await Funcionario.findById(id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionario no encontrado' });
    }
    
    // Actualizar campos
    if (nombre) funcionario.nombre = nombre;
    if (cargo) funcionario.cargo = cargo;
    if (telefono !== undefined) funcionario.telefono = telefono;
    if (email !== undefined) funcionario.email = email;
    if (firma !== undefined) funcionario.firma = firma;
    
    funcionario.fechaActualizacion = new Date();
    await funcionario.save();
    
    res.json({ 
      message: 'Funcionario actualizado exitosamente', 
      funcionario 
    });
  } catch (error) {
    console.error('Error al actualizar funcionario:', error);
    res.status(500).json({ error: 'Error al actualizar funcionario', detalle: error.message });
  }
};

// Eliminar funcionario (soft delete)
export const eliminarFuncionario = async (req, res) => {
  try {
    const { id } = req.params;
    
    const funcionario = await Funcionario.findById(id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionario no encontrado' });
    }
    
    funcionario.activo = false;
    funcionario.fechaActualizacion = new Date();
    await funcionario.save();
    
    res.json({ message: 'Funcionario eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar funcionario:', error);
    res.status(500).json({ error: 'Error al eliminar funcionario', detalle: error.message });
  }
};

// Actualizar firma de funcionario
export const actualizarFirmaFuncionario = async (req, res) => {
  try {
    const { id } = req.params;
    const { firma } = req.body;
    
    const funcionario = await Funcionario.findById(id);
    if (!funcionario) {
      return res.status(404).json({ error: 'Funcionario no encontrado' });
    }
    
    funcionario.firma = firma;
    funcionario.fechaActualizacion = new Date();
    await funcionario.save();
    
    res.json({ 
      message: 'Firma actualizada exitosamente', 
      funcionario 
    });
  } catch (error) {
    console.error('Error al actualizar firma:', error);
    res.status(500).json({ error: 'Error al actualizar firma', detalle: error.message });
  }
};
