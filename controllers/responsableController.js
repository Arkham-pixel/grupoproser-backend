import Responsable from '../models/Responsable.js';
import SecurUser from '../models/SecurUser.js';

function escapeRegex(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Obtener todos los responsables
export const obtenerResponsables = async (req, res) => {
  try {
    const responsables = await Responsable.find({}).sort({ nmbrRespnsble: 1 }).lean();

    const emails = [...new Set(
      responsables.map((r) => String(r.email || '').trim()).filter(Boolean)
    )];

    let usuarios = [];
    if (emails.length > 0) {
      const emailOrLogin = emails.flatMap((email) => {
        const rx = new RegExp(`^${escapeRegex(email)}$`, 'i');
        return [{ email: rx }, { login: rx }];
      });
      usuarios = await SecurUser.find({ $or: emailOrLogin })
        .select('foto email name login')
        .lean();
    }

    const usuariosPorClave = new Map();
    for (const usuario of usuarios) {
      if (usuario.email) usuariosPorClave.set(String(usuario.email).toLowerCase(), usuario);
      if (usuario.login) usuariosPorClave.set(String(usuario.login).toLowerCase(), usuario);
    }

    const responsablesConFotos = responsables.map((responsable) => {
      const responsableObj = { ...responsable };
      if (!responsable.email) return responsableObj;
      const usuario = usuariosPorClave.get(String(responsable.email).toLowerCase());
      if (!usuario) return responsableObj;
      if (usuario.foto) responsableObj.fotoUsuario = usuario.foto;
      responsableObj.nombreUsuario = usuario.name;
      responsableObj.usuarioId = usuario._id;
      responsableObj.usuarioLogin = usuario.login;
      return responsableObj;
    });

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