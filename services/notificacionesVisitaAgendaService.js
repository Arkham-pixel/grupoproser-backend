import NotificacionOperativa from '../models/NotificacionOperativa.js';
import { listarEventosAgenda } from './agendaCatastroficoService.js';
import { cargarDatosOperativos } from './notificacionesOperativasService.js';
import {
  construirContenidoNotificacion,
  destinatariosAsignacion,
  etiquetaCaso,
  valorAsignacionVacio,
} from '../utils/notificacionesOperativasCore.js';
import { instanteBogota, ymdBogota } from '../utils/agendaCatastrofico.js';

function avisosDesactivados() {
  return (
    process.env.SKIP_NOTIFICACIONES_OPERATIVAS === '1' ||
    process.env.NODE_ENV === 'test'
  );
}

export function minutosAnticipacionVisita() {
  const n = Number.parseInt(process.env.NOTIF_VISITA_MINUTOS || '15', 10);
  if (!Number.isFinite(n)) return 15;
  return Math.min(20, Math.max(10, n));
}

export async function emitirAvisosVisitaProximas(ahora = new Date()) {
  if (avisosDesactivados()) return { creadas: 0, revisadas: 0 };
  const anticipacionMin = minutosAnticipacionVisita();
  const hoy = ymdBogota(ahora);
  const eventos = await listarEventosAgenda({ desde: hoy, hasta: hoy });
  const datos = await cargarDatosOperativos();
  let creadas = 0;
  for (const ev of eventos) {
    if (ev.todoElDia || !ev.horaInicio) continue;
    const visitaAt = instanteBogota(ev.fecha, ev.horaInicio);
    if (!visitaAt) continue;
    const avisoAt = new Date(visitaAt.getTime() - anticipacionMin * 60 * 1000);
    if (ahora < avisoAt || ahora >= visitaAt) continue;

    const destinos = new Map();
    const pares = [
      ['ajustador', ev.ajustador, datos.ajustadores],
      ['inspector', ev.inspector, datos.inspectores],
    ];
    for (const [campo, valor, catalogo] of pares) {
      if (valorAsignacionVacio(valor)) continue;
      for (const u of destinatariosAsignacion(datos.users, campo, valor, null, catalogo)) {
        if (!u?._id) continue;
        destinos.set(String(u._id), { u, campo });
      }
    }
    for (const { u, campo } of destinos.values()) {
      const claveDedupe = `visita:${u._id}:${ev.id}:${ev.fecha}:${ev.horaInicio}`;
      const casos = [
        {
          id: String(ev.id || ''),
          etiqueta: etiquetaCaso({
            _id: ev.id,
            consecutivo: ev.consecutivo,
            siniestro: ev.siniestro,
            zc: ev.zc,
            asegurado: ev.asegurado,
          }),
          consecutivo: ev.consecutivo || '',
          siniestro: ev.siniestro || '',
          asegurado: ev.asegurado || '',
          fecha: ev.fecha || '',
          horaInicio: ev.horaInicio || '',
          horaFin: ev.horaFin || '',
        },
      ];
      const contenido = construirContenidoNotificacion({
        tipo: 'visita',
        modulo: ev.modulo,
        casos,
        campo,
        anticipacionMin,
      });
      try {
        await NotificacionOperativa.create({
          recipientUserId: String(u._id),
          recipientLogin: String(u.login || ''),
          recipientRole: String(u.role || ''),
          tipo: 'visita',
          modulo: ev.modulo || 'agenda',
          titulo: contenido.titulo,
          mensaje: contenido.mensaje,
          cantidad: 1,
          ruta: contenido.ruta,
          campoAsignacion: contenido.campo || campo || '',
          claveDedupe,
          casos,
        });
        creadas += 1;
      } catch (err) {
        if (err?.code === 11000) continue;
        console.error('❌ Notificación visita:', err.message);
      }
    }
  }
  return { creadas, revisadas: eventos.length };
}
