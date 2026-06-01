import './config/loadEnv.js';
import mongoose from "mongoose";
import app from "./app.js";
import path from 'path';
import { fileURLToPath } from 'url';

// Importar modelos para que estén disponibles globalmente
import './models/Responsable.js';
import './models/FuncionarioAseguradora.js';
import './models/Intermediario.js';

// Importar servicios de cron
import { iniciarCronAlertas } from './services/cronAlertasService.js';
import { CronTareasService } from './services/cronTareasService.js';
import { iniciarCronSesiones } from './services/cronSesionesService.js';
import { iniciarCronCambioEstados } from './services/cronCambioEstadosService.js';
import { iniciarCronEmailOutbox } from './services/cronEmailOutboxService.js';
import { iniciarCronExpressCierreMensual } from './services/cronExpressCierreMensualService.js';
import { verifyMailOnStartup } from './services/mailTransport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// app.use(express.static(path.join(__dirname, "frontend", "build")));



// Verificar que las variables se cargaron
console.log('🔧 Variables de entorno cargadas:');
console.log('🔧 NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('📧 EMAIL_USER:', process.env.EMAIL_USER);
console.log('📧 EMAIL_PASS:', process.env.EMAIL_PASS ? '***' : 'NO DEFINIDO');
console.log('🌐 MONGO_URI:', process.env.MONGO_URI ? 'DEFINIDO' : 'NO DEFINIDO');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ La variable de entorno MONGO_URI no está definida.");
  process.exit(1);
}

// Configuración mejorada de MongoDB (opciones actualizadas)
const mongoOptions = {
  serverSelectionTimeoutMS: 10000, // 10 segundos
  socketTimeoutMS: 45000, // 45 segundos
  maxPoolSize: 10,
  minPoolSize: 1,
  maxIdleTimeMS: 30000,
  retryWrites: true,
  w: "majority"
};

// Iniciar el servidor independientemente del estado de MongoDB
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log("⚠️ El servidor iniciará aunque MongoDB no esté disponible");
  await verifyMailOnStartup();
});

// Intentar conectar a MongoDB en segundo plano
mongoose
  .connect(MONGO_URI, mongoOptions)
  .then(() => {
    console.log("✅ Conectado a MongoDB");
    console.log("Usando MONGO_URI:", MONGO_URI);
    
    // Iniciar los servicios de cron después de conectar a MongoDB
    try {
      iniciarCronAlertas();
      console.log("✅ Servicio de cron de alertas iniciado");
      
      // Iniciar cron de tareas
      const cronTareas = CronTareasService.iniciarCronTareas();
      cronTareas.iniciar();
      console.log("✅ Servicio de cron de tareas iniciado");
      
      // Iniciar cron de sesiones inactivas
      iniciarCronSesiones();
      console.log("✅ Servicio de cron de sesiones inactivas iniciado");
      
      // Iniciar cron de cambio automático de estados
      iniciarCronCambioEstados();
      console.log("✅ Servicio de cron de cambio de estados iniciado");

      iniciarCronEmailOutbox();
      console.log("✅ Servicio de cron de cola de correos iniciado");

      iniciarCronExpressCierreMensual();
      console.log("✅ Servicio de cron de cierre mensual Express iniciado");
    } catch (error) {
      console.error("❌ Error iniciando servicios de cron:", error.message);
    }
  })
  .catch((err) => {
    console.error("❌ Error conectando a MongoDB:", err.message);
    console.log("⚠️ El servidor seguirá funcionando sin base de datos");
    console.log("🔄 Intentando reconectar en 30 segundos...");
    
    // Intentar reconectar cada 30 segundos
    const reconnectInterval = setInterval(() => {
      mongoose.connect(MONGO_URI, mongoOptions)
        .then(() => {
          console.log("✅ Reconexión exitosa a MongoDB");
          clearInterval(reconnectInterval);
          
          // Iniciar los servicios de cron después de reconectar
          try {
            iniciarCronAlertas();
            console.log("✅ Servicio de cron de alertas reiniciado después de reconexión");
            
            // Iniciar cron de tareas
            const cronTareas = CronTareasService.iniciarCronTareas();
            cronTareas.iniciar();
            console.log("✅ Servicio de cron de tareas iniciado después de reconexión");
            
            // Iniciar cron de sesiones inactivas
            iniciarCronSesiones();
            console.log("✅ Servicio de cron de sesiones inactivas reiniciado después de reconexión");
            
            // Iniciar cron de cambio automático de estados
            iniciarCronCambioEstados();
            console.log("✅ Servicio de cron de cambio de estados reiniciado después de reconexión");

            iniciarCronExpressCierreMensual();
            console.log("✅ Servicio de cron de cierre mensual Express reiniciado después de reconexión");
          } catch (error) {
            console.error("❌ Error reiniciando servicios de cron:", error.message);
          }
        })
        .catch(() => {
          console.log("🔄 Reintentando conexión a MongoDB...");
        });
    }, 30000);
  });

// Manejar eventos de conexión
mongoose.connection.on('error', (err) => {
  console.error('❌ Error en la conexión de MongoDB:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ Desconectado de MongoDB');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ Reconectado a MongoDB');
});

// Manejar el cierre del servidor
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Cerrando servidor...');
  process.exit(0);
});
