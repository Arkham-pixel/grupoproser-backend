import ExpressCatalogo, { TIPOS } from '../models/ExpressCatalogo.js';
import SiniestroExpress from '../models/SiniestroExpress.js';
import {
  AMPAROS_EXPRESS_DEFAULT,
  ANALISTAS_EXPRESS_DEFAULT,
} from '../constants/expressCatalogoDefaults.js';
import {
  buildMapaCatalogo,
  normCatalogoNombre,
  resolverDesdeMapa,
} from '../utils/expressCatalogoUtils.js';

export { TIPOS };

export async function listarPorTipo(tipo, { soloActivos = true } = {}) {
  const filtro = { tipo };
  if (soloActivos) filtro.activo = true;
  return ExpressCatalogo.find(filtro).sort({ nombre: 1 }).lean();
}

export async function buildCatalogMaps() {
  const items = await ExpressCatalogo.find({ activo: true }).lean();
  const maps = { amparo: new Map(), analista: new Map(), intermediario: new Map() };
  for (const item of items) {
    if (!maps[item.tipo]) continue;
    const clave = normCatalogoNombre(item.nombre);
    if (clave && !maps[item.tipo].has(clave)) {
      maps[item.tipo].set(clave, item.nombre.trim());
    }
  }
  return maps;
}

export async function normalizarCatalogo(tipo, value) {
  if (!value) return null;
  const items = await listarPorTipo(tipo);
  const mapa = buildMapaCatalogo(items);
  return resolverDesdeMapa(mapa, value);
}

export function normalizarConMapas(maps, tipo, value) {
  if (!value || !maps?.[tipo]) return null;
  return resolverDesdeMapa(maps[tipo], value);
}

export async function crearItem({ tipo, nombre }) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) throw new Error('El nombre es obligatorio');
  if (!TIPOS.includes(tipo)) throw new Error('Tipo de catálogo no válido');

  const existente = await ExpressCatalogo.findOne({ tipo, nombre: limpio });
  if (existente) {
    if (!existente.activo) {
      existente.activo = true;
      await existente.save();
      return existente.toObject();
    }
    throw new Error('Ya existe en el catálogo Express');
  }

  const todos = await ExpressCatalogo.find({ tipo }).lean();
  const duplicado = todos.find((i) => normCatalogoNombre(i.nombre) === normCatalogoNombre(limpio));
  if (duplicado) {
    if (!duplicado.activo) {
      await ExpressCatalogo.updateOne({ _id: duplicado._id }, { $set: { activo: true, nombre: limpio } });
      return ExpressCatalogo.findById(duplicado._id).lean();
    }
    throw new Error('Ya existe en el catálogo Express');
  }

  const doc = await ExpressCatalogo.create({ tipo, nombre: limpio, activo: true });
  return doc.toObject();
}

export async function eliminarItem(id) {
  const eliminado = await ExpressCatalogo.findByIdAndDelete(id);
  if (!eliminado) throw new Error('Registro no encontrado');
  return eliminado.toObject();
}

const CAMPO_POR_TIPO = {
  amparo: 'amparo',
  analista: 'analista',
  intermediario: 'intermediario',
};

export async function actualizarItem(id, { nombre }) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) throw new Error('El nombre es obligatorio');

  const item = await ExpressCatalogo.findById(id);
  if (!item) throw new Error('Registro no encontrado');

  const nombreAnterior = item.nombre;
  if (normCatalogoNombre(nombreAnterior) === normCatalogoNombre(limpio)) {
    return item.toObject();
  }

  const todos = await ExpressCatalogo.find({ tipo: item.tipo, _id: { $ne: item._id } }).lean();
  const duplicado = todos.find((i) => normCatalogoNombre(i.nombre) === normCatalogoNombre(limpio));
  if (duplicado) {
    throw new Error('Ya existe otro ítem con ese nombre en el catálogo');
  }

  item.nombre = limpio;
  await item.save();

  const campo = CAMPO_POR_TIPO[item.tipo];
  if (campo && nombreAnterior !== limpio) {
    await SiniestroExpress.updateMany({ [campo]: nombreAnterior }, { $set: { [campo]: limpio } });
  }

  return item.toObject();
}

export async function seedDefaults({ intermediarios = [] } = {}) {
  let creados = 0;
  let reactivados = 0;

  const upsert = async (tipo, nombre) => {
    const limpio = String(nombre).trim();
    if (!limpio) return;
    const existente = await ExpressCatalogo.findOne({ tipo, nombre: limpio });
    if (existente) {
      if (!existente.activo) {
        existente.activo = true;
        await existente.save();
        reactivados += 1;
      }
      return;
    }
    const todos = await ExpressCatalogo.find({ tipo }).lean();
    const dup = todos.find((i) => normCatalogoNombre(i.nombre) === normCatalogoNombre(limpio));
    if (dup) {
      if (!dup.activo) {
        await ExpressCatalogo.updateOne({ _id: dup._id }, { $set: { activo: true } });
        reactivados += 1;
      }
      return;
    }
    await ExpressCatalogo.create({ tipo, nombre: limpio, activo: true });
    creados += 1;
  };

  for (const nombre of AMPAROS_EXPRESS_DEFAULT) await upsert('amparo', nombre);
  for (const nombre of ANALISTAS_EXPRESS_DEFAULT) await upsert('analista', nombre);
  for (const nombre of intermediarios) await upsert('intermediario', nombre);

  return { creados, reactivados };
}
