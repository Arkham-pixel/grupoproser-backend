import EquidadFdmCaso from '../models/EquidadFdmCaso.js';

const esValorVacio = (valor) =>
  valor === undefined || valor === null || valor === '' || valor === 'null' || valor === 'undefined';

const esPlaceholderFdm = (valor) => {
  if (esValorVacio(valor)) return true;
  if (valor instanceof Date) return Number.isNaN(valor.getTime());
  if (typeof valor === 'number') return !Number.isFinite(valor);
  const t = String(valor)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!t) return true;
  return /^(N\/?A|NA|NULL|UNDEFINED|-|SIN DATO)$/i.test(t);
};

const mergeCampoFdm = (incoming, existing) => {
  if (!esPlaceholderFdm(incoming)) return incoming;
  if (!esPlaceholderFdm(existing)) return existing;
  if (!esValorVacio(incoming)) return incoming;
  return existing ?? null;
};

const normClaveFdm = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const soloDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

const cedulaClaveFdm = (valor) => soloDigitos(valor);

const celularClaveFdm = (valor) => {
  const d = soloDigitos(valor);
  if (d.length > 10) return d.slice(-10);
  return d;
};

const direccionClaveFdm = (valor) =>
  normClaveFdm(valor)
    .replace(/[#.,;:\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const calidadCedulaFdm = (valor) => {
  const d = soloDigitos(valor);
  if (!d || /^0+$/.test(d)) return 0;
  if (d.length >= 6 && d.length <= 10) return 20 + d.length;
  if (d.length > 10) return 10;
  return d.length;
};

export const elegirMejorCedulaFdm = (incoming, existing) => {
  const ca = calidadCedulaFdm(incoming);
  const cb = calidadCedulaFdm(existing);
  if (ca === 0 && cb === 0) return mergeCampoFdm(incoming, existing);
  if (ca > cb) return esPlaceholderFdm(incoming) ? existing : incoming;
  if (cb > ca) return esPlaceholderFdm(existing) ? incoming : existing;
  return esPlaceholderFdm(existing) ? incoming : existing;
};

const elegirMejorNombreFdm = (incoming, existing) => {
  if (esPlaceholderFdm(incoming)) return existing ?? incoming;
  if (esPlaceholderFdm(existing)) return incoming;
  const ni = normClaveFdm(incoming);
  const ne = normClaveFdm(existing);
  if (ni.length === ne.length) return existing;
  return ni.length > ne.length ? incoming : existing;
};

const elegirMejorCelularFdm = (incoming, existing) => {
  const puntaje = (valor) => {
    const d = celularClaveFdm(valor);
    if (!d) return 0;
    if (d.length === 10 && d.startsWith('3')) return 30;
    if (d.length === 10) return 20;
    return d.length;
  };
  const pa = puntaje(incoming);
  const pb = puntaje(existing);
  if (pa === 0 && pb === 0) return mergeCampoFdm(incoming, existing);
  if (pa > pb) return incoming;
  if (pb > pa) return existing;
  return esPlaceholderFdm(existing) ? incoming : existing;
};

export const eventoClaveFdm = (caso = {}) => {
  const evento = normClaveFdm(caso.evento);
  if (evento) return evento;
  const cobertura = normClaveFdm(caso.cobertura);
  if (cobertura === 'TEMBLOR' || cobertura === 'TERREMOTO') return 'TERREMOTO 10 AGOSTO 2026';
  if (cobertura === 'ANEGACION') return 'OLA INVERNAL';
  const fecha = caso.fechaRegistro instanceof Date
    ? caso.fechaRegistro
    : caso.fechaRegistro
      ? new Date(caso.fechaRegistro)
      : null;
  if (fecha && !Number.isNaN(fecha.getTime()) && fecha >= new Date(2026, 7, 10)) {
    return 'TERREMOTO 10 AGOSTO 2026';
  }
  return 'OLA INVERNAL';
};

/**
 * Deduplica por evento + identidad. Un mismo asegurado en ola invernal y terremoto
 * son dos casos distintos; no se pisan entre sí.
 *
 * La cédula se compara solo con dígitos (1.234.567 === 1234567).
 * Nombre+dirección y nombre+celular se usan aunque haya cédula, para unir
 * la misma persona con la identificación mal escrita y luego la correcta.
 */
export const clavesDeduplicacionFdm = (caso = {}) => {
  const claves = [];
  const evento = eventoClaveFdm(caso);
  const cedula = cedulaClaveFdm(caso.cedula);
  const siniestro = normClaveFdm(caso.siniestro);
  const nroCaso = normClaveFdm(caso.caso);
  const poliza = normClaveFdm(caso.polizaAfectar);
  const direccion = direccionClaveFdm(caso.direccionAfectada);
  const nombre = normClaveFdm(caso.nombre);
  const celular = celularClaveFdm(caso.celular);

  if (siniestro) claves.push(`E:${evento}|S:${siniestro}`);
  if (nroCaso) claves.push(`E:${evento}|C:${nroCaso}`);
  if (cedula && poliza) claves.push(`E:${evento}|I:${cedula}|P:${poliza}`);
  if (cedula.length >= 6) claves.push(`E:${evento}|I:${cedula}`);
  if (cedula.length >= 6 && direccion) claves.push(`E:${evento}|I:${cedula}|D:${direccion}`);
  if (nombre && nombre !== 'SIN NOMBRE' && direccion) claves.push(`E:${evento}|N:${nombre}|D:${direccion}`);
  if (nombre && nombre !== 'SIN NOMBRE' && celular.length >= 7) claves.push(`E:${evento}|N:${nombre}|T:${celular}`);
  return claves;
};

const cedulasCompatiblesFdm = (a, b) => {
  const da = cedulaClaveFdm(a);
  const db = cedulaClaveFdm(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length < 5 || db.length < 5) return false;
  const [corta, larga] = da.length <= db.length ? [da, db] : [db, da];
  return larga.includes(corta) && larga.length - corta.length <= 2;
};

const tokensNombreFdm = (valor) =>
  normClaveFdm(valor)
    .split(' ')
    .filter((t) => t && t !== 'SIN' && t !== 'NOMBRE' && t.length > 1);

const nombresEquivalentesFdm = (a, b) => {
  const na = normClaveFdm(a);
  const nb = normClaveFdm(b);
  if (!na || !nb || na === 'SIN NOMBRE' || nb === 'SIN NOMBRE') return false;
  if (na === nb) return true;
  const ta = tokensNombreFdm(a);
  const tb = tokensNombreFdm(b);
  if (ta.length < 3 || tb.length < 3) return false;
  if (Math.abs(ta.length - tb.length) > 1) return false;
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const setB = new Set(tb);
  const comunes = ta.filter((t) => setB.has(t)).length;
  return comunes >= Math.min(ta.length, tb.length) - 1 && comunes >= 2;
};

const identidadPobreFdm = (caso = {}) =>
  !cedulaClaveFdm(caso.cedula) && celularClaveFdm(caso.celular).length < 7;

export const sonElMismoCasoFdm = (a = {}, b = {}) => {
  if (!a || !b) return false;
  if (eventoClaveFdm(a) !== eventoClaveFdm(b)) return false;

  const cedA = cedulaClaveFdm(a.cedula);
  const cedB = cedulaClaveFdm(b.cedula);
  if (cedA.length >= 6 && cedA === cedB) return true;

  const nomExacto = nombresEquivalentesFdm(a.nombre, b.nombre) && normClaveFdm(a.nombre) === normClaveFdm(b.nombre);
  const nomParecido = nombresEquivalentesFdm(a.nombre, b.nombre);
  if (!nomParecido) return false;

  const dirA = direccionClaveFdm(a.direccionAfectada);
  const dirB = direccionClaveFdm(b.direccionAfectada);
  const telA = celularClaveFdm(a.celular);
  const telB = celularClaveFdm(b.celular);
  const mismoTel = telA.length >= 7 && telA === telB;
  const mismaDir = Boolean(dirA) && dirA === dirB;
  const conflictoCedula =
    cedA.length >= 6 && cedB.length >= 6 && !cedulasCompatiblesFdm(a.cedula, b.cedula);

  if (conflictoCedula) return false;
  if (cedulasCompatiblesFdm(a.cedula, b.cedula) && nomParecido) return true;
  if (nomExacto && mismoTel) return true;
  if (nomExacto && mismaDir) return true;
  if (nomExacto && tokensNombreFdm(a.nombre).length >= 3) return true;
  if (!nomExacto && nomParecido && (identidadPobreFdm(a) || identidadPobreFdm(b) || mismoTel || mismaDir)) {
    return true;
  }
  return false;
};

const buscarPorIdentidadFdm = (payload, existentes) => {
  for (const doc of existentes) {
    if (sonElMismoCasoFdm(payload, doc)) return doc;
  }
  return null;
};

const camposLlenosFdm = (caso = {}) =>
  ['nombre', 'cedula', 'celular', 'direccionAfectada', 'municipio', 'oficinaRadicadora'].filter(
    (campo) => !esPlaceholderFdm(caso[campo])
  ).length;

const elegirKeeperFdm = (a, b) => {
  if (a.liquidador && !b.liquidador) return a;
  if (b.liquidador && !a.liquidador) return b;
  const ca = calidadCedulaFdm(a.cedula);
  const cb = calidadCedulaFdm(b.cedula);
  if (ca !== cb) return ca > cb ? a : b;
  const fa = camposLlenosFdm(a);
  const fb = camposLlenosFdm(b);
  if (fa !== fb) return fa > fb ? a : b;
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return ta <= tb ? a : b;
};

export const fusionarDuplicadosExistentesFdm = async () => {
  let fusionados = 0;
  let cambio = true;
  while (cambio) {
    cambio = false;
    const docs = await EquidadFdmCaso.find().lean();
    outer: for (let i = 0; i < docs.length; i += 1) {
      for (let j = i + 1; j < docs.length; j += 1) {
        if (!sonElMismoCasoFdm(docs[i], docs[j])) continue;
        const keeper = elegirKeeperFdm(docs[i], docs[j]);
        const other = String(keeper._id) === String(docs[i]._id) ? docs[j] : docs[i];
        const merge = mergeImportacionFdm(other, keeper);
        await EquidadFdmCaso.findByIdAndUpdate(keeper._id, merge);
        await EquidadFdmCaso.findByIdAndDelete(other._id);
        fusionados += 1;
        cambio = true;
        break outer;
      }
    }
  }
  return fusionados;
};

const CAMPOS_MERGE_FDM = [
  'numero',
  'evento',
  'nombre',
  'cedula',
  'celular',
  'direccionAfectada',
  'municipio',
  'departamento',
  'oficinaRadicadora',
  'fechaRegistro',
  'ajustador',
  'aif',
  'polizaDanosVigente',
  'polizaAfectar',
  'orden',
  'vigenciaPoliza',
  'afectacionesAnteriores',
  'siniestroIndemnizado',
  'valorEdificio',
  'valorContenido',
  'valoresIndemnizables',
  'subsidioEmpresarial',
  'cobertura',
  'primas',
  'tipoNegocio',
  'perdidaContenidos',
  'perdidaEdificio',
  'totalPerdida',
  'deducible',
  'totalLiquidado',
  'subsidio',
  'valorIndemnizadoAjustador',
  'caso',
  'siniestro',
  'fechaLiquidacion',
  'fechaAviso',
  'valorObjecion',
  'fechaCausacion',
  'valorIndemnizado',
  'fechaGiro',
  'estado',
  'observaciones',
  'detalle',
];

const mergeImportacionFdm = (incomingPayload = {}, existente = {}) => {
  const out = {
    consecutivo: existente.consecutivo || null,
    liquidador: existente.liquidador ?? null,
    esNuevo: existente.esNuevo === true,
  };
  for (const campo of CAMPOS_MERGE_FDM) {
    if (campo === 'cedula' || campo === 'nombre' || campo === 'celular') continue;
    out[campo] = mergeCampoFdm(incomingPayload[campo], existente[campo]);
  }
  out.cedula = elegirMejorCedulaFdm(incomingPayload.cedula, existente.cedula);
  out.nombre = elegirMejorNombreFdm(incomingPayload.nombre, existente.nombre);
  out.celular = elegirMejorCelularFdm(incomingPayload.celular, existente.celular);
  return out;
};

const indexarClavesFdm = (indice, doc) => {
  for (const clave of clavesDeduplicacionFdm(doc)) {
    indice.set(clave, doc);
  }
};

const localizarExistenteFdm = (payload, indice, existentes) => {
  for (const clave of clavesDeduplicacionFdm(payload)) {
    if (indice.has(clave)) return indice.get(clave);
  }
  return buscarPorIdentidadFdm(payload, existentes);
};

/**
 * Une filas del mismo Excel que son la misma persona (cédula distinta / mal escrita).
 */
export const colapsarFilasDuplicadasFdm = (filas = []) => {
  const indice = new Map();
  const grupos = [];
  let fusionados = 0;

  for (const fila of filas) {
    const payload = { ...(fila || {}) };
    if (!payload.evento) payload.evento = eventoClaveFdm(payload);

    const existente = localizarExistenteFdm(payload, indice, grupos);
    if (existente) {
      Object.assign(existente, mergeImportacionFdm(payload, existente));
      fusionados += 1;
      indexarClavesFdm(indice, existente);
    } else {
      grupos.push(payload);
      indexarClavesFdm(indice, payload);
    }
  }

  return { filas: grupos, fusionados };
};

const obtenerMaxSecuencialFdm = async () => {
  const patron = /^FDM-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await EquidadFdmCaso.find({
    consecutivo: { $exists: true, $nin: [null, ''] },
  })
    .select('consecutivo')
    .lean();

  let maxSecuencial = 0;
  for (const reg of registros) {
    const match = String(reg.consecutivo || '').trim().match(patron);
    if (match?.[3]) {
      const n = parseInt(match[3], 10);
      if (!Number.isNaN(n) && n > maxSecuencial) maxSecuencial = n;
    }
  }
  return maxSecuencial;
};

/**
 * Crea o actualiza sin borrar la colección.
 * Los registros creados en esta corrida quedan marcados como esNuevo.
 */
export const ejecutarImportacionFdm = async (filas = []) => {
  const { filas: filasUnicas, fusionados } = colapsarFilasDuplicadasFdm(filas);

  const existentes = await EquidadFdmCaso.find().lean();
  const indice = new Map();
  for (const doc of existentes) {
    indexarClavesFdm(indice, doc);
  }

  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  let secuencial = await obtenerMaxSecuencialFdm();

  const resumen = {
    totalRecibidos: filas.length,
    fusionadosEnArchivo: fusionados,
    creados: 0,
    actualizados: 0,
    omitidos: 0,
    errores: [],
  };

  for (let i = 0; i < filasUnicas.length; i += 1) {
    const fila = filasUnicas[i] || {};
    const filaNum = i + 1;
    try {
      const payloadBase = { ...fila };
      if (!payloadBase.nombre) payloadBase.nombre = 'SIN NOMBRE';
      const sinIdentidad =
        payloadBase.nombre === 'SIN NOMBRE' &&
        !payloadBase.cedula &&
        !payloadBase.direccionAfectada &&
        !payloadBase.celular &&
        payloadBase.numero == null;
      if (sinIdentidad) {
        resumen.omitidos += 1;
        resumen.errores.push({ fila: filaNum, motivo: 'Fila sin nombre, cédula ni dirección' });
        continue;
      }
      if (!payloadBase.estado) payloadBase.estado = 'PENDIENTE';
      if (!payloadBase.evento) payloadBase.evento = eventoClaveFdm(payloadBase);

      const existente = localizarExistenteFdm(payloadBase, indice, existentes);

      if (existente?._id) {
        const merge = mergeImportacionFdm(payloadBase, existente);
        if (!merge.consecutivo) {
          secuencial += 1;
          merge.consecutivo = `FDM-${año}-${mes}-${secuencial}`;
        }
        const actualizado = await EquidadFdmCaso.findByIdAndUpdate(existente._id, merge, {
          new: true,
        }).lean();
        resumen.actualizados += 1;
        const idx = existentes.findIndex((d) => String(d._id) === String(actualizado._id));
        if (idx >= 0) existentes[idx] = actualizado;
        indexarClavesFdm(indice, actualizado);
      } else {
        secuencial += 1;
        payloadBase.consecutivo = `FDM-${año}-${mes}-${secuencial}`;
        payloadBase.esNuevo = true;
        const creado = await EquidadFdmCaso.create(payloadBase);
        const lean = creado.toObject();
        resumen.creados += 1;
        existentes.push(lean);
        indexarClavesFdm(indice, lean);
      }
    } catch (errFila) {
      resumen.omitidos += 1;
      resumen.errores.push({
        fila: filaNum,
        motivo: errFila.message || 'Error al procesar la fila',
      });
    }
  }

  resumen.duplicadosFusionados = await fusionarDuplicadosExistentesFdm();
  return resumen;
};
