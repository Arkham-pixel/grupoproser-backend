import {
  esSupervisorBandejaFacturacion,
  resolverGerenteDesdeLogin,
} from '../config/gerentesFacturacion.js';

export function loginDesdeUsuario(usuario) {
  return String(usuario?.login || usuario?.cedula || '').trim();
}

/** Todos los identificadores posibles del usuario (login, cédula, etc.). */
export function loginsDesdeUsuario(usuario) {
  const out = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  add(usuario?.login);
  add(usuario?.cedula);
  add(usuario?.codiRespnsble);
  add(usuario?.documento);
  return out;
}

export function rolDesdeUsuario(usuario) {
  return String(usuario?.rol || usuario?.role || usuario?.tipoUsuario || '')
    .trim()
    .toLowerCase();
}

/** Admin, administrador o roles de gerencia/gerente; también jefes de facturación y supervisor. */
export function esAdminOGerencia(usuario) {
  if (!usuario) return false;
  const rol = rolDesdeUsuario(usuario);
  if (
    rol === 'admin' ||
    rol === 'administrador' ||
    rol === 'gerencia' ||
    rol === 'gerente' ||
    rol.includes('gerencia')
  ) {
    return true;
  }
  const login = loginDesdeUsuario(usuario);
  if (!login) return false;
  if (esSupervisorBandejaFacturacion(login)) return true;
  return Boolean(resolverGerenteDesdeLogin(login));
}

/** Puede crear / reasignar / cancelar subtareas del caso. */
export function puedeGestionarSubtareasCaso(usuario, caso) {
  if (!usuario || !caso) return false;
  if (esAdminOGerencia(usuario)) return true;
  const login = loginDesdeUsuario(usuario);
  const codi = String(caso.codiRespnsble || '').trim();
  return Boolean(login && codi && login === codi);
}

/** Asignado interno de la subtarea. */
export function esAsignadoInterno(usuario, subtarea) {
  if (!usuario || !subtarea || subtarea.tipoAsignado !== 'interno') return false;
  const codi = String(subtarea.codiAsignado || '').trim();
  if (!codi) return false;
  const candidatos = loginsDesdeUsuario(usuario).map((l) => l.toLowerCase());
  return candidatos.includes(codi.toLowerCase());
}

export function puedeVerSubtarea(usuario, caso, subtarea) {
  if (!usuario) return false;
  if (puedeGestionarSubtareasCaso(usuario, caso)) return true;
  return esAsignadoInterno(usuario, subtarea);
}

export function puedeTrabajarSubtareaInterna(usuario, caso, subtarea) {
  if (!usuario || !subtarea) return false;
  if (puedeGestionarSubtareasCaso(usuario, caso)) return true;
  return esAsignadoInterno(usuario, subtarea);
}

/** Semáforo operativo de la subtarea. */
export function semaforoSubtarea(subtarea, ahora = new Date()) {
  const estado = String(subtarea?.estado || '');
  if (estado === 'completada') return 'verde';
  if (estado === 'cancelada') return 'gris';

  if (subtarea?.fechaLimite) {
    const limite = new Date(subtarea.fechaLimite);
    if (!Number.isNaN(limite.getTime()) && limite < ahora) return 'rojo';
    const msRestantes = limite.getTime() - ahora.getTime();
    const tresDias = 3 * 24 * 60 * 60 * 1000;
    if (msRestantes <= tresDias) return 'amarillo';
  }

  if (estado === 'en_progreso') return 'amarillo';
  return 'verde';
}

function msATextoDuracion(ms) {
  if (ms == null || Number.isNaN(Number(ms)) || ms < 0) return null;
  const totalMin = Math.round(Number(ms) / 60000);
  if (totalMin < 1) return 'menos de 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const horas = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (horas < 48) {
    return mins > 0 ? `${horas} h ${mins} min` : `${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  const horasRest = horas % 24;
  return horasRest > 0 ? `${dias} d ${horasRest} h` : `${dias} d`;
}

/**
 * Calcula duraciones para control de horas / auditoría.
 * - asignación: desde creación hasta completar (o ahora si sigue abierta)
 * - trabajo: desde primer trabajo hasta completar (o ahora)
 */
export function calcularDuracionesSubtarea(subtarea, ahora = new Date()) {
  const created = subtarea?.createdAt ? new Date(subtarea.createdAt) : null;
  const inicio =
    subtarea?.fechaInicioTrabajo
      ? new Date(subtarea.fechaInicioTrabajo)
      : created;
  const fin =
    subtarea?.estado === 'completada' && subtarea?.fechaCompletada
      ? new Date(subtarea.fechaCompletada)
      : ['pendiente', 'en_progreso'].includes(String(subtarea?.estado || ''))
        ? ahora
        : null;

  const duracionAsignacionMs =
    subtarea?.duracionAsignacionMs != null && subtarea.estado === 'completada'
      ? Number(subtarea.duracionAsignacionMs)
      : created && fin
        ? fin.getTime() - created.getTime()
        : null;

  const duracionTrabajoMs =
    subtarea?.duracionTrabajoMs != null && subtarea.estado === 'completada'
      ? Number(subtarea.duracionTrabajoMs)
      : inicio && fin
        ? fin.getTime() - inicio.getTime()
        : null;

  return {
    duracionAsignacionMs,
    duracionTrabajoMs,
    duracionAsignacionTexto: msATextoDuracion(duracionAsignacionMs),
    duracionTrabajoTexto: msATextoDuracion(duracionTrabajoMs),
  };
}

export function enriquecerSubtarea(subtarea) {
  const obj = typeof subtarea?.toObject === 'function' ? subtarea.toObject() : { ...subtarea };
  delete obj.tokenHash;
  const duraciones = calcularDuracionesSubtarea(obj);
  return {
    ...obj,
    ...duraciones,
    semaforo: semaforoSubtarea(obj),
    vencida:
      Boolean(obj.fechaLimite) &&
      !['completada', 'cancelada'].includes(obj.estado) &&
      new Date(obj.fechaLimite) < new Date(),
  };
}
