/**
 * Carga backend/.env con ruta fija (no depende del cwd de PM2 ni de dónde se ejecute node).
 * Importar este módulo antes de leer process.env en server.js o en config/secrets.js.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
const alreadyProd = (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
// En local el .env manda (evita túneles/URLs viejas de la sesión).
// En Coolify no pisa las variables que inyecta el panel.
dotenv.config({ path: envPath, override: !alreadyProd });

if (process.env.NODE_ENV) {
  process.env.NODE_ENV = process.env.NODE_ENV.trim();
}
