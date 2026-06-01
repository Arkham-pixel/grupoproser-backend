import express from "express";
import { obtenerProductos } from "../controllers/productoSecundarioController.js";

const router = express.Router();

router.get("/productos-secundarios", obtenerProductos);

export default router;
