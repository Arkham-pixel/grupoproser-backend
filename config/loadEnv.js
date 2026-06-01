/**
 * Carga backend/.env con ruta fija (no depende del cwd de PM2 ni de dónde se ejecute node).
 * Importar este módulo antes de leer process.env en server.js o en config/secrets.js.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
