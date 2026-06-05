// routes/user.routes.js
import express from "express";
import { verificarToken } from "../middleware/verificarToken.js";
import Usuario from "../models/Usuario.js";
import bcrypt from "bcryptjs";
import path from "path";
import { createMulterUpload, attachPersistedFileMiddleware } from "../storage/multerStorageFactory.js";
import { STORAGE_CATEGORIES, deleteReplacedStoredFile, getPublicPathForSingle } from "../services/fileStorageService.js";

const router = express.Router();

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

// ─── Ruta PROTEGIDA: crear usuario (con foto opcional) ────────
router.post(
  "/crear",
  verificarToken,
  upload.single("foto"),
  persistFoto,
  async (req, res) => {
    const rolSolicitante = req.usuario.rol;
    if (rolSolicitante !== "admin" && rolSolicitante !== "soporte") {
      return res
        .status(403)
        .json({ message: "Acceso denegado: solo admin o soporte puede crear cuentas" });
    }

    const { nombre, correo, password, rol } = req.body;
    if (!nombre || !correo || !password || !rol) {
      return res.status(400).json({ message: "Faltan campos obligatorios" });
    }

    try {
      const usuarioExistente = await Usuario.findOne({ correo });
      if (usuarioExistente) {
        return res.status(409).json({ message: "El correo ya está registrado" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const nuevoUsuario = new Usuario({
        nombre,
        correo,
        password: hashedPassword,
        rol
      });

      if (req.file) {
        nuevoUsuario.foto = getPublicPathForSingle(req, (f) => `/uploads/${f.filename}`);
      }

      await nuevoUsuario.save();
      return res
        .status(201)
        .json({ message: "Usuario creado correctamente", usuario: nuevoUsuario });
    } catch (error) {
      console.error("Error al crear usuario:", error);
      return res.status(500).json({ message: "Error interno del servidor" });
    }
  }
);

// ─── 4. Nueva ruta PROTEGIDA: obtener perfil del usuario logueado ─
router.get(
  "/perfil",
  verificarToken,
  async (req, res) => {
    try {
      // req.usuario.id lo proporciona tu middleware verificarToken
      const usuario = await Usuario.findById(req.usuario.id).select("-password");
      if (!usuario) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }
      return res.json(usuario);
    } catch (error) {
      console.error("Error al leer perfil:", error);
      return res.status(500).json({ message: "Error interno al obtener perfil" });
    }
  }
);

router.put(
  "/perfil",
  verificarToken,
  upload.single("foto"),
  persistFoto,
  async (req, res) => {
    console.log('📝 === INICIANDO ACTUALIZACIÓN DE PERFIL (USUARIO NORMAL) ===');
    console.log('👤 Usuario autenticado:', req.usuario);
    console.log('📁 Archivo recibido:', req.file);
    console.log('📋 Datos recibidos:', req.body);
    
    try {
      const usuario = await Usuario.findById(req.usuario.id);
      if (!usuario) {
        console.log('❌ Usuario no encontrado en BD');
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      console.log('✅ Usuario encontrado:', usuario.nombre);

      // Verificar contraseña si se proporciona
      if (req.body.passwordConfirm) {
        console.log('🔐 Verificando contraseña...');
        const isMatch = await bcrypt.compare(req.body.passwordConfirm, usuario.password);
        if (!isMatch) {
          console.log('❌ Contraseña incorrecta');
          return res.status(401).json({ message: "Contraseña incorrecta. No se guardaron los cambios." });
        }
        console.log('✅ Contraseña correcta');
      }

      // Actualizar foto si se proporciona
      if (req.file) {
        console.log('📸 Procesando archivo:', req.file.originalname);
        const nuevaFotoUrl = getPublicPathForSingle(req, (f) => `/uploads/${f.filename}`);
        await deleteReplacedStoredFile(usuario.foto, nuevaFotoUrl).catch((err) => {
          console.warn('⚠️ No se pudo eliminar la foto anterior:', err.message);
        });
        usuario.foto = nuevaFotoUrl;
        console.log('🔗 Nueva URL de foto:', usuario.foto);
      }

      // Actualizar campos básicos
      const { passwordConfirm, ...updateData } = req.body;
      if (updateData.nombre !== undefined && updateData.nombre !== null) {
        console.log('📝 Actualizando nombre:', updateData.nombre);
        usuario.nombre = updateData.nombre || "";
      }
      if (updateData.apellido !== undefined && updateData.apellido !== null) {
        console.log('📝 Actualizando apellido:', updateData.apellido);
        usuario.apellido = updateData.apellido || "";
      }
      if (updateData.correo !== undefined && updateData.correo !== null) {
        console.log('📝 Actualizando correo:', updateData.correo);
        usuario.correo = updateData.correo || "";
      }
      if (updateData.celular !== undefined && updateData.celular !== null) {
        console.log('📝 Actualizando celular:', updateData.celular);
        usuario.celular = updateData.celular || "";
      }
      if (updateData.cedula !== undefined && updateData.cedula !== null) {
        console.log('📝 Actualizando cedula:', updateData.cedula);
        usuario.cedula = updateData.cedula || "";
      }
      if (updateData.fechaNacimiento !== undefined && updateData.fechaNacimiento !== null && updateData.fechaNacimiento !== "") {
        console.log('📝 Actualizando fechaNacimiento:', updateData.fechaNacimiento);
        // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
        if (typeof updateData.fechaNacimiento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updateData.fechaNacimiento)) {
          const [year, month, day] = updateData.fechaNacimiento.split('-');
          usuario.fechaNacimiento = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          usuario.fechaNacimiento = updateData.fechaNacimiento;
        }
      } else if (updateData.fechaNacimiento === "") {
        console.log('📝 Limpiando fechaNacimiento');
        usuario.fechaNacimiento = null;
      }
      
      // Actualizar nuevos campos del perfil
      if (updateData.tipoSangre !== undefined && updateData.tipoSangre !== null) {
        console.log('📝 Actualizando tipoSangre:', updateData.tipoSangre);
        usuario.tipoSangre = updateData.tipoSangre || "";
      }
      if (updateData.direccion !== undefined && updateData.direccion !== null) {
        console.log('📝 Actualizando direccion:', updateData.direccion);
        usuario.direccion = updateData.direccion || "";
      }
      if (updateData.telefonoFijo !== undefined && updateData.telefonoFijo !== null) {
        console.log('📝 Actualizando telefonoFijo:', updateData.telefonoFijo);
        usuario.telefonoFijo = updateData.telefonoFijo || "";
      }
      if (updateData.celulares !== undefined && updateData.celulares !== null) {
        console.log('📝 Actualizando celulares:', updateData.celulares);
        usuario.celulares = updateData.celulares || "";
      }
      if (updateData.correosElectronicos !== undefined && updateData.correosElectronicos !== null) {
        console.log('📝 Actualizando correosElectronicos:', updateData.correosElectronicos);
        usuario.correosElectronicos = updateData.correosElectronicos || "";
      }
      if (updateData.empresa !== undefined && updateData.empresa !== null) {
        console.log('📝 Actualizando empresa:', updateData.empresa);
        usuario.empresa = updateData.empresa || "";
      }
      if (updateData.fechaIngreso !== undefined && updateData.fechaIngreso !== null && updateData.fechaIngreso !== "") {
        console.log('📝 Actualizando fechaIngreso:', updateData.fechaIngreso);
        // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
        if (typeof updateData.fechaIngreso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updateData.fechaIngreso)) {
          const [year, month, day] = updateData.fechaIngreso.split('-');
          usuario.fechaIngreso = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          usuario.fechaIngreso = updateData.fechaIngreso;
        }
      } else if (updateData.fechaIngreso === "") {
        console.log('📝 Limpiando fechaIngreso');
        usuario.fechaIngreso = null;
      }
      if (updateData.cargos !== undefined && updateData.cargos !== null) {
        console.log('📝 Actualizando cargos:', updateData.cargos);
        usuario.cargos = updateData.cargos || "";
      }
      if (updateData.salario !== undefined && updateData.salario !== null && updateData.salario !== "") {
        console.log('📝 Actualizando salario:', updateData.salario);
        usuario.salario = updateData.salario;
      } else if (updateData.salario === "") {
        console.log('📝 Limpiando salario');
        usuario.salario = null;
      }
      if (updateData.fechaModificacionSueldo !== undefined && updateData.fechaModificacionSueldo !== null && updateData.fechaModificacionSueldo !== "") {
        console.log('📝 Actualizando fechaModificacionSueldo:', updateData.fechaModificacionSueldo);
        // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
        if (typeof updateData.fechaModificacionSueldo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updateData.fechaModificacionSueldo)) {
          const [year, month, day] = updateData.fechaModificacionSueldo.split('-');
          usuario.fechaModificacionSueldo = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          usuario.fechaModificacionSueldo = updateData.fechaModificacionSueldo;
        }
      } else if (updateData.fechaModificacionSueldo === "") {
        console.log('📝 Limpiando fechaModificacionSueldo');
        usuario.fechaModificacionSueldo = null;
      }
      if (updateData.tipoContrato !== undefined && updateData.tipoContrato !== null) {
        console.log('📝 Actualizando tipoContrato:', updateData.tipoContrato);
        usuario.tipoContrato = updateData.tipoContrato || "";
      }
      if (updateData.fechaModificacionContrato !== undefined && updateData.fechaModificacionContrato !== null && updateData.fechaModificacionContrato !== "") {
        console.log('📝 Actualizando fechaModificacionContrato:', updateData.fechaModificacionContrato);
        // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
        if (typeof updateData.fechaModificacionContrato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updateData.fechaModificacionContrato)) {
          const [year, month, day] = updateData.fechaModificacionContrato.split('-');
          usuario.fechaModificacionContrato = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          usuario.fechaModificacionContrato = updateData.fechaModificacionContrato;
        }
      } else if (updateData.fechaModificacionContrato === "") {
        console.log('📝 Limpiando fechaModificacionContrato');
        usuario.fechaModificacionContrato = null;
      }
      if (updateData.vencimiento !== undefined && updateData.vencimiento !== null && updateData.vencimiento !== "") {
        console.log('📝 Actualizando vencimiento:', updateData.vencimiento);
        // Si viene en formato YYYY-MM-DD, crear la fecha en hora local (medianoche local)
        if (typeof updateData.vencimiento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updateData.vencimiento)) {
          const [year, month, day] = updateData.vencimiento.split('-');
          usuario.vencimiento = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          usuario.vencimiento = updateData.vencimiento;
        }
      } else if (updateData.vencimiento === "") {
        console.log('📝 Limpiando vencimiento');
        usuario.vencimiento = null;
      }
      if (updateData.aportesSalud !== undefined && updateData.aportesSalud !== null) {
        console.log('📝 Actualizando aportesSalud:', updateData.aportesSalud);
        usuario.aportesSalud = updateData.aportesSalud || "";
      }
      if (updateData.aportesPension !== undefined && updateData.aportesPension !== null) {
        console.log('📝 Actualizando aportesPension:', updateData.aportesPension);
        usuario.aportesPension = updateData.aportesPension || "";
      }
      if (updateData.aportesCesantias !== undefined && updateData.aportesCesantias !== null) {
        console.log('📝 Actualizando aportesCesantias:', updateData.aportesCesantias);
        usuario.aportesCesantias = updateData.aportesCesantias || "";
      }
      if (updateData.aportesARL !== undefined && updateData.aportesARL !== null) {
        console.log('📝 Actualizando aportesARL:', updateData.aportesARL);
        usuario.aportesARL = updateData.aportesARL || "";
      }
      if (updateData.aportesCCF !== undefined && updateData.aportesCCF !== null) {
        console.log('📝 Actualizando aportesCCF:', updateData.aportesCCF);
        usuario.aportesCCF = updateData.aportesCCF || "";
      }
      if (updateData.evaluacionPeriodoPrueba !== undefined && updateData.evaluacionPeriodoPrueba !== null) {
        console.log('📝 Actualizando evaluacionPeriodoPrueba:', updateData.evaluacionPeriodoPrueba);
        usuario.evaluacionPeriodoPrueba = updateData.evaluacionPeriodoPrueba || "";
      }
      if (updateData.sucursal !== undefined && updateData.sucursal !== null) {
        console.log('📝 Actualizando sucursal:', updateData.sucursal);
        usuario.sucursal = updateData.sucursal || "";
      }

      console.log('💾 Guardando usuario en BD...');
      await usuario.save();
      console.log('✅ Perfil guardado exitosamente en BD');
      
      // Verificar que se guardó correctamente
      const usuarioVerificado = await Usuario.findById(req.usuario.id);
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
        aportesPension: usuarioVerificado.aportesPension
      });
      
      return res.json({ 
        message: "Perfil actualizado correctamente",
        usuario: usuarioVerificado
      });
    } catch (error) {
      console.error('❌ Error actualizando perfil:', error);
      console.error('📋 Stack trace:', error.stack);
      return res.status(500).json({ message: "Error interno al actualizar perfil", error: error.message });
    }
  }
);


export default router;
