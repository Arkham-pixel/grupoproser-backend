import MatrizRiesgo from '../models/MatrizRiesgo.js';
import SecurUser from '../models/SecurUser.js';

// Crear nueva matriz de riesgo
export const crearMatrizRiesgo = async (req, res) => {
  try {
    const { datosMatriz, nombreEmpresa, titulo } = req.body;
    const userId = req.user.id;
    
    // Obtener información del usuario
    const usuario = await SecurUser.findById(userId);
    if (!usuario) {
      return res.status(404).json({ 
        success: false, 
        error: 'Usuario no encontrado' 
      });
    }
    
    // Crear nueva matriz de riesgo
    const nuevaMatriz = new MatrizRiesgo({
      tipo: 'matriz_riesgo_inicial',
      titulo: titulo || `Matriz de Riesgo - ${nombreEmpresa}`,
      nombreEmpresa,
      ajustador: {
        nombre: usuario.name,
        email: usuario.email,
        userId: userId
      },
      datosMatriz,
      estado: 'inicial'
    });
    
    // Guardar en la base de datos
    const matrizGuardada = await nuevaMatriz.save();
    
    // Agregar entrada al historial
    await matrizGuardada.agregarHistorial(
      usuario.name,
      'crear',
      'Matriz de riesgo creada inicialmente',
      { secciones: Object.keys(datosMatriz) }
    );
    
    res.status(201).json({
      success: true,
      message: 'Matriz de riesgo creada exitosamente',
      data: {
        id: matrizGuardada._id,
        titulo: matrizGuardada.titulo,
        nombreEmpresa: matrizGuardada.nombreEmpresa,
        fechaCreacion: matrizGuardada.fechaCreacion,
        estado: matrizGuardada.estado
      }
    });
    
  } catch (error) {
    console.error('Error creando matriz de riesgo:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
};

// Obtener todas las matrices de riesgo del usuario
export const obtenerMatricesRiesgo = async (req, res) => {
  try {
    const userId = req.user.id;
    const rolUsuario = req.user.rol || req.user.role || '';
    const { estado, tipo, empresa } = req.query;
    
    // Construir filtros
    const filtros = {
      eliminado: false
    };
    
    // Si no es admin, soporte o visualizador, solo ver sus propias matrices
    const puedeVerTodas = rolUsuario === 'admin' || rolUsuario === 'soporte' || rolUsuario === 'visualizador';
    if (!puedeVerTodas) {
      filtros['ajustador.userId'] = userId;
    }
    
    if (estado) filtros.estado = estado;
    if (tipo) filtros.tipo = tipo;
    if (empresa) filtros.nombreEmpresa = new RegExp(empresa, 'i');
    
    // Obtener matrices con paginación
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const matrices = await MatrizRiesgo.find(filtros)
      .select('titulo nombreEmpresa ajustador fechaCreacion fechaModificacion estado tipo')
      .sort({ fechaCreacion: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await MatrizRiesgo.countDocuments(filtros);
    
    res.json({
      success: true,
      data: matrices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error obteniendo matrices de riesgo:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
};

// Obtener una matriz de riesgo específica
export const obtenerMatrizRiesgo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const rolUsuario = req.user.rol || req.user.role || '';
    
    // Construir filtros
    const filtros = {
      _id: id,
      eliminado: false
    };
    
    // Si no es admin, soporte o visualizador, solo ver sus propias matrices
    const puedeVerTodas = rolUsuario === 'admin' || rolUsuario === 'soporte' || rolUsuario === 'visualizador';
    if (!puedeVerTodas) {
      filtros['ajustador.userId'] = userId;
    }
    
    const matriz = await MatrizRiesgo.findOne(filtros);
    
    if (!matriz) {
      return res.status(404).json({
        success: false,
        error: 'Matriz de riesgo no encontrada'
      });
    }
    
    res.json({
      success: true,
      data: matriz
    });
    
  } catch (error) {
    console.error('Error obteniendo matriz de riesgo:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
};

// Actualizar matriz de riesgo
export const actualizarMatrizRiesgo = async (req, res) => {
  try {
    const { id } = req.params;
    const { datosMatriz, titulo, estado } = req.body;
    const userId = req.user.id;
    const rolUsuario = req.user.rol || req.user.role || '';

    const filtros = {
      _id: id,
      eliminado: false,
    };
    const puedeEditarCualquiera =
      rolUsuario === 'admin' || rolUsuario === 'soporte' || rolUsuario === 'visualizador';
    if (!puedeEditarCualquiera) {
      filtros['ajustador.userId'] = userId;
    }

    const matriz = await MatrizRiesgo.findOne(filtros);

    if (!matriz) {
      return res.status(404).json({
        success: false,
        error: 'Matriz de riesgo no encontrada',
      });
    }

    // Obtener información del usuario
    const usuario = await SecurUser.findById(userId);
    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }
    
    // Actualizar campos
    if (datosMatriz) matriz.datosMatriz = datosMatriz;
    if (titulo) matriz.titulo = titulo;
    if (estado) matriz.estado = estado;
    
    // Guardar cambios
    const matrizActualizada = await matriz.save();
    
    // Agregar entrada al historial
    await matrizActualizada.agregarHistorial(
      usuario.name,
      'actualizar',
      'Matriz de riesgo actualizada',
      { 
        cambios: Object.keys(datosMatriz || {}),
        nuevoEstado: estado 
      }
    );
    
    res.json({
      success: true,
      message: 'Matriz de riesgo actualizada exitosamente',
      data: {
        id: matrizActualizada._id,
        titulo: matrizActualizada.titulo,
        fechaModificacion: matrizActualizada.fechaModificacion,
        estado: matrizActualizada.estado
      }
    });
    
  } catch (error) {
    console.error('Error actualizando matriz de riesgo:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
};

// Convertir matriz inicial a final
export const convertirAFinal = async (req, res) => {
  try {
    const { id } = req.params;
    const { datosMatriz } = req.body;
    const userId = req.user.id;
    
    // Buscar la matriz inicial
    const matrizInicial = await MatrizRiesgo.findOne({
      _id: id,
      'ajustador.userId': userId,
      eliminado: false,
      tipo: 'matriz_riesgo_inicial'
    });
    
    if (!matrizInicial) {
      return res.status(404).json({
        success: false,
        error: 'Matriz de riesgo inicial no encontrada'
      });
    }
    
    // Obtener información del usuario
    const usuario = await SecurUser.findById(userId);
    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }
    
    // Crear matriz final
    const matrizFinal = new MatrizRiesgo({
      tipo: 'matriz_riesgo_final',
      titulo: `${matrizInicial.titulo} - Informe Final`,
      nombreEmpresa: matrizInicial.nombreEmpresa,
      ajustador: matrizInicial.ajustador,
      datosMatriz: datosMatriz || matrizInicial.datosMatriz,
      estado: 'final',
      formularioInicial: matrizInicial._id
    });
    
    // Guardar matriz final
    const matrizGuardada = await matrizFinal.save();
    
    // Agregar entrada al historial
    await matrizGuardada.agregarHistorial(
      usuario.name,
      'convertir_final',
      'Matriz convertida a informe final',
      { matrizInicial: matrizInicial._id }
    );
    
    res.status(201).json({
      success: true,
      message: 'Matriz convertida a informe final exitosamente',
      data: {
        id: matrizGuardada._id,
        titulo: matrizGuardada.titulo,
        fechaCreacion: matrizGuardada.fechaCreacion,
        estado: matrizGuardada.estado
      }
    });
    
  } catch (error) {
    console.error('Error convirtiendo matriz a final:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
};

// Eliminar matriz de riesgo (soft delete)
export const eliminarMatrizRiesgo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const matriz = await MatrizRiesgo.findOne({
      _id: id,
      'ajustador.userId': userId,
      eliminado: false
    });
    
    if (!matriz) {
      return res.status(404).json({
        success: false,
        error: 'Matriz de riesgo no encontrada'
      });
    }
    
    // Obtener información del usuario
    const usuario = await SecurUser.findById(userId);
    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }
    
    // Marcar como eliminado
    await matriz.marcarEliminado(usuario.name);
    
    res.json({
      success: true,
      message: 'Matriz de riesgo eliminada exitosamente'
    });
    
  } catch (error) {
    console.error('Error eliminando matriz de riesgo:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
};

// Obtener historial de una matriz
export const obtenerHistorialMatriz = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const rolUsuario = req.user.rol || req.user.role || '';
    
    // Construir filtros
    const filtros = {
      _id: id,
      eliminado: false
    };
    
    // Si no es admin, soporte o visualizador, solo ver sus propias matrices
    const puedeVerTodas = rolUsuario === 'admin' || rolUsuario === 'soporte' || rolUsuario === 'visualizador';
    if (!puedeVerTodas) {
      filtros['ajustador.userId'] = userId;
    }
    
    const matriz = await MatrizRiesgo.findOne(filtros).select('historialCambios titulo nombreEmpresa');
    
    if (!matriz) {
      return res.status(404).json({
        success: false,
        error: 'Matriz de riesgo no encontrada'
      });
    }
    
    res.json({
      success: true,
      data: {
        titulo: matriz.titulo,
        nombreEmpresa: matriz.nombreEmpresa,
        historial: matriz.historialCambios
      }
    });
    
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      details: error.message
    });
  }
};
