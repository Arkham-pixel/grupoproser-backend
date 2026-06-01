import SecurUserSecundario from "../models/SecurUserSecundario.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs"; // Si usas bcrypt
import nodemailer from "nodemailer";
import { JWT_SECRET } from "../config/secrets.js";

export const obtenerSecurUsers = async (req, res) => {
  try {
    const users = await SecurUserSecundario.find();
    res.json(users);
  } catch (error) {
    console.error("Error detallado:", error);
    res.status(500).json({ mensaje: "Error al obtener usuarios secundarios", error: error.message });
  }
};

export const loginSecurUser = async (req, res) => {
  const { login, pswd } = req.body;
  try {
    console.log('Intentando login para:', login);
    // Busca el usuario por login
    const user = await SecurUserSecundario.findOne({ login });
    if (!user) {
      console.log('Usuario no encontrado');
      return res.status(401).json({ mensaje: "Usuario no encontrado" });
    }
    // Comparar contraseña: soporta hash (bcrypt) o texto plano
    let passwordValido = false;
    if (user.pswd && user.pswd.startsWith('$2')) {
      // bcrypt hash
      passwordValido = await bcrypt.compare(pswd, user.pswd);
    } else {
      // texto plano
      passwordValido = user.pswd === pswd;
    }
    if (!passwordValido) {
      console.log('Contraseña incorrecta');
      return res.status(401).json({ mensaje: "Contraseña incorrecta" });
    }
    // Generar código 2FA
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFACode = code;
    user.twoFACodeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos
    await user.save();
    // Enviar código por correo
    try {
      const transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Código de verificación 2FA',
        text: `Tu código de verificación es: ${code}`
      });
      console.log('Código 2FA enviado a:', user.email);
    } catch (mailErr) {
      console.error('Error enviando correo 2FA:', mailErr);
      console.log('Código 2FA generado (no enviado por email):', code);
      // En desarrollo, devolver el código en la respuesta
      return res.json({ 
        twoFARequired: true, 
        email: user.email,
        debugCode: code, // Solo para desarrollo
        message: 'Código 2FA generado pero no enviado por email'
      });
    }
    return res.json({ twoFARequired: true, email: user.email });
  } catch (error) {
    console.error('Error en login 2FA:', error);
    res.status(500).json({ mensaje: "Error en el login 2FA", error: error.message });
  }
};

// Validar código 2FA y devolver token
export const validarCodigo2FA = async (req, res) => {
  const { login, code } = req.body;
  try {
    const user = await SecurUserSecundario.findOne({ login });
    if (!user || !user.twoFACode || !user.twoFACodeExpires) {
      return res.status(400).json({ mensaje: "Código no solicitado o usuario inválido" });
    }
    if (user.twoFACode !== code) {
      return res.status(401).json({ mensaje: "Código incorrecto" });
    }
    if (user.twoFACodeExpires < new Date()) {
      return res.status(401).json({ mensaje: "Código expirado" });
    }
    // Limpiar el código después de usarlo
    user.twoFACode = undefined;
    user.twoFACodeExpires = undefined;
    await user.save();
    // Generar token JWT
    const token = jwt.sign(
      { id: user._id, login: user.login, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );
    res.json({
      mensaje: "Login exitoso",
      token,
      user: {
        id: user._id,
        login: user.login,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ mensaje: "Error en la verificación 2FA", error: error.message });
  }
};

export const obtenerPerfilSecurUser = async (req, res) => {
  try {
    // El id viene del token JWT
    const userId = req.usuario.id;
    const user = await SecurUserSecundario.findById(userId).select("-pswd");
    if (!user) {
      return res.status(404).json({ mensaje: "Usuario no encontrado" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ mensaje: "Error al obtener perfil", error: error.message });
  }
};

export const actualizarPerfilSecurUser = async (req, res) => {
  try {
    const userId = req.usuario.id;
    const { passwordConfirm, ...update } = req.body;

    const user = await SecurUserSecundario.findById(userId);
    if (!user) {
      return res.status(404).json({ mensaje: "Usuario no encontrado" });
    }

    // Verifica la contraseña
    // Si la contraseña está hasheada:
    const isMatch = await bcrypt.compare(passwordConfirm, user.pswd);
    // Si la contraseña está en texto plano (no recomendado):
    // const isMatch = passwordConfirm === user.pswd;

    if (!isMatch) {
      return res.status(401).json({ mensaje: "Contraseña incorrecta. No se guardaron los cambios." });
    }

    // Actualiza los datos
    const updatedUser = await SecurUserSecundario.findByIdAndUpdate(userId, update, { new: true, runValidators: true });
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ mensaje: "Error al actualizar perfil", error: error.message });
  }
};

export const cambiarPasswordSecurUser = async (req, res) => {
  try {
    const userId = req.usuario.id;
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ mensaje: "Todos los campos son obligatorios" });
    }
    const user = await SecurUserSecundario.findById(userId);
    if (!user) {
      return res.status(404).json({ mensaje: "Usuario no encontrado" });
    }
    // Validar contraseña actual (soporta hash o texto plano)
    let passwordValido = false;
    if (user.pswd && user.pswd.startsWith('$2')) {
      passwordValido = await bcrypt.compare(oldPassword, user.pswd);
    } else {
      passwordValido = user.pswd === oldPassword;
    }
    if (!passwordValido) {
      return res.status(401).json({ mensaje: "La contraseña actual es incorrecta" });
    }
    // Hashear la nueva contraseña
    const hashed = await bcrypt.hash(newPassword, 10);
    user.pswd = hashed;
    await user.save();
    res.json({ mensaje: "Contraseña cambiada correctamente", user: { login: user.login } });
  } catch (error) {
    res.status(500).json({ mensaje: "Error al cambiar la contraseña", error: error.message });
  }
};

export const eliminarSecurUser = async (req, res) => {
  try {
    const { loginOrEmail } = req.query;
    // Obtener el usuario autenticado desde el token (req.usuario)
    const usuarioActual = req.usuario;
    if (!loginOrEmail) {
      return res.status(400).json({ mensaje: "Debes proporcionar login o email" });
    }
    const user = await SecurUserSecundario.findOne({
      $or: [
        { login: loginOrEmail },
        { email: loginOrEmail }
      ]
    });
    if (!user) {
      return res.status(404).json({ mensaje: "Usuario no encontrado" });
    }
    // Evitar que el admin/soporte se elimine a sí mismo
    if (
      usuarioActual &&
      ((usuarioActual.login && usuarioActual.login === user.login) ||
       (usuarioActual.email && usuarioActual.email === user.email))
    ) {
      return res.status(403).json({ mensaje: "No puedes eliminar tu propio usuario" });
    }
    await SecurUserSecundario.deleteOne({ _id: user._id });
    res.json({ mensaje: "Usuario eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ mensaje: "Error al eliminar usuario", error: error.message });
  }
};
