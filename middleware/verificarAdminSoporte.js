// middleware/verificarAdminSoporte.js
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/secrets.js";

export function verificarAdminSoporte(req, res, next) {
  console.log('🔐 === VERIFICANDO ADMIN/SOPORTE ===');
  console.log('📡 Método:', req.method);
  console.log('📡 Ruta:', req.path);
  
  const authHeader = req.headers.authorization;
  console.log('📦 Authorization header presente:', !!authHeader);
  console.log('📦 Authorization header:', authHeader ? authHeader.substring(0, 50) + '...' : 'NO');

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log('❌ Token no proporcionado o formato incorrecto');
    return res.status(401).json({ success: false, message: "Token no proporcionado" });
  }

  const token = authHeader.split(" ")[1];
  console.log('🔑 Token extraído (primeros 50 chars):', token ? token.substring(0, 50) + '...' : 'NO');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('✅ Token verificado exitosamente');
    req.user = decoded;
    
    // Verificar que el usuario tenga rol de admin o soporte
    // Buscar el rol en diferentes campos posibles del token (case-insensitive)
    const rolRaw = decoded.rol || decoded.role || decoded.tipoUsuario || '';
    const rol = String(rolRaw).trim().toLowerCase();
    
    console.log('🔍 Verificando permisos - Token decodificado:', {
      id: decoded.id,
      login: decoded.login,
      rolOriginal: decoded.rol,
      roleOriginal: decoded.role,
      tipoUsuarioOriginal: decoded.tipoUsuario,
      rolRaw: rolRaw,
      rolProcesado: rol,
      todosLosCampos: Object.keys(decoded)
    });
    
    // Comparar con diferentes variaciones posibles
    const esAdmin = rol === 'admin' || rol === 'administrador';
    const esSoporte = rol === 'soporte' || rol === 'support';
    
    if (!esAdmin && !esSoporte) {
      console.log('❌ Acceso denegado - Rol detectado:', rol, 'Tipo:', typeof rol);
      return res.status(403).json({ 
        success: false, 
        message: "Acceso denegado. Se requieren permisos de administrador o soporte.",
        debug: {
          rolDetectado: rol,
          rolRaw: rolRaw,
          decoded: {
            rol: decoded.rol,
            role: decoded.role,
            tipoUsuario: decoded.tipoUsuario
          }
        }
      });
    }
    
    console.log('✅ Acceso permitido - Rol:', rol);
    
    next();
  } catch (error) {
    console.error('❌ Error verificando token:', error.message);
    return res.status(403).json({ success: false, message: "Token inválido o expirado", error: error.message });
  }
}

