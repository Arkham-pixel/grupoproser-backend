import {
  listarEventosAgenda,
  listarPersonasAgenda,
  disponibilidadAgenda,
  ymdHoyBogota,
  alcanceAgendaParaIdentidad,
} from '../services/agendaCatastroficoService.js';
import { ymdBogota } from '../utils/agendaCatastrofico.js';
import { obtenerIdentidadUsuarioReq } from '../utils/permisosCasoPorRol.js';

function rolDeReq(req) {
  return req.user?.role || req.usuario?.role || req.user?.rol || '';
}

export const getEventosAgendaCatastrofico = async (req, res) => {
  try {
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const desde = ymdBogota(req.query.desde) || ymdHoyBogota();
    const hasta = ymdBogota(req.query.hasta) || desde;
    const eventos = await listarEventosAgenda({
      desde,
      hasta,
      persona: req.query.persona || '',
      rolVista: req.query.rol || '',
      rolUsuario: identidad?.rol || rolDeReq(req),
      identidad,
    });
    res.json({
      success: true,
      desde,
      hasta,
      total: eventos.length,
      alcance: alcanceAgendaParaIdentidad(identidad),
      data: eventos,
    });
  } catch (error) {
    console.error('❌ Agenda CAT eventos:', error);
    res.status(500).json({ success: false, error: 'No se pudo cargar la agenda catastrófica' });
  }
};

export const getDisponibilidadAgendaCatastrofico = async (req, res) => {
  try {
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const data = await disponibilidadAgenda({
      fecha: req.query.fecha,
      ajustador: req.query.ajustador || '',
      inspector: req.query.inspector || '',
      excludeId: req.query.excludeId || req.query.casoId || '',
      rolUsuario: identidad?.rol || rolDeReq(req),
    });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('❌ Agenda CAT disponibilidad:', error);
    res.status(500).json({ success: false, error: 'No se pudo consultar la disponibilidad' });
  }
};

export const getHoyAgendaCatastrofico = async (req, res) => {
  try {
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const hoy = ymdHoyBogota();
    const eventos = await listarEventosAgenda({
      desde: hoy,
      hasta: hoy,
      rolUsuario: identidad?.rol || rolDeReq(req),
      identidad,
    });
    res.json({
      success: true,
      fecha: hoy,
      total: eventos.length,
      alcance: alcanceAgendaParaIdentidad(identidad),
      data: eventos,
    });
  } catch (error) {
    console.error('❌ Agenda CAT hoy:', error);
    res.status(500).json({ success: false, error: 'No se pudo cargar la agenda de hoy' });
  }
};

export const getPersonasAgendaCatastrofico = async (req, res) => {
  try {
    const identidad = await obtenerIdentidadUsuarioReq(req);
    const data = await listarPersonasAgenda(identidad?.rol || rolDeReq(req));
    res.json({ success: true, alcance: alcanceAgendaParaIdentidad(identidad), ...data });
  } catch (error) {
    console.error('❌ Agenda CAT personas:', error);
    res.status(500).json({ success: false, error: 'No se pudo cargar el equipo' });
  }
};
