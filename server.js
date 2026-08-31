import './config/loadEnv.js';
import './config/mongoDns.js';
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
import { iniciarCronEmailOutbox } from './services/cronEmailOutboxService.js';
import { iniciarCronExpressCierreMensual } from './services/cronExpressCierreMensualService.js';
import { iniciarCronSharePointSync } from './services/cronSharepointSyncService.js';
import { iniciarCronAlfaPolicyImport } from './services/cronAlfaPolicyImportService.js';
import { iniciarCronAlfaExcelSharePointImport } from './services/cronAlfaExcelSharePointImportService.js';
import { iniciarCronAlfaExcelOutbound } from './services/cronAlfaExcelOutboundService.js';
import { iniciarCronEquidadFdmExcelSharePointImport } from './services/cronEquidadFdmExcelSharePointImportService.js';
import { iniciarCronEquidadFdmExcelOutbound } from './services/cronEquidadFdmExcelOutboundService.js';
import { iniciarSharePointWatchdog } from './services/cronSharePointWatchdogService.js';
import { iniciarCronEspejoArchivosBbvaCat } from './services/cronEspejoArchivosBbvaCatService.js';
import { verifyMailOnStartup } from './services/mailTransport.js';
import { verifyS3OnBoot } from './config/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// app.use(express.static(path.join(__dirname, "frontend", "build")));



// Verificar que las variables se cargaron
console.log('🔧 Variables de entorno cargadas:');
console.log('🔧 NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('📧 EMAIL_USER:', process.env.EMAIL_USER);
console.log('📧 EMAIL_PASS:', process.env.EMAIL_PASS ? '***' : 'NO DEFINIDO');
console.log('🌐 MONGO_URI:', process.env.MONGO_URI ? 'DEFINIDO' : 'NO DEFINIDO');

const MONGO_URI = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ La variable de entorno MONGO_URI no está definida.");
  process.exit(1);
}

// maxIdleTimeMS corto cierra sockets y fuerza reconexiones TLS a Atlas (ETIMEDOUT).
const mongoOptions = {
  family: 4,
  serverSelectionTimeoutMS: 20000,
  socketTimeoutMS: 45000,
  maxPoolSize: 30,
  minPoolSize: 2,
  heartbeatFrequencyMS: 10000,
  retryWrites: true,
  retryReads: true,
  w: "majority"
};

let cronsIniciados = false;
const CRON_DELAY_MS = Number.parseInt(process.env.CRON_START_DELAY_MS || '60000', 10);

function iniciarServiciosCron() {
  if (cronsIniciados) {
    console.log('⚠️ Servicios de cron ya estaban iniciados');
    return;
  }
  cronsIniciados = true;
  iniciarCronAlertas();
  console.log("✅ Servicio de cron de alertas iniciado");

  const cronTareas = CronTareasService.iniciarCronTareas();
  cronTareas.iniciar();
  console.log("✅ Servicio de cron de tareas iniciado");

  iniciarCronSesiones();
  console.log("✅ Servicio de cron de sesiones inactivas iniciado");

  iniciarCronEmailOutbox();
  console.log("✅ Servicio de cron de cola de correos iniciado");

  iniciarCronExpressCierreMensual();
  console.log("✅ Servicio de cron de cierre mensual Express iniciado");

  iniciarCronSharePointSync();
  iniciarCronAlfaPolicyImport();
  iniciarCronAlfaExcelSharePointImport();
  iniciarCronAlfaExcelOutbound();
  iniciarCronEquidadFdmExcelSharePointImport();
  iniciarCronEquidadFdmExcelOutbound();
  iniciarSharePointWatchdog();
  iniciarCronEspejoArchivosBbvaCat();
}

// Iniciar el servidor independientemente del estado de MongoDB
const rawPort = process.env.PORT ?? '3000';
const PORT = Number.parseInt(String(rawPort).trim(), 10);
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error(
    `❌ PORT inválido (${JSON.stringify(rawPort)}). Debe ser solo el número del puerto (ej. 3000), no la URI de MongoDB.`
  );
  process.exit(1);
}
if (String(rawPort).trim() !== String(PORT)) {
  console.warn(
    `⚠️ PORT tenía texto extra (${JSON.stringify(rawPort)}); se usa ${PORT}. Revise variables en Coolify.`
  );
}
app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log("⚠️ El servidor iniciará aunque MongoDB no esté disponible");
  await verifyMailOnStartup();
  await verifyS3OnBoot();
});

// Intentar conectar a MongoDB en segundo plano
mongoose
  .connect(MONGO_URI, mongoOptions)
  .then(() => {
    console.log("✅ Conectado a MongoDB");
    (async () => {
      try {
        const db = mongoose.connection.db;
        const existentes = new Set((await db.listCollections().toArray()).map((c) => c.name));
        const pares = [
          ['gsk3cAppalliasCasos', 'gsk3cAppallianzCasos'],
          ['gsk3cAppalliasListadoCasos', 'gsk3cAppallianzListadoCasos'],
        ];
        for (const [origen, destino] of pares) {
          if (existentes.has(origen) && !existentes.has(destino)) {
            await db.collection(origen).rename(destino);
            console.log(`📦 Colección ${origen} → ${destino}`);
          }
        }
      } catch (error) {
        console.warn('No se pudieron renombrar colecciones Allias → Allianz:', error.message);
      }
    })();

    const delayMs = Number.isFinite(CRON_DELAY_MS) ? Math.max(0, CRON_DELAY_MS) : 60000;
    if (delayMs > 0) {
      console.log(`⏳ Crons en ${Math.round(delayMs / 1000)}s para no saturar Mongo al arrancar`);
      setTimeout(() => {
        try {
          iniciarServiciosCron();
        } catch (error) {
          console.error("❌ Error iniciando servicios de cron:", error.message);
          cronsIniciados = false;
        }
      }, delayMs);
    } else {
      try {
        iniciarServiciosCron();
      } catch (error) {
        console.error("❌ Error iniciando servicios de cron:", error.message);
        cronsIniciados = false;
      }
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

          try {
            iniciarServiciosCron();
          } catch (error) {
            console.error("❌ Error reiniciando servicios de cron:", error.message);
            cronsIniciados = false;
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
function esErrorPoolMongo(err) {
  const name = String(err?.name || '');
  const msg = String(err?.message || '');
  return (
    name.includes('PoolCleared') ||
    name.includes('MongoNetwork') ||
    name.includes('MongoServerSelection') ||
    msg.includes('PoolCleared') ||
    msg.includes('connection pool') ||
    msg.includes('ReplicaSetNoPrimary')
  );
}

process.on('uncaughtException', (err) => {
  if (esErrorPoolMongo(err)) {
    console.error('⚠️ Mongo cortó el pool; el API sigue en pie:', err.message);
    return;
  }
  console.error('❌ uncaughtException:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  if (esErrorPoolMongo(err)) {
    console.error('⚠️ Mongo rechazó una operación; el API sigue en pie:', err.message);
    return;
  }
  console.error('❌ unhandledRejection:', reason);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Cerrando servidor...');
  process.exit(0);
});
