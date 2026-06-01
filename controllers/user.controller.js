import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/secrets.js";

// Registro
export const register = async (req, res) => {
  try {
    const { nombre, correo, contrasena } = req.body;

    // Validación previa
    const existe = await User.findOne({ correo });
    if (existe) return res.status(400).json({ error: "El correo ya está registrado" });

    const hashedPassword = await bcrypt.hash(contrasena, 10);
    const user = new User({ nombre, correo, contrasena: hashedPassword });
    await user.save();

    res.status(201).json({ message: "Usuario registrado correctamente" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Login
export const login = async (req, res) => {
  try {
    const { correo, contrasena } = req.body;

    const user = await User.findOne({ correo });
    if (!user) return res.status(400).json({ error: "Usuario no encontrado" });

    const valid = await bcrypt.compare(contrasena, user.contrasena);
    if (!valid) return res.status(400).json({ error: "Contraseña incorrecta" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1d" });

    res.json({ access_token: token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
