import PuertosCatalogo, { TIPOS } from '../models/PuertosCatalogo.js';
import PuertosActa from '../models/PuertosActa.js';
import { DEFAULTS_POR_TIPO } from '../constants/puertosCatalogoDefaults.js';
import {
  buildMapaCatalogo,
  normCatalogoNombre,
  resolverDesdeMapa,
} from '../utils/puertosCatalogoUtils.js';

export { TIPOS };

export async function listarPorTipo(tipo, { soloActivos = true } = {}) {
  const filtro = { tipo };
  if (soloActivos) filtro.activo = true;
  return PuertosCatalogo.find(filtro).sort({ nombre: 1 }).lean();
}

export async function listarTodos({ soloActivos = true } = {}) {
  const filtro = soloActivos ? { activo: true } : {};
  return PuertosCatalogo.find(filtro).sort({ tipo: 1, nombre: 1 }).lean();
}

export async function normalizarCatalogo(tipo, value) {
  if (!value) return null;
  const items = await listarPorTipo(tipo);
  const mapa = buildMapaCatalogo(items);
  return resolverDesdeMapa(mapa, value);
}

async function upsertNombre(tipo, nombre) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) return;

  const existente = await PuertosCatalogo.findOne({ tipo, nombre: limpio });
  if (existente) {
    if (!existente.activo) {
      existente.activo = true;
      await existente.save();
    }
    return;
  }

  const todos = await PuertosCatalogo.find({ tipo }).lean();
  const duplicado = todos.find((i) => normCatalogoNombre(i.nombre) === normCatalogoNombre(limpio));
  if (duplicado) {
    if (!duplicado.activo) {
      await PuertosCatalogo.updateOne({ _id: duplicado._id }, { $set: { activo: true, nombre: limpio } });
    }
    return;
  }

  await PuertosCatalogo.create({ tipo, nombre: limpio, activo: true });
}

export async function crearItem({ tipo, nombre }) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) throw new Error('El nombre es obligatorio');
  if (!TIPOS.includes(tipo)) throw new Error('Tipo de catálogo no válido');

  const existente = await PuertosCatalogo.findOne({ tipo, nombre: limpio });
  if (existente) {
    if (!existente.activo) {
      existente.activo = true;
      await existente.save();
      return existente.toObject();
    }
    throw new Error('Ya existe en el catálogo de Puertos');
  }

  const todos = await PuertosCatalogo.find({ tipo }).lean();
  const duplicado = todos.find((i) => normCatalogoNombre(i.nombre) === normCatalogoNombre(limpio));
  if (duplicado) {
    if (!duplicado.activo) {
      await PuertosCatalogo.updateOne({ _id: duplicado._id }, { $set: { activo: true, nombre: limpio } });
      return PuertosCatalogo.findById(duplicado._id).lean();
    }
    throw new Error('Ya existe en el catálogo de Puertos');
  }

  const doc = await PuertosCatalogo.create({ tipo, nombre: limpio, activo: true });
  return doc.toObject();
}

export async function eliminarItem(id) {
  const eliminado = await PuertosCatalogo.findByIdAndDelete(id);
  if (!eliminado) throw new Error('Registro no encontrado');
  return eliminado.toObject();
}

const CAMPOS_ACTA_POR_TIPO = {
  regional: 'regional',
  inspector: 'nombreInspector',
  empaque: 'empaque',
  tipo_inspeccion: 'tipoInspeccion',
  aseguradora: 'codiAsgrdra',
  sucursal: 'sucursal',
  estado_acta: 'estado',
};

export async function actualizarItem(id, { nombre }) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) throw new Error('El nombre es obligatorio');

  const item = await PuertosCatalogo.findById(id);
  if (!item) throw new Error('Registro no encontrado');

  const nombreAnterior = item.nombre;
  if (normCatalogoNombre(nombreAnterior) === normCatalogoNombre(limpio)) {
    return item.toObject();
  }

  const todos = await PuertosCatalogo.find({ tipo: item.tipo, _id: { $ne: item._id } }).lean();
  const duplicado = todos.find((i) => normCatalogoNombre(i.nombre) === normCatalogoNombre(limpio));
  if (duplicado) {
    throw new Error('Ya existe otro ítem con ese nombre en el catálogo');
  }

  item.nombre = limpio;
  await item.save();

  const campo = CAMPOS_ACTA_POR_TIPO[item.tipo];
  if (campo && nombreAnterior !== limpio) {
    await PuertosActa.updateMany({ [campo]: nombreAnterior }, { $set: { [campo]: limpio } });
  }

  if (item.tipo === 'tipo_averia' && nombreAnterior !== limpio) {
    await PuertosActa.updateMany(
      { 'detalleInspeccion.tipoAveria': nombreAnterior },
      { $set: { 'detalleInspeccion.tipoAveria': limpio } }
    );
  }

  if (item.tipo === 'tipo_transporte' && nombreAnterior !== limpio) {
    await PuertosActa.updateMany(
      { 'transporteExterior.tipoTransporte': nombreAnterior },
      { $set: { 'transporteExterior.tipoTransporte': limpio } }
    );
  }

  return item.toObject();
}

export async function seedDefaults() {
  let creados = 0;
  let reactivados = 0;

  for (const tipo of TIPOS) {
    const nombres = DEFAULTS_POR_TIPO[tipo] || [];
    for (const nombre of nombres) {
      const limpio = String(nombre).trim();
      if (!limpio) continue;

      const existente = await PuertosCatalogo.findOne({ tipo, nombre: limpio });
      if (existente) {
        if (!existente.activo) {
          existente.activo = true;
          await existente.save();
          reactivados += 1;
        }
        continue;
      }

      const todos = await PuertosCatalogo.find({ tipo }).lean();
      const dup = todos.find((i) => normCatalogoNombre(i.nombre) === normCatalogoNombre(limpio));
      if (dup) {
        if (!dup.activo) {
          await PuertosCatalogo.updateOne({ _id: dup._id }, { $set: { activo: true } });
          reactivados += 1;
        }
        continue;
      }

      await PuertosCatalogo.create({ tipo, nombre: limpio, activo: true });
      creados += 1;
    }
  }

  return { creados, reactivados };
}

export async function asegurarCatalogosIniciales() {
  const total = await PuertosCatalogo.countDocuments();
  if (total === 0) {
    return seedDefaults();
  }
  return { creados: 0, reactivados: 0 };
}
