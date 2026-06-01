import './config/secrets.js';
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { corsMiddleware } from "./config/corsConfig.js";
import { helmetMiddleware, loginRateLimitMiddleware } from "./config/httpSecurity.js";

import authRoutes from "./routes/auth.js";
import securAuthRoutes from "./routes/securAuth.js";
console.log('✅ securAuthRoutes importado:', typeof securAuthRoutes);
import userRoutes from "./routes/user.routes.js";
import securUserSecundarioRoutes from "./routes/securUserSecundario.routes.js";
import siniestroRoutes from "./routes/siniestroRoutes.js";
import ciudadRoutes from './routes/ciudadRoutes.js';
import clientesRoutes from './routes/clientes.js';
import funcionarioAseguradoraRoutes from './routes/funcionarioAseguradora.routes.js';
import responsableRoutes from './routes/responsable.routes.js';
import estadoRoutes from './routes/estado.routes.js';
import complexRoutes from './routes/complex.routes.js';
import tareasRoutes from './routes/tareas.routes.js';
import comunicadosRoutes from './routes/comunicados.routes.js';
import usuariosRoutes from './routes/usuarios.routes.js';
import casosRoutes from './routes/casos.js';
import riesgosRoutes from './routes/riesgos.routes.js';
import historialRoutes from './routes/historial.routes.js';
import alertasRoutes from './routes/alertasRoutes.js';
import funcionarioRoutes from './routes/funcionario.routes.js';
import matrizRiesgoRoutes from './routes/matrizRiesgoRoutes.js';
import intermediarioRoutes from './routes/intermediario.routes.js';
import expressCatalogoRoutes from './routes/expressCatalogo.routes.js';
import siniestroExpressRoutes from './routes/siniestroExpress.routes.js';
import chatgptRoutes from './routes/chatgpt.routes.js';
import inspeccionPropiedadesRoutes from './routes/inspeccionPropiedades.routes.js';
import documentoRoutes from './routes/documento.routes.js';
import healthRoutes from './routes/health.routes.js';
import { UPLOADS_ROOT } from './config/uploadsRoot.js';
import { logStorageStatusOnBoot } from './config/storage.js';

console.log('📦 Importando rutas de intermediarios...');
console.log('📦 Tipo de intermediarioRoutes:', typeof intermediarioRoutes);

const app = express();

// Healthcheck de Coolify/Docker: GET /
// PRUEBA DE SICRONIZACION CON CO0LIFY
app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'grupoproser-backend',
    nota: 'PRUEBA DE SICRONIZACION CON CO0LIFY.',
  });
});

// Tras Nginx/ALB, req.ip usa X-Forwarded-For (necesario para rate limit por IP)
if (process.env.TRUST_PROXY === 'false' || process.env.TRUST_PROXY === '0') {
  // sin proxy delante
} else if (
  process.env.TRUST_PROXY === 'true' ||
  process.env.TRUST_PROXY === '1' ||
  process.env.NODE_ENV === 'production'
) {
  app.set('trust proxy', 1);
}

// CORS: lista explícita; orígenes no permitidos reciben respuesta sin cabeceras CORS válidas
app.use(corsMiddleware());

// Cabeceras seguras (sin CSP estricto: API + SPA en otro origen)
app.use(helmetMiddleware());

// Rate limit solo en POST /login y /login/2fa (desactivar: RATE_LIMIT_DISABLED=true)
app.use(loginRateLimitMiddleware());

// Middleware de logging simplificado
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  // Log especial para rutas de estados
  if (req.url.includes('/api/estados')) {
    console.log(`🔍 Ruta de estados detectada: ${req.method} ${req.url}`);
  }
  next();
});

// Configurar body-parser con límite aumentado para imágenes base64
// Aumentado a 500mb para permitir más de 22 fotos en formularios
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// 2️ Carpeta uploads fija respecto a este proyecto (backend/uploads), no depende del cwd.
const uploadsDir = UPLOADS_ROOT;
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("📁 Carpeta 'uploads/' creada... ✅", uploadsDir);
}
console.log('📁 Sirviendo /uploads desde:', uploadsDir);
logStorageStatusOnBoot();

// 3️ Sirve los archivos subidos de forma estática
// En desarrollo: /uploads desde localhost:3000
// En producción: /uploads desde el mismo dominio del frontend
app.use("/uploads", express.static(uploadsDir));

// Asegurar que también exista la carpeta de historial
const historialUploadsDir = path.join(uploadsDir, "historial");
if (!fs.existsSync(historialUploadsDir)) {
  fs.mkdirSync(historialUploadsDir, { recursive: true });
  console.log("📁 Carpeta 'uploads/historial/' creada... ✅");
}

const expressUploadsDir = path.join(uploadsDir, "express");
if (!fs.existsSync(expressUploadsDir)) {
  fs.mkdirSync(expressUploadsDir, { recursive: true });
  console.log("📁 Carpeta 'uploads/express/' creada... ✅");
}

const documentosUploadsDir = path.join(uploadsDir, "documentos");
if (!fs.existsSync(documentosUploadsDir)) {
  fs.mkdirSync(documentosUploadsDir, { recursive: true });
  console.log("📁 Carpeta 'uploads/documentos/' creada... ✅");
}

// Para producción: también servir archivos estáticos del frontend
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, '../frontend/dist');
  if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    console.log('📁 Frontend estático configurado para producción');
  }
}

// 4️ Monta aquí tus rutas
app.use("/api/auth", authRoutes);
app.use("/api/secur-auth", securAuthRoutes);
console.log('✅ Ruta /api/secur-auth montada');
app.use("/api/usuarios", userRoutes);
app.use("/api", securUserSecundarioRoutes);
app.use("/api/siniestros", siniestroRoutes);
app.use('/api', ciudadRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/funcionarios-aseguradora', funcionarioAseguradoraRoutes);
app.use('/api/responsables', responsableRoutes);
// Registrar rutas de estados con log
console.log('📝 Registrando ruta /api/estados...');
app.use('/api/estados', estadoRoutes);
console.log('✅ Ruta /api/estados registrada exitosamente');
app.use('/api/complex', complexRoutes);
app.use('/api/casos', casosRoutes);
app.use('/api/riesgos', riesgosRoutes);
app.use('/api/tareas', tareasRoutes);
app.use('/api/comunicados', comunicadosRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/historial-formularios', historialRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/funcionarios', funcionarioRoutes);
app.use('/api/matrices-riesgo', matrizRiesgoRoutes);

// Registrar ruta de intermediarios
console.log('📝 Registrando ruta /api/intermediarios...');
try {
  app.use('/api/intermediarios', intermediarioRoutes);
  console.log('✅ Ruta /api/intermediarios registrada exitosamente');
} catch (error) {
  console.error('❌ Error al registrar ruta de intermediarios:', error);
}
app.use('/api/express-catalogos', expressCatalogoRoutes);
app.use('/api/siniestros-express', siniestroExpressRoutes);
app.use('/api/chatgpt', chatgptRoutes);
app.use('/api/inspeccion-propiedades', inspeccionPropiedadesRoutes);
console.log('📝 Registrando ruta /api/documentos...');
app.use('/api/documentos', documentoRoutes);
console.log('✅ Ruta /api/documentos registrada exitosamente');
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '***' : 'NO DEFINIDO');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Configurada' : '❌ No configurada');
console.log('🔧 CORS configurado correctamente');

export default app; 