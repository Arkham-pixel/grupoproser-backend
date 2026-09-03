import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import ZurichCaso from '../models/ZurichCaso.js';
import ZurichListadoCaso from '../models/ZurichListadoCaso.js';
import BbvaCatCaso from '../models/BbvaCatCaso.js';
import BbvaCatListadoCaso from '../models/BbvaCatListadoCaso.js';
import AllianzCaso from '../models/AllianzCaso.js';
import AllianzListadoCaso from '../models/AllianzListadoCaso.js';
import PrevisoraCaso from '../models/PrevisoraCaso.js';
import PrevisoraListadoCaso from '../models/PrevisoraListadoCaso.js';
import EquidadCatCaso from '../models/EquidadCatCaso.js';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import SegurosSuraCaso from '../models/SegurosSuraCaso.js';
import { CONTRATISTAS_MODULO, normalizarRol } from '../config/roles.js';
import {
  coincidenPersonas,
  combinarFiltrosMongo,
  esIdentidadConVistaGlobalAgenda,
  esIdentidadLiderDeModulo,
} from '../utils/permisosCasoPorRol.js';
import { esIdentidadEra, esIdentidadLiderEra } from '../utils/jerarquiaEra.js';
import { construirFiltroVistaEra } from '../utils/alcanceEra.js';
import {
  ConflictoAgendaError,
  fechaAgendaDeCaso,
  franjaValida,
  horaAMinutos,
  minutosAHora,
  normalizarHora,
  normNombrePersona,
  rangosSeSolapan,
  ymdBogota,
} from '../utils/agendaCatastrofico.js';

const PROYECCION = {
  _id: 1,
  consecutivo: 1,
  siniestro: 1,
  zc: 1,
  asegurado: 1,
  ciudad: 1,
  direccionPredio: 1,
  estado: 1,
  ajustador: 1,
  inspector: 1,
  fechaCoordinandoInspeccion: 1,
  fechaInspeccion: 1,
  horaInicioCoordinacion: 1,
  horaFinCoordinacion: 1,
};

export const FUENTES_AGENDA = [
  {
    key: 'zurich',
    etiqueta: 'Zurich',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/zurich/reporte?casoId=${id}`,
    apis: ['/api/zurich'],
    Model: ZurichCaso,
  },
  {
    key: 'zurichListado',
    etiqueta: 'Zurich listado',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/zurich/listado/reporte?casoId=${id}`,
    apis: ['/api/zurich-listado'],
    Model: ZurichListadoCaso,
  },
  {
    key: 'bbvaCat',
    etiqueta: 'BBVA CAT',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/bbva-cat/reporte?casoId=${id}`,
    apis: ['/api/bbva-cat'],
    Model: BbvaCatCaso,
  },
  {
    key: 'bbvaCatListado',
    etiqueta: 'BBVA listado',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/bbva-cat/listado/reporte?casoId=${id}`,
    apis: ['/api/bbva-cat-listado'],
    Model: BbvaCatListadoCaso,
  },
  {
    key: 'allianz',
    etiqueta: 'Allianz',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/allianz/reporte?casoId=${id}`,
    apis: ['/api/allianz'],
    Model: AllianzCaso,
  },
  {
    key: 'allianzListado',
    etiqueta: 'Allianz listado',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/allianz/listado/reporte?casoId=${id}`,
    apis: ['/api/allianz-listado'],
    Model: AllianzListadoCaso,
  },
  {
    key: 'previsora',
    etiqueta: 'Previsora',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/previsora/reporte?casoId=${id}`,
    apis: ['/api/previsora'],
    Model: PrevisoraCaso,
  },
  {
    key: 'previsoraListado',
    etiqueta: 'Previsora listado',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/previsora/listado/reporte?casoId=${id}`,
    apis: ['/api/previsora-listado'],
    Model: PrevisoraListadoCaso,
  },
  {
    key: 'equidadCat',
    etiqueta: 'Equidad CAT',
    fechaCampo: 'fechaCoordinandoInspeccion',
    ruta: (id) => `/equidad-cat/reporte?casoId=${id}`,
    apis: ['/api/equidad-cat'],
    Model: EquidadCatCaso,
  },
  {
    key: 'alfa',
    etiqueta: 'Alfa',
    fechaCampo: 'fechaInspeccion',
    ruta: (id) => `/seguros-alfa/reporte?casoId=${id}`,
    apis: ['/api/seguros-alfa'],
    Model: SegurosAlfaCaso,
  },
  {
    key: 'sura',
    etiqueta: 'Sura',
    fechaCampo: 'fechaInspeccion',
    ruta: (id) => `/sura/reporte?casoId=${id}`,
    apis: ['/api/sura'],
    Model: SegurosSuraCaso,
  },
];

function fuentesParaRol(rol) {
  const config = CONTRATISTAS_MODULO[normalizarRol(rol)];
  if (!config) return FUENTES_AGENDA;
  const apis = new Set(config.apis || []);
  return FUENTES_AGENDA.filter((f) => f.apis.some((api) => apis.has(api)));
}

function ymdMasDias(ymd, dias) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

function filtroFechaMongo(campo, desdeYmd, hastaYmd) {
  const desde = new Date(`${ymdMasDias(desdeYmd, -1)}T00:00:00.000Z`);
  const hasta = new Date(`${ymdMasDias(hastaYmd, 2)}T00:00:00.000Z`);
  return { [campo]: { $gte: desde, $lt: hasta } };
}

function eventoDesdeDoc(doc, fuente) {
  const fecha = doc[fuente.fechaCampo] || fechaAgendaDeCaso(doc);
  const fechaYmd = ymdBogota(fecha);
  if (!fechaYmd) return null;
  const horaInicio = normalizarHora(doc.horaInicioCoordinacion);
  const horaFin = normalizarHora(doc.horaFinCoordinacion);
  const timed = franjaValida(horaInicio, horaFin);
  return {
    id: String(doc._id),
    modulo: fuente.key,
    etiquetaModulo: fuente.etiqueta,
    fecha: fechaYmd,
    horaInicio: timed ? horaInicio : '',
    horaFin: timed ? horaFin : '',
    todoElDia: !timed,
    ajustador: doc.ajustador || '',
    inspector: doc.inspector || '',
    asegurado: doc.asegurado || '',
    ciudad: doc.ciudad || '',
    direccionPredio: doc.direccionPredio || '',
    estado: doc.estado || '',
    consecutivo: doc.consecutivo || '',
    siniestro: doc.siniestro || '',
    zc: doc.zc || '',
    ruta: fuente.ruta(String(doc._id)),
  };
}

function coincidePersona(evento, personaNorm) {
  if (!personaNorm) return true;
  return (
    normNombrePersona(evento.ajustador) === personaNorm ||
    normNombrePersona(evento.inspector) === personaNorm
  );
}

function esRolAgendaGlobal(rol) {
  const r = normalizarRol(rol);
  return r === 'admin' || r === 'soporte';
}

function esVistaAgendaGlobal(identidad = {}) {
  return esRolAgendaGlobal(identidad.rol) || esIdentidadConVistaGlobalAgenda(identidad);
}

function fuentesParaIdentidad(identidad, rolUsuario = '') {
  if (esVistaAgendaGlobal(identidad) || esRolAgendaGlobal(rolUsuario)) return FUENTES_AGENDA;
  return fuentesParaRol(identidad?.rol || rolUsuario);
}

function clavesIdentidadAgenda(identidad = {}) {
  return [...new Set(
    [identidad.name, identidad.nombre, identidad.login, identidad.cedula]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  )];
}

function eventoAsignadoAIdentidad(evento, identidad) {
  const claves = clavesIdentidadAgenda(identidad);
  if (!claves.length) return false;
  return claves.some(
    (k) => coincidenPersonas(evento.ajustador, k) || coincidenPersonas(evento.inspector, k)
  );
}

function filtrarEventosPorIdentidad(eventos, identidad) {
  if (!identidad || esVistaAgendaGlobal(identidad)) return eventos;
  if (esIdentidadEra(identidad)) {
    const vistos = new Set();
    const out = [];
    const liderEra = esIdentidadLiderEra(identidad);
    for (const ev of eventos) {
      const clave = `${ev.modulo}:${ev.id}`;
      if (vistos.has(clave)) continue;
      if (liderEra || eventoAsignadoAIdentidad(ev, identidad)) {
        vistos.add(clave);
        out.push(ev);
      }
    }
    return out;
  }
  const vistos = new Set();
  const out = [];
  for (const ev of eventos) {
    const clave = `${ev.modulo}:${ev.id}`;
    if (vistos.has(clave)) continue;
    if (esIdentidadLiderDeModulo(identidad, ev.modulo) || eventoAsignadoAIdentidad(ev, identidad)) {
      vistos.add(clave);
      out.push(ev);
    }
  }
  return out;
}

export function alcanceAgendaParaIdentidad(identidad) {
  if (!identidad || esVistaAgendaGlobal(identidad)) return 'global';
  if (esIdentidadLiderEra(identidad)) return 'area';
  if (FUENTES_AGENDA.some((f) => esIdentidadLiderDeModulo(identidad, f.key))) return 'area';
  return 'asignados';
}

export async function listarEventosAgenda({
  desde,
  hasta,
  persona = '',
  rolVista = '',
  rolUsuario = '',
  identidad = null,
  filtrarPorIdentidad = true,
} = {}) {
  const desdeYmd = ymdBogota(desde) || ymdBogota(new Date());
  const hastaYmd = ymdBogota(hasta) || desdeYmd;
  const personaNorm = normNombrePersona(persona);
  const fuentes = fuentesParaIdentidad(identidad, rolUsuario);

  const bloques = await Promise.all(
    fuentes.map(async (fuente) => {
      try {
        let filtro = filtroFechaMongo(fuente.fechaCampo, desdeYmd, hastaYmd);
        if (
          esIdentidadEra(identidad) &&
          fuente.key === 'alfa' &&
          !esVistaAgendaGlobal(identidad)
        ) {
          filtro = combinarFiltrosMongo(filtro, await construirFiltroVistaEra());
        }
        const docs = await fuente.Model.find(filtro)
          .select(PROYECCION)
          .lean();
        return docs
          .map((doc) => eventoDesdeDoc(doc, fuente))
          .filter(Boolean)
          .filter((ev) => ev.fecha >= desdeYmd && ev.fecha <= hastaYmd);
      } catch (error) {
        console.error(`❌ Agenda CAT ${fuente.key}:`, error.message);
        return [];
      }
    })
  );

  let eventos = bloques.flat();
  if (filtrarPorIdentidad) {
    eventos = filtrarEventosPorIdentidad(eventos, identidad);
  }
  if (personaNorm) eventos = eventos.filter((ev) => coincidePersona(ev, personaNorm));
  if (rolVista === 'ajustador') eventos = eventos.filter((ev) => ev.ajustador);
  if (rolVista === 'inspector') eventos = eventos.filter((ev) => ev.inspector);

  eventos.sort((a, b) => {
    const fa = `${a.fecha}${a.horaInicio || '00:00'}`;
    const fb = `${b.fecha}${b.horaInicio || '00:00'}`;
    return fa.localeCompare(fb);
  });
  return eventos;
}

export async function disponibilidadAgenda({
  fecha,
  ajustador = '',
  inspector = '',
  excludeId = '',
  rolUsuario = '',
} = {}) {
  const fechaYmd = ymdBogota(fecha);
  if (!fechaYmd) return { fecha: '', ocupados: [], slots: [] };

  const nombres = [ajustador, inspector].map(normNombrePersona).filter(Boolean);
  const eventos = await listarEventosAgenda({
    desde: fechaYmd,
    hasta: fechaYmd,
    rolUsuario,
    filtrarPorIdentidad: false,
  });

  const ocupados = [];
  for (const ev of eventos) {
    if (excludeId && String(ev.id) === String(excludeId)) continue;
    if (ev.todoElDia || !franjaValida(ev.horaInicio, ev.horaFin)) continue;
    const ini = horaAMinutos(ev.horaInicio);
    const fin = horaAMinutos(ev.horaFin);
    const roles = [];
    if (nombres.includes(normNombrePersona(ev.ajustador))) roles.push({ rol: 'ajustador', nombre: ev.ajustador });
    if (nombres.includes(normNombrePersona(ev.inspector))) roles.push({ rol: 'inspector', nombre: ev.inspector });
    if (!nombres.length) continue;
    if (!roles.length) continue;
    ocupados.push({
      ...ev,
      minutosInicio: ini,
      minutosFin: fin,
      personas: roles,
    });
  }

  return { fecha: fechaYmd, ocupados };
}

function personasDePayload(payload = {}) {
  return [payload.ajustador, payload.inspector].map((n) => String(n || '').trim()).filter(Boolean);
}

export async function buscarConflictoAgenda(payload = {}, { excludeId = '', rolUsuario = '' } = {}) {
  const fecha = fechaAgendaDeCaso(payload);
  const fechaYmd = ymdBogota(fecha);
  const horaInicio = normalizarHora(payload.horaInicioCoordinacion);
  const horaFin = normalizarHora(payload.horaFinCoordinacion);
  if (!fechaYmd || !franjaValida(horaInicio, horaFin)) return null;

  const personas = personasDePayload(payload);
  if (!personas.length) return null;

  const { ocupados } = await disponibilidadAgenda({
    fecha: fechaYmd,
    ajustador: payload.ajustador,
    inspector: payload.inspector,
    excludeId,
    rolUsuario,
  });

  const ini = horaAMinutos(horaInicio);
  const fin = horaAMinutos(horaFin);
  const choques = ocupados.filter((ev) => rangosSeSolapan(ini, fin, ev.minutosInicio, ev.minutosFin));
  if (!choques.length) return null;

  const primero = choques[0];
  const quien = primero.personas?.map((p) => p.nombre).join(', ') || 'el equipo';
  return new ConflictoAgendaError(
    `${quien} ya tiene una inspección el ${fechaYmd} de ${primero.horaInicio} a ${primero.horaFin} (${primero.etiquetaModulo} ${primero.consecutivo || primero.siniestro || ''}).`.trim(),
    choques
  );
}

export async function rechazarSiFranjaOcupada(res, payload, opts = {}) {
  const conflicto = await buscarConflictoAgenda(payload, opts);
  if (!conflicto) return false;
  res.status(409).json({
    success: false,
    error: conflicto.message,
    conflictos: conflicto.conflictos || [],
  });
  return true;
}

export async function listarPersonasAgenda(rolUsuario = '') {
  const fuentes = fuentesParaRol(rolUsuario);
  const modulos = new Set(fuentes.map((f) => f.key.replace(/Listado$/, '')));
  const [ajustadores, inspectores] = await Promise.all([
    AjustadorCatastrofico.find().select('nombre ciudad modulos').lean(),
    InspectorCatastrofico.find().select('nombre ciudad modulos').lean(),
  ]);

  const uniq = (lista, rol) => {
    const map = new Map();
    for (const item of lista) {
      const nombre = String(item.nombre || '').trim();
      if (!nombre) continue;
      const clave = normNombrePersona(nombre);
      if (!map.has(clave)) map.set(clave, { nombre, rol, ciudad: item.ciudad || '' });
    }
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  };

  void modulos;
  return {
    ajustadores: uniq(ajustadores, 'ajustador'),
    inspectores: uniq(inspectores, 'inspector'),
  };
}

export function ymdHoyBogota() {
  return ymdBogota(new Date());
}

export { minutosAHora };
