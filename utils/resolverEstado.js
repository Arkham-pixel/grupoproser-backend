import Estado from '../models/Estado.js';
import mongoose from 'mongoose';

const COLECCION_ESTADOS = 'gsk3cAppestados';
const CAMPOS_CODIGO = ['codiEstdo', 'codiEstado', 'codi_estdo', 'codi_estado'];
const CAMPOS_DESCRIPCION = ['descEstdo', 'descEstado', 'desc_estdo', 'descripcion'];

function leerDescripcion(doc) {
  if (!doc) return null;
  for (const campo of CAMPOS_DESCRIPCION) {
    const valor = doc[campo];
    if (valor != null && String(valor).trim() !== '') {
      return String(valor).trim();
    }
  }
  return null;
}

function esSoloCodigoNumerico(valor) {
  return /^\d+$/.test(String(valor ?? '').trim());
}

function construirFiltrosPorCodigo(codigoLimpio) {
  const codigoNum = Number(codigoLimpio);
  const filtros = [];

  for (const campo of CAMPOS_CODIGO) {
    filtros.push({ [campo]: codigoLimpio });
    if (!Number.isNaN(codigoNum) && codigoNum > 0) {
      filtros.push({ [campo]: codigoNum });
    }
  }

  return filtros;
}

/**
 * Resuelve el nombre legible de un estado para correos y reportes.
 * Acepta código numérico, descripción ya guardada en el caso o nombre en texto.
 */
export async function resolverNombreEstado({
  codiEstdo,
  estado,
  descripcionEstado,
} = {}) {
  const descGuardada = descripcionEstado != null ? String(descripcionEstado).trim() : '';
  if (descGuardada && !esSoloCodigoNumerico(descGuardada)) {
    return descGuardada;
  }

  const valorEstado = estado != null ? String(estado).trim() : '';
  if (valorEstado && !esSoloCodigoNumerico(valorEstado)) {
    return valorEstado;
  }

  const codigoRaw = codiEstdo ?? estado;
  if (codigoRaw == null || String(codigoRaw).trim() === '') {
    return 'No especificado';
  }

  const codigoLimpio = String(codigoRaw).trim();
  const filtros = construirFiltrosPorCodigo(codigoLimpio);

  let doc = await Estado.findOne({ $or: filtros }).lean();

  if (!doc && mongoose.connection?.db) {
    doc = await mongoose.connection.db
      .collection(COLECCION_ESTADOS)
      .findOne({ $or: filtros });
  }

  const descripcion = leerDescripcion(doc);
  if (descripcion) {
    return descripcion;
  }

  return codigoLimpio;
}
