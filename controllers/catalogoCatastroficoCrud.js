/**
 * CRUD genérico para catálogos catastróficos (ajustador / inspector) con ciudad.
 */

const normCiudad = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();

export function crearCatalogoCatastroficoCrud(Model, etiqueta = 'registro') {
  const listar = async (req, res) => {
    try {
      const ciudadQuery = String(req.query?.ciudad || '').trim();
      let docs = await Model.find({}).sort({ nombre: 1 }).lean();

      if (ciudadQuery) {
        const target = normCiudad(ciudadQuery);
        docs = docs.filter((d) => {
          const c = normCiudad(d.ciudad);
          if (!c || c === 'TODAS' || c === 'TODOS') return true;
          return c === target;
        });
      }

      res.json({ success: true, data: docs });
    } catch (error) {
      console.error(`Error al listar ${etiqueta}:`, error);
      res.status(500).json({
        success: false,
        error: `Error al obtener ${etiqueta}`,
        detalle: error.message,
      });
    }
  };

  const obtenerPorId = async (req, res) => {
    try {
      const doc = await Model.findById(req.params.id);
      if (!doc) {
        return res.status(404).json({ success: false, error: `${etiqueta} no encontrado` });
      }
      res.json({ success: true, data: doc });
    } catch (error) {
      console.error(`Error al obtener ${etiqueta}:`, error);
      res.status(500).json({
        success: false,
        error: `Error al obtener ${etiqueta}`,
        detalle: error.message,
      });
    }
  };

  const crear = async (req, res) => {
    try {
      const { codigo, nombre, email, telefono, ciudad } = req.body || {};
      if (!codigo || !nombre || !ciudad) {
        return res.status(400).json({
          success: false,
          error: 'Código, nombre y ciudad son campos requeridos.',
        });
      }

      const existe = await Model.findOne({ codigo: String(codigo).trim() });
      if (existe) {
        return res.status(409).json({
          success: false,
          error: `Ya existe un ${etiqueta} con este código.`,
        });
      }

      const nuevo = await Model.create({
        codigo: String(codigo).trim(),
        nombre: String(nombre).trim(),
        email: email != null ? String(email).trim() : '',
        telefono: telefono != null ? String(telefono).trim() : '',
        ciudad: String(ciudad).trim(),
      });

      res.status(201).json({
        success: true,
        data: nuevo,
        message: `${etiqueta} creado exitosamente`,
      });
    } catch (error) {
      console.error(`Error al crear ${etiqueta}:`, error);
      res.status(500).json({
        success: false,
        error: `Error al crear ${etiqueta}`,
        detalle: error.message,
      });
    }
  };

  const actualizar = async (req, res) => {
    try {
      const { id } = req.params;
      const { codigo, nombre, email, telefono, ciudad } = req.body || {};
      if (!codigo || !nombre || !ciudad) {
        return res.status(400).json({
          success: false,
          error: 'Código, nombre y ciudad son campos requeridos.',
        });
      }

      const conflicto = await Model.findOne({
        codigo: String(codigo).trim(),
        _id: { $ne: id },
      });
      if (conflicto) {
        return res.status(409).json({
          success: false,
          error: `Ya existe otro ${etiqueta} con este código.`,
        });
      }

      const actualizado = await Model.findByIdAndUpdate(
        id,
        {
          codigo: String(codigo).trim(),
          nombre: String(nombre).trim(),
          email: email != null ? String(email).trim() : '',
          telefono: telefono != null ? String(telefono).trim() : '',
          ciudad: String(ciudad).trim(),
        },
        { new: true, runValidators: true }
      );

      if (!actualizado) {
        return res.status(404).json({ success: false, error: `${etiqueta} no encontrado` });
      }

      res.json({
        success: true,
        data: actualizado,
        message: `${etiqueta} actualizado exitosamente`,
      });
    } catch (error) {
      console.error(`Error al actualizar ${etiqueta}:`, error);
      res.status(500).json({
        success: false,
        error: `Error al actualizar ${etiqueta}`,
        detalle: error.message,
      });
    }
  };

  const eliminar = async (req, res) => {
    try {
      const eliminado = await Model.findByIdAndDelete(req.params.id);
      if (!eliminado) {
        return res.status(404).json({ success: false, error: `${etiqueta} no encontrado` });
      }
      res.json({ success: true, message: `${etiqueta} eliminado exitosamente` });
    } catch (error) {
      console.error(`Error al eliminar ${etiqueta}:`, error);
      res.status(500).json({
        success: false,
        error: `Error al eliminar ${etiqueta}`,
        detalle: error.message,
      });
    }
  };

  return { listar, obtenerPorId, crear, actualizar, eliminar };
}
