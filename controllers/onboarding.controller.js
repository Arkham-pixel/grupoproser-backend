import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import OnboardingInvitacion from '../models/OnboardingInvitacion.js';
import SecurUser from '../models/SecurUser.js';
import Documento from '../models/Documento.js';
import { esRolValido, aplicarSufijoNombrePorRol } from '../config/roles.js';
import { resolveFrontendUrl } from '../config/platformUrls.js';
import { enviarInvitacionOnboarding, enviarCredencialesOnboarding } from '../services/emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIAS_TOKEN_DEFAULT = 14;

const PLANTILLAS = {
  politica: {
    file: path.join(__dirname, '../assets/onboarding/politica-tratamiento-datos.pdf'),
    mime: 'application/pdf',
    nombre: 'Politica_Tratamiento_Datos.pdf',
  },
  confidencialidad: {
    file: path.join(__dirname, '../assets/onboarding/acuerdo-confidencialidad.docx'),
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    nombre: 'Acuerdo_Confidencialidad.docx',
  },
};

const DOCS_HR = {
  hojaVida: { etiqueta: 'hoja_vida', nombre: 'Hoja de vida / Currículum' },
  certificadoBancario: { etiqueta: 'certificado_bancario', nombre: 'Certificado bancario' },
  cedula: { etiqueta: 'cedula', nombre: 'Cédula de ciudadanía' },
};

function frontendUrlDesdeReq(req) {
  const candidatos = [req.headers.origin, req.headers.referer];
  for (const valor of candidatos) {
    const s = String(valor || '').trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return `${u.protocol}//${u.host}`;
      }
    } catch {
      /* siguiente */
    }
  }
  return resolveFrontendUrl();
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function generarTokenAcceso() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashToken(raw) };
}

function clientMeta(req) {
  return {
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
  };
}

function buildArchivoFromFile(file, fileStorage = null) {
  if (fileStorage?.driver === 's3') {
    return {
      nombreOriginal: file.originalname,
      nombreArchivo: fileStorage.filename,
      ruta: fileStorage.publicPath,
      tamaño: fileStorage.size,
      tipoMime: fileStorage.mimetype,
    };
  }
  return {
    nombreOriginal: file.originalname,
    nombreArchivo: file.filename,
    ruta: `/uploads/documentos/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
  };
}

async function guardarDocumentoPerfil({ usuario, nombre, descripcion, etiquetas, file, fileStorage }) {
  const documento = new Documento({
    nombre,
    descripcion: descripcion || '',
    archivo: buildArchivoFromFile(file, fileStorage),
    usuarioSubio: {
      id: String(usuario._id),
      login: usuario.login,
      nombre: usuario.name,
    },
    etiquetas: etiquetas || [],
  });
  await documento.save();
  return documento;
}

function docsCompletos(inv) {
  const d = inv.documentosHr || {};
  return Boolean(d.hojaVida?.subido && d.certificadoBancario?.subido && d.cedula?.subido);
}

function firmasCompletas(inv) {
  return Boolean(inv.firmaPoliticaDatos?.firmado && inv.firmaConfidencialidad?.firmado);
}

function recalcularEstado(inv) {
  if (inv.estado === 'cancelado') return 'cancelado';
  if (inv.tokenExpira && inv.tokenExpira < new Date() && inv.estado !== 'completado') {
    return 'expirado';
  }
  if (docsCompletos(inv) && inv.usuarioId) return 'completado';
  if (inv.usuarioId) {
    const parcial =
      inv.documentosHr?.hojaVida?.subido ||
      inv.documentosHr?.certificadoBancario?.subido ||
      inv.documentosHr?.cedula?.subido;
    return parcial ? 'docs_parciales' : 'cuenta_creada';
  }
  if (firmasCompletas(inv)) return 'firmado';
  if (inv.firmaPoliticaDatos?.firmado || inv.firmaConfidencialidad?.firmado) {
    return 'firmas_parciales';
  }
  return 'pendiente';
}

function payloadPublico(inv) {
  return {
    id: inv._id,
    nombre: inv.nombre,
    correo: inv.correo,
    celular: inv.celular,
    cedula: inv.cedula,
    fechaNacimiento: inv.fechaNacimiento,
    rol: inv.rol,
    estado: inv.estado,
    tokenExpira: inv.tokenExpira,
    firmaPoliticaDatos: {
      firmado: Boolean(inv.firmaPoliticaDatos?.firmado),
      firmadoEn: inv.firmaPoliticaDatos?.firmadoEn || null,
      firmaImagen: inv.firmaPoliticaDatos?.firmado ? inv.firmaPoliticaDatos.firmaImagen || null : null,
    },
    firmaConfidencialidad: {
      firmado: Boolean(inv.firmaConfidencialidad?.firmado),
      firmadoEn: inv.firmaConfidencialidad?.firmadoEn || null,
      firmaImagen: inv.firmaConfidencialidad?.firmado
        ? inv.firmaConfidencialidad.firmaImagen || null
        : null,
    },
    cuentaCreada: Boolean(inv.usuarioId),
    documentosHr: {
      hojaVida: { subido: Boolean(inv.documentosHr?.hojaVida?.subido) },
      certificadoBancario: { subido: Boolean(inv.documentosHr?.certificadoBancario?.subido) },
      cedula: { subido: Boolean(inv.documentosHr?.cedula?.subido) },
    },
    pasos: {
      firmarPolitica: Boolean(inv.firmaPoliticaDatos?.firmado),
      firmarConfidencialidad: Boolean(inv.firmaConfidencialidad?.firmado),
      crearCuenta: Boolean(inv.usuarioId),
      documentosCompletos: docsCompletos(inv),
      puedeIngresar: inv.estado === 'completado',
    },
  };
}

async function encontrarPorToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw.length < 20) return null;
  return OnboardingInvitacion.findOne({ tokenHash: hashToken(raw) });
}

async function requireInviteActiva(req, res) {
  const inv = await encontrarPorToken(req.params.token);
  if (!inv) {
    res.status(404).json({ message: 'Enlace no válido o no encontrado' });
    return null;
  }
  if (inv.estado === 'cancelado') {
    res.status(410).json({ message: 'Esta invitación fue cancelada' });
    return null;
  }
  if (inv.tokenExpira && inv.tokenExpira < new Date() && inv.estado !== 'completado') {
    inv.estado = 'expirado';
    await inv.save();
    res.status(410).json({ message: 'Este enlace ha expirado. Solicite uno nuevo al administrador.' });
    return null;
  }
  return inv;
}

function requireAdminSoporte(req, res) {
  const role = req.user?.role || req.usuario?.role;
  if (role !== 'admin' && role !== 'soporte') {
    res.status(403).json({ message: 'Solo admin o soporte pueden gestionar invitaciones' });
    return false;
  }
  return true;
}

/** Admin: crear invitación remota */
export async function crearInvitacion(req, res) {
  try {
    if (!requireAdminSoporte(req, res)) return;

    const { nombre, correo, celular, cedula, fechaNacimiento, rol, enviarEmail } = req.body;
    if (!nombre?.trim() || !correo?.trim() || !cedula?.trim()) {
      return res.status(400).json({ message: 'Nombre, correo y cédula son obligatorios' });
    }

    const rolAsignado = rol || 'usuario';
    if (!esRolValido(rolAsignado)) {
      return res.status(400).json({ message: 'Rol inválido' });
    }

    const cedulaTrim = String(cedula).trim();
    const correoTrim = String(correo).trim().toLowerCase();

    const usuarioExistente = await SecurUser.findOne({
      $or: [{ email: correoTrim }, { login: cedulaTrim }, { cedula: cedulaTrim }],
    });
    if (usuarioExistente) {
      return res.status(409).json({ message: 'Ya existe un usuario con ese correo o cédula' });
    }

    const pendiente = await OnboardingInvitacion.findOne({
      $or: [{ correo: correoTrim }, { cedula: cedulaTrim }],
      estado: { $nin: ['completado', 'cancelado', 'expirado'] },
    });
    if (pendiente) {
      return res.status(409).json({
        message: 'Ya hay una invitación activa para este correo o cédula',
        invitacionId: pendiente._id,
      });
    }

    const gen = generarTokenAcceso();
    const frontendUrl = frontendUrlDesdeReq(req);

    const invitacion = await OnboardingInvitacion.create({
      nombre: String(nombre).trim(),
      correo: correoTrim,
      celular: String(celular || '').trim(),
      cedula: cedulaTrim,
      fechaNacimiento: fechaNacimiento || undefined,
      rol: rolAsignado,
      tokenHash: gen.hash,
      tokenExpira: new Date(Date.now() + DIAS_TOKEN_DEFAULT * 24 * 60 * 60 * 1000),
      estado: 'pendiente',
      creadoPor: {
        id: String(req.user?.id || req.user?._id || ''),
        login: req.user?.login || '',
        nombre: req.user?.name || req.user?.login || '',
      },
    });

    const enlace = `${frontendUrl}/onboarding/${gen.raw}`;
    let emailResult = null;

    if (enviarEmail !== false) {
      emailResult = await enviarInvitacionOnboarding({
        emailDestino: correoTrim,
        nombreDestino: invitacion.nombre,
        token: gen.raw,
        frontendUrl,
        diasValidez: DIAS_TOKEN_DEFAULT,
      });
      if (emailResult?.success) {
        invitacion.emailEnviado = true;
        invitacion.emailEnviadoEn = new Date();
        await invitacion.save();
      }
    }

    res.status(201).json({
      message: 'Invitación creada',
      invitacion: {
        id: invitacion._id,
        nombre: invitacion.nombre,
        correo: invitacion.correo,
        cedula: invitacion.cedula,
        rol: invitacion.rol,
        estado: invitacion.estado,
        tokenExpira: invitacion.tokenExpira,
      },
      enlace,
      tokenUnaVez: gen.raw,
      email: emailResult,
    });
  } catch (error) {
    console.error('Error creando invitación onboarding:', error);
    res.status(500).json({ message: 'Error al crear la invitación', error: error.message });
  }
}

/** Admin: listar invitaciones */
export async function listarInvitaciones(req, res) {
  try {
    if (!requireAdminSoporte(req, res)) return;
    const limite = Math.min(Number(req.query.limit) || 50, 200);
    const items = await OnboardingInvitacion.find()
      .sort({ createdAt: -1 })
      .limit(limite)
      .select('-tokenHash -firmaPoliticaDatos.firmaImagen -firmaConfidencialidad.firmaImagen')
      .lean();
    res.json({ invitaciones: items });
  } catch (error) {
    console.error('Error listando invitaciones:', error);
    res.status(500).json({ message: 'Error al listar invitaciones' });
  }
}

/** Admin: reenviar enlace */
export async function reenviarInvitacion(req, res) {
  try {
    if (!requireAdminSoporte(req, res)) return;
    const inv = await OnboardingInvitacion.findById(req.params.id);
    if (!inv) return res.status(404).json({ message: 'Invitación no encontrada' });
    if (inv.estado === 'completado') {
      return res.status(400).json({ message: 'El onboarding ya está completado' });
    }
    if (inv.estado === 'cancelado') {
      return res.status(400).json({ message: 'La invitación está cancelada' });
    }

    const gen = generarTokenAcceso();
    inv.tokenHash = gen.hash;
    inv.tokenExpira = new Date(Date.now() + DIAS_TOKEN_DEFAULT * 24 * 60 * 60 * 1000);
    if (inv.estado === 'expirado') inv.estado = recalcularEstado(inv);

    const frontendUrl = frontendUrlDesdeReq(req);
    const enlace = `${frontendUrl}/onboarding/${gen.raw}`;

    const emailResult = await enviarInvitacionOnboarding({
      emailDestino: inv.correo,
      nombreDestino: inv.nombre,
      token: gen.raw,
      frontendUrl,
      diasValidez: DIAS_TOKEN_DEFAULT,
    });
    if (emailResult?.success) {
      inv.emailEnviado = true;
      inv.emailEnviadoEn = new Date();
    }
    await inv.save();

    res.json({
      message: 'Enlace regenerado',
      enlace,
      tokenUnaVez: gen.raw,
      email: emailResult,
      invitacion: { id: inv._id, estado: inv.estado, tokenExpira: inv.tokenExpira },
    });
  } catch (error) {
    console.error('Error reenviando invitación:', error);
    res.status(500).json({ message: 'Error al reenviar invitación' });
  }
}

/** Público: estado onboarding */
export async function obtenerPublica(req, res) {
  try {
    const inv = await requireInviteActiva(req, res);
    if (!inv) return;
    res.json(payloadPublico(inv));
  } catch (error) {
    console.error('Error obteniendo onboarding público:', error);
    res.status(500).json({ message: 'Error al obtener la invitación' });
  }
}

/** Público: descargar plantilla */
export async function descargarPlantilla(req, res) {
  try {
    const inv = await requireInviteActiva(req, res);
    if (!inv) return;

    const tipo = String(req.params.tipo || '').toLowerCase();
    const plantilla = PLANTILLAS[tipo];
    if (!plantilla) {
      return res.status(400).json({ message: 'Tipo de plantilla inválido' });
    }
    if (!fs.existsSync(plantilla.file)) {
      return res.status(404).json({ message: 'Plantilla no encontrada en el servidor' });
    }

    res.setHeader('Content-Type', plantilla.mime);
    res.setHeader('Content-Disposition', `inline; filename="${plantilla.nombre}"`);
    fs.createReadStream(plantilla.file).pipe(res);
  } catch (error) {
    console.error('Error sirviendo plantilla onboarding:', error);
    res.status(500).json({ message: 'Error al obtener la plantilla' });
  }
}

/** Público: firmar acuerdo (politica | confidencialidad) + PDF firmado opcional */
export async function firmarAcuerdo(req, res) {
  try {
    const inv = await requireInviteActiva(req, res);
    if (!inv) return;

    if (inv.usuarioId) {
      return res.status(400).json({ message: 'Las firmas ya fueron registradas y la cuenta existe' });
    }

    const tipo = String(req.body.tipo || '').toLowerCase();
    if (tipo !== 'politica' && tipo !== 'confidencialidad') {
      return res.status(400).json({ message: 'Tipo de acuerdo inválido' });
    }

    const firmaImagen = String(req.body.firmaImagen || '').trim();
    if (!firmaImagen || !firmaImagen.startsWith('data:image')) {
      return res.status(400).json({ message: 'Debe dibujar o subir una firma (imagen)' });
    }

    const campo = tipo === 'politica' ? 'firmaPoliticaDatos' : 'firmaConfidencialidad';
    if (inv[campo]?.firmado) {
      return res.status(400).json({ message: 'Este acuerdo ya fue firmado' });
    }

    const meta = clientMeta(req);
    inv[campo] = {
      firmado: true,
      firmadoEn: new Date(),
      firmaImagen,
      ip: meta.ip,
      userAgent: meta.userAgent,
      documentoId: inv[campo]?.documentoId || undefined,
    };

    inv.estado = recalcularEstado(inv);
    await inv.save();

    res.json({
      message: 'Acuerdo firmado correctamente',
      invitacion: payloadPublico(inv),
    });
  } catch (error) {
    console.error('Error firmando acuerdo:', error);
    res.status(500).json({ message: 'Error al firmar el acuerdo', error: error.message });
  }
}

/** Público: crear cuenta tras firmas + adjuntar PDFs firmados */
export async function registrarCuenta(req, res) {
  try {
    const inv = await requireInviteActiva(req, res);
    if (!inv) return;

    if (!firmasCompletas(inv)) {
      return res.status(400).json({
        message: 'Debe firmar la política de datos y el acuerdo de confidencialidad antes de crear la cuenta',
      });
    }
    if (inv.usuarioId) {
      return res.status(400).json({ message: 'La cuenta ya fue creada para esta invitación' });
    }

    const password = String(req.body.password || '');
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        message:
          'La contraseña debe tener mínimo 8 caracteres, mayúscula, minúscula, número y símbolo',
      });
    }

    const fechaNacimiento = req.body.fechaNacimiento || inv.fechaNacimiento;
    if (!fechaNacimiento) {
      return res.status(400).json({ message: 'La fecha de nacimiento es obligatoria' });
    }

    const usuarioExistente = await SecurUser.findOne({
      $or: [{ email: inv.correo }, { login: inv.cedula }, { cedula: inv.cedula }],
    });
    if (usuarioExistente) {
      return res.status(409).json({ message: 'Ya existe un usuario con ese correo o cédula' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const nuevoUsuario = new SecurUser({
      name: aplicarSufijoNombrePorRol(inv.nombre, inv.rol),
      email: inv.correo,
      login: inv.cedula,
      pswd: hashedPassword,
      role: inv.rol,
      phone: inv.celular || '',
      cedula: inv.cedula,
      fechaNacimiento,
      active: 'N', // Solo se activa al subir HV + bancario + cédula
    });
    await nuevoUsuario.save();

    inv.usuarioId = String(nuevoUsuario._id);
    inv.login = nuevoUsuario.login;
    inv.fechaNacimiento = fechaNacimiento;

    const files = req.files || {};
    const meta = clientMeta(req);

    const guardarFirmado = async (fieldName, tipo) => {
      const file = Array.isArray(files[fieldName]) ? files[fieldName][0] : null;
      if (!file) return;
      const fileStorage = req.filesStorage?.[fieldName]?.[0] || null;
      const nombreDoc =
        tipo === 'politica'
          ? 'Política de tratamiento de datos (firmada)'
          : 'Acuerdo de confidencialidad (firmado)';
      const etiqueta =
        tipo === 'politica' ? 'politica_datos_firmada' : 'acuerdo_confidencialidad_firmado';
      const doc = await guardarDocumentoPerfil({
        usuario: nuevoUsuario,
        nombre: nombreDoc,
        descripcion: `Firmado en onboarding — ${new Date().toISOString()} — IP ${meta.ip}`,
        etiquetas: [etiqueta, 'onboarding', 'firma'],
        file,
        fileStorage,
      });
      const campo = tipo === 'politica' ? 'firmaPoliticaDatos' : 'firmaConfidencialidad';
      inv[campo].documentoId = String(doc._id);
    };

    await guardarFirmado('politicaPdf', 'politica');
    await guardarFirmado('confidencialidadPdf', 'confidencialidad');

    inv.estado = recalcularEstado(inv);
    await inv.save();

    const emailCredenciales = await enviarCredencialesOnboarding({
      emailDestino: nuevoUsuario.email,
      nombreDestino: inv.nombre,
      login: nuevoUsuario.login,
      password,
      frontendUrl: frontendUrlDesdeReq(req),
    });

    res.status(201).json({
      message:
        'Cuenta creada. Suba hoja de vida, certificado bancario y cédula para activar el acceso.',
      invitacion: payloadPublico(inv),
      usuario: {
        id: nuevoUsuario._id,
        login: nuevoUsuario.login,
        email: nuevoUsuario.email,
        active: nuevoUsuario.active,
      },
      credencialesEmail: {
        enviado: Boolean(emailCredenciales?.success),
        error: emailCredenciales?.success ? undefined : emailCredenciales?.message,
      },
    });
  } catch (error) {
    console.error('Error registrando cuenta onboarding:', error);
    res.status(500).json({ message: 'Error al crear la cuenta', error: error.message });
  }
}

/** Público: subir documento HR (hojaVida | certificadoBancario | cedula) */
export async function subirDocumentoHr(req, res) {
  try {
    const inv = await requireInviteActiva(req, res);
    if (!inv) return;

    if (!inv.usuarioId) {
      return res.status(400).json({ message: 'Primero debe crear la cuenta' });
    }

    const tipo = String(req.body.tipo || req.params.tipo || '').trim();
    const metaDoc = DOCS_HR[tipo];
    if (!metaDoc) {
      return res.status(400).json({
        message: 'Tipo inválido. Use hojaVida, certificadoBancario o cedula',
      });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'Debe adjuntar el archivo' });
    }

    const usuario = await SecurUser.findById(inv.usuarioId);
    if (!usuario) {
      return res.status(404).json({ message: 'Usuario de la invitación no encontrado' });
    }

    const doc = await guardarDocumentoPerfil({
      usuario,
      nombre: metaDoc.nombre,
      descripcion: `Documento de onboarding — ${tipo}`,
      etiquetas: [metaDoc.etiqueta, 'onboarding', 'hr'],
      file: req.file,
      fileStorage: req.fileStorage || null,
    });

    inv.documentosHr[tipo] = {
      subido: true,
      subidoEn: new Date(),
      documentoId: String(doc._id),
      nombreArchivo: req.file.originalname,
    };

    if (docsCompletos(inv)) {
      usuario.active = 'Y';
      await usuario.save();
      inv.estado = 'completado';
      inv.completadoEn = new Date();
    } else {
      inv.estado = recalcularEstado(inv);
    }
    await inv.save();

    res.status(201).json({
      message: docsCompletos(inv)
        ? 'Documentación completa. Ya puede iniciar sesión en la plataforma.'
        : 'Documento subido correctamente',
      invitacion: payloadPublico(inv),
      documento: { id: doc._id, nombre: doc.nombre },
    });
  } catch (error) {
    console.error('Error subiendo documento HR onboarding:', error);
    res.status(500).json({ message: 'Error al subir el documento', error: error.message });
  }
}

/** Público: descargar copia firmada (si ya existe en gestor) */
export async function descargarFirmado(req, res) {
  try {
    const inv = await requireInviteActiva(req, res);
    if (!inv) return;

    const tipo = String(req.params.tipo || '').toLowerCase();
    const campo = tipo === 'politica' ? inv.firmaPoliticaDatos : inv.firmaConfidencialidad;
    if (!campo?.documentoId) {
      return res.status(404).json({ message: 'Aún no hay copia firmada disponible' });
    }

    const documento = await Documento.findById(campo.documentoId);
    if (!documento?.archivo?.ruta) {
      return res.status(404).json({ message: 'Documento firmado no encontrado' });
    }

    // Redirigir a ruta pública del archivo si es local; si S3, devolver metadatos
    res.json({
      documento: {
        id: documento._id,
        nombre: documento.nombre,
        ruta: documento.archivo.ruta,
        tipoMime: documento.archivo.tipoMime,
      },
    });
  } catch (error) {
    console.error('Error descargando firmado:', error);
    res.status(500).json({ message: 'Error al obtener la copia firmada' });
  }
}
