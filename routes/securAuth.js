// routes/securAuth.js
import express from "express";
import mongoose from "mongoose";
import SecurUser from "../models/SecurUser.js";
import SesionUsuario from "../models/SesionUsuario.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { JWT_SECRET } from "../config/secrets.js";
import { esRolValido } from "../config/roles.js";
import { UPLOADS_ROOT, ensureUploadDir } from "../config/uploadsRoot.js";
import { createMulterUpload, attachPersistedFileMiddleware } from "../storage/multerStorageFactory.js";
import { STORAGE_CATEGORIES, deleteReplacedStoredFile, getPublicPathForSingle } from "../services/fileStorageService.js";
import { resolveFrontendUrl } from "../config/platformUrls.js";

const router = express.Router();

console.log('✅ Router securAuth inicializado');

// ─── Configuración de multer para subida de fotos ─────────────
const uploadsDir = ensureUploadDir(UPLOADS_ROOT);

const upload = createMulterUpload({
  category: STORAGE_CATEGORIES.PERFILES,
  filenameFn: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const userId = req.usuario?.id || 'unknown';
    cb(null, `${userId}-${Date.now()}${ext}`);
  },
});
const persistFoto = attachPersistedFileMiddleware({
  category: STORAGE_CATEGORIES.PERFILES,
});

// Obtener perfil de un usuario específico por ID (para administradores)
// IMPORTANTE: Esta ruta debe ir ANTES de /usuarios para que Express la capture correctamente
router.get("/usuarios/:id/perfil", async (req, res) => {
  console.log('🔍 GET /usuarios/:id/perfil - Ruta capturada');
  console.log('📋 Parámetros:', req.params);
  const token = req.headers.authorization?.split(' ')[1];
  const { id } = req.params;
  
  try {
    if (!token) {
      return res.status(401).json({ message: "Token requerido" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar que el usuario tenga permisos (admin o soporte)
    const usuarioActual = await SecurUser.findById(decoded.id);
    if (!usuarioActual || !['admin', 'soporte'].includes(usuarioActual.role)) {
      return res.status(403).json({ message: "No tienes permisos para acceder a este recurso" });
    }
    
    const usuario = await SecurUser.findById(id).lean();
    
    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    const perfilResponse = {
      id: usuario._id,
      login: usuario.login,
      name: usuario.name,
      email: usuario.email,
      role: usuario.role,
      phone: usuario.phone,
      active: usuario.active,
      privAdmin: usuario.privAdmin,
      pswdLastUpdated: usuario.pswdLastUpdated,
      createdAt: usuario.createdAt,
      updatedAt: usuario.updatedAt,
      foto: usuario.foto,
      cedula: usuario.cedula ?? null,
      fechaNacimiento: usuario.fechaNacimiento ?? null,
      tipoSangre: usuario.tipoSangre ?? null,
      direccion: usuario.direccion ?? null,
      telefonoFijo: usuario.telefonoFijo ?? null,
      celulares: usuario.celulares ?? null,
      correosElectronicos: usuario.correosElectronicos ?? null,
      empresa: usuario.empresa ?? null,
      fechaIngreso: usuario.fechaIngreso ?? null,
      cargos: usuario.cargos ?? null,
      salario: usuario.salario ?? null,
      fechaModificacionSueldo: usuario.fechaModificacionSueldo ?? null,
      tipoContrato: usuario.tipoContrato ?? null,
      fechaModificacionContrato: usuario.fechaModificacionContrato ?? null,
      vencimiento: usuario.vencimiento ?? null,
      aportesSalud: usuario.aportesSalud ?? null,
      aportesPension: usuario.aportesPension ?? null,
      aportesCesantias: usuario.aportesCesantias ?? null,
      aportesARL: usuario.aportesARL ?? null,
      aportesCCF: usuario.aportesCCF ?? null,
      evaluacionPeriodoPrueba: usuario.evaluacionPeriodoPrueba ?? null,
      sucursal: usuario.sucursal ?? null
    };
    
    res.json(perfilResponse);
  } catch (error) {
    console.error('Error obteniendo perfil de usuario:', error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta para listar usuarios secur (solo para desarrollo)
router.get("/usuarios", async (req, res) => {
  try {
    console.log('🔍 Buscando usuarios en la base de datos...');
    // Gestión de documentos / listados: sin foto binaria (picture puede ser Buffer muy pesado)
    const usuarios = await SecurUser.find(
      {},
      { pswd: 0, mfa: 0, activationCode: 0, picture: 0, totpSecret: 0, totpTempSecret: 0 }
    )
      .sort({ name: 1 })
      .lean();
    console.log('✅ Usuarios encontrados:', usuarios.length);
    console.log('📋 Roles encontrados:', [...new Set(usuarios.map(u => u.role))]);
    res.json({
      total: usuarios.length,
      usuarios: usuarios
    });
  } catch (error) {
    console.error("❌ Error al listar usuarios secur:", error);
    console.error("📋 Stack trace:", error.stack);
    res.status(500).json({ message: "Error al obtener usuarios" });
  }
});

// Ruta de prueba para verificar conexión a la base de datos
router.get("/test-db", async (req, res) => {
  try {
    console.log('🧪 Probando conexión a la base de datos...');
    
    // Verificar si el modelo está conectado
    const dbState = SecurUser.db.db.admin().listDatabases();
    console.log('✅ Conexión a MongoDB verificada');
    
    // Contar usuarios
    const count = await SecurUser.countDocuments();
    console.log('📊 Total de usuarios en la base de datos:', count);
    
    res.json({
      success: true,
      message: "Conexión a la base de datos exitosa",
      userCount: count,
      dbState: "connected"
    });
  } catch (error) {
    console.error("❌ Error en prueba de base de datos:", error);
    console.error("📋 Stack trace:", error.stack);
    res.status(500).json({ 
      success: false,
      message: "Error en la conexión a la base de datos",
      error: error.message
    });
  }
});

// 🔐 Ruta para cambiar contraseña de usuarios (solo para admin/soporte)
console.log('📝 Registrando ruta POST /cambiar-password');
router.post("/cambiar-password", async (req, res) => {
  try {
    console.log('🔐 Iniciando cambio de contraseña...');
    console.log('📝 Datos recibidos:', { 
      login: req.body.login, 
      adminLogin: req.body.adminLogin,
      nuevaPassword: req.body.nuevaPassword ? '***' : 'NO DEFINIDA'
    });
    
    const { login, nuevaPassword, adminLogin, adminPassword } = req.body;
    
    // Validar datos requeridos
    if (!login || !nuevaPassword || !adminLogin || !adminPassword) {
      console.log('❌ Datos faltantes:', { login: !!login, nuevaPassword: !!nuevaPassword, adminLogin: !!adminLogin, adminPassword: !!adminPassword });
      return res.status(400).json({ message: "Todos los campos son requeridos" });
    }
    
    console.log('🔍 Buscando administrador:', adminLogin);
    // Verificar que el administrador existe y tiene permisos
    const admin = await SecurUser.findOne({ login: adminLogin });
    if (!admin) {
      console.log('❌ Administrador no encontrado:', adminLogin);
      return res.status(404).json({ message: "Administrador no encontrado" });
    }
    
    console.log('✅ Administrador encontrado:', { name: admin.name, role: admin.role, active: admin.active });
    
    // Verificar que el administrador está activo
    if (admin.active !== "Y") {
      console.log('❌ Administrador inactivo:', adminLogin);
      return res.status(401).json({ message: "Administrador inactivo" });
    }
    
    console.log('🔐 Verificando contraseña del administrador...');
    // Verificar contraseña del administrador
    const isAdminPasswordValid = await bcrypt.compare(adminPassword, admin.pswd);
    if (!isAdminPasswordValid) {
      console.log('❌ Contraseña de administrador incorrecta');
      return res.status(401).json({ message: "Contraseña de administrador incorrecta" });
    }
    
    console.log('✅ Contraseña de administrador válida');
    
    // Verificar que el administrador tiene permisos (admin o soporte)
    if (!["admin", "soporte"].includes(admin.role)) {
      console.log('❌ Administrador sin permisos:', admin.role);
      return res.status(403).json({ message: "No tienes permisos para cambiar contraseñas" });
    }
    
    console.log('🔍 Buscando usuario a cambiar:', login);
    // Buscar el usuario a cambiar
    const usuario = await SecurUser.findOne({ login });
    if (!usuario) {
      console.log('❌ Usuario no encontrado:', login);
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    console.log('✅ Usuario encontrado:', { name: usuario.name, role: usuario.role });
    
    console.log('🔐 Encriptando nueva contraseña...');
    // Encriptar nueva contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(nuevaPassword, saltRounds);
    
    console.log('💾 Actualizando contraseña en la base de datos...');
    // Actualizar solo la contraseña y la fecha de actualización
    // NO tocar otros campos para evitar problemas de validación
    usuario.pswd = hashedPassword;
    usuario.pswdLastUpdated = new Date().toISOString();
    
    // Si el usuario no tiene role, asignar uno por defecto
    if (!usuario.role || usuario.role === '') {
      console.log('⚠️ Usuario sin role, asignando "usuario" por defecto');
      usuario.role = 'usuario';
    }
    
    await usuario.save();
    
    console.log('✅ Contraseña actualizada exitosamente');
    
    res.json({ 
      success: true, 
      message: `Contraseña actualizada para ${usuario.name}`,
      usuario: {
        login: usuario.login,
        name: usuario.name,
        email: usuario.email,
        role: usuario.role
      }
    });
    
  } catch (error) {
    console.error("❌ Error al cambiar contraseña:", error);
    console.error("📋 Stack trace:", error.stack);
    res.status(500).json({ 
      message: "Error en el servidor",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Login para usuarios secur con 2FA
router.post("/login", async (req, res) => {
  const { correo, password } = req.body;
  try {
    console.log('🔐 Intentando login para:', correo);
    
    // Buscar por login (cedula), email o cedula directamente (case-insensitive)
    const busqueda = correo?.trim();
    const usuario = await SecurUser.findOne({
      $or: [
        { login: { $regex: new RegExp(`^${busqueda}$`, 'i') } },
        { email: { $regex: new RegExp(`^${busqueda}$`, 'i') } },
        { cedula: { $regex: new RegExp(`^${busqueda}$`, 'i') } }
      ]
    });
    
    if (!usuario) {
      console.log('❌ Usuario no encontrado:', correo);
      console.log('🔍 Buscado por login (cedula), email o cedula:', busqueda);
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    console.log('✅ Usuario encontrado:', { 
      login: usuario.login, 
      email: usuario.email, 
      name: usuario.name,
      role: usuario.role 
    });
    
    // Verificar si el usuario está activo
    if (usuario.active !== "Y") {
      console.log('❌ Usuario inactivo:', correo);
      return res.status(401).json({ message: "Usuario inactivo" });
    }
    
    // Comparar contraseña usando bcrypt
    const isPasswordValid = await bcrypt.compare(password, usuario.pswd);
    if (!isPasswordValid) {
      console.log('❌ Contraseña incorrecta para:', correo);
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    
    console.log('✅ Credenciales válidas para:', correo);
    
    // ========== 2FA CON APP DE AUTENTICACIÓN (TOTP) ==========
    // Si el usuario activó la verificación en dos pasos con Google/Microsoft Authenticator,
    // no se entrega el JWT todavía: se devuelve un token temporal y se exige el código de 6 dígitos.
    if (usuario.totpEnabled && usuario.totpSecret) {
      console.log('🔐 Usuario con 2FA (TOTP) activado, solicitando código:', correo);
      
      const tempToken = jwt.sign(
        { id: usuario._id, purpose: "2fa" },
        JWT_SECRET,
        { expiresIn: "5m" }
      );
      
      return res.json({
        twoFARequired: true,
        method: "totp",
        tempToken,
        message: "Ingresa el código de tu app de autenticación"
      });
    }
    
    // ========== 2FA TEMPORALMENTE SUSPENDIDO ==========
    // TODO: Reactivar cuando se resuelva el problema del email
    /*
    // Generar código 2FA
    const twoFACode = Math.floor(100000 + Math.random() * 900000).toString();
    const twoFACodeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos
    
    // Guardar código en el usuario
    usuario.mfa = twoFACode;
    usuario.mfaLastUpdated = new Date().toISOString();
    await usuario.save();
    
    console.log('📧 Código 2FA generado:', twoFACode, 'para:', correo);
    
         // Enviar código por correo
     try {
       console.log('📧 Configurando nodemailer...');
       console.log('📧 EMAIL_USER:', process.env.EMAIL_USER);
       console.log('📧 EMAIL_PASS:', process.env.EMAIL_PASS ? '***' : 'NO DEFINIDO');
       
       const nodemailer = await import('nodemailer');
       
               // Configuración más robusta para Gmail
        const transporter = nodemailer.default.createTransporter({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          },
          debug: true, // Habilitar debug
          logger: true // Habilitar logs
        });
       
       console.log('📧 Transporter configurado, verificando conexión...');
       
       // Verificar conexión
       await transporter.verify();
       console.log('✅ Conexión SMTP verificada');
       
       const mailOptions = {
         from: `"Grupo Proser" <${process.env.EMAIL_USER}>`,
         to: usuario.email,
         subject: '🔐 Código de verificación 2FA - Grupo Proser',
         html: `
           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
             <h2 style="color: #2563eb;">🔐 Verificación de Seguridad</h2>
             <p>Hola <strong>${usuario.name}</strong>,</p>
             <p>Se ha solicitado un código de verificación para acceder a la aplicación de Grupo Proser.</p>
             <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
               <h3 style="color: #059669; font-size: 24px; margin: 0;">${twoFACode}</h3>
               <p style="color: #6b7280; font-size: 14px; margin: 10px 0 0 0;">Código de verificación</p>
             </div>
             <p><strong>⚠️ Importante:</strong></p>
             <ul>
               <li>Este código expira en 10 minutos</li>
               <li>No compartas este código con nadie</li>
               <li>Si no solicitaste este código, ignora este mensaje</li>
             </ul>
             <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
               Este es un mensaje automático, no respondas a este correo.
             </p>
           </div>
         `
       };
       
       console.log('📧 Enviando email a:', usuario.email);
       const info = await transporter.sendMail(mailOptions);
       console.log('✅ Email enviado exitosamente');
       console.log('📧 Message ID:', info.messageId);
       console.log('📧 Response:', info.response);
      
      // Devolver respuesta indicando que se requiere 2FA
      res.json({ 
        twoFARequired: true, 
        email: usuario.email,
        message: "Código de verificación enviado al correo corporativo"
      });
      
    } catch (emailError) {
      console.error('❌ Error enviando email:', emailError);
      // Si falla el email, aún así devolver que se requiere 2FA
      res.json({ 
        twoFARequired: true, 
        email: usuario.email,
        message: "Código de verificación enviado al correo corporativo"
      });
    }
    */
    // ========== FIN DE 2FA SUSPENDIDO ==========
    
    if (usuario.totpTempSecret && !usuario.totpEnabled) {
      console.log('ℹ️ Usuario con 2FA pendiente de confirmar (escaneó QR pero no activó):', correo);
    } else {
      console.log('ℹ️ Login directo - 2FA con app no activado para:', correo);
    }
    
    // Generar token JWT
    const token = jwt.sign(
      { id: usuario._id, login: usuario.login, role: usuario.role },
      JWT_SECRET,
      { expiresIn: "4h" }
    );
    
    // Registrar inicio de sesión
    try {
      const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      
      const nuevaSesion = new SesionUsuario({
        usuarioId: usuario._id,
        login: usuario.login,
        nombre: usuario.name,
        inicioSesion: new Date(),
        activa: true,
        ip: ip,
        userAgent: userAgent
      });
      
      await nuevaSesion.save();
      console.log(`✅ Sesión registrada para usuario: ${usuario.name} (${usuario.login})`);
    } catch (sessionError) {
      console.error('⚠️ Error al registrar sesión (no crítico):', sessionError);
      // No fallar el login si hay error al registrar la sesión
    }
    
    res.json({
      token,
      usuario: {
        id: usuario._id,
        login: usuario.login,
        name: usuario.name,
        email: usuario.email,
        role: usuario.role
      },
      twoFASetupRecommended: !usuario.totpEnabled,
      twoFASetupPending: Boolean(usuario.totpTempSecret && !usuario.totpEnabled),
      message: "Inicio de sesión exitoso"
    });
    
  } catch (error) {
    console.error("❌ Error en login secur:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// 🔄 Refresh Token - Renovar token antes de que expire (para usuarios SecurUser)
router.post("/refresh-token", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Token no proporcionado" });
    }
    
    const token = authHeader.split(" ")[1];
    
    try {
      // Decodificar el token (permitir tokens expirados para renovación)
      const decoded = jwt.decode(token, { complete: true });
      
      if (!decoded || !decoded.payload) {
        return res.status(401).json({ message: "Token inválido" });
      }
      
      // Verificar que el token tenga la estructura correcta
      const payload = decoded.payload;
      
      if (!payload.id) {
        return res.status(401).json({ message: "Token inválido: falta información del usuario" });
      }
      
      // Buscar el usuario en la base de datos
      const usuario = await SecurUser.findById(payload.id);
      
      if (!usuario) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }
      
      // Verificar que el usuario esté activo
      if (usuario.active !== "Y") {
        return res.status(401).json({ message: "Usuario inactivo" });
      }
      
      // Generar nuevo token con la misma información
      const newToken = jwt.sign(
        { id: usuario._id, login: usuario.login, role: usuario.role },
        JWT_SECRET,
        { expiresIn: "4h" }
      );
      
      console.log(`🔄 Token renovado para usuario secur: ${usuario.name} (${usuario.login})`);
      
      res.json({
        token: newToken,
        usuario: {
          id: usuario._id,
          login: usuario.login,
          name: usuario.name,
          email: usuario.email,
          role: usuario.role
        }
      });
    } catch (error) {
      // Si el token está completamente inválido, no podemos renovarlo
      return res.status(401).json({ message: "Token inválido o no puede ser renovado" });
    }
  } catch (error) {
    console.error("Error en refresh token secur:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Verificar código 2FA y completar login
router.post("/login/2fa", async (req, res) => {
  const { correo, code, tempToken } = req.body;
  try {
    console.log('🔐 Verificando código 2FA para:', correo);
    
    // ===== FLUJO TOTP (app de autenticación: Google/Microsoft Authenticator) =====
    if (tempToken) {
      let decoded;
      try {
        decoded = jwt.verify(tempToken, JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ message: "Sesión de verificación expirada. Inicia sesión de nuevo." });
      }
      
      if (decoded.purpose !== "2fa") {
        return res.status(401).json({ message: "Token de verificación inválido" });
      }
      
      const usuario = await SecurUser.findById(decoded.id);
      if (!usuario || usuario.active !== "Y") {
        return res.status(404).json({ message: "Usuario no encontrado o inactivo" });
      }
      
      if (!usuario.totpEnabled || !usuario.totpSecret) {
        return res.status(400).json({ message: "La verificación en dos pasos no está activada" });
      }
      
      const { valid: codigoValido } = verifySync({
        token: String(code || '').replace(/\s/g, ''),
        secret: usuario.totpSecret,
        epochTolerance: TOTP_EPOCH_TOLERANCE,
      });
      
      if (!codigoValido) {
        console.log('❌ Código TOTP incorrecto para:', usuario.login);
        return res.status(401).json({ message: "Código incorrecto. Verifica tu app de autenticación." });
      }
      
      console.log('✅ Código TOTP válido para:', usuario.login);
      
      // Generar token JWT definitivo
      const token = jwt.sign(
        { id: usuario._id, login: usuario.login, role: usuario.role },
        JWT_SECRET,
        { expiresIn: "4h" }
      );
      
      // Registrar inicio de sesión
      try {
        const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        
        const nuevaSesion = new SesionUsuario({
          usuarioId: usuario._id,
          login: usuario.login,
          nombre: usuario.name,
          inicioSesion: new Date(),
          activa: true,
          ip: ip,
          userAgent: userAgent
        });
        
        await nuevaSesion.save();
        console.log(`✅ Sesión registrada para usuario: ${usuario.name} (${usuario.login})`);
      } catch (sessionError) {
        console.error('⚠️ Error al registrar sesión (no crítico):', sessionError);
      }
      
      return res.json({
        token,
        usuario: {
          id: usuario._id,
          login: usuario.login,
          name: usuario.name,
          email: usuario.email,
          role: usuario.role
        },
        message: "Login exitoso"
      });
    }
    
    // ===== FLUJO LEGADO: código enviado por correo =====
    // Buscar usuario
    const usuario = await SecurUser.findOne({ login: correo });
    if (!usuario) {
      console.log('❌ Usuario no encontrado para verificación 2FA:', correo);
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    // Verificar si hay código MFA
    if (!usuario.mfa) {
      console.log('❌ No hay código MFA para:', correo);
      return res.status(400).json({ message: "Código no solicitado o expirado" });
    }
    
    // Verificar si el código coincide
    if (usuario.mfa !== code) {
      console.log('❌ Código incorrecto para:', correo, 'Esperado:', usuario.mfa, 'Recibido:', code);
      return res.status(401).json({ message: "Código incorrecto" });
    }
    
    // Verificar si el código no ha expirado (10 minutos)
    const mfaTime = new Date(usuario.mfaLastUpdated);
    const now = new Date();
    const diffMinutes = (now - mfaTime) / (1000 * 60);
    
    if (diffMinutes > 10) {
      console.log('❌ Código expirado para:', correo, 'Minutos transcurridos:', diffMinutes);
      // Limpiar código expirado
      usuario.mfa = null;
      usuario.mfaLastUpdated = null;
      await usuario.save();
      return res.status(401).json({ message: "Código expirado" });
    }
    
    console.log('✅ Código 2FA válido para:', correo);
    
    // Limpiar código después de usarlo
    usuario.mfa = null;
    usuario.mfaLastUpdated = null;
    await usuario.save();
    
    // Generar token JWT
    const token = jwt.sign(
      { id: usuario._id, login: usuario.login, role: usuario.role },
      JWT_SECRET,
      { expiresIn: "4h" }
    );
    
    console.log('✅ Login 2FA exitoso para:', correo);
    
    res.json({ 
      token, 
      usuario: {
        id: usuario._id,
        login: usuario.login,
        name: usuario.name,
        email: usuario.email,
        role: usuario.role
      },
      message: "Login exitoso"
    });
    
  } catch (error) {
    console.error("❌ Error en verificación 2FA:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// =====================================================
// ENDPOINTS DE 2FA CON APP DE AUTENTICACIÓN (TOTP)
// Google Authenticator / Microsoft Authenticator
// =====================================================

// Tolerancia de ±30 segundos por desfase de reloj del celular (epochTolerance en segundos)
const TOTP_EPOCH_TOLERANCE = 30;
const TOTP_ISSUER = "ARNALD DATA FLOW";

// En la app de autenticación se muestra: "ARNALD DATA FLOW: {ID}"
const obtenerEtiquetaTotp = (usuario) =>
  usuario.cedula || usuario.login;

const generarDatosTotp = async (usuario, secret) => {
  const label = obtenerEtiquetaTotp(usuario);
  const otpauthUrl = generateURI({
    issuer: TOTP_ISSUER,
    label,
    secret,
  });
  const qr = await QRCode.toDataURL(otpauthUrl, { width: 280, margin: 2 });
  return { qr, secret, label, issuer: TOTP_ISSUER };
};

// Helper: obtener el usuario autenticado desde el token Bearer
const obtenerUsuarioDesdeToken = async (req) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return { error: { status: 401, message: "Token requerido" } };
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // No aceptar tokens temporales de 2FA para gestionar la configuración
    if (decoded.purpose === "2fa") {
      return { error: { status: 401, message: "Token inválido" } };
    }
    const usuario = await SecurUser.findById(decoded.id);
    if (!usuario) return { error: { status: 404, message: "Usuario no encontrado" } };
    return { usuario };
  } catch (err) {
    return { error: { status: 401, message: "Token inválido o expirado" } };
  }
};

// Estado actual del 2FA del usuario autenticado
router.get("/2fa/status", async (req, res) => {
  const { usuario, error } = await obtenerUsuarioDesdeToken(req);
  if (error) return res.status(error.status).json({ message: error.message });
  
  res.json({
    enabled: Boolean(usuario.totpEnabled && usuario.totpSecret),
    pending: Boolean(usuario.totpTempSecret && !usuario.totpEnabled),
    accountId: obtenerEtiquetaTotp(usuario),
    issuer: TOTP_ISSUER,
  });
});

// Paso 1 de activación: generar secreto y QR para escanear con la app
router.post("/2fa/setup", async (req, res) => {
  const { usuario, error } = await obtenerUsuarioDesdeToken(req);
  if (error) return res.status(error.status).json({ message: error.message });
  
  try {
    if (usuario.totpEnabled && usuario.totpSecret) {
      return res.status(400).json({ message: "La verificación en dos pasos ya está activada" });
    }
    
    const reutilizarPendiente = Boolean(usuario.totpTempSecret);
    const secret = usuario.totpTempSecret || generateSecret();
    if (!reutilizarPendiente) {
      usuario.totpTempSecret = secret;
      await usuario.save();
    }

    const datosTotp = await generarDatosTotp(usuario, secret);

    console.log(
      reutilizarPendiente
        ? `🔐 QR TOTP reutilizado (activación pendiente) para: ${usuario.login}`
        : `🔐 Secreto TOTP generado para: ${usuario.login}`
    );

    res.json({
      ...datosTotp,
      pending: true,
      message: "Escanea el código QR con Google Authenticator o Microsoft Authenticator. Luego confirma con el código de 6 dígitos."
    });
  } catch (err) {
    console.error("❌ Error generando configuración 2FA:", err);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Paso 2 de activación: confirmar con el primer código de la app
router.post("/2fa/activate", async (req, res) => {
  const { usuario, error } = await obtenerUsuarioDesdeToken(req);
  if (error) return res.status(error.status).json({ message: error.message });
  
  try {
    const { code } = req.body;
    
    if (!usuario.totpTempSecret) {
      return res.status(400).json({ message: "Primero debes generar el código QR" });
    }
    
    const { valid: codigoValido } = verifySync({
      token: String(code || '').replace(/\s/g, ''),
      secret: usuario.totpTempSecret,
      epochTolerance: TOTP_EPOCH_TOLERANCE,
    });
    
    if (!codigoValido) {
      return res.status(401).json({ message: "Código incorrecto. Verifica tu app de autenticación e intenta de nuevo." });
    }
    
    usuario.totpSecret = usuario.totpTempSecret;
    usuario.totpTempSecret = null;
    usuario.totpEnabled = true;
    usuario.mfaLastUpdated = new Date().toISOString();
    await usuario.save();
    
    console.log('✅ 2FA (TOTP) activado para:', usuario.login);
    
    res.json({ enabled: true, message: "Verificación en dos pasos activada correctamente" });
  } catch (err) {
    console.error("❌ Error activando 2FA:", err);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Desactivar 2FA (requiere un código válido de la app)
router.post("/2fa/disable", async (req, res) => {
  const { usuario, error } = await obtenerUsuarioDesdeToken(req);
  if (error) return res.status(error.status).json({ message: error.message });
  
  try {
    const { code } = req.body;
    
    if (!usuario.totpEnabled || !usuario.totpSecret) {
      return res.status(400).json({ message: "La verificación en dos pasos no está activada" });
    }
    
    const { valid: codigoValido } = verifySync({
      token: String(code || '').replace(/\s/g, ''),
      secret: usuario.totpSecret,
      epochTolerance: TOTP_EPOCH_TOLERANCE,
    });
    
    if (!codigoValido) {
      return res.status(401).json({ message: "Código incorrecto. No se desactivó la verificación en dos pasos." });
    }
    
    usuario.totpSecret = null;
    usuario.totpTempSecret = null;
    usuario.totpEnabled = false;
    usuario.mfaLastUpdated = new Date().toISOString();
    await usuario.save();
    
    console.log('⚠️ 2FA (TOTP) desactivado para:', usuario.login);
    
    res.json({ enabled: false, message: "Verificación en dos pasos desactivada" });
  } catch (err) {
    console.error("❌ Error desactivando 2FA:", err);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// =====================================================
// ENDPOINTS DE RECUPERACIÓN DE CONTRASEÑA
// =====================================================

console.log('📝 Registrando endpoint POST /forgot-password');

// Solicitar recuperación de contraseña (enviar correo con token)
router.post("/forgot-password", async (req, res) => {
  const { correo } = req.body;
  
  try {
    console.log('🔑 Solicitud de recuperación de contraseña para:', correo);
    console.log('🔍 Estado del entorno:', {
      NODE_ENV: process.env.NODE_ENV || 'undefined (default: development)',
      EMAIL_USER: process.env.EMAIL_USER ? 'Configurado' : 'NO CONFIGURADO',
      EMAIL_PASS: process.env.EMAIL_PASS ? (process.env.EMAIL_PASS === 'tu_password_aqui' ? 'PLACEHOLDER' : 'Configurado') : 'NO CONFIGURADO',
      EMAIL_SERVICE: process.env.EMAIL_SERVICE || 'No configurado'
    });
    
    if (!correo) {
      return res.status(400).json({ message: "Correo electrónico es requerido" });
    }
    
    // Buscar usuario por email, login o cédula
    let usuario;
    try {
      const busqueda = correo?.trim();
      console.log('🔍 Buscando usuario con:', busqueda);
      
      usuario = await SecurUser.findOne({
        $or: [
          { email: { $regex: new RegExp(`^${busqueda}$`, 'i') } },
          { login: { $regex: new RegExp(`^${busqueda}$`, 'i') } },
          { cedula: { $regex: new RegExp(`^${busqueda}$`, 'i') } }
        ]
      });
      
      console.log('🔍 Resultado de búsqueda:', usuario ? `Usuario encontrado: ${usuario.email || usuario.login}` : 'Usuario no encontrado');
    } catch (dbError) {
      console.error('❌ Error buscando usuario en la base de datos:', dbError);
      throw new Error('Error al buscar el usuario. Intenta nuevamente.');
    }
    
    // Por seguridad, siempre devolvemos el mismo mensaje aunque el usuario no exista
    if (!usuario) {
      console.log('⚠️ Usuario no encontrado para recuperación:', correo);
      // Devolvemos mensaje genérico por seguridad
      return res.json({ 
        message: "Si el correo está registrado, recibirás un enlace de recuperación."
      });
    }
    
    // Verificar que el usuario esté activo
    if (usuario.active !== "Y") {
      console.log('⚠️ Usuario inactivo intentó recuperar contraseña:', correo);
      return res.json({ 
        message: "Si el correo está registrado, recibirás un enlace de recuperación."
      });
    }
    
    // Generar token aleatorio
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Hashear el token antes de guardarlo en la BD
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    
    // Guardar token y fecha de expiración (30 minutos)
    try {
      usuario.resetPasswordToken = hashedToken;
      usuario.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos
      await usuario.save();
      console.log('✅ Token de recuperación generado y guardado para:', usuario.email);
    } catch (saveError) {
      console.error('❌ Error guardando token de recuperación:', saveError);
      console.error('❌ Detalles del error:', {
        message: saveError.message,
        name: saveError.name,
        errors: saveError.errors
      });
      throw new Error('Error al guardar el token de recuperación. Intenta nuevamente.');
    }
    
    // Enlace al formulario del frontend (no al API)
    const requestHost = req.get('host') || req.headers.host || req.headers['x-forwarded-host'];
    const frontendUrl = resolveFrontendUrl({ requestHost });
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
    
    console.log('🔗 URL de reset generada:', resetUrl);
    console.log('🔍 Variables de entorno:', {
      FRONTEND_URL: process.env.FRONTEND_URL ? 'Configurado' : 'No configurado',
      FRONTEND_PORT: process.env.FRONTEND_PORT || 'No configurado',
      NODE_ENV: process.env.NODE_ENV || 'development',
      host: req.get('host') || req.headers.host
    });
    
    // Verificar si el email está configurado correctamente
    // Detectar entorno: si NODE_ENV no está definido, asumimos desarrollo
    // Limpiar espacios en blanco que pueden venir de variables de entorno
    const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
    const isDevelopment = nodeEnv !== 'production';
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;
    
    console.log('🔍 Verificando configuración de email:', {
      nodeEnv: nodeEnv,
      isDevelopment: isDevelopment,
      emailUser: emailUser ? 'Configurado' : 'NO CONFIGURADO',
      emailPass: emailPass ? (emailPass === 'tu_password_aqui' ? 'PLACEHOLDER' : 'Configurado') : 'NO CONFIGURADO'
    });
    
    // Verificar si el email está configurado correctamente
    const isEmailConfigured = emailUser && 
                              emailPass && 
                              emailPass !== 'tu_password_aqui' && 
                              emailPass !== 'tu-contraseña-de-aplicacion' &&
                              typeof emailPass === 'string' &&
                              emailPass.trim().length > 0;
    
    console.log('✅ isEmailConfigured:', isEmailConfigured);
    
    // En producción, si falta configuración SMTP devolvemos mensaje genérico
    if (!isDevelopment && !isEmailConfigured) {
      console.error('❌ Variables de entorno de email no configuradas en PRODUCCIÓN');
      return res.json({
        message: "Si el correo está registrado, recibirás un enlace de recuperación.",
        success: true,
        environment: 'production',
        emailSent: false
      });
    }
    
    // En desarrollo, si no hay email configurado, no exponer token al cliente
    if (isDevelopment && !isEmailConfigured) {
      console.warn('⚠️ Email no configurado en DESARROLLO. No se enviará correo y no se expondrá token al cliente.');
      
      return res.json({ 
        message: "Si el correo está registrado, recibirás un enlace de recuperación.",
        success: true,
        environment: 'development',
        emailSent: false
      });
    }
    
    console.log('📧 Procediendo a configurar y enviar email...');
    
    // Configurar transporter de nodemailer
    let transporter;
    try {
      transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },
        debug: true,
        logger: true,
        tls: {
          rejectUnauthorized: false
        },
        secure: false
      });
      console.log('✅ Transporter de nodemailer creado');
    } catch (transporterError) {
      console.error('❌ Error creando transporter de nodemailer:', transporterError);
      throw new Error('Error al configurar el servicio de correo electrónico');
    }
    
    // Verificar conexión SMTP
    try {
      await transporter.verify();
      console.log('✅ Conexión SMTP verificada');
    } catch (smtpError) {
      console.error('❌ Error verificando SMTP:', smtpError);
      console.error('❌ Detalles del error SMTP:', {
        message: smtpError.message,
        code: smtpError.code,
        command: smtpError.command,
        response: smtpError.response
      });
      
      // Si falla la autenticación SMTP, no exponer token ni URL al cliente
      console.warn(`⚠️ Error de autenticación SMTP en ${isDevelopment ? 'DESARROLLO' : 'PRODUCCIÓN'}. No se expondrá token al cliente.`);
      
      // Preparar respuesta según el entorno
      const responseData = {
        message: "Si el correo está registrado, recibirás un enlace de recuperación.",
        success: true,
        environment: isDevelopment ? 'development' : 'production', // Informar al frontend del entorno real
        emailError: true // Indicar que hubo un error de email
      };
      
      responseData.emailSent = false;
      
      return res.json(responseData);
    }
    
    // Contenido del correo
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: usuario.email,
      subject: '🔑 Recuperación de Contraseña - Arnald DataFlow',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2563eb; margin: 0; font-size: 24px;">🔑 Recuperación de Contraseña</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">El corazón digital de Grupo Proser</p>
            </div>
            
            <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <p style="color: #1f2937; margin: 0 0 15px 0;">Hola <strong>${usuario.name}</strong>,</p>
              <p style="color: #1f2937; margin: 0 0 15px 0;">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta en Arnald DataFlow.
              </p>
              <p style="color: #1f2937; margin: 0;">
                Si no realizaste esta solicitud, puedes ignorar este correo de manera segura.
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="display: inline-block; padding: 15px 30px; background: linear-gradient(135deg, #667EEA 0%, #764BA2 100%); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                Restablecer Contraseña
              </a>
            </div>
            
            <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">⚠️ Información Importante</h3>
              <ul style="color: #78350f; margin: 0; padding-left: 20px; line-height: 1.5;">
                <li>Este enlace es válido por <strong>30 minutos</strong></li>
                <li>Solo puedes usar este enlace <strong>una vez</strong></li>
                <li>Después de cambiar la contraseña, el enlace dejará de funcionar</li>
                <li>Si no solicitaste este cambio, ignora este correo</li>
              </ul>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 10px 0; font-size: 14px;">🔗 ¿El botón no funciona?</h3>
              <p style="color: #0c4a6e; margin: 0; font-size: 12px; word-break: break-all;">
                Copia y pega este enlace en tu navegador:<br>
                <span style="color: #2563eb;">${resetUrl}</span>
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Este es un mensaje automático del Sistema Arnald DataFlow de Grupo Proser.<br>
                No responda a este correo. Para consultas, contacte al administrador del sistema.
              </p>
            </div>
          </div>
        </div>
      `
    };
    
    // Enviar correo
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Correo de recuperación enviado:', info.messageId);
      console.log('📧 Accepted:', info.accepted);
      console.log('📧 Response:', info.response);
    } catch (emailError) {
      console.error('❌ Error enviando correo:', emailError);
      console.error('❌ Detalles del error de envío:', {
        message: emailError.message,
        code: emailError.code,
        command: emailError.command,
        response: emailError.response,
        responseCode: emailError.responseCode
      });
      
      // Si falla el envío, no exponer token ni URL al cliente
      console.warn(`⚠️ Error enviando correo en ${isDevelopment ? 'DESARROLLO' : 'PRODUCCIÓN'}. No se expondrá token al cliente.`);
      
      // Preparar respuesta según el entorno
      const responseData = {
        message: "Si el correo está registrado, recibirás un enlace de recuperación.",
        success: true,
        environment: isDevelopment ? 'development' : 'production', // Informar al frontend del entorno real
        emailError: true // Indicar que hubo un error de email
      };
      
      responseData.emailSent = false;
      
      return res.json(responseData);
    }
    
    // Respuesta cuando el correo se envía exitosamente
    res.json({ 
      message: "Si el correo está registrado, recibirás un enlace de recuperación.",
      success: true,
      environment: isDevelopment ? 'development' : 'production', // Informar al frontend del entorno real
      emailSent: true // Indicar que el correo se envió exitosamente
    });
    
  } catch (error) {
    console.error('❌ Error en recuperación de contraseña:', error);
    console.error('❌ Stack trace:', error.stack);
    console.error('❌ Error completo:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    console.error('❌ Tipo de error:', error.name);
    console.error('❌ Mensaje de error:', error.message);
    
    res.status(500).json({ 
      message: "Error al procesar la solicitud. Intenta nuevamente."
    });
  }
});

console.log('📝 Registrando endpoint POST /reset-password');

// Restablecer contraseña con token
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  
  try {
    console.log('🔑 Intento de restablecer contraseña con token');
    
    if (!token || !newPassword) {
      return res.status(400).json({ message: "Token y nueva contraseña son requeridos" });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
    }
    
    // Hashear el token recibido para comparar con el guardado
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    // Buscar usuario con el token válido y no expirado
    const usuario = await SecurUser.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() } // Token no expirado
    });
    
    if (!usuario) {
      console.log('❌ Token inválido, expirado o ya usado');
      return res.status(400).json({ 
        message: "El enlace de recuperación es inválido, ha expirado o ya fue utilizado. Por seguridad, cada enlace solo funciona una vez y expira en 30 minutos. Solicita un nuevo enlace si aún necesitas cambiar tu contraseña."
      });
    }
    
    console.log('✅ Token válido para usuario:', usuario.email);
    
    // Hashear la nueva contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Actualizar contraseña y limpiar token
    usuario.pswd = hashedPassword;
    usuario.resetPasswordToken = undefined;
    usuario.resetPasswordExpires = undefined;
    usuario.pswdLastUpdated = new Date().toISOString();
    await usuario.save();
    
    console.log('✅ Contraseña actualizada exitosamente para:', usuario.email);
    
    // Enviar correo de confirmación
    try {
      const transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      
      await transporter.sendMail({
        from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
        to: usuario.email,
        subject: '✅ Contraseña Actualizada - Arnald DataFlow',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
            <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #059669; margin: 0; font-size: 24px;">✅ Contraseña Actualizada</h1>
                <p style="color: #6b7280; margin: 10px 0 0 0;">El corazón digital de Grupo Proser</p>
              </div>
              
              <div style="background-color: #d1fae5; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
                <p style="color: #1f2937; margin: 0 0 15px 0;">Hola <strong>${usuario.name}</strong>,</p>
                <p style="color: #1f2937; margin: 0;">
                  Tu contraseña ha sido actualizada exitosamente. Ya puedes iniciar sesión con tu nueva contraseña.
                </p>
              </div>
              
              <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
                <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">⚠️ ¿No fuiste tú?</h3>
                <p style="color: #78350f; margin: 0; line-height: 1.5;">
                  Si no realizaste este cambio, contacta inmediatamente al administrador del sistema.
                </p>
              </div>
              
              <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  Este es un mensaje automático del Sistema Arnald DataFlow de Grupo Proser.
                </p>
              </div>
            </div>
          </div>
        `
      });
      
      console.log('✅ Correo de confirmación enviado');
    } catch (emailError) {
      console.error('⚠️ Error enviando correo de confirmación:', emailError);
      // No fallar si el correo de confirmación falla
    }
    
    res.json({ 
      message: "Contraseña actualizada exitosamente. Ya puedes iniciar sesión.",
      success: true
    });
    
  } catch (error) {
    console.error('❌ Error al restablecer contraseña:', error);
    res.status(500).json({ 
      message: "Error al restablecer la contraseña. Intenta nuevamente.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Cambiar contraseña propia (usuario cambia su propia contraseña)
router.post("/cambiar-password-propia", async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    if (!token) {
      return res.status(401).json({ message: "Token requerido" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const usuario = await SecurUser.findById(decoded.id);
    
    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    // Verificar contraseña antigua usando bcrypt
    const isOldPasswordValid = await bcrypt.compare(oldPassword, usuario.pswd);
    if (!isOldPasswordValid) {
      return res.status(401).json({ message: "Contraseña actual incorrecta" });
    }
    
    // Actualizar contraseña con hash
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    usuario.pswd = hashedNewPassword;
    usuario.pswdLastUpdated = new Date().toISOString();
    await usuario.save();
    
    res.json({ 
      success: true,
      message: "Contraseña cambiada correctamente", 
      user: { login: usuario.login } 
    });
    
  } catch (error) {
    console.error("Error cambiando contraseña:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Actualizar perfil de un usuario específico por ID (para administradores)
router.put("/usuarios/:id/perfil", async (req, res) => {
  const { 
    name, email, phone, role, passwordConfirm,
    cedula, fechaNacimiento, tipoSangre, direccion,
    telefonoFijo, celulares, correosElectronicos,
    empresa, fechaIngreso, cargos, salario,
    fechaModificacionSueldo, tipoContrato,
    fechaModificacionContrato, vencimiento,
    aportesSalud, aportesPension, aportesCesantias,
    aportesARL, aportesCCF, evaluacionPeriodoPrueba, sucursal
  } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  const { id } = req.params;
  
  try {
    if (!token) {
      return res.status(401).json({ message: "Token requerido" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar que el usuario tenga permisos (admin o soporte)
    const usuarioActual = await SecurUser.findById(decoded.id);
    if (!usuarioActual || !['admin', 'soporte'].includes(usuarioActual.role)) {
      return res.status(403).json({ message: "No tienes permisos para acceder a este recurso" });
    }
    
    // Verificar contraseña del administrador si se proporciona
    if (passwordConfirm) {
      const isMatch = await bcrypt.compare(passwordConfirm, usuarioActual.pswd);
      if (!isMatch) {
        return res.status(401).json({ message: "Contraseña incorrecta. No se guardaron los cambios." });
      }
    }
    
    const usuario = await SecurUser.findById(id);
    
    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    // Actualizar campos
    if (name !== undefined) usuario.name = name;
    if (email !== undefined) usuario.email = email;
    if (phone !== undefined) usuario.phone = phone;
    if (role !== undefined && ['admin', 'soporte'].includes(usuarioActual.role)) usuario.role = role;
    if (cedula !== undefined) usuario.cedula = cedula;
    if (fechaNacimiento !== undefined) usuario.fechaNacimiento = fechaNacimiento ? new Date(fechaNacimiento) : null;
    if (tipoSangre !== undefined) usuario.tipoSangre = tipoSangre;
    if (direccion !== undefined) usuario.direccion = direccion;
    if (telefonoFijo !== undefined) usuario.telefonoFijo = telefonoFijo;
    if (celulares !== undefined) usuario.celulares = celulares;
    if (correosElectronicos !== undefined) usuario.correosElectronicos = correosElectronicos;
    if (empresa !== undefined) usuario.empresa = empresa;
    if (fechaIngreso !== undefined) usuario.fechaIngreso = fechaIngreso ? new Date(fechaIngreso) : null;
    if (cargos !== undefined) usuario.cargos = cargos;
    if (salario !== undefined) usuario.salario = salario;
    if (fechaModificacionSueldo !== undefined) usuario.fechaModificacionSueldo = fechaModificacionSueldo ? new Date(fechaModificacionSueldo) : null;
    if (tipoContrato !== undefined) usuario.tipoContrato = tipoContrato;
    if (fechaModificacionContrato !== undefined) usuario.fechaModificacionContrato = fechaModificacionContrato ? new Date(fechaModificacionContrato) : null;
    if (vencimiento !== undefined) usuario.vencimiento = vencimiento ? new Date(vencimiento) : null;
    if (aportesSalud !== undefined) usuario.aportesSalud = aportesSalud;
    if (aportesPension !== undefined) usuario.aportesPension = aportesPension;
    if (aportesCesantias !== undefined) usuario.aportesCesantias = aportesCesantias;
    if (aportesARL !== undefined) usuario.aportesARL = aportesARL;
    if (aportesCCF !== undefined) usuario.aportesCCF = aportesCCF;
    if (evaluacionPeriodoPrueba !== undefined) usuario.evaluacionPeriodoPrueba = evaluacionPeriodoPrueba;
    if (sucursal !== undefined) usuario.sucursal = sucursal;
    
    await usuario.save();
    
    const userResponse = {
      id: usuario._id,
      login: usuario.login,
      name: usuario.name,
      email: usuario.email,
      role: usuario.role,
      phone: usuario.phone,
      active: usuario.active,
      privAdmin: usuario.privAdmin,
      pswdLastUpdated: usuario.pswdLastUpdated,
      createdAt: usuario.createdAt,
      updatedAt: usuario.updatedAt,
      foto: usuario.foto,
      cedula: usuario.cedula ?? null,
      fechaNacimiento: usuario.fechaNacimiento ?? null,
      tipoSangre: usuario.tipoSangre ?? null,
      direccion: usuario.direccion ?? null,
      telefonoFijo: usuario.telefonoFijo ?? null,
      celulares: usuario.celulares ?? null,
      correosElectronicos: usuario.correosElectronicos ?? null,
      empresa: usuario.empresa ?? null,
      fechaIngreso: usuario.fechaIngreso ?? null,
      cargos: usuario.cargos ?? null,
      salario: usuario.salario ?? null,
      fechaModificacionSueldo: usuario.fechaModificacionSueldo ?? null,
      tipoContrato: usuario.tipoContrato ?? null,
      fechaModificacionContrato: usuario.fechaModificacionContrato ?? null,
      vencimiento: usuario.vencimiento ?? null,
      aportesSalud: usuario.aportesSalud ?? null,
      aportesPension: usuario.aportesPension ?? null,
      aportesCesantias: usuario.aportesCesantias ?? null,
      aportesARL: usuario.aportesARL ?? null,
      aportesCCF: usuario.aportesCCF ?? null,
      evaluacionPeriodoPrueba: usuario.evaluacionPeriodoPrueba ?? null,
      sucursal: usuario.sucursal ?? null
    };
    
    res.json({ message: "Perfil actualizado exitosamente", usuario: userResponse });
  } catch (error) {
    console.error('Error actualizando perfil de usuario:', error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Obtener perfil de usuario
router.get("/perfil", async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    console.log('👤 === OBTENIENDO PERFIL DE USUARIO ===');
    console.log('🔐 Token recibido:', token ? 'SÍ' : 'NO');
    
    if (!token) {
      return res.status(401).json({ message: "Token requerido" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('🔓 Token decodificado:', { id: decoded.id, login: decoded.login });
    
    // Usar lean() para obtener un objeto plano con todos los campos
    const usuario = await SecurUser.findById(decoded.id).lean();
    
    if (!usuario) {
      console.log('❌ Usuario no encontrado en BD');
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    console.log('✅ Usuario encontrado en BD:', {
      id: usuario._id,
      login: usuario.login,
      name: usuario.name,
      email: usuario.email,
      role: usuario.role,
      phone: usuario.phone,
      active: usuario.active,
      privAdmin: usuario.privAdmin,
      pswdLastUpdated: usuario.pswdLastUpdated,
      createdAt: usuario.createdAt,
      updatedAt: usuario.updatedAt,
      foto: usuario.foto,
      fotoTipo: typeof usuario.foto,
      fotoExiste: !!usuario.foto,
      // Nuevos campos
      empresa: usuario.empresa,
      cedula: usuario.cedula,
      tipoSangre: usuario.tipoSangre,
      direccion: usuario.direccion,
      telefonoFijo: usuario.telefonoFijo,
      celulares: usuario.celulares,
      correosElectronicos: usuario.correosElectronicos,
      fechaIngreso: usuario.fechaIngreso,
      cargos: usuario.cargos,
      salario: usuario.salario,
      tipoContrato: usuario.tipoContrato,
      aportesSalud: usuario.aportesSalud,
      aportesPension: usuario.aportesPension
    });
    
    // Construir respuesta explícitamente - usar ?? para preservar strings vacíos
    const perfilResponse = {
      id: usuario._id,
      login: usuario.login,
      name: usuario.name,
      email: usuario.email,
      role: usuario.role,
      phone: usuario.phone,
      active: usuario.active,
      privAdmin: usuario.privAdmin,
      pswdLastUpdated: usuario.pswdLastUpdated,
      createdAt: usuario.createdAt,
      updatedAt: usuario.updatedAt,
      foto: usuario.foto,
      // Nuevos campos del perfil - usar ?? para preservar strings vacíos, solo convertir undefined a null
      cedula: usuario.cedula ?? null,
      fechaNacimiento: usuario.fechaNacimiento ?? null,
      tipoSangre: usuario.tipoSangre ?? null,
      direccion: usuario.direccion ?? null,
      telefonoFijo: usuario.telefonoFijo ?? null,
      celulares: usuario.celulares ?? null,
      correosElectronicos: usuario.correosElectronicos ?? null,
      empresa: usuario.empresa ?? null,
      fechaIngreso: usuario.fechaIngreso ?? null,
      cargos: usuario.cargos ?? null,
      salario: usuario.salario ?? null,
      fechaModificacionSueldo: usuario.fechaModificacionSueldo ?? null,
      tipoContrato: usuario.tipoContrato ?? null,
      fechaModificacionContrato: usuario.fechaModificacionContrato ?? null,
      vencimiento: usuario.vencimiento ?? null,
      aportesSalud: usuario.aportesSalud ?? null,
      aportesPension: usuario.aportesPension ?? null,
      aportesCesantias: usuario.aportesCesantias ?? null,
      aportesARL: usuario.aportesARL ?? null,
      aportesCCF: usuario.aportesCCF ?? null,
      evaluacionPeriodoPrueba: usuario.evaluacionPeriodoPrueba ?? null,
      sucursal: usuario.sucursal ?? null
    };
    
    console.log('📤 Enviando respuesta del perfil:', JSON.stringify(perfilResponse, null, 2));
    console.log('📋 Campos nuevos en respuesta:', {
      empresa: perfilResponse.empresa,
      cedula: perfilResponse.cedula,
      tipoSangre: perfilResponse.tipoSangre,
      direccion: perfilResponse.direccion,
      telefonoFijo: perfilResponse.telefonoFijo,
      celulares: perfilResponse.celulares,
      correosElectronicos: perfilResponse.correosElectronicos,
      fechaIngreso: perfilResponse.fechaIngreso,
      cargos: perfilResponse.cargos,
      salario: perfilResponse.salario,
      tipoContrato: perfilResponse.tipoContrato,
      aportesSalud: perfilResponse.aportesSalud,
      aportesPension: perfilResponse.aportesPension
    });
    console.log('👤 === FIN OBTENCIÓN DE PERFIL ===');
    
    res.json(perfilResponse);
    
  } catch (error) {
    console.error("❌ Error obteniendo perfil:", error);
    console.error("📋 Stack trace:", error.stack);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Actualizar perfil (datos básicos)
router.put("/perfil", async (req, res) => {
  const { 
    name, email, phone, role, passwordConfirm,
    cedula, fechaNacimiento, tipoSangre, direccion,
    telefonoFijo, celulares, correosElectronicos,
    empresa, fechaIngreso, cargos, salario,
    fechaModificacionSueldo, tipoContrato,
    fechaModificacionContrato, vencimiento,
    aportesSalud, aportesPension, aportesCesantias,
    aportesARL, aportesCCF, evaluacionPeriodoPrueba, sucursal
  } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    console.log('📝 === ACTUALIZANDO PERFIL ===');
    console.log('📋 Datos recibidos:', req.body);
    console.log('🔐 Token recibido:', token ? 'SÍ' : 'NO');
    
    if (!token) {
      return res.status(401).json({ message: "Token requerido" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('🔓 Token decodificado:', { id: decoded.id, login: decoded.login });
    
    const usuario = await SecurUser.findById(decoded.id);
    
    if (!usuario) {
      console.log('❌ Usuario no encontrado');
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    console.log('✅ Usuario encontrado:', usuario.name);
    
    // Verificar contraseña si se proporciona
    if (passwordConfirm) {
      console.log('🔐 Verificando contraseña...');
      const isMatch = await bcrypt.compare(passwordConfirm, usuario.pswd);
      if (!isMatch) {
        console.log('❌ Contraseña incorrecta');
        return res.status(401).json({ message: "Contraseña incorrecta. No se guardaron los cambios." });
      }
      console.log('✅ Contraseña correcta');
    }
    
    // Actualizar campos básicos
    if (name !== undefined) {
      console.log('📝 Actualizando name:', name);
      usuario.name = name;
    }
    if (email !== undefined) {
      console.log('📝 Actualizando email:', email);
      usuario.email = email;
    }
    if (phone !== undefined) {
      console.log('📝 Actualizando phone:', phone);
      usuario.phone = phone;
    }
    if (role !== undefined) {
      console.log('📝 Actualizando role:', role);
      usuario.role = role;
    }
    
    // Actualizar nuevos campos del perfil (solo si tienen valor o son strings vacíos explícitos)
    if (cedula !== undefined && cedula !== null) {
      console.log('📝 Actualizando cedula:', cedula);
      usuario.cedula = cedula || "";
    }
    if (fechaNacimiento !== undefined && fechaNacimiento !== null && fechaNacimiento !== "") {
      console.log('📝 Actualizando fechaNacimiento:', fechaNacimiento);
      // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
      // para evitar cambios de día por zona horaria
      if (typeof fechaNacimiento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento)) {
        const [year, month, day] = fechaNacimiento.split('-');
        // Crear fecha en hora local (medianoche) para preservar el día
        usuario.fechaNacimiento = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        usuario.fechaNacimiento = fechaNacimiento;
      }
    } else if (fechaNacimiento === "") {
      console.log('📝 Limpiando fechaNacimiento');
      usuario.fechaNacimiento = null;
    }
    if (tipoSangre !== undefined && tipoSangre !== null) {
      console.log('📝 Actualizando tipoSangre:', tipoSangre);
      usuario.tipoSangre = tipoSangre || "";
    }
    if (direccion !== undefined && direccion !== null) {
      console.log('📝 Actualizando direccion:', direccion);
      usuario.direccion = direccion || "";
    }
    if (telefonoFijo !== undefined && telefonoFijo !== null) {
      console.log('📝 Actualizando telefonoFijo:', telefonoFijo);
      usuario.telefonoFijo = telefonoFijo || "";
    }
    if (celulares !== undefined && celulares !== null) {
      console.log('📝 Actualizando celulares:', celulares);
      usuario.celulares = celulares || "";
    }
    if (correosElectronicos !== undefined && correosElectronicos !== null) {
      console.log('📝 Actualizando correosElectronicos:', correosElectronicos);
      usuario.correosElectronicos = correosElectronicos || "";
    }
    if (empresa !== undefined && empresa !== null) {
      console.log('📝 Actualizando empresa:', empresa);
      usuario.empresa = empresa || "";
    }
    if (fechaIngreso !== undefined && fechaIngreso !== null && fechaIngreso !== "") {
      console.log('📝 Actualizando fechaIngreso:', fechaIngreso);
      // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
      if (typeof fechaIngreso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaIngreso)) {
        const [year, month, day] = fechaIngreso.split('-');
        usuario.fechaIngreso = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        usuario.fechaIngreso = fechaIngreso;
      }
    } else if (fechaIngreso === "") {
      console.log('📝 Limpiando fechaIngreso');
      usuario.fechaIngreso = null;
    }
    if (cargos !== undefined && cargos !== null) {
      console.log('📝 Actualizando cargos:', cargos);
      usuario.cargos = cargos || "";
    }
    if (salario !== undefined && salario !== null && salario !== "") {
      console.log('📝 Actualizando salario:', salario);
      usuario.salario = salario;
    } else if (salario === "") {
      console.log('📝 Limpiando salario');
      usuario.salario = null;
    }
    if (fechaModificacionSueldo !== undefined && fechaModificacionSueldo !== null && fechaModificacionSueldo !== "") {
      console.log('📝 Actualizando fechaModificacionSueldo:', fechaModificacionSueldo);
      // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
      if (typeof fechaModificacionSueldo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaModificacionSueldo)) {
        const [year, month, day] = fechaModificacionSueldo.split('-');
        usuario.fechaModificacionSueldo = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        usuario.fechaModificacionSueldo = fechaModificacionSueldo;
      }
    } else if (fechaModificacionSueldo === "") {
      console.log('📝 Limpiando fechaModificacionSueldo');
      usuario.fechaModificacionSueldo = null;
    }
    if (tipoContrato !== undefined && tipoContrato !== null) {
      console.log('📝 Actualizando tipoContrato:', tipoContrato);
      usuario.tipoContrato = tipoContrato || "";
    }
    if (fechaModificacionContrato !== undefined && fechaModificacionContrato !== null && fechaModificacionContrato !== "") {
      console.log('📝 Actualizando fechaModificacionContrato:', fechaModificacionContrato);
      // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
      if (typeof fechaModificacionContrato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaModificacionContrato)) {
        const [year, month, day] = fechaModificacionContrato.split('-');
        usuario.fechaModificacionContrato = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        usuario.fechaModificacionContrato = fechaModificacionContrato;
      }
    } else if (fechaModificacionContrato === "") {
      console.log('📝 Limpiando fechaModificacionContrato');
      usuario.fechaModificacionContrato = null;
    }
    if (vencimiento !== undefined && vencimiento !== null && vencimiento !== "") {
      console.log('📝 Actualizando vencimiento:', vencimiento);
      // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
      if (typeof vencimiento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) {
        const [year, month, day] = vencimiento.split('-');
        usuario.vencimiento = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        usuario.vencimiento = vencimiento;
      }
    } else if (vencimiento === "") {
      console.log('📝 Limpiando vencimiento');
      usuario.vencimiento = null;
    }
    if (aportesSalud !== undefined && aportesSalud !== null) {
      console.log('📝 Actualizando aportesSalud:', aportesSalud);
      usuario.aportesSalud = aportesSalud || "";
    }
    if (aportesPension !== undefined && aportesPension !== null) {
      console.log('📝 Actualizando aportesPension:', aportesPension);
      usuario.aportesPension = aportesPension || "";
    }
    if (aportesCesantias !== undefined && aportesCesantias !== null) {
      console.log('📝 Actualizando aportesCesantias:', aportesCesantias);
      usuario.aportesCesantias = aportesCesantias || "";
    }
    if (aportesARL !== undefined && aportesARL !== null) {
      console.log('📝 Actualizando aportesARL:', aportesARL);
      usuario.aportesARL = aportesARL || "";
    }
    if (aportesCCF !== undefined && aportesCCF !== null) {
      console.log('📝 Actualizando aportesCCF:', aportesCCF);
      usuario.aportesCCF = aportesCCF || "";
    }
    if (evaluacionPeriodoPrueba !== undefined && evaluacionPeriodoPrueba !== null) {
      console.log('📝 Actualizando evaluacionPeriodoPrueba:', evaluacionPeriodoPrueba);
      usuario.evaluacionPeriodoPrueba = evaluacionPeriodoPrueba || "";
    }
    if (sucursal !== undefined && sucursal !== null) {
      console.log('📝 Actualizando sucursal:', sucursal);
      usuario.sucursal = sucursal || "";
    }
    
    console.log('💾 Guardando usuario en BD...');
    await usuario.save();
    console.log('✅ Usuario guardado exitosamente');
    
    // Verificar que se guardó correctamente - usar lean() para obtener todos los campos
    const usuarioVerificado = await SecurUser.findById(decoded.id).lean();
    console.log('✅ Usuario después de guardar:', {
      empresa: usuarioVerificado.empresa,
      cedula: usuarioVerificado.cedula,
      tipoSangre: usuarioVerificado.tipoSangre,
      direccion: usuarioVerificado.direccion,
      telefonoFijo: usuarioVerificado.telefonoFijo,
      celulares: usuarioVerificado.celulares,
      correosElectronicos: usuarioVerificado.correosElectronicos,
      fechaIngreso: usuarioVerificado.fechaIngreso,
      cargos: usuarioVerificado.cargos,
      salario: usuarioVerificado.salario,
      tipoContrato: usuarioVerificado.tipoContrato,
      aportesSalud: usuarioVerificado.aportesSalud,
      aportesPension: usuarioVerificado.aportesPension,
      aportesCesantias: usuarioVerificado.aportesCesantias,
      aportesARL: usuarioVerificado.aportesARL,
      aportesCCF: usuarioVerificado.aportesCCF,
      evaluacionPeriodoPrueba: usuarioVerificado.evaluacionPeriodoPrueba,
      sucursal: usuarioVerificado.sucursal
    });
    
    // Construir respuesta explícita con todos los campos
    const userResponse = {
      id: usuarioVerificado._id,
      login: usuarioVerificado.login,
      name: usuarioVerificado.name,
      email: usuarioVerificado.email,
      role: usuarioVerificado.role,
      phone: usuarioVerificado.phone,
      active: usuarioVerificado.active,
      privAdmin: usuarioVerificado.privAdmin,
      pswdLastUpdated: usuarioVerificado.pswdLastUpdated,
      createdAt: usuarioVerificado.createdAt,
      updatedAt: usuarioVerificado.updatedAt,
      foto: usuarioVerificado.foto,
      // Nuevos campos del perfil - usar ?? para preservar strings vacíos
      cedula: usuarioVerificado.cedula ?? null,
      fechaNacimiento: usuarioVerificado.fechaNacimiento ?? null,
      tipoSangre: usuarioVerificado.tipoSangre ?? null,
      direccion: usuarioVerificado.direccion ?? null,
      telefonoFijo: usuarioVerificado.telefonoFijo ?? null,
      celulares: usuarioVerificado.celulares ?? null,
      correosElectronicos: usuarioVerificado.correosElectronicos ?? null,
      empresa: usuarioVerificado.empresa ?? null,
      fechaIngreso: usuarioVerificado.fechaIngreso ?? null,
      cargos: usuarioVerificado.cargos ?? null,
      salario: usuarioVerificado.salario ?? null,
      fechaModificacionSueldo: usuarioVerificado.fechaModificacionSueldo ?? null,
      tipoContrato: usuarioVerificado.tipoContrato ?? null,
      fechaModificacionContrato: usuarioVerificado.fechaModificacionContrato ?? null,
      vencimiento: usuarioVerificado.vencimiento ?? null,
      aportesSalud: usuarioVerificado.aportesSalud ?? null,
      aportesPension: usuarioVerificado.aportesPension ?? null,
      aportesCesantias: usuarioVerificado.aportesCesantias ?? null,
      aportesARL: usuarioVerificado.aportesARL ?? null,
      aportesCCF: usuarioVerificado.aportesCCF ?? null,
      evaluacionPeriodoPrueba: usuarioVerificado.evaluacionPeriodoPrueba ?? null,
      sucursal: usuarioVerificado.sucursal ?? null
    };
    
    console.log('📤 Respuesta completa del PUT:', JSON.stringify(userResponse, null, 2));
    
    res.json({ 
      message: "Perfil actualizado correctamente",
      user: userResponse
    });
    
  } catch (error) {
    console.error("❌ Error actualizando perfil:", error);
    console.error("📋 Stack trace:", error.stack);
    res.status(500).json({ message: "Error en el servidor", error: error.message });
  }
});

// Actualizar foto de perfil
router.put("/perfil/foto", upload.single("foto"), persistFoto, async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    console.log('📸 === INICIANDO ACTUALIZACIÓN DE FOTO ===');
    console.log('🔐 Token recibido:', token ? 'SÍ' : 'NO');
    
    if (!token) {
      return res.status(401).json({ message: "Token requerido" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('🔓 Token decodificado:', { id: decoded.id, login: decoded.login });
    
    const usuario = await SecurUser.findById(decoded.id);
    
    if (!usuario) {
      console.log('❌ Usuario no encontrado en BD');
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    console.log('✅ Usuario encontrado:', { 
      id: usuario._id, 
      name: usuario.name, 
      fotoActual: usuario.foto 
    });
    
    // Verificar si se recibió un archivo
    if (!req.file) {
      console.log('❌ No se recibió ningún archivo');
      return res.status(400).json({ message: "No se recibió ningún archivo" });
    }
    
    console.log('📁 Archivo recibido:', {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
    
    // Actualizar el campo foto con la URL relativa
    const nuevaFotoUrl = getPublicPathForSingle(req, (f) => `/uploads/${f.filename}`);
    console.log('🔄 Cambiando foto de:', usuario.foto, 'a:', nuevaFotoUrl);

    await deleteReplacedStoredFile(usuario.foto, nuevaFotoUrl).catch((err) => {
      console.warn('⚠️ No se pudo eliminar la foto anterior:', err.message);
    });
    
    usuario.foto = nuevaFotoUrl;
    
    console.log('💾 Guardando usuario en BD...');
    await usuario.save();
    
    // Verificar que se guardó correctamente
    const usuarioVerificado = await SecurUser.findById(decoded.id);
    console.log('✅ Usuario después de guardar:', { 
      id: usuarioVerificado._id, 
      name: usuarioVerificado.name, 
      foto: usuarioVerificado.foto 
    });
    
    console.log('✅ Foto guardada exitosamente en BD');
    console.log('📸 === FIN ACTUALIZACIÓN DE FOTO ===');
    
    // Devolver la URL actualizada
    res.json({ fotoPerfil: usuario.foto });
    
  } catch (error) {
    console.error('❌ Error actualizando foto:', error);
    console.error('📋 Stack trace:', error.stack);
    res.status(500).json({ message: "Error interno al actualizar foto" });
  }
});

// Eliminar usuario
router.delete("/usuarios", async (req, res) => {
  const { loginOrEmail } = req.query;
  const token = req.headers.authorization?.split(' ')[1];
  
  console.log('🗑️ Eliminando usuario:', { loginOrEmail, hasToken: !!token });
  console.log('📋 Headers:', req.headers);
  
  try {
    if (!token) {
      console.log('❌ No hay token en la petición');
      return res.status(401).json({ message: "Token requerido" });
    }
    
    console.log('🔐 Verificando token...');
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('✅ Token válido, ID del usuario:', decoded.id);
    
    const usuarioActual = await SecurUser.findById(decoded.id);
    
    if (!usuarioActual) {
      console.log('❌ Usuario actual no encontrado en la base de datos');
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    console.log('✅ Usuario actual encontrado:', { 
      login: usuarioActual.login, 
      role: usuarioActual.role, 
      active: usuarioActual.active 
    });
    
    // Solo admin puede eliminar usuarios
    if (usuarioActual.role !== "admin") {
      console.log('❌ Usuario no es admin, rol actual:', usuarioActual.role);
      return res.status(403).json({ message: "No tienes permisos para eliminar usuarios" });
    }
    
    if (!loginOrEmail) {
      console.log('❌ No se proporcionó loginOrEmail');
      return res.status(400).json({ message: "Login o email requerido" });
    }
    
    console.log('🔍 Buscando usuario a eliminar:', loginOrEmail);
    // Buscar usuario por login o email
    const usuarioAEliminar = await SecurUser.findOne({
      $or: [
        { login: loginOrEmail },
        { email: loginOrEmail }
      ]
    });
    
    if (!usuarioAEliminar) {
      console.log('❌ Usuario a eliminar no encontrado:', loginOrEmail);
      return res.status(404).json({ message: "Usuario a eliminar no encontrado" });
    }
    
    console.log('✅ Usuario a eliminar encontrado:', { 
      login: usuarioAEliminar.login, 
      email: usuarioAEliminar.email,
      role: usuarioAEliminar.role 
    });
    
    // No permitir eliminar al propio usuario
    if (usuarioAEliminar._id.toString() === usuarioActual._id.toString()) {
      console.log('❌ Intento de eliminar propia cuenta');
      return res.status(400).json({ message: "No puedes eliminar tu propia cuenta" });
    }
    
    console.log('🗑️ Procediendo a eliminar usuario...');
    await SecurUser.findByIdAndDelete(usuarioAEliminar._id);
    console.log('✅ Usuario eliminado exitosamente');
    
    res.json({ 
      message: "Usuario eliminado correctamente",
      usuarioEliminado: {
        login: usuarioAEliminar.login,
        email: usuarioAEliminar.email
      }
    });
    
  } catch (error) {
    console.error("Error eliminando usuario:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Crear nuevo usuario secur (solo admin y soporte pueden hacerlo)
router.post("/register", upload.single("foto"), persistFoto, async (req, res) => {
  // Extraer datos de req.body (multer parsea multipart/form-data)
  const { nombre, correo, password, rol, celular, cedula, fechaNacimiento } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    console.log('📝 === REGISTRO DE USUARIO ===');
    console.log('🔐 Token recibido:', token ? 'SÍ' : 'NO');
    console.log('📋 Datos recibidos:', { nombre, correo, password: password ? '***' : 'NO', rol, celular, cedula, fechaNacimiento });
    
    if (!token) {
      console.log('❌ No hay token');
      return res.status(401).json({ message: "Token requerido" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('🔓 Token decodificado:', { id: decoded.id, login: decoded.login, role: decoded.role });
    
    const usuarioActual = await SecurUser.findById(decoded.id);
    
    if (!usuarioActual) {
      console.log('❌ Usuario no encontrado en BD');
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    console.log('✅ Usuario actual:', { 
      id: usuarioActual._id, 
      login: usuarioActual.login, 
      role: usuarioActual.role, 
      active: usuarioActual.active 
    });
    
    // Admin y soporte pueden crear usuarios
    if (usuarioActual.role !== "admin" && usuarioActual.role !== "soporte") {
      console.log('❌ Usuario sin permisos. Rol:', usuarioActual.role);
      return res.status(403).json({ 
        message: "No tienes permisos para crear usuarios. Solo administradores y soporte pueden crear usuarios." 
      });
    }
    
    if (!nombre || !correo || !password || !cedula) {
      console.log('❌ Faltan campos obligatorios');
      return res.status(400).json({ message: "Nombre, correo, cédula y contraseña son obligatorios" });
    }

    const rolAsignado = rol || "usuario";
    if (!esRolValido(rolAsignado)) {
      return res.status(400).json({ message: `Rol inválido. Valores permitidos: admin, soporte, usuario, visualizador, puertos` });
    }
    
    // Validar que la cédula no esté vacía
    const cedulaTrim = cedula.trim();
    if (!cedulaTrim) {
      console.log('❌ Cédula vacía');
      return res.status(400).json({ message: "La cédula es obligatoria" });
    }
    
    // Verificar si el usuario ya existe (por login/cedula o email)
    const usuarioExistente = await SecurUser.findOne({ 
      $or: [
        { email: correo }, 
        { login: cedulaTrim },
        { cedula: cedulaTrim }
      ] 
    });
    
    if (usuarioExistente) {
      console.log('❌ Usuario ya existe:', { email: correo, cedula: cedulaTrim });
      return res.status(409).json({ message: "El usuario ya existe (correo o cédula ya registrados)" });
    }
    
    // Crear nuevo usuario usando la cédula como login
    const hashedPassword = await bcrypt.hash(password, 10);
    const nuevoUsuario = new SecurUser({
      name: nombre,
      email: correo,
      login: cedulaTrim, // Usar la cédula como login
      pswd: hashedPassword,
      role: rolAsignado,
      phone: celular || "",
      cedula: cedulaTrim,
      fechaNacimiento: fechaNacimiento || "",
      active: "Y"
    });
    
    // Si hay foto, guardarla
    if (req.file) {
      nuevoUsuario.foto = getPublicPathForSingle(req, (f) => `/uploads/${f.filename}`);
      console.log('📸 Foto agregada:', nuevoUsuario.foto);
    }
    
    await nuevoUsuario.save();
    
    console.log('✅ Usuario creado exitosamente:', {
      id: nuevoUsuario._id,
      name: nuevoUsuario.name,
      email: nuevoUsuario.email,
      role: nuevoUsuario.role
    });
    console.log('📝 === FIN REGISTRO DE USUARIO ===');
    
    res.status(201).json({ 
      message: "Usuario creado correctamente",
      usuario: {
        id: nuevoUsuario._id,
        name: nuevoUsuario.name,
        email: nuevoUsuario.email,
        role: nuevoUsuario.role
      }
    });
    
  } catch (error) {
    console.error("❌ Error creando usuario secur:", error);
    console.error("📋 Stack trace:", error.stack);
    
    // Si es un error de JWT, retornar 401
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "Token inválido o expirado" });
    }
    
    res.status(500).json({ 
      message: "Error en el servidor",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Ruta de prueba para email (solo para desarrollo)
router.post("/test-email", async (req, res) => {
  try {
    console.log('🧪 Iniciando prueba de email...');
    console.log('📧 EMAIL_USER:', process.env.EMAIL_USER);
    console.log('📧 EMAIL_PASS:', process.env.EMAIL_PASS ? '***' : 'NO DEFINIDO');
    
    const nodemailer = await import('nodemailer');
    
    // Configuración de prueba
    const transporter = nodemailer.default.createTransporter({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      debug: true,
      logger: true
    });
    
    console.log('📧 Transporter configurado, verificando conexión...');
    
    // Verificar conexión
    await transporter.verify();
    console.log('✅ Conexión SMTP verificada');
    
    const mailOptions = {
      from: `"Grupo Proser" <${process.env.EMAIL_USER}>`,
      to: 'danalyst@proserpuertos.com.co', // Email de prueba
      subject: '🧪 Prueba de Email - Grupo Proser',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">🧪 Prueba de Email</h2>
          <p>Este es un email de prueba para verificar que el sistema de envío funciona correctamente.</p>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString()}</p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
            Este es un mensaje de prueba automático.
          </p>
        </div>
      `
    };
    
    console.log('📧 Enviando email de prueba...');
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email de prueba enviado exitosamente');
    console.log('📧 Message ID:', info.messageId);
    console.log('📧 Response:', info.response);
    
    res.json({ 
      success: true, 
      message: "Email de prueba enviado correctamente",
      messageId: info.messageId
    });
    
  } catch (error) {
    console.error('❌ Error en prueba de email:', error);
    res.status(500).json({ 
      success: false, 
      message: "Error enviando email de prueba",
      error: error.message 
    });
  }
});

// Endpoint para verificar sesión activa (heartbeat) - DEBE ESTAR ANTES DE RUTAS CON PARÁMETROS
// IMPORTANTE: Esta ruta debe estar ANTES de rutas con parámetros dinámicos como /usuario/:login
console.log('✅ Endpoint GET /verificar-sesion registrado (antes de rutas con parámetros)');
router.get("/verificar-sesion", async (req, res) => {
  try {
    console.log('💓 Heartbeat recibido - verificando sesión...');
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      console.log('⚠️ Heartbeat sin token');
      return res.status(401).json({ message: "Token no proporcionado" });
    }
    
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
      console.log('✅ Token válido para heartbeat:', decoded.login);
    } catch (error) {
      console.log('⚠️ Token inválido en heartbeat:', error.message);
      return res.status(401).json({ message: "Token inválido o expirado" });
    }

    // Sesión limitada del enlace de subtarea: no hay SecurUser / SesionUsuario
    if (decoded?.externo || decoded?.role === 'externo') {
      return res.json({
        message: "Sesión externa activa",
        externo: true,
        usuario: {
          id: decoded.id,
          login: decoded.login,
          name: decoded.nombre || decoded.name || 'Externo',
        },
      });
    }
    
    // Verificar que el usuario existe y está activo
    const usuario = await SecurUser.findById(decoded.id);
    if (!usuario || usuario.active !== "Y") {
      console.log('⚠️ Usuario no encontrado o inactivo en heartbeat');
      return res.status(401).json({ message: "Usuario no encontrado o inactivo" });
    }
    
    // Actualizar última actividad de la sesión activa
    const sesionActiva = await SesionUsuario.findOne({
      usuarioId: decoded.id,
      activa: true
    }).sort({ inicioSesion: -1 });
    
    if (sesionActiva) {
      // Actualizar timestamp de última actividad (usando updatedAt)
      sesionActiva.updatedAt = new Date();
      await sesionActiva.save();
      console.log('✅ Actividad actualizada para sesión:', sesionActiva.login);
    } else {
      console.log('⚠️ No se encontró sesión activa para:', usuario.login);
    }
    
    res.json({ 
      message: "Sesión activa",
      usuario: {
        id: usuario._id,
        login: usuario.login,
        name: usuario.name
      }
    });
  } catch (error) {
    console.error('❌ Error en verificar-sesion:', error);
    res.status(500).json({ message: "Error al verificar sesión" });
  }
});

// Ruta para obtener usuario por login (solo admin/soporte)
router.get("/usuario/:login", async (req, res) => {
  try {
    const { login } = req.params;
    
    // Verificar que el usuario que hace la petición sea admin o soporte
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: "Token no proporcionado" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const usuarioActual = await SecurUser.findOne({ login: decoded.login });
    
    if (!usuarioActual || (usuarioActual.role !== 'admin' && usuarioActual.role !== 'soporte')) {
      return res.status(403).json({ message: "No tienes permisos para realizar esta acción" });
    }

    // Buscar el usuario por login
    const usuario = await SecurUser.findOne({ login: login });
    if (!usuario) {
      console.log('❌ Usuario no encontrado con login:', login);
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    console.log('✅ Usuario encontrado por login:', usuario.login);

    // No enviar la contraseña en la respuesta
    const usuarioSinPassword = {
      _id: usuario._id,
      login: usuario.login,
      name: usuario.name,
      email: usuario.email,
      active: usuario.active,
      role: usuario.role,
      phone: usuario.phone,
      createdAt: usuario.createdAt,
      updatedAt: usuario.updatedAt
    };

    res.json(usuarioSinPassword);
  } catch (error) {
    console.error("Error al obtener usuario:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta para actualizar usuario por login (solo admin/soporte)
router.put("/actualizar-usuario/:login", async (req, res) => {
  try {
    const { login } = req.params;
    const { name, email, phone, role, active } = req.body;
    
    // Verificar que el usuario que hace la petición sea admin o soporte
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: "Token no proporcionado" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const usuarioActual = await SecurUser.findOne({ login: decoded.login });
    
    if (!usuarioActual || (usuarioActual.role !== 'admin' && usuarioActual.role !== 'soporte')) {
      return res.status(403).json({ message: "No tienes permisos para realizar esta acción" });
    }

    // Buscar el usuario por login
    const usuario = await SecurUser.findOne({ login: login });
    if (!usuario) {
      console.log('❌ Usuario no encontrado con login:', login);
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // Actualizar campos permitidos
    if (name !== undefined) usuario.name = name;
    if (email !== undefined) usuario.email = email;
    if (phone !== undefined) usuario.phone = phone;
    if (role !== undefined) {
      if (!esRolValido(role)) {
        return res.status(400).json({ message: 'Rol inválido. Valores permitidos: admin, soporte, usuario, visualizador, puertos' });
      }
      usuario.role = role;
    }
    if (active !== undefined) usuario.active = active;

    await usuario.save();

    console.log('✅ Usuario actualizado exitosamente:', {
      id: usuario._id,
      name: usuario.name,
      role: usuario.role,
      active: usuario.active
    });

    res.json({
      success: true,
      message: `Usuario ${usuario.name} actualizado exitosamente`,
      usuario: {
        _id: usuario._id,
        login: usuario.login,
        name: usuario.name,
        email: usuario.email,
        active: usuario.active,
        role: usuario.role,
        phone: usuario.phone
      }
    });

  } catch (error) {
    console.error("Error al actualizar usuario:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

// Ruta de prueba para verificar el estado de la base de datos
router.get("/test-foto/:userId", async (req, res) => {
  try {
    console.log('🧪 === PRUEBA DE FOTO ===');
    const { userId } = req.params;
    console.log('🔍 Buscando usuario con ID:', userId);
    
    const usuario = await SecurUser.findById(userId);
    if (!usuario) {
      console.log('❌ Usuario no encontrado');
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    console.log('✅ Usuario encontrado:', {
      id: usuario._id,
      name: usuario.name,
      foto: usuario.foto,
      fotoTipo: typeof usuario.foto,
      fotoExiste: !!usuario.foto,
      coleccion: usuario.collection.name,
      esquema: Object.keys(usuario._doc)
    });
    
    // Verificar si el campo foto existe en el esquema
    const schemaFields = Object.keys(SecurUser.schema.paths);
    console.log('📋 Campos del esquema:', schemaFields);
    console.log('🔍 Campo foto en esquema:', schemaFields.includes('foto'));
    
    res.json({
      usuario: {
        id: usuario._id,
        name: usuario.name,
        foto: usuario.foto
      },
      esquema: schemaFields,
      fotoEnEsquema: schemaFields.includes('foto')
    });
    
  } catch (error) {
    console.error('❌ Error en prueba de foto:', error);
    res.status(500).json({ message: "Error en el servidor", error: error.message });
  }
});

// Endpoint de logout - Registrar fin de sesión
router.post("/logout", async (req, res) => {
  try {
    // Aceptar token desde header, body o FormData (para sendBeacon)
    let token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      // Intentar desde body (JSON)
      token = req.body?.token;
    }
    
    if (!token && req.body && typeof req.body === 'object') {
      // Intentar desde FormData (sendBeacon)
      token = req.body.token;
    }
    
    if (!token) {
      // Si no hay token pero es una petición de sendBeacon, responder OK de todas formas
      if (req.headers['content-type']?.includes('multipart/form-data') || 
          req.headers['content-type']?.includes('application/x-www-form-urlencoded') ||
          Object.keys(req.body || {}).length > 0) {
        return res.json({ message: "Sesión cerrada" });
      }
      return res.status(401).json({ message: "Token no proporcionado" });
    }
    
    let decoded;
    try {
      // Intentar decodificar el token (permitir tokens expirados para logout)
      decoded = jwt.decode(token);
      if (!decoded || !decoded.id) {
        // Si no se puede decodificar, intentar verificar
        decoded = jwt.verify(token, JWT_SECRET);
      }
    } catch (error) {
      // Si el token está expirado o inválido, aún intentamos cerrar la sesión
      console.log('⚠️ Token expirado o inválido, pero intentando cerrar sesión de todas formas');
      // Intentar buscar sesiones activas por el token decodificado parcialmente
      try {
        const partialDecoded = jwt.decode(token);
        if (partialDecoded && partialDecoded.id) {
          decoded = partialDecoded;
        } else {
          return res.json({ message: "Sesión cerrada" });
        }
      } catch (e) {
        return res.json({ message: "Sesión cerrada" });
      }
    }
    
    // Sesiones externas (enlace de subtarea) no se registran en SesionUsuario
    // y su id no es un ObjectId; no hay nada que cerrar en BD.
    if (decoded?.externo || !mongoose.Types.ObjectId.isValid(String(decoded?.id || ''))) {
      return res.json({ message: "Sesión cerrada" });
    }

    // Buscar la sesión activa más reciente del usuario
    const sesionActiva = await SesionUsuario.findOne({
      usuarioId: decoded.id,
      activa: true
    }).sort({ inicioSesion: -1 });
    
    if (sesionActiva) {
      const finSesion = new Date();
      const duracionMs = finSesion - sesionActiva.inicioSesion;
      const duracionMinutos = Math.floor(duracionMs / (1000 * 60));
      const duracionSegundos = Math.floor((duracionMs % (1000 * 60)) / 1000);
      
      sesionActiva.finSesion = finSesion;
      sesionActiva.duracionMinutos = duracionMinutos;
      sesionActiva.duracionSegundos = duracionSegundos;
      sesionActiva.activa = false;
      
      await sesionActiva.save();
      console.log(`✅ Sesión cerrada para usuario ID: ${decoded.id}, duración: ${duracionMinutos}m ${duracionSegundos}s`);
    }
    
    res.json({ message: "Sesión cerrada correctamente" });
  } catch (error) {
    console.error("❌ Error en logout:", error);
    // Aún responder OK para no bloquear el cierre del navegador
    res.json({ message: "Sesión cerrada" });
  }
});

// NOTA: El endpoint /verificar-sesion fue movido ANTES de las rutas con parámetros dinámicos
// (línea ~1006) para evitar conflictos de enrutamiento. Esta definición duplicada fue eliminada.

// Endpoint para cerrar sesiones inactivas automáticamente (ejecutar periódicamente)
router.post("/cerrar-sesiones-inactivas", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: "Token no proporcionado" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Solo admin puede ejecutar esta acción
    if (decoded.role !== 'admin') {
      return res.status(403).json({ message: "No tienes permisos" });
    }
    
    // Cerrar sesiones que han estado activas por más de 7 horas 50 minutos
    const tiempoMaximoSesion = 7 * 60 * 60 * 1000 + 50 * 60 * 1000; // 7 horas 50 minutos
    const tiempoLimiteInicio = new Date(Date.now() - tiempoMaximoSesion);
    
    const sesionesInactivas = await SesionUsuario.find({
      activa: true,
      inicioSesion: { $lt: tiempoLimiteInicio }
    });
    
    let cerradas = 0;
    for (const sesion of sesionesInactivas) {
      const finSesion = new Date();
      const duracionMs = finSesion - sesion.inicioSesion;
      const duracionMinutos = Math.floor(duracionMs / (1000 * 60));
      const duracionSegundos = Math.floor((duracionMs % (1000 * 60)) / 1000);
      
      sesion.finSesion = finSesion;
      sesion.duracionMinutos = duracionMinutos;
      sesion.duracionSegundos = duracionSegundos;
      sesion.activa = false;
      
      await sesion.save();
      cerradas++;
    }
    
    console.log(`✅ ${cerradas} sesiones inactivas cerradas automáticamente`);
    
    res.json({ 
      message: `${cerradas} sesiones inactivas cerradas`,
      cerradas: cerradas
    });
  } catch (error) {
    console.error("❌ Error cerrando sesiones inactivas:", error);
    res.status(500).json({ message: "Error al cerrar sesiones inactivas" });
  }
});

// Endpoint para obtener estadísticas de tiempo de uso por usuario
router.get("/estadisticas-tiempo-uso", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: "Token no proporcionado" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar que el usuario sea admin o soporte
    if (decoded.role !== 'admin' && decoded.role !== 'soporte') {
      return res.status(403).json({ message: "No tienes permisos para ver estas estadísticas" });
    }
    
    // IMPORTANTE: Obtener TODOS los usuarios activos primero
    // Esto asegura que usuarios sin sesiones también aparezcan en las estadísticas
    console.log('📊 Obteniendo todos los usuarios activos...');
    const todosUsuarios = await SecurUser.find({ active: 'Y' })
      .select('_id login name email role')
      .lean();
    console.log(`✅ Usuarios activos encontrados: ${todosUsuarios.length}`);
    
    // Obtener todas las sesiones (cerradas y activas) agrupadas por usuario
    console.log('📊 Agregando sesiones por usuario...');
    const estadisticasSesiones = await SesionUsuario.aggregate([
      {
        $group: {
          _id: "$usuarioId",
          login: { $first: "$login" },
          nombre: { $first: "$nombre" },
          totalSesiones: { $sum: 1 },
          tiempoTotalMinutos: { 
            $sum: {
              $cond: [
                { $eq: ["$activa", false] },
                { $ifNull: ["$duracionMinutos", 0] },
                0
              ]
            }
          },
          tiempoTotalSegundos: { 
            $sum: {
              $cond: [
                { $eq: ["$activa", false] },
                { $ifNull: ["$duracionSegundos", 0] },
                0
              ]
            }
          },
          ultimaSesion: { $max: "$finSesion" },
          primeraSesion: { $min: "$inicioSesion" },
          sesionActiva: {
            $max: {
              $cond: [
                { $eq: ["$activa", true] },
                "$inicioSesion",
                null
              ]
            }
          },
          tieneSesionActiva: {
            $max: {
              $cond: [
                { $eq: ["$activa", true] },
                true,
                false
              ]
            }
          }
        }
      }
    ]);
    
    console.log(`✅ Sesiones agregadas: ${estadisticasSesiones.length} usuarios con sesiones`);
    
    // Crear un mapa de estadísticas por usuarioId para búsqueda rápida
    const estadisticasMap = new Map();
    estadisticasSesiones.forEach(stat => {
      const idStr = stat._id?.toString();
      if (idStr) {
        estadisticasMap.set(idStr, stat);
      }
    });
    
    // Combinar usuarios activos con sus estadísticas de sesiones
    const estadisticas = todosUsuarios.map(usuario => {
      const usuarioIdStr = usuario._id?.toString();
      const statSesiones = estadisticasMap.get(usuarioIdStr);
      
      if (statSesiones) {
        // Usuario tiene sesiones, usar datos de la agregación
        return {
          usuarioId: usuario._id,
          login: statSesiones.login || usuario.login,
          nombre: statSesiones.nombre || usuario.name,
          email: usuario.email,
          rol: usuario.role,
          totalSesiones: statSesiones.totalSesiones,
          tiempoTotalMinutos: statSesiones.tiempoTotalMinutos || 0,
          tiempoTotalSegundos: statSesiones.tiempoTotalSegundos || 0,
          ultimaSesion: statSesiones.ultimaSesion,
          primeraSesion: statSesiones.primeraSesion,
          sesionActiva: statSesiones.sesionActiva,
          tieneSesionActiva: statSesiones.tieneSesionActiva || false
        };
      } else {
        // Usuario no tiene sesiones, crear estadísticas vacías
        return {
          usuarioId: usuario._id,
          login: usuario.login,
          nombre: usuario.name,
          email: usuario.email,
          rol: usuario.role,
          totalSesiones: 0,
          tiempoTotalMinutos: 0,
          tiempoTotalSegundos: 0,
          ultimaSesion: null,
          primeraSesion: null,
          sesionActiva: null,
          tieneSesionActiva: false
        };
      }
    });
    
    // Ordenar por tiempo total y sesión activa
    estadisticas.sort((a, b) => {
      const tiempoA = a.tiempoTotalMinutos || 0;
      const tiempoB = b.tiempoTotalMinutos || 0;
      if (tiempoA !== tiempoB) {
        return tiempoB - tiempoA;
      }
      // Si tienen el mismo tiempo, priorizar usuarios con sesión activa
      if (a.tieneSesionActiva && !b.tieneSesionActiva) return -1;
      if (!a.tieneSesionActiva && b.tieneSesionActiva) return 1;
      return 0;
    });
    
    console.log(`📊 Estadísticas encontradas: ${estadisticas.length} usuarios`);
    
    // Obtener TODAS las sesiones activas para actualizar información de sesiones activas
    // Ahora que ya incluimos todos los usuarios activos, solo necesitamos actualizar las sesiones activas
    const sesionesActivasSolas = await SesionUsuario.find({ activa: true })
      .select('usuarioId login nombre inicioSesion')
      .lean();
    
    console.log(`🔍 Sesiones activas encontradas: ${sesionesActivasSolas.length}`);
    if (sesionesActivasSolas.length > 0) {
      console.log(`📋 Logins de sesiones activas:`, sesionesActivasSolas.map(s => `${s.login} (ID: ${s.usuarioId?.toString()})`).join(', '));
    }
    
    // Actualizar información de sesiones activas en las estadísticas existentes
    // Recrear el mapa con las estadísticas ya procesadas
    estadisticasMap.clear();
    estadisticas.forEach(stat => {
      const idStr = stat.usuarioId?.toString();
      if (idStr) {
        estadisticasMap.set(idStr, stat);
      }
    });
    
    for (const sesionActiva of sesionesActivasSolas) {
      const usuarioIdStr = sesionActiva.usuarioId?.toString();
      const stat = estadisticasMap.get(usuarioIdStr);
      
      if (stat) {
        // Actualizar información de sesión activa
        stat.sesionActiva = sesionActiva.inicioSesion;
        stat.tieneSesionActiva = true;
        // Actualizar login y nombre si no están en la estadística
        if (!stat.login && sesionActiva.login) {
          stat.login = sesionActiva.login;
        }
        if (!stat.nombre && sesionActiva.nombre) {
          stat.nombre = sesionActiva.nombre;
        }
        console.log(`✅ Actualizada sesión activa para usuario: ${stat.login || usuarioIdStr}`);
      } else {
        // Esto no debería pasar ahora que incluimos todos los usuarios activos
        // Pero por si acaso, lo registramos
        console.log(`⚠️ Sesión activa encontrada para usuario no en estadísticas: ${sesionActiva.login} (ID: ${usuarioIdStr})`);
      }
    }
    
    // Convertir el mapa de vuelta a array (ya todos los usuarios activos están incluidos)
    estadisticas.length = 0;
    estadisticas.push(...Array.from(estadisticasMap.values()));
    
    console.log(`✅ Estadísticas finales: ${estadisticas.length} usuarios (todos los usuarios activos incluidos)`);
    
    // Formatear los resultados y calcular tiempo de sesión activa
    const ahora = new Date();
    const estadisticasFormateadas = await Promise.all(estadisticas.map(async (stat) => {
      // Calcular tiempo de sesión activa si existe
      let tiempoSesionActiva = null;
      if (stat.sesionActiva || stat.tieneSesionActiva) {
        // Intentar buscar la sesión activa, manejando tanto ObjectId como string
        let sesionActivaEncontrada = null;
        try {
          // Intentar con el inicioSesion exacto si está disponible
          if (stat.sesionActiva) {
            sesionActivaEncontrada = await SesionUsuario.findOne({
              usuarioId: stat.usuarioId,
              activa: true,
              inicioSesion: stat.sesionActiva
            });
          }
          
          // Si no se encuentra, buscar cualquier sesión activa del usuario
          if (!sesionActivaEncontrada) {
            sesionActivaEncontrada = await SesionUsuario.findOne({
              usuarioId: stat.usuarioId,
              activa: true
            }).sort({ inicioSesion: -1 });
          }
        } catch (err) {
          console.log(`⚠️ Error buscando sesión activa para usuario ${stat.usuarioId}:`, err.message);
        }
        
        if (sesionActivaEncontrada) {
          const tiempoActivaMs = ahora - sesionActivaEncontrada.inicioSesion;
          const minutosActiva = Math.floor(tiempoActivaMs / (1000 * 60));
          const segundosActiva = Math.floor((tiempoActivaMs % (1000 * 60)) / 1000);
          const horasActiva = Math.floor(minutosActiva / 60);
          
          tiempoSesionActiva = {
            horas: horasActiva,
            minutos: minutosActiva % 60,
            segundos: segundosActiva,
            totalMinutos: minutosActiva,
            formato: `${horasActiva}h ${minutosActiva % 60}m ${segundosActiva}s`
          };
        }
      }
      
      // Tiempo total incluyendo sesión activa
      const tiempoTotalConActiva = stat.tiempoTotalMinutos + (tiempoSesionActiva ? tiempoSesionActiva.totalMinutos : 0);
      const horas = Math.floor(tiempoTotalConActiva / 60);
      const minutos = tiempoTotalConActiva % 60;
      const segundos = stat.tiempoTotalSegundos % 60;
      
      return {
        usuarioId: stat.usuarioId,
        login: stat.login,
        nombre: stat.nombre,
        email: stat.email || 'N/A',
        rol: stat.rol || 'N/A',
        totalSesiones: stat.totalSesiones,
        tieneSesionActiva: !!tiempoSesionActiva,
        tiempoSesionActiva: tiempoSesionActiva,
        tiempoTotal: {
          horas: horas,
          minutos: minutos,
          segundos: segundos,
          totalMinutos: tiempoTotalConActiva,
          totalSegundos: stat.tiempoTotalSegundos,
          formato: `${horas}h ${minutos}m ${segundos}s`
        },
        tiempoTotalCerradas: {
          horas: Math.floor(stat.tiempoTotalMinutos / 60),
          minutos: stat.tiempoTotalMinutos % 60,
          totalMinutos: stat.tiempoTotalMinutos,
          formato: `${Math.floor(stat.tiempoTotalMinutos / 60)}h ${stat.tiempoTotalMinutos % 60}m`
        },
        ultimaSesion: stat.ultimaSesion,
        primeraSesion: stat.primeraSesion
      };
    }));
    
    console.log(`✅ Estadísticas formateadas: ${estadisticasFormateadas.length} usuarios`);
    
    res.json({
      totalUsuarios: estadisticasFormateadas.length,
      estadisticas: estadisticasFormateadas
    });
  } catch (error) {
    console.error("❌ Error al obtener estadísticas:", error);
    res.status(500).json({ message: "Error al obtener estadísticas de tiempo de uso" });
  }
});

// Endpoint de debug para verificar sesiones
router.get("/debug-sesiones", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: "Token no proporcionado" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar que el usuario sea admin o soporte
    if (decoded.role !== 'admin' && decoded.role !== 'soporte') {
      return res.status(403).json({ message: "No tienes permisos" });
    }
    
    const totalSesiones = await SesionUsuario.countDocuments();
    const sesionesActivas = await SesionUsuario.countDocuments({ activa: true });
    const sesionesCerradas = await SesionUsuario.countDocuments({ activa: false });
    
    const ultimasSesiones = await SesionUsuario.find()
      .sort({ inicioSesion: -1 })
      .limit(20)
      .select('usuarioId login nombre inicioSesion finSesion activa duracionMinutos')
      .lean();
    
    // Obtener todos los usuarios únicos con sesiones activas
    const usuariosConSesionActiva = await SesionUsuario.distinct('usuarioId', { activa: true });
    const loginsConSesionActiva = await SesionUsuario.distinct('login', { activa: true });
    
    // Buscar sesiones del usuario específico si se proporciona
    const { usuarioId, login } = req.query;
    let sesionesUsuario = null;
    let usuarioInfo = null;
    if (usuarioId || login) {
      const query = {};
      if (usuarioId) {
        const mongoose = await import('mongoose');
        if (mongoose.default.Types.ObjectId.isValid(usuarioId)) {
          query.usuarioId = new mongoose.default.Types.ObjectId(usuarioId);
        } else {
          query.usuarioId = usuarioId;
        }
      }
      if (login) query.login = { $regex: new RegExp(login, 'i') };
      
      sesionesUsuario = await SesionUsuario.find(query)
        .sort({ inicioSesion: -1 })
        .lean();
      
      // Buscar información del usuario
      if (login) {
        usuarioInfo = await SecurUser.findOne({ login: { $regex: new RegExp(login, 'i') } })
          .select('_id login name email role')
          .lean();
      } else if (usuarioId) {
        const mongoose = await import('mongoose');
        if (mongoose.default.Types.ObjectId.isValid(usuarioId)) {
          usuarioInfo = await SecurUser.findById(usuarioId)
            .select('_id login name email role')
            .lean();
        }
      }
      
    }
    
    // Buscar específicamente el usuario "matriz" si existe
    const usuarioMatriz = await SecurUser.findOne({ 
      $or: [
        { login: { $regex: /matriz/i } },
        { name: { $regex: /matriz/i } }
      ]
    }).select('_id login name email role').lean();
    
    let sesionesMatriz = null;
    if (usuarioMatriz) {
      sesionesMatriz = await SesionUsuario.find({ usuarioId: usuarioMatriz._id })
        .sort({ inicioSesion: -1 })
        .lean();
    }
    
    res.json({
      resumen: {
        totalSesiones,
        sesionesActivas,
        sesionesCerradas,
        usuariosConSesionActiva: usuariosConSesionActiva.length,
        loginsConSesionActiva: loginsConSesionActiva
      },
      ultimasSesiones: ultimasSesiones.map(s => ({
        usuarioId: s.usuarioId?.toString(),
        login: s.login,
        nombre: s.nombre,
        inicioSesion: s.inicioSesion,
        finSesion: s.finSesion,
        activa: s.activa,
        duracionMinutos: s.duracionMinutos
      })),
      sesionesUsuario: sesionesUsuario ? sesionesUsuario.map(s => ({
        usuarioId: s.usuarioId?.toString(),
        login: s.login,
        nombre: s.nombre,
        inicioSesion: s.inicioSesion,
        finSesion: s.finSesion,
        activa: s.activa,
        duracionMinutos: s.duracionMinutos
      })) : null,
      usuarioInfo: usuarioInfo ? {
        _id: usuarioInfo._id?.toString(),
        login: usuarioInfo.login,
        name: usuarioInfo.name,
        email: usuarioInfo.email,
        role: usuarioInfo.role
      } : null,
      usuarioMatriz: usuarioMatriz ? {
        _id: usuarioMatriz._id?.toString(),
        login: usuarioMatriz.login,
        name: usuarioMatriz.name,
        email: usuarioMatriz.email,
        role: usuarioMatriz.role
      } : null,
      sesionesMatriz: sesionesMatriz ? sesionesMatriz.map(s => ({
        usuarioId: s.usuarioId?.toString(),
        login: s.login,
        nombre: s.nombre,
        inicioSesion: s.inicioSesion,
        finSesion: s.finSesion,
        activa: s.activa,
        duracionMinutos: s.duracionMinutos
      })) : null
    });
  } catch (error) {
    console.error("❌ Error en debug sesiones:", error);
    res.status(500).json({ message: "Error al obtener información de debug" });
  }
});

// Endpoint para obtener tiempo de uso de un usuario específico
router.get("/tiempo-uso/:usuarioId", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: "Token no proporcionado" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const { usuarioId } = req.params;
    
    // Verificar que el usuario sea admin, soporte, o esté consultando su propio tiempo
    if (decoded.role !== 'admin' && decoded.role !== 'soporte' && decoded.id !== usuarioId) {
      return res.status(403).json({ message: "No tienes permisos para ver esta información" });
    }
    
    // Obtener todas las sesiones del usuario
    const sesiones = await SesionUsuario.find({
      usuarioId: usuarioId
    }).sort({ inicioSesion: -1 }).limit(100);
    
    // Calcular estadísticas
    const sesionesCerradas = sesiones.filter(s => !s.activa && s.finSesion);
    const sesionActiva = sesiones.find(s => s.activa);
    
    const tiempoTotalMinutos = sesionesCerradas.reduce((sum, s) => sum + (s.duracionMinutos || 0), 0);
    const tiempoTotalSegundos = sesionesCerradas.reduce((sum, s) => sum + (s.duracionSegundos || 0), 0);
    
    const horas = Math.floor(tiempoTotalMinutos / 60);
    const minutos = tiempoTotalMinutos % 60;
    const segundos = tiempoTotalSegundos % 60;
    
    // Si hay sesión activa, calcular tiempo hasta ahora
    let tiempoSesionActiva = null;
    if (sesionActiva) {
      const tiempoActivaMs = Date.now() - sesionActiva.inicioSesion;
      const minutosActiva = Math.floor(tiempoActivaMs / (1000 * 60));
      const segundosActiva = Math.floor((tiempoActivaMs % (1000 * 60)) / 1000);
      tiempoSesionActiva = {
        minutos: minutosActiva,
        segundos: segundosActiva,
        formato: `${Math.floor(minutosActiva / 60)}h ${minutosActiva % 60}m ${segundosActiva}s`
      };
    }
    
    res.json({
      usuarioId: usuarioId,
      totalSesiones: sesiones.length,
      sesionesCerradas: sesionesCerradas.length,
      sesionActiva: sesionActiva ? {
        inicio: sesionActiva.inicioSesion,
        tiempoTranscurrido: tiempoSesionActiva
      } : null,
      tiempoTotal: {
        horas: horas,
        minutos: minutos,
        segundos: segundos,
        totalMinutos: tiempoTotalMinutos,
        formato: `${horas}h ${minutos}m ${segundos}s`
      },
      sesiones: sesiones.map(s => ({
        id: s._id,
        inicio: s.inicioSesion,
        fin: s.finSesion,
        duracion: s.duracionMinutos ? `${Math.floor(s.duracionMinutos / 60)}h ${s.duracionMinutos % 60}m` : null,
        activa: s.activa
      }))
    });
  } catch (error) {
    console.error("❌ Error al obtener tiempo de uso:", error);
    res.status(500).json({ message: "Error al obtener tiempo de uso" });
  }
});

// Cambiar estado de vacaciones de un usuario
router.put("/usuarios/:id/vacaciones", async (req, res) => {
  const { id } = req.params;
  const { enVacaciones } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  
  // Lista de usuarios permitidos para gestionar vacaciones
  const USUARIOS_PERMITIDOS_VACACIONES = [
    '1065012991',
    'admin',
    'soporte'
  ];
  
  try {
    if (!token) {
      return res.status(401).json({ message: "Token requerido" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const usuarioActual = await SecurUser.findById(decoded.id);
    
    if (!usuarioActual) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    
    // Verificar que el usuario esté en la lista de permitidos
    if (!USUARIOS_PERMITIDOS_VACACIONES.includes(usuarioActual.login)) {
      console.log(`❌ Usuario ${usuarioActual.login} intentó cambiar estado de vacaciones pero no está autorizado`);
      return res.status(403).json({ 
        message: "No tienes permisos para gestionar el estado de vacaciones. Solo usuarios autorizados pueden realizar esta acción." 
      });
    }
    
    console.log(`✅ Usuario ${usuarioActual.login} autorizado para gestionar vacaciones`);
    
    if (typeof enVacaciones !== 'boolean') {
      return res.status(400).json({ message: "El campo enVacaciones debe ser un booleano" });
    }
    
    const usuario = await SecurUser.findById(id);
    
    if (!usuario) {
      return res.status(404).json({ message: "Usuario a modificar no encontrado" });
    }
    
    usuario.enVacaciones = enVacaciones;
    await usuario.save();
    
    res.json({
      success: true,
      message: enVacaciones 
        ? `Usuario ${usuario.name} marcado como en vacaciones` 
        : `Usuario ${usuario.name} reactivado (fuera de vacaciones)`,
      usuario: {
        _id: usuario._id,
        login: usuario.login,
        name: usuario.name,
        email: usuario.email,
        enVacaciones: usuario.enVacaciones
      }
    });
    
  } catch (error) {
    console.error("Error cambiando estado de vacaciones:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

export default router; 