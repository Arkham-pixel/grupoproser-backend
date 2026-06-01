import Responsable from '../models/Responsable.js';
import SecurUser from '../models/SecurUser.js';

// Obtener todos los responsables
export const obtenerResponsables = async (req, res) => {
  try {
    const responsables = await Responsable.find({}).sort({ nmbrRespnsble: 1 });
    
    // Enriquecer responsables con fotos de usuarios
    const responsablesConFotos = await Promise.all(
      responsables.map(async (responsable) => {
        const responsableObj = responsable.toObject();
        
        // Buscar usuario por email si existe
        if (responsable.email) {
          try {
            // Buscar por email exacto (case insensitive) o por login
            const usuario = await SecurUser.findOne({ 
              $or: [
                { email: { $regex: new RegExp(`^${responsable.email}$`, 'i') } },
                { login: { $regex: new RegExp(`^${responsable.email}$`, 'i') } }
              ]
            }).select('foto email name login');
            
            if (usuario) {
              if (usuario.foto) {
                responsableObj.fotoUsuario = usuario.foto;
              }
              responsableObj.nombreUsuario = usuario.name;
              responsableObj.usuarioId = usuario._id;
              responsableObj.usuarioLogin = usuario.login;
              console.log(`✅ Usuario encontrado para ${responsable.email}:`, {
                name: usuario.name,
                tieneFoto: !!usuario.foto,
                foto: usuario.foto
              });
            } else {
              console.log(`⚠️ No se encontró usuario para email: ${responsable.email}`);
            }
          } catch (err) {
            console.error(`❌ Error buscando usuario para ${responsable.email}:`, err);
          }
        }
        
        return responsableObj;
      })
    );
    
    res.json({ success: true, data: responsablesConFotos });
  } catch (error) {
    console.error('Error al obtener responsables:', error);
    res.status(500).json({ success: false, error: 'Error al obtener responsables', detalle: error.message });
  }
};

// Obtener un responsable por ID
export const obtenerResponsablePorId = async (req, res) => {
  try {
    const { id } = req.params;
    const responsable = await Responsable.findById(id);
    if (!responsable) {
      return res.status(404).json({ success: false, error: 'Responsable no encontrado' });
    }
    res.json({ success: true, data: responsable });
  } catch (error) {
    console.error('Error al obtener responsable:', error);
    res.status(500).json({ success: false, error: 'Error al obtener responsable', detalle: error.message });
  }
};

// Crear un nuevo responsable
export const crearResponsable = async (req, res) => {
  try {
    const { codiRespnsble, nmbrRespnsble, email, telefono } = req.body;

    // Validar campos requeridos
    if (!codiRespnsble || !nmbrRespnsble) {
      return res.status(400).json({ success: false, error: 'El código y el nombre son campos requeridos.' });
    }

    // Verificar si ya existe un responsable con el mismo código
    const existeResponsable = await Responsable.findOne({ codiRespnsble });
    if (existeResponsable) {
      return res.status(409).json({ success: false, error: 'Ya existe un responsable con este código.' });
    }

    const nuevoResponsable = new Responsable({
      codiRespnsble,
      nmbrRespnsble,
      email,
      telefono
    });
    await nuevoResponsable.save();
    res.status(201).json({ success: true, data: nuevoResponsable, message: 'Responsable creado exitosamente' });
  } catch (error) {
    console.error('Error al crear responsable:', error);
    res.status(500).json({ success: false, error: 'Error al crear responsable', detalle: error.message });
  }
};

// Actualizar un responsable existente
export const actualizarResponsable = async (req, res) => {
  try {
    const { id } = req.params;
    const { codiRespnsble, nmbrRespnsble, email, telefono } = req.body;

    // Validar campos requeridos
    if (!codiRespnsble || !nmbrRespnsble) {
      return res.status(400).json({ success: false, error: 'El código y el nombre son campos requeridos.' });
    }

    // Verificar si el nuevo código ya existe en otro responsable
    const existeResponsableConMismoCodigo = await Responsable.findOne({ codiRespnsble, _id: { $ne: id } });
    if (existeResponsableConMismoCodigo) {
      return res.status(409).json({ success: false, error: 'Ya existe otro responsable con este código.' });
    }

    const responsableActualizado = await Responsable.findByIdAndUpdate(
      id,
      { codiRespnsble, nmbrRespnsble, email, telefono },
      { new: true, runValidators: true }
    );

    if (!responsableActualizado) {
      return res.status(404).json({ success: false, error: 'Responsable no encontrado para actualizar' });
    }
    res.json({ success: true, data: responsableActualizado, message: 'Responsable actualizado exitosamente' });
  } catch (error) {
    console.error('Error al actualizar responsable:', error);
    res.status(500).json({ success: false, error: 'Error al actualizar responsable', detalle: error.message });
  }
};

// Eliminar un responsable
export const eliminarResponsable = async (req, res) => {
  try {
    const { id } = req.params;
    const responsableEliminado = await Responsable.findByIdAndDelete(id);
    if (!responsableEliminado) {
      return res.status(404).json({ success: false, error: 'Responsable no encontrado para eliminar' });
    }
    res.json({ success: true, message: 'Responsable eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar responsable:', error);
    res.status(500).json({ success: false, error: 'Error al eliminar responsable', detalle: error.message });
  }
}; 