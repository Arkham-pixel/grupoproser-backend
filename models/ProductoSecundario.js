import secondaryConnection from "../db/secondaryConnection.js";
import mongoose from "mongoose";

const ProductoSchema = new mongoose.Schema({
  nombre: String,
  precio: Number,
  // ...otros campos
});

export default secondaryConnection.model("Producto", ProductoSchema);
