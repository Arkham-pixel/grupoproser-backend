import ProtocoloSiniestrosConfig from '../models/ProtocoloSiniestrosConfig.js';
import ProtocoloSiniestrosHistorial from '../models/ProtocoloSiniestrosHistorial.js';
import { obtenerProtocoloPorDefecto } from '../config/protocoloSiniestrosDefaults.js';

let cacheProtocolo = null;

function fusionarEtapas(defaults, personalizadas = []) {
  if (!Array.isArray(personalizadas) || personalizadas.length === 0) {
    return defaults;
  }

  const mapa = new Map(defaults.map((e) => [e.id, { ...e }]));

  personalizadas.forEach((etapa) => {
    if (!etapa?.id) return;
    const base = mapa.get(etapa.id) || {};
    mapa.set(etapa.id, {
      ...base,
      ...etapa,
      limite: etapa.limite ? { ...base.limite, ...etapa.limite } : base.limite,
      limiteMaximo: etapa.limiteMaximo
        ? { ...base.limiteMaximo, ...etapa.limiteMaximo }
        : base.limiteMaximo,
    });
  });

  return Array.from(mapa.values()).sort((a, b) => (a.fase || 0) - (b.fase || 0));
}

function fusionarSeguimientos(defaults, personalizados = []) {
  if (!Array.isArray(personalizados) || personalizados.length === 0) {
    return defaults;
  }

  const mapa = new Map(defaults.map((s) => [s.id, { ...s }]));
  personalizados.forEach((seg) => {
    if (!seg?.id) return;
    mapa.set(seg.id, { ...mapa.get(seg.id), ...seg });
  });
  return Array.from(mapa.values());
}

export function invalidarCacheProtocolo() {
  cacheProtocolo = null;
}

export async function obtenerProtocoloActivo() {
  if (cacheProtocolo) return cacheProtocolo;

  const defaults = obtenerProtocoloPorDefecto();
  const almacenado = await ProtocoloSiniestrosConfig.findOne({ clave: 'complex' }).lean();

  if (!almacenado) {
    cacheProtocolo = defaults;
    return cacheProtocolo;
  }

  cacheProtocolo = {
    ...defaults,
    version: almacenado.version || defaults.version,
    fechaActivacion: almacenado.fechaActivacion || defaults.fechaActivacion,
    etapas: fusionarEtapas(defaults.etapas, almacenado.etapas),
    seguimientosRecurrentes: fusionarSeguimientos(
      defaults.seguimientosRecurrentes,
      almacenado.seguimientosRecurrentes
    ),
    actualizadoPor: almacenado.actualizadoPor,
    actualizadoEn: almacenado.actualizadoEn,
  };

  return cacheProtocolo;
}

export async function guardarProtocoloPersonalizado(datos, usuario = 'sistema') {
  const defaults = obtenerProtocoloPorDefecto();

  const payload = {
    clave: 'complex',
    version: datos.version || defaults.version,
    fechaActivacion: datos.fechaActivacion || defaults.fechaActivacion,
    etapas: datos.etapas || defaults.etapas,
    seguimientosRecurrentes: datos.seguimientosRecurrentes || defaults.seguimientosRecurrentes,
    actualizadoPor: usuario,
    actualizadoEn: new Date(),
  };

  await ProtocoloSiniestrosConfig.findOneAndUpdate(
    { clave: 'complex' },
    payload,
    { upsert: true, new: true }
  );

  invalidarCacheProtocolo();
  const activo = await obtenerProtocoloActivo();
  await registrarHistorialProtocolo('actualizacion', usuario, activo);
  return activo;
}

async function registrarHistorialProtocolo(accion, usuario, snapshot) {
  await ProtocoloSiniestrosHistorial.create({
    clave: 'complex',
    version: snapshot?.version,
    accion,
    usuario,
    snapshot,
    cambiosResumen: accion === 'restauracion' ? 'Restauración a valores oficiales' : 'Actualización de plazos',
  });
}

export async function obtenerHistorialProtocolo(limite = 20) {
  return ProtocoloSiniestrosHistorial.find({ clave: 'complex' })
    .sort({ createdAt: -1 })
    .limit(limite)
    .lean();
}

export async function restaurarProtocoloPorDefecto(usuario = 'sistema') {
  await ProtocoloSiniestrosConfig.deleteOne({ clave: 'complex' });
  invalidarCacheProtocolo();
  const activo = await obtenerProtocoloActivo();
  await registrarHistorialProtocolo('restauracion', usuario, activo);
  return activo;
}
