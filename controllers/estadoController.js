import Estado from '../models/Estado.js';
import EstadoRiesgo from '../models/EstadoRiesgo.js';
import ClasificacionRiesgo from '../models/ClasificacionRiesgo.js';
import EstadoExpress from '../models/EstadoExpress.js';
import SiniestroExpress from '../models/SiniestroExpress.js';

const normEstadoExpress = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const codigoEstadoExpress = (estado) =>
  String(estado?.codiEstdo ?? estado?.codiEstado ?? '').trim();

const descEstadoExpress = (estado) =>
  String(estado?.descEstdo ?? estado?.descEstado ?? '').trim();

export const obtenerEstados = async (req, res) => {
  try {
    const estados = await Estado.find();
    res.json(estados);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estados', detalle: error.message });
  }
};

export const obtenerEstadosRiesgo = async (req, res) => {
  try {
    console.log('🔍 Intentando obtener estados de riesgo...');
    console.log('📊 Modelo EstadoRiesgo:', EstadoRiesgo);
    console.log('🔗 Conexión:', EstadoRiesgo.db.name);
    
    const estados = await EstadoRiesgo.find();
    console.log('✅ Estados de riesgo encontrados:', estados.length);
    console.log('📋 Primer estado:', estados[0]);
    res.json(estados);
  } catch (err) {
    console.error('❌ Error al obtener estados de riesgo:', err);
    res.status(500).json({ error: 'Error al obtener los estados de riesgo' });
  }
};

export const obtenerClasificacionesRiesgo = async (req, res) => {
  try {
    console.log('🔍 Intentando obtener clasificaciones de riesgo...');
    console.log('📊 Modelo ClasificacionRiesgo:', ClasificacionRiesgo);
    console.log('🔗 Conexión:', ClasificacionRiesgo.db.name);
    
    const clasificaciones = await ClasificacionRiesgo.find();
    console.log('✅ Clasificaciones encontradas:', clasificaciones.length);
    console.log('📋 Primera clasificación:', clasificaciones[0]);
    res.json(clasificaciones);
  } catch (err) {
    console.error('❌ Error al obtener clasificaciones de riesgo:', err);
    res.status(500).json({ error: 'Error al obtener las clasificaciones de riesgo' });
  }
}; 

export const obtenerEstadosExpress = async (req, res) => {
  try {
    const estados = await EstadoExpress.find().sort({ codiEstdo: 1, codiEstado: 1 }).lean();
    res.json(estados);
  } catch (error) {
    console.error('❌ Error al obtener estados express:', error);
    res.status(500).json({ error: 'Error al obtener los estados express', detalle: error.message });
  }
};

export const crearEstadoExpress = async (req, res) => {
  try {
    const codiEstdo = Number(req.body.codiEstdo ?? req.body.codiEstado);
    const descEstdo = descEstadoExpress(req.body);

    if (!Number.isFinite(codiEstdo) || codiEstdo <= 0) {
      return res.status(400).json({
        success: false,
        error: 'El código de estado debe ser un número positivo.',
      });
    }
    if (!descEstdo) {
      return res.status(400).json({
        success: false,
        error: 'La descripción del estado es obligatoria.',
      });
    }

    const duplicado = await EstadoExpress.findOne({
      $or: [{ codiEstdo }, { codiEstado: codiEstdo }, { descEstdo }, { descEstado: descEstdo }],
    });
    if (duplicado) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un estado Express con ese código o descripción.',
      });
    }

    const estado = await EstadoExpress.create({
      codiEstdo,
      descEstdo,
      codiEstado: codiEstdo,
      descEstado: descEstdo,
    });

    res.status(201).json({ success: true, data: estado });
  } catch (error) {
    console.error('❌ Error al crear estado express:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear el estado express',
      detalle: error.message,
    });
  }
};

export const actualizarEstadoExpress = async (req, res) => {
  try {
    const { id } = req.params;
    const codiNuevo = Number(req.body.codiEstdo ?? req.body.codiEstado);
    const descNueva = descEstadoExpress(req.body);

    const estado = await EstadoExpress.findById(id);
    if (!estado) {
      return res.status(404).json({ success: false, error: 'Estado Express no encontrado.' });
    }

    if (!Number.isFinite(codiNuevo) || codiNuevo <= 0) {
      return res.status(400).json({
        success: false,
        error: 'El código de estado debe ser un número positivo.',
      });
    }
    if (!descNueva) {
      return res.status(400).json({
        success: false,
        error: 'La descripción del estado es obligatoria.',
      });
    }

    const codiAnterior = codigoEstadoExpress(estado);
    const descAnterior = descEstadoExpress(estado);
    const descAnteriorNorm = normEstadoExpress(descAnterior);

    const duplicado = await EstadoExpress.findOne({
      _id: { $ne: estado._id },
      $or: [{ codiEstdo: codiNuevo }, { codiEstado: codiNuevo }, { descEstdo: descNueva }, { descEstado: descNueva }],
    });
    if (duplicado) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro estado Express con ese código o descripción.',
      });
    }

    estado.codiEstdo = codiNuevo;
    estado.codiEstado = codiNuevo;
    estado.descEstdo = descNueva;
    estado.descEstado = descNueva;
    await estado.save();

    const codigoStr = String(codiNuevo);
    const codigoAnteriorStr = String(codiAnterior);
    const valoresAnteriores = [codigoAnteriorStr, descAnterior, descAnteriorNorm].filter(Boolean);

    if (codigoStr !== codigoAnteriorStr || normEstadoExpress(descNueva) !== descAnteriorNorm) {
      await SiniestroExpress.updateMany(
        { estadoProceso: { $in: valoresAnteriores } },
        { $set: { estadoProceso: codigoStr } }
      );
    }

    res.json({
      success: true,
      data: estado,
      message: 'Estado actualizado. Los casos Express vinculados usan el código del catálogo.',
    });
  } catch (error) {
    console.error('❌ Error al actualizar estado express:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el estado express',
      detalle: error.message,
    });
  }
};

export const eliminarEstadoExpress = async (req, res) => {
  try {
    const { id } = req.params;
    const estado = await EstadoExpress.findById(id);
    if (!estado) {
      return res.status(404).json({ success: false, error: 'Estado Express no encontrado.' });
    }

    const codigo = codigoEstadoExpress(estado);
    const descNorm = normEstadoExpress(descEstadoExpress(estado));
    const enUso = await SiniestroExpress.countDocuments({
      $or: [{ estadoProceso: codigo }, { estadoProceso: descNorm }],
    });

    if (enUso > 0) {
      return res.status(400).json({
        success: false,
        error: `No se puede eliminar: ${enUso} caso(s) Express usan este estado.`,
      });
    }

    await EstadoExpress.deleteOne({ _id: estado._id });
    res.json({ success: true, message: 'Estado Express eliminado.' });
  } catch (error) {
    console.error('❌ Error al eliminar estado express:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el estado express',
      detalle: error.message,
    });
  }
};

// Crear un nuevo estado de COMPLEX
export const crearEstado = async (req, res) => {
  console.log('🔵 crearEstado llamado');
  console.log('🔵 req.body:', req.body);
  try {
    const { codiEstdo, descEstdo } = req.body;

    // Validar que se proporcionen los campos requeridos
    if (!codiEstdo || !descEstdo) {
      return res.status(400).json({ 
        error: 'Campos requeridos faltantes', 
        detalle: 'Se requiere codiEstdo y descEstdo' 
      });
    }

    // Verificar si ya existe un estado con el mismo código
    const estadoExistente = await Estado.findOne({ codiEstdo: Number(codiEstdo) });
    if (estadoExistente) {
      return res.status(400).json({ 
        error: 'Estado duplicado', 
        detalle: `Ya existe un estado con el código ${codiEstdo}` 
      });
    }

    // Crear el nuevo estado
    const nuevoEstado = new Estado({
      codiEstdo: Number(codiEstdo),
      descEstdo: String(descEstdo).trim()
    });

    const estadoGuardado = await nuevoEstado.save();
    console.log('✅ Estado creado:', estadoGuardado);
    
    res.status(201).json({
      success: true,
      message: 'Estado creado exitosamente',
      data: estadoGuardado
    });
  } catch (error) {
    console.error('❌ Error al crear estado:', error);
    res.status(500).json({ 
      error: 'Error al crear el estado', 
      detalle: error.message 
    });
  }
};

// Eliminar un estado de COMPLEX
export const eliminarEstado = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ 
        error: 'ID requerido', 
        detalle: 'Se requiere el ID del estado a eliminar' 
      });
    }

    // Buscar y eliminar el estado
    const estadoEliminado = await Estado.findByIdAndDelete(id);

    if (!estadoEliminado) {
      return res.status(404).json({ 
        error: 'Estado no encontrado', 
        detalle: `No se encontró un estado con el ID ${id}` 
      });
    }

    console.log('✅ Estado eliminado:', estadoEliminado);
    
    res.json({
      success: true,
      message: 'Estado eliminado exitosamente',
      data: estadoEliminado
    });
  } catch (error) {
    console.error('❌ Error al eliminar estado:', error);
    res.status(500).json({ 
      error: 'Error al eliminar el estado', 
      detalle: error.message 
    });
  }
};