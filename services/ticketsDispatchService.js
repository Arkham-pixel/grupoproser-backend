import {
  enviarConfirmacionTicketUsuario,
  enviarNotificacionTicketSoporte,
} from './emailService.js';
import { notificarTicketCreado } from './notificacionesOperativasService.js';

/**
 * Despacho independiente de avisos de ticket.
 * Nunca debe tumbar la creación del ticket: errores solo se loguean.
 */
export function despacharAvisosTicketCreado(ticket, actor = null) {
  const payload = ticket?.toObject ? ticket.toObject() : ticket;
  if (!payload?._id) return;

  setImmediate(() => {
    (async () => {
      const resultados = {
        emailSoporte: null,
        emailUsuario: null,
        notificacionLocal: null,
      };

      try {
        resultados.emailSoporte = await enviarNotificacionTicketSoporte(payload);
      } catch (err) {
        console.error('⚠️ [tickets] email soporte falló (se reintentará vía outbox si quedó encolado):', err.message);
        resultados.emailSoporte = { success: false, error: err.message };
      }

      try {
        if (payload.creadoPorEmail) {
          resultados.emailUsuario = await enviarConfirmacionTicketUsuario(payload);
        }
      } catch (err) {
        console.error('⚠️ [tickets] email usuario falló (outbox):', err.message);
        resultados.emailUsuario = { success: false, error: err.message };
      }

      try {
        resultados.notificacionLocal = await notificarTicketCreado(payload, actor);
      } catch (err) {
        console.error('⚠️ [tickets] notificación local falló:', err.message);
        resultados.notificacionLocal = { success: false, error: err.message };
      }

      console.log('📬 [tickets] avisos despachados', {
        numero: payload.numero,
        emailSoporte: resultados.emailSoporte?.success ?? false,
        emailUsuario: resultados.emailUsuario?.success ?? false,
        queuedSoporte: Boolean(resultados.emailSoporte?.queued),
        queuedUsuario: Boolean(resultados.emailUsuario?.queued),
        notifLocal: resultados.notificacionLocal?.creadas ?? 0,
      });
    })().catch((err) => {
      console.error('❌ [tickets] despacho de avisos:', err.message);
    });
  });
}
