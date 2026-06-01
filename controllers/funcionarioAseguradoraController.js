import FuncionarioAseguradora from '../models/FuncionarioAseguradora.js';

/** Campos persistibles (deben existir en el schema; fuera de esto Mongoose los ignora en strict). */
const CAMPOS_FUNCIONARIO = [
  'id',
  'codiAsgrdra',
  'nmbrContcto',
  'cargo',
  'email',
  'teleCellar',
  'direccion',
  'ciudadDestino',
  'paisDestino'
];

function cuerpoFuncionarioDesdeRequest(body) {
  const datos = {};
  for (const k of CAMPOS_FUNCIONARIO) {
    if (!Object.prototype.hasOwnProperty.call(body, k)) continue;
    let v = body[k];
    if (k === 'id') {
      if (v === '' || v === null || v === undefined) continue;
      v = parseInt(v, 10);
      if (Number.isNaN(v)) continue;
      datos.id = v;
      continue;
    }
    datos[k] = v === null || v === undefined ? '' : String(v);
  }
  return datos;
}

// Obtener todos los funcionarios o filtrar por codiAsgrdra
export const obtenerFuncionarios = async (req, res) => {
  try {
    const { codiAsgrdra } = req.query;
    let query = {};
    if (codiAsgrdra) {
      query.codiAsgrdra = codiAsgrdra;
    }
    const funcionarios = await FuncionarioAseguradora.find(query).sort({ nmbrContcto: 1 });
    res.json({ success: true, data: funcionarios });
  } catch (error) {
    console.error('Error al obtener funcionarios:', error);
    res.status(500).json({ success: false, error: 'Error al obtener funcionarios', detalle: error.message });
  }
};

// Obtener un funcionario por ID
export const obtenerFuncionarioPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const funcionario = await FuncionarioAseguradora.findById(id);
    if (!funcionario) {
      return res.status(404).json({ success: false, error: 'Funcionario no encontrado' });
    }
    res.json({ success: true, data: funcionario });
  } catch (error) {
    console.error('Error al obtener funcionario:', error);
    res.status(500).json({ success: false, error: 'Error al obtener funcionario', detalle: error.message });
  }
};

// Crear un nuevo funcionario
export const crearFuncionario = async (req, res) => {
  try {
    const datosFuncionario = cuerpoFuncionarioDesdeRequest(req.body);
    
    // Validar campos requeridos
    if (!datosFuncionario.nmbrContcto || !datosFuncionario.codiAsgrdra) {
      return res.status(400).json({ 
        success: false, 
        error: 'Los campos nmbrContcto y codiAsgrdra son requeridos' 
      });
    }

    // Obtener el siguiente ID automático si no se proporciona o es 0
    // Validar que el ID sea un número válido y mayor a 0
    if (!datosFuncionario.id || datosFuncionario.id === 0 || datosFuncionario.id === '' || isNaN(datosFuncionario.id)) {
      const ultimoFuncionario = await FuncionarioAseguradora.findOne().sort({ id: -1 });
      datosFuncionario.id = ultimoFuncionario && ultimoFuncionario.id ? ultimoFuncionario.id + 1 : 1;
    } else {
      // Asegurar que el ID sea un número
      datosFuncionario.id = parseInt(datosFuncionario.id);
      
      // Verificar que no exista ya un funcionario con ese ID
      const funcionarioExistente = await FuncionarioAseguradora.findOne({ id: datosFuncionario.id });
      if (funcionarioExistente) {
        return res.status(400).json({ 
          success: false, 
          error: `Ya existe un funcionario con el ID ${datosFuncionario.id}. Por favor, use otro ID.` 
        });
      }
    }

    const nuevoFuncionario = new FuncionarioAseguradora(datosFuncionario);
    await nuevoFuncionario.save();
    
    res.status(201).json({ success: true, data: nuevoFuncionario, mensaje: 'Funcionario creado exitosamente' });
  } catch (error) {
    console.error('Error al crear funcionario:', error);
    res.status(500).json({ success: false, error: 'Error al crear funcionario', detalle: error.message });
  }
};

// Actualizar un funcionario
export const actualizarFuncionario = async (req, res) => {
  try {
    const { id } = req.params;
    const patch = cuerpoFuncionarioDesdeRequest(req.body);

    const doc = await FuncionarioAseguradora.findById(id);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Funcionario no encontrado' });
    }

    for (const k of CAMPOS_FUNCIONARIO) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      doc.set(k, patch[k]);
    }

    await doc.save();

    res.json({ success: true, data: doc, mensaje: 'Funcionario actualizado exitosamente' });
  } catch (error) {
    console.error('Error al actualizar funcionario:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar funcionario', detalle: error.message });
  }
};

// Eliminar un funcionario
export const eliminarFuncionario = async (req, res) => {
  try {
    const { id } = req.params;
    const funcionarioEliminado = await FuncionarioAseguradora.findByIdAndDelete(id);
    
    if (!funcionarioEliminado) {
      return res.status(404).json({ success: false, error: 'Funcionario no encontrado' });
    }

    res.json({ success: true, mensaje: 'Funcionario eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar funcionario:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar funcionario', detalle: error.message });
  }
};
