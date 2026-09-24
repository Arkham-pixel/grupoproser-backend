/**
 * Empalme Mongo ↔ Videoperitaje (SDK preferido; Postgres directo como fallback).
 */
import { normalizarModulo } from './videoperitajeCasoService.js';
import {
  videoperitajePgConfigurado,
  videoperitajePgQuery,
} from '../config/videoperitajePostgres.js';
import {
  videoperitajeSdkConfigurado,
  sdkVerificarCupo,
  sdkRegistrarSesion,
  sdkActualizarSesion,
  sdkEventoSesion,
  sdkPuedeIniciarLlamada,
} from './videoperitajeSdkClient.js';

/**
 * Arnald = UNA empresa (Grupo Proser).
 * Módulos CAT (bbva, zurich, etc.) solo identifican origen en la sesión;
 * cupo/suscripción siempre contra `grupoproser`.
 */
export function moduloACompaniaCodigo(_modulo = '') {
  return 'grupoproser';
}

const MOTIVO_MSG = {
  sin_suscripcion_activa: 'La compañía no tiene suscripción activa de videoperitaje',
  cupo_semanal_agotado: 'Cupo semanal de sesiones agotado para esta compañía',
  max_concurrentes: 'Ya hay el máximo de sesiones simultáneas para esta compañía',
  muy_temprano: 'Aún no es la hora de la videollamada programada',
  ventana_vencida: 'La ventana de la videollamada programada ya venció',
  sesion_cerrada: 'La sesión ya está cerrada',
  sesion_no_encontrada: 'Sesión no encontrada en el SDK',
};

function softLog(err, ctx) {
  console.warn(`[videoperitaje-cupo] ${ctx}:`, err?.message || err);
}

function integracionActiva() {
  return videoperitajeSdkConfigurado() || videoperitajePgConfigurado();
}


async function resolverCompaniaId(codigo) {
  const { rows } = await videoperitajePgQuery(
    `SELECT id FROM videoperitaje.companias
     WHERE codigo = $1 AND activa = TRUE
     LIMIT 1`,
    [codigo]
  );
  return rows[0]?.id || null;
}

async function upsertAuditor({ companiaId, userId, login, nombre, email, telefono }) {
  const loginNorm = String(login || '').trim();
  if (!loginNorm || !companiaId) return null;

  const { rows } = await videoperitajePgQuery(
    `INSERT INTO videoperitaje.auditores
       (compania_id, user_id_arnald, login_arnald, nombre, email, telefono, activo)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     ON CONFLICT (login_arnald) DO UPDATE SET
       user_id_arnald = COALESCE(EXCLUDED.user_id_arnald, videoperitaje.auditores.user_id_arnald),
       nombre = CASE
         WHEN EXCLUDED.nombre <> '' THEN EXCLUDED.nombre
         ELSE videoperitaje.auditores.nombre
       END,
       email = COALESCE(NULLIF(EXCLUDED.email, ''), videoperitaje.auditores.email),
       telefono = COALESCE(NULLIF(EXCLUDED.telefono, ''), videoperitaje.auditores.telefono),
       activo = TRUE,
       updated_at = NOW()
     RETURNING id`,
    [
      companiaId,
      String(userId || '') || null,
      loginNorm,
      String(nombre || '').trim(),
      String(email || '').trim() || null,
      String(telefono || '').trim() || null,
    ]
  );
  return rows[0]?.id || null;
}

/**
 * Chequeo de cupo antes de crear sesión.
 * Preferencia: SDK → Postgres directo → skip (solo Mongo).
 */
export async function verificarCupoCrearSesion(modulo) {
  if (videoperitajeSdkConfigurado()) {
    try {
      const data = await sdkVerificarCupo(modulo);
      if (!data.permitido) {
        return {
          ok: false,
          status: 403,
          code: String(data.motivo || 'CUPO').toUpperCase(),
          error: data.error || MOTIVO_MSG[data.motivo] || 'Cupo no disponible',
          cupo: data.cupo,
        };
      }
      return {
        ok: true,
        via: 'sdk',
        duracionMaxMinutos: Number(data.cupo?.duracion_max_minutos) || 60,
        cupo: data.cupo,
        compania: data.compania,
      };
    } catch (err) {
      softLog(err, 'verificarCupoCrearSesion.sdk');
      return {
        ok: false,
        status: err.status || 503,
        code: err.code || 'VIDEOPERITAJE_SDK_ERROR',
        error: err.message || 'No se pudo validar el cupo vía SDK',
      };
    }
  }

  if (!videoperitajePgConfigurado()) {
    return { ok: true, skipped: true };
  }

  const codigo = moduloACompaniaCodigo(modulo);
  try {
    const companiaId = await resolverCompaniaId(codigo);
    if (!companiaId) {
      return {
        ok: false,
        status: 403,
        code: 'COMPANIA_NO_REGISTRADA',
        error: `Compañía "${codigo}" no está registrada para videoperitaje`,
      };
    }

    const { rows } = await videoperitajePgQuery(
      `SELECT * FROM videoperitaje.puede_iniciar_sesion($1)`,
      [companiaId]
    );
    const cupo = rows[0] || {};
    if (!cupo.permitido) {
      const motivo = String(cupo.motivo || 'sin_suscripcion_activa');
      return {
        ok: false,
        status: 403,
        code: motivo.toUpperCase(),
        error: MOTIVO_MSG[motivo] || 'No se puede iniciar la sesión (cupo)',
        cupo,
        companiaId,
      };
    }

    return {
      ok: true,
      via: 'pg',
      companiaId,
      duracionMaxMinutos: Number(cupo.duracion_max_minutos) || 60,
      cupo,
    };
  } catch (err) {
    softLog(err, 'verificarCupoCrearSesion');
    return {
      ok: false,
      status: 503,
      code: 'VIDEOPERITAJE_PG_ERROR',
      error: 'No se pudo validar el cupo de videoperitaje. Intente de nuevo.',
    };
  }
}

function normalizarCupoRespuesta({
  via,
  permitido,
  motivo,
  plan,
  limite,
  usadas,
  concurrentesMax,
  concurrentesAhora,
  duracionMaxMinutos,
  compania,
  raw,
}) {
  const lim = Math.max(0, Number(limite) || 0);
  const usa = Math.max(0, Number(usadas) || 0);
  const restantes = lim > 0 ? Math.max(0, lim - usa) : null;
  return {
    via,
    permitido: Boolean(permitido),
    motivo: motivo || (permitido ? 'ok' : 'desconocido'),
    plan: plan || null,
    periodo: 'semana',
    limite: lim || null,
    usadas: usa,
    restantes,
    concurrentesMax: Number(concurrentesMax) || null,
    concurrentesAhora: Number(concurrentesAhora) || 0,
    duracionMaxMinutos: Number(duracionMaxMinutos) || 60,
    compania: compania || null,
    mensaje:
      restantes == null
        ? 'Cupo no configurado (sin límite activo).'
        : restantes <= 0
          ? 'Cupo semanal agotado. Renueve o amplíe la suscripción.'
          : `Quedan ${restantes} de ${lim} videoperitajes esta semana.`,
    raw: raw || undefined,
  };
}

/**
 * Estado de cupo/suscripción para mostrar en UI (restantes de la semana).
 * SDK → Postgres → fallback Mongo + env VIDEOPERITAJE_CUPO_SEMANAL.
 */
export async function obtenerEstadoCupo(modulo = 'independiente') {
  const codigo = moduloACompaniaCodigo(modulo);

  if (videoperitajeSdkConfigurado()) {
    try {
      const data = await sdkVerificarCupo(modulo);
      const c = data.cupo || data || {};
      const limite =
        c.sesiones_por_semana ??
        c.sesionesPorSemana ??
        c.limite ??
        c.limit ??
        null;
      const usadas =
        c.sesiones_usadas_semana ??
        c.sesionesUsadasSemana ??
        c.usadas ??
        c.used ??
        0;
      return normalizarCupoRespuesta({
        via: 'sdk',
        permitido: data.permitido !== false,
        motivo: data.motivo || (data.permitido === false ? 'cupo' : 'ok'),
        plan: c.plan_codigo || c.plan || data.plan || null,
        limite,
        usadas,
        concurrentesMax: c.sesiones_concurrentes_max ?? c.concurrentesMax,
        concurrentesAhora: c.sesiones_concurrentes_ahora ?? c.concurrentesAhora,
        duracionMaxMinutos: c.duracion_max_minutos ?? c.duracionMaxMinutos,
        compania: data.compania || { codigo },
        raw: data,
      });
    } catch (err) {
      softLog(err, 'obtenerEstadoCupo.sdk');
      // sigue a PG / mongo
    }
  }

  if (videoperitajePgConfigurado()) {
    try {
      const companiaId = await resolverCompaniaId(codigo);
      if (!companiaId) {
        return normalizarCupoRespuesta({
          via: 'pg',
          permitido: false,
          motivo: 'sin_suscripcion_activa',
          limite: 0,
          usadas: 0,
          compania: { codigo },
        });
      }
      const { rows: vista } = await videoperitajePgQuery(
        `SELECT * FROM videoperitaje.v_cupo_compania WHERE compania_id = $1 LIMIT 1`,
        [companiaId]
      );
      const v = vista[0];
      if (!v) {
        return normalizarCupoRespuesta({
          via: 'pg',
          permitido: false,
          motivo: 'sin_suscripcion_activa',
          limite: 0,
          usadas: 0,
          compania: { codigo, id: companiaId },
        });
      }
      const { rows: okRows } = await videoperitajePgQuery(
        `SELECT * FROM videoperitaje.puede_iniciar_sesion($1)`,
        [companiaId]
      );
      const ok = okRows[0] || {};
      return normalizarCupoRespuesta({
        via: 'pg',
        permitido: Boolean(ok.permitido),
        motivo: ok.motivo || 'ok',
        plan: v.plan_codigo,
        limite: v.sesiones_por_semana,
        usadas: v.sesiones_usadas_semana,
        concurrentesMax: v.sesiones_concurrentes_max,
        concurrentesAhora: v.sesiones_concurrentes_ahora,
        duracionMaxMinutos: v.duracion_max_minutos,
        compania: {
          id: v.compania_id,
          codigo: v.compania_codigo,
          nombre: v.compania_nombre,
        },
        raw: { vista: v, puede: ok },
      });
    } catch (err) {
      softLog(err, 'obtenerEstadoCupo.pg');
    }
  }

  // Fallback Mongo: cuenta sesiones de la semana ISO (no canceladas).
  try {
    const VideoperitajeSesion = (await import('../models/VideoperitajeSesion.js')).default;
    const ahora = new Date();
    const dia = ahora.getUTCDay() || 7; // 1=lun … 7=dom
    const lunes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
    lunes.setUTCDate(lunes.getUTCDate() - (dia - 1));
    lunes.setUTCHours(0, 0, 0, 0);

    const filtroModulo =
      !modulo || modulo === 'independiente'
        ? {}
        : {
            $or: [
              { modulo: normalizarModulo(modulo) },
              { modulo: { $in: ['', 'independiente'] } },
            ],
          };

    const usadas = await VideoperitajeSesion.countDocuments({
      createdAt: { $gte: lunes },
      estado: { $ne: 'cancelada' },
      ...filtroModulo,
    });

    const limiteEnv = Number(process.env.VIDEOPERITAJE_CUPO_SEMANAL || 0);
    const limite = Number.isFinite(limiteEnv) && limiteEnv > 0 ? limiteEnv : null;
    const permitido = limite == null || usadas < limite;

    return normalizarCupoRespuesta({
      via: 'mongo',
      permitido,
      motivo: permitido ? 'ok' : 'cupo_semanal_agotado',
      plan: process.env.VIDEOPERITAJE_PLAN_CODIGO || 'local',
      limite,
      usadas,
      duracionMaxMinutos: Number(process.env.VIDEOPERITAJE_DURACION_MAX_MIN || 60),
      compania: { codigo },
    });
  } catch (err) {
    softLog(err, 'obtenerEstadoCupo.mongo');
    return normalizarCupoRespuesta({
      via: 'none',
      permitido: true,
      motivo: 'sin_control',
      limite: null,
      usadas: 0,
      compania: { codigo },
    });
  }
}

/**
 * Valida fecha/hora programada antes de entrar a la sala.
 */
export async function verificarVentanaLlamada(sesion) {
  if (!sesion?._id) return { ok: true, skipped: true };
  if (!integracionActiva()) return { ok: true, skipped: true };

  // Sin programación → se permite (compatibilidad)
  if (!sesion.programadaAt && !sesion.programada_at) {
    return { ok: true, motivo: 'ok_sin_programacion' };
  }

  if (videoperitajeSdkConfigurado()) {
    try {
      const data = await sdkPuedeIniciarLlamada(String(sesion._id));
      if (!data.permitido) {
        return {
          ok: false,
          status: 403,
          code: String(data.motivo || 'VENTANA').toUpperCase(),
          error: MOTIVO_MSG[data.motivo] || data.error || 'Fuera de la ventana de la videollamada',
          ventana: data,
        };
      }
      return { ok: true, via: 'sdk', ventana: data };
    } catch (err) {
      softLog(err, 'verificarVentanaLlamada.sdk');
      return {
        ok: false,
        status: err.status || 503,
        code: err.code || 'VIDEOPERITAJE_SDK_ERROR',
        error: err.message || 'No se pudo validar la hora de la llamada',
      };
    }
  }

  try {
    const { rows } = await videoperitajePgQuery(
      `SELECT * FROM videoperitaje.puede_iniciar_llamada($1)`,
      [String(sesion._id)]
    );
    const row = rows[0] || {};
    if (!row.permitido) {
      const motivo = String(row.motivo || 'ventana_vencida');
      return {
        ok: false,
        status: 403,
        code: motivo.toUpperCase(),
        error: MOTIVO_MSG[motivo] || 'Fuera de la ventana de la videollamada',
        ventana: row,
      };
    }
    return { ok: true, via: 'pg', ventana: row };
  } catch (err) {
    softLog(err, 'verificarVentanaLlamada.pg');
    return { ok: true, skipped: true, warn: err.message };
  }
}


/**
 * Inserta/actualiza fila de sesión (SDK o Postgres).
 */
export async function registrarSesionPostgres(sesion, { usuario, duracionMaxMinutos } = {}) {
  if (!sesion?._id) return null;

  if (videoperitajeSdkConfigurado()) {
    try {
      const data = await sdkRegistrarSesion({
        mongo_sesion_id: String(sesion._id),
        modulo: sesion.modulo || '',
        caso_id: sesion.casoId ? String(sesion.casoId) : null,
        expediente: sesion.expediente || '',
        siniestro: sesion.siniestro || '',
        livekit_room: sesion.livekitRoom || '',
        origen: 'arnald',
        estado: sesion.estado || 'pendiente',
        duracion_max_minutos: Number(duracionMaxMinutos) || 60,
        programada_at: sesion.programadaAt || sesion.programada_at || null,
        ventana_antes_min: Number(sesion.ventanaAntesMin) || 15,
        ventana_despues_min: Number(sesion.ventanaDespuesMin) || 60,
        notas: sesion.notas || '',
        auditor: {
          user_id: usuario?.id || sesion.peritoUserId,
          login: usuario?.login || sesion.peritoLogin,
          nombre: usuario?.nombre || sesion.peritoNombre,
        },
        asegurado: {
          identificacion: sesion.identificacionAsegurado || '',
          nombre: sesion.aseguradoNombre || '',
          telefono: sesion.celular || '',
          correo: sesion.email || '',
        },
      });
      return data?.data?.id || true;
    } catch (err) {
      softLog(err, 'registrarSesionPostgres.sdk');
      return null;
    }
  }

  if (!videoperitajePgConfigurado()) return null;

  try {
    const codigo = moduloACompaniaCodigo(sesion.modulo);
    const companiaId = await resolverCompaniaId(codigo);
    if (!companiaId) {
      softLog(new Error(`compañía ${codigo} no encontrada`), 'registrarSesionPostgres');
      return null;
    }

    const auditorId = await upsertAuditor({
      companiaId,
      userId: usuario?.id || sesion.peritoUserId,
      login: usuario?.login || sesion.peritoLogin,
      nombre: usuario?.nombre || sesion.peritoNombre,
      email: null,
      telefono: null,
    });

    const { rows } = await videoperitajePgQuery(
      `INSERT INTO videoperitaje.sesiones (
         mongo_sesion_id, modulo, caso_id, expediente, siniestro, livekit_room, origen,
         compania_id, auditor_id,
         identificacion_asegurado, nombre_asegurado, telefono, correo,
         estado, duracion_max_minutos, notas, programada_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'arnald',
         $7, $8,
         $9, $10, $11, $12,
         $13, $14, $15, $16
       )
       ON CONFLICT (mongo_sesion_id) DO UPDATE SET
         modulo = EXCLUDED.modulo,
         caso_id = EXCLUDED.caso_id,
         expediente = EXCLUDED.expediente,
         siniestro = EXCLUDED.siniestro,
         livekit_room = EXCLUDED.livekit_room,
         auditor_id = COALESCE(EXCLUDED.auditor_id, videoperitaje.sesiones.auditor_id),
         identificacion_asegurado = COALESCE(EXCLUDED.identificacion_asegurado, videoperitaje.sesiones.identificacion_asegurado),
         nombre_asegurado = EXCLUDED.nombre_asegurado,
         telefono = EXCLUDED.telefono,
         correo = EXCLUDED.correo,
         estado = EXCLUDED.estado,
         duracion_max_minutos = EXCLUDED.duracion_max_minutos,
         programada_at = COALESCE(EXCLUDED.programada_at, videoperitaje.sesiones.programada_at),
         updated_at = NOW()
       RETURNING id`,
      [
        String(sesion._id),
        String(sesion.modulo || ''),
        sesion.casoId ? String(sesion.casoId) : null,
        String(sesion.expediente || '') || null,
        String(sesion.siniestro || '') || null,
        String(sesion.livekitRoom || '') || null,
        companiaId,
        auditorId,
        String(sesion.identificacionAsegurado || '') || null,
        String(sesion.aseguradoNombre || ''),
        String(sesion.celular || '') || null,
        String(sesion.email || '') || null,
        mapEstado(sesion.estado),
        Number(duracionMaxMinutos) || 60,
        String(sesion.notas || '') || null,
        sesion.programadaAt ? new Date(sesion.programadaAt).toISOString() : null,
      ]
    );

    const pgId = rows[0]?.id;
    if (pgId) {
      await insertarEvento(pgId, 'invite_sent', 'sistema', sesion.peritoLogin, {
        mongo_sesion_id: String(sesion._id),
      });
    }
    return pgId || null;
  } catch (err) {
    softLog(err, 'registrarSesionPostgres');
    return null;
  }
}

function mapEstado(estado) {
  const e = String(estado || 'pendiente');
  if (['pendiente', 'en_proceso', 'finalizada', 'cancelada', 'timeout'].includes(e)) return e;
  return 'pendiente';
}

async function sesionPgIdPorMongo(mongoId) {
  const { rows } = await videoperitajePgQuery(
    `SELECT id FROM videoperitaje.sesiones WHERE mongo_sesion_id = $1 LIMIT 1`,
    [String(mongoId)]
  );
  return rows[0]?.id || null;
}

async function insertarEvento(sesionPgId, tipo, rol, actorLogin, meta = {}) {
  if (!sesionPgId) return;
  await videoperitajePgQuery(
    `INSERT INTO videoperitaje.sesion_eventos (sesion_id, tipo, rol, actor_login, meta)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [sesionPgId, tipo, rol || null, actorLogin || null, JSON.stringify(meta || {})]
  );
}

/**
 * Marca en_proceso + connect (perito o asegurado).
 */
export async function marcarSesionEnProcesoPostgres(sesion, { rol, actorLogin } = {}) {
  if (!sesion?._id) return;

  if (videoperitajeSdkConfigurado()) {
    try {
      const iniciada = sesion.inicio ? new Date(sesion.inicio) : new Date();
      await sdkActualizarSesion(String(sesion._id), {
        estado: 'en_proceso',
        iniciada_at: iniciada.toISOString(),
        livekit_room: sesion.livekitRoom || '',
      });
      await sdkEventoSesion(String(sesion._id), {
        tipo: 'connect',
        rol: rol || 'sistema',
        actor_login: actorLogin,
        meta: { mongo_estado: sesion.estado },
      });
    } catch (err) {
      softLog(err, 'marcarSesionEnProcesoPostgres.sdk');
    }
    return;
  }

  if (!videoperitajePgConfigurado()) return;
  try {
    const iniciada = sesion.inicio ? new Date(sesion.inicio) : new Date();
    const { rows } = await videoperitajePgQuery(
      `UPDATE videoperitaje.sesiones SET
         estado = 'en_proceso',
         iniciada_at = COALESCE(iniciada_at, $2),
         livekit_room = COALESCE(NULLIF($3, ''), livekit_room),
         updated_at = NOW()
       WHERE mongo_sesion_id = $1
       RETURNING id`,
      [String(sesion._id), iniciada.toISOString(), String(sesion.livekitRoom || '')]
    );
    let pgId = rows[0]?.id;
    if (!pgId) {
      pgId = await registrarSesionPostgres(sesion, {});
    }
    await insertarEvento(pgId, 'connect', rol || 'sistema', actorLogin, {
      mongo_estado: sesion.estado,
    });
  } catch (err) {
    softLog(err, 'marcarSesionEnProcesoPostgres');
  }
}

/**
 * Finaliza / cancela / timeout.
 */
export async function cerrarSesionPostgres(sesion, { evento = 'force_end', actorLogin } = {}) {
  if (!sesion?._id) return;

  const estado = mapEstado(sesion.estado);
  const fin = sesion.fin ? new Date(sesion.fin) : new Date();
  const duracion = Number(sesion.duracionSeg) || 0;

  if (videoperitajeSdkConfigurado()) {
    try {
      await sdkActualizarSesion(String(sesion._id), {
        estado,
        finalizada_at: fin.toISOString(),
        duracion_segundos: duracion,
        notas: sesion.notas || '',
      });
      const tipoEvento =
        estado === 'cancelada'
          ? 'force_end'
          : estado === 'timeout'
            ? 'timeout'
            : evento || 'room_closed';
      await sdkEventoSesion(String(sesion._id), {
        tipo: tipoEvento,
        rol: 'auditor',
        actor_login: actorLogin || sesion.peritoLogin,
        cerrar: true,
        estado,
        duracion_segundos: duracion,
        meta: { duracion_segundos: duracion, estado },
      });
    } catch (err) {
      softLog(err, 'cerrarSesionPostgres.sdk');
    }
    return;
  }

  if (!videoperitajePgConfigurado()) return;
  try {
    const { rows } = await videoperitajePgQuery(
      `UPDATE videoperitaje.sesiones SET
         estado = $2,
         finalizada_at = $3,
         duracion_segundos = $4,
         notas = COALESCE(NULLIF($5, ''), notas),
         updated_at = NOW()
       WHERE mongo_sesion_id = $1
       RETURNING id`,
      [String(sesion._id), estado, fin.toISOString(), duracion, String(sesion.notas || '')]
    );

    let pgId = rows[0]?.id;
    if (!pgId) pgId = await sesionPgIdPorMongo(sesion._id);

    const tipoEvento =
      estado === 'cancelada'
        ? 'force_end'
        : estado === 'timeout'
          ? 'timeout'
          : evento || 'room_closed';

    await insertarEvento(pgId, tipoEvento, 'auditor', actorLogin || sesion.peritoLogin, {
      duracion_segundos: duracion,
      estado,
    });

    if (estado === 'finalizada' || estado === 'cancelada' || estado === 'timeout') {
      await insertarEvento(pgId, 'disconnect', 'sistema', actorLogin || sesion.peritoLogin, {
        motivo: estado,
      });
    }
  } catch (err) {
    softLog(err, 'cerrarSesionPostgres');
  }
}
