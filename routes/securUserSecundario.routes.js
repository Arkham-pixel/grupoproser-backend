import express from "express";
import {
  obtenerSecurUsers,
  loginSecurUser,
  obtenerPerfilSecurUser,
  actualizarPerfilSecurUser,
  validarCodigo2FA,
  eliminarSecurUser,
  cambiarPasswordSecurUser
} from "../controllers/securUserSecundarioController.js";
import { verificarToken } from "../middleware/auth.js"; // O el middleware que uses


const router = express.Router();

router.get("/secur-users-secundarios", obtenerSecurUsers);
router.post("/secur-users/login", loginSecurUser);
router.post("/secur-users/2fa", validarCodigo2FA);
router.post("/secur-users/cambiar-password", verificarToken, cambiarPasswordSecurUser);
router.get("/secur-users/perfil", verificarToken, obtenerPerfilSecurUser);
router.put("/secur-users/perfil", verificarToken, actualizarPerfilSecurUser);
router.delete("/secur-users", eliminarSecurUser);

export default router;
