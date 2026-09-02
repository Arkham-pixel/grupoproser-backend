import SecurUser from '../models/SecurUser.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import NotificacionOperativa from '../models/NotificacionOperativa.js';
import { usuarioActualContexto } from '../middleware/contextoUsuario.js';
import {
  asignacionCambio,
  asignacionQuitada,
  construirContenidoNotificacion,
  destinatariosAsignacion,
  destinatariosCasoNuevo,
  esMismoActor,
  resumenCasoNotificacion,
  valorAsignacionVacio,
} from '../utils/notificacionesOperativasCore.js';

const FLUSH_MS = 400;
const CACHE_MS = 30_000;
const buckets = new Map();

let cacheOp = { at: 0, users: [], ajustadores: [], inspectores: [] };

function notificacionesDesactivadas() {
  return (
    process.env.SKIP_NOTIFICACIONES_OPERATIVAS === '1' ||
    process.env.NODE_ENV === 'test'
  );
}

function leanDoc(doc) {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
}

export async function cargarDatosOperativos(actor = null) {
  const ahora = Date.now();
  if (ahora - cacheOp.at >= CACHE_MS || !cacheOp.users.length) {
    const [users, ajustadores, inspectores] = await Promise.all([
      SecurUser.find({ active: { $ne: 'N' } })
        .select('_id login name role cedula email phone celulares')
        .lean(),
      AjustadorCatastrofico.find({})
        .select('_id nombre codigo email telefono usuarioId userId')
        .lean(),
      InspectorCatastrofico.find({})
        .select('_id nombre codigo email telefono usuarioId userId')
        .lean(),
    ]);
    cacheOp = { at: ahora, users, ajustadores, inspectores };
  }
  const users = [...cacheOp.users];
  if (actor && !users.some((u) => esMismoActor(u, actor))) {
    try {
      const id = actor.id || actor._id;
      const extra = id
        ? await SecurUser.findById(id).select('_id login name role cedula email phone celulares').lean()
        : actor.login
          ? await SecurUser.findOne({ login: actor.login })
              .select('_id login name role cedula email phone celulares')
              .lean()
          : null;
      if (extra) users.push(extra);
    } catch {
      /* sin perfil extra */
    }
  }
  return {
    users,
    ajustadores: cacheOp.ajustadores,
    inspectores: cacheOp.inspectores,
  };
}

function actorDesde(actor) {
  return actor || usuarioActualContexto() || null;
}

function encolar({ recipient, tipo, modulo, caso, actor, campo = '' }) {
  if (!recipient?._id) return;
  if (tipo !== 'asignacion' && esMismoActor(recipient, actor)) return;
  const key = `${recipient._id}|${tipo}|${modulo}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { recipient, tipo, modulo, campo: campo || '', casos: [] };
    buckets.set(key, bucket);
  } else if (bucket.campo && campo && bucket.campo !== campo) {
    bucket.campo = '';
  }
  const resumen = caso ? resumenCasoNotificacion(caso) : null;
  if (resumen?.id && !bucket.casos.some((c) => c.id === resumen.id)) {
    bucket.casos.push(resumen);
  } else if (resumen && !resumen.id) {
    bucket.casos.push(resumen);
  }
  if (bucket.timer) clearTimeout(bucket.timer);
  const flush = () => {
    buckets.delete(key);
    persistirBucket(bucket).catch((err) => {
      console.error('❌ Notificación operativa:', err.message);
    });
  };
  if (tipo === 'asignacion' || tipo === 'desasignacion') {
    flush();
    return;
  }
  bucket.timer = setTimeout(flush, FLUSH_MS);
}

async function persistirBucket(bucket) {
  if (!bucket.casos.length) return;
  const contenido = construirContenidoNotificacion({
    tipo: bucket.tipo,
    modulo: bucket.modulo,
    casos: bucket.casos,
    campo: bucket.campo,
  });
  await NotificacionOperativa.create({
    recipientUserId: String(bucket.recipient._id),
    recipientLogin: String(bucket.recipient.login || ''),
    recipientRole: String(bucket.recipient.role || ''),
    tipo: bucket.tipo,
    modulo: bucket.modulo,
    titulo: contenido.titulo,
    mensaje: contenido.mensaje,
    cantidad: contenido.cantidad,
    ruta: contenido.ruta,
    campoAsignacion: contenido.campo || bucket.campo || '',
    casos: bucket.casos.slice(0, 12),
  });
}

export async function procesarCasoCreado(doc, modulo, actorExplicito = null) {
  if (notificacionesDesactivadas()) return;
  const caso = leanDoc(doc);
  if (!caso) return;
  const actor = actorDesde(actorExplicito);
  const datos = await cargarDatosOperativos(actor);
  for (const lider of destinatariosCasoNuevo(datos.users, modulo, caso, actor)) {
    encolar({ recipient: lider, tipo: 'caso_nuevo', modulo, caso, actor });
  }
  await procesarAsignacionCampos({}, caso, modulo, actor, datos);
}

export async function procesarCambioAsignacion(previo, actual, modulo, actorExplicito = null) {
  if (notificacionesDesactivadas()) return;
  const antes = leanDoc(previo) || {};
  const despues = leanDoc(actual);
  if (!despues) return;
  const actor = actorDesde(actorExplicito);
  const datos = await cargarDatosOperativos(actor);
  await procesarAsignacionCampos(antes, despues, modulo, actor, datos);
}

/** Escrituras nativas (collection.updateOne/insertOne) no disparan hooks de Mongoose. */
export function notificarPersistenciaNativa({ crear = false, previo = null, actual = null, modulo } = {}) {
  if (!modulo || !actual) return;
  const actor = usuarioActualContexto();
  const tarea = crear
    ? procesarCasoCreado(actual, modulo, actor)
    : procesarCambioAsignacion(previo, actual, modulo, actor);
  tarea.catch((err) => {
    console.error('❌ Notificación operativa (persistencia nativa):', err.message);
  });
}

async function procesarAsignacionCampos(antes, despues, modulo, actor, datos = {}) {
  const usuarios = datos.users || [];
  const campos = [
    ['ajustador', despues.ajustador, antes.ajustador, datos.ajustadores || []],
    ['inspector', despues.inspector, antes.inspector, datos.inspectores || []],
  ];
  const yaAsignacion = new Set();
  const yaDesasignacion = new Set();
  for (const [campo, valorNuevo, valorViejo, catalogo] of campos) {
    if (asignacionQuitada(valorViejo, valorNuevo)) {
      const previos = destinatariosAsignacion(usuarios, campo, valorViejo, actor, catalogo);
      if (!previos.length) {
        console.warn(
          `⚠️ Notificación desasignación sin destinatario (${modulo} / ${campo}): "${valorViejo}"`
        );
      }
      for (const persona of previos) {
        const id = String(persona._id || persona.login || '');
        if (!id || yaDesasignacion.has(id)) continue;
        yaDesasignacion.add(id);
        encolar({
          recipient: persona,
          tipo: 'desasignacion',
          modulo,
          caso: despues,
          actor,
          campo,
        });
      }
    }
    if (!asignacionCambio(valorViejo, valorNuevo)) continue;
    if (valorAsignacionVacio(valorNuevo)) continue;
    const destinos = destinatariosAsignacion(usuarios, campo, valorNuevo, actor, catalogo);
    if (!destinos.length) {
      console.warn(
        `⚠️ Notificación asignación sin destinatario (${modulo} / ${campo}): "${valorNuevo}"`
      );
    }
    for (const persona of destinos) {
      const id = String(persona._id || persona.login || '');
      if (!id || yaAsignacion.has(id)) continue;
      yaAsignacion.add(id);
      encolar({
        recipient: persona,
        tipo: 'asignacion',
        modulo,
        caso: despues,
        actor,
        campo,
      });
    }
  }
}

function camposUpdateNotificacion(update = {}) {
  const crudo = update && typeof update === 'object' ? update : {};
  const set = { ...(crudo.$set || {}) };
  for (const [k, v] of Object.entries(crudo)) {
    if (!k.startsWith('$')) set[k] = v;
  }
  return set;
}

export function aplicarPluginNotificacionesOperativas(schema, { modulo } = {}) {
  if (!schema || !modulo) return;
  if (schema._notifOperativasRegistrado) return;
  schema._notifOperativasRegistrado = true;

  schema.post('init', function asignarSnapshotNotif() {
    this.$locals.notifPrevAsign = {
      ajustador: this.ajustador,
      inspector: this.inspector,
      ajustadorLider: this.ajustadorLider,
    };
  });

  schema.pre('save', function marcarNuevoNotif() {
    this.$locals.notifWasNew = this.isNew;
  });

  schema.post('save', function notificarSave(doc) {
    const wasNew = this.$locals?.notifWasNew;
    const prev = this.$locals?.notifPrevAsign;
    if (!wasNew && prev == null) return;
    const moduloDoc = modulo;
    const prevAsign = prev || {};
    const actor = usuarioActualContexto();
    setImmediate(() => {
      const tarea = wasNew
        ? procesarCasoCreado(doc, moduloDoc, actor)
        : procesarCambioAsignacion(prevAsign, doc, moduloDoc, actor);
      tarea.catch((err) => console.error('❌ Hook notificación save:', err.message));
    });
  });

  schema.pre('findOneAndUpdate', async function precargarAsignacionNotif() {
    const set = camposUpdateNotificacion(this.getUpdate() || {});
    const toca = ['ajustador', 'inspector', 'ajustadorLider'].some((c) =>
      Object.prototype.hasOwnProperty.call(set, c)
    );
    if (!toca) {
      this._notifSkip = true;
      return;
    }
    try {
      this._notifPrev = await this.model
        .findOne(this.getQuery())
        .select('ajustador inspector ajustadorLider consecutivo siniestro nmroSinstro zc asegurado')
        .lean();
    } catch {
      this._notifPrev = null;
    }
  });

  schema.post('findOneAndUpdate', function notificarFindOneAndUpdate(doc) {
    if (this._notifSkip) return;
    const prev = this._notifPrev || {};
    const moduloDoc = modulo;
    const eraNuevo = !this._notifPrev;
    const actor = usuarioActualContexto();
    const query = this.getQuery();
    const model = this.model;
    setImmediate(() => {
      (async () => {
        const actual = (await model.findOne(query).lean()) || doc;
        if (!actual) return;
        if (eraNuevo) await procesarCasoCreado(actual, moduloDoc, actor);
        else await procesarCambioAsignacion(prev, actual, moduloDoc, actor);
      })().catch((err) =>
        console.error('❌ Hook notificación findOneAndUpdate:', err.message)
      );
    });
  });

  schema.post('insertMany', function notificarInsertMany(docs) {
    if (!Array.isArray(docs) || !docs.length) return;
    const moduloDoc = modulo;
    const actor = usuarioActualContexto();
    setImmediate(() => {
      Promise.all(docs.map((doc) => procesarCasoCreado(doc, moduloDoc, actor))).catch((err) =>
        console.error('❌ Hook notificación insertMany:', err.message)
      );
    });
  });
}

export async function listarNotificacionesDeUsuario({ userId, login, limit = 40 } = {}) {
  let loginFinal = String(login || '').trim();
  if (userId && !loginFinal) {
    try {
      const u = await SecurUser.findById(userId).select('login cedula').lean();
      loginFinal = String(u?.login || u?.cedula || '').trim();
    } catch {
      loginFinal = '';
    }
  }
  const or = [];
  if (userId) or.push({ recipientUserId: String(userId) });
  if (loginFinal) {
    or.push({ recipientLogin: loginFinal });
    const digits = loginFinal.replace(/\D/g, '');
    if (digits.length >= 5 && digits !== loginFinal) or.push({ recipientLogin: digits });
  }
  if (!or.length) return { total: 0, noLeidas: 0, data: [] };
  const filtro = or.length === 1 ? or[0] : { $or: or };
  const [data, noLeidas] = await Promise.all([
    NotificacionOperativa.find(filtro).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 40, 80)).lean(),
    NotificacionOperativa.countDocuments({ ...filtro, leida: false }),
  ]);
  return { total: data.length, noLeidas, data };
}

export async function marcarNotificacionLeida({ id, userId, login } = {}) {
  const or = [];
  if (userId) or.push({ recipientUserId: String(userId) });
  if (login) or.push({ recipientLogin: String(login) });
  if (!id || !or.length) return null;
  const filtro = { _id: id, ...(or.length === 1 ? or[0] : { $or: or }) };
  return NotificacionOperativa.findOneAndUpdate(
    filtro,
    { $set: { leida: true, leidaEn: new Date() } },
    { new: true }
  ).lean();
}

export async function marcarTodasLeidas({ userId, login } = {}) {
  const or = [];
  if (userId) or.push({ recipientUserId: String(userId) });
  if (login) or.push({ recipientLogin: String(login) });
  if (!or.length) return { modified: 0 };
  const filtro = { leida: false, ...(or.length === 1 ? or[0] : { $or: or }) };
  const res = await NotificacionOperativa.updateMany(filtro, {
    $set: { leida: true, leidaEn: new Date() },
  });
  return { modified: res.modifiedCount || 0 };
}
