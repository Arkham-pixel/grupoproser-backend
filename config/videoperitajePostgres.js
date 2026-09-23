/**
 * Pool Postgres para cupos / auditoría de videoperitaje (PostgREST schema).
 * Si VIDEOPERITAJE_PG_ENABLED no es true o faltan credenciales, el módulo
 * sigue en Mongo sin aplicar límites.
 */
import pg from 'pg';

const { Pool } = pg;

let pool = null;
let warnedDisabled = false;

function truthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
}

export function videoperitajePgHabilitado() {
  return truthy(process.env.VIDEOPERITAJE_PG_ENABLED);
}

export function videoperitajePgConfigurado() {
  if (!videoperitajePgHabilitado()) return false;
  if (process.env.VIDEOPERITAJE_PG_URI || process.env.DATABASE_URL) return true;
  return Boolean(process.env.VIDEOPERITAJE_PG_HOST && process.env.VIDEOPERITAJE_PG_DATABASE);
}

function buildPoolConfig() {
  const uri = process.env.VIDEOPERITAJE_PG_URI || process.env.DATABASE_URL;
  if (uri) {
    return {
      connectionString: uri,
      max: Number(process.env.VIDEOPERITAJE_PG_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: truthy(process.env.VIDEOPERITAJE_PG_SSL)
        ? { rejectUnauthorized: false }
        : undefined,
    };
  }
  return {
    host: process.env.VIDEOPERITAJE_PG_HOST || '127.0.0.1',
    port: Number(process.env.VIDEOPERITAJE_PG_PORT || 5432),
    database: process.env.VIDEOPERITAJE_PG_DATABASE,
    user: process.env.VIDEOPERITAJE_PG_USER,
    password: process.env.VIDEOPERITAJE_PG_PASSWORD,
    max: Number(process.env.VIDEOPERITAJE_PG_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    ssl: truthy(process.env.VIDEOPERITAJE_PG_SSL)
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

export function getVideoperitajePgPool() {
  if (!videoperitajePgConfigurado()) {
    if (videoperitajePgHabilitado() && !warnedDisabled) {
      warnedDisabled = true;
      console.warn(
        '[videoperitaje-pg] VIDEOPERITAJE_PG_ENABLED=true pero faltan VIDEOPERITAJE_PG_URI o HOST/DATABASE'
      );
    }
    return null;
  }
  if (!pool) {
    pool = new Pool(buildPoolConfig());
    pool.on('error', (err) => {
      console.error('[videoperitaje-pg] error en pool:', err?.message || err);
    });
  }
  return pool;
}

export async function videoperitajePgQuery(text, params = []) {
  const p = getVideoperitajePgPool();
  if (!p) {
    const err = new Error('Postgres videoperitaje no configurado');
    err.code = 'VIDEOPERITAJE_PG_DISABLED';
    throw err;
  }
  return p.query(text, params);
}
