import ProductoSecundario from "../models/ProductoSecundario.js";

// Ejemplo de función para obtener productos de la segunda base
export const obtenerProductos = async (req, res) => {
  try {
    const productos = await ProductoSecundario.find();
    res.json(productos);
  } catch (error) {
    res.status(500).json({ mensaje: "Error al obtener productos secundarios" });
  }
};
