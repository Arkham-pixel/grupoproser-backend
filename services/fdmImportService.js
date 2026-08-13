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

export const eventoClaveFdm = (caso = {}) => {
  const evento = normClaveFdm(caso.evento);
  if (evento) return evento;
  const cobertura = normClaveFdm(caso.cobertura);
  if (cobertura === 'TEMBLOR' || cobertura === 'TERREMOTO') return 'TERREMOTO 10 AGOSTO 2026';
  if (cobertura === 'ANEGACION') return 'OLA INVERNAL';
  return 'OLA INVERNAL';
};

/**
 * Deduplica por evento + identidad. Un mismo asegurado en ola invernal y terremoto
 * son dos casos distintos; no se pisan entre sí.
 */
export const clavesDeduplicacionFdm = (caso = {}) => {
  const claves = [];
  const evento = eventoClaveFdm(caso);
  const cedula = normClaveFdm(caso.cedula);
  const siniestro = normClaveFdm(caso.siniestro);
  const nroCaso = normClaveFdm(caso.caso);
  const poliza = normClaveFdm(caso.polizaAfectar);
  const direccion = normClaveFdm(caso.direccionAfectada);
  const nombre = normClaveFdm(caso.nombre);

  if (siniestro) claves.push(`E:${evento}|S:${siniestro}`);
  if (nroCaso) claves.push(`E:${evento}|C:${nroCaso}`);
  if (cedula && poliza) claves.push(`E:${evento}|I:${cedula}|P:${poliza}`);
  if (cedula && direccion) claves.push(`E:${evento}|I:${cedula}|D:${direccion}`);
  if (!cedula && nombre && direccion) claves.push(`E:${evento}|N:${nombre}|D:${direccion}`);
  if (cedula && !poliza && !direccion) claves.push(`E:${evento}|I:${cedula}`);
  return claves;
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
    out[campo] = mergeCampoFdm(incomingPayload[campo], existente[campo]);
  }
  return out;
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
  const existentes = await EquidadFdmCaso.find().lean();
  const indice = new Map();
  for (const doc of existentes) {
    for (const clave of clavesDeduplicacionFdm(doc)) {
      if (!indice.has(clave)) indice.set(clave, doc);
    }
  }

  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  let secuencial = await obtenerMaxSecuencialFdm();

  const resumen = {
    totalRecibidos: filas.length,
    creados: 0,
    actualizados: 0,
    omitidos: 0,
    errores: [],
  };

  for (let i = 0; i < filas.length; i += 1) {
    const fila = filas[i] || {};
    const filaNum = i + 1;
    try {
      const payloadBase = { ...fila };
      if (!payloadBase.nombre) {
        resumen.omitidos += 1;
        resumen.errores.push({ fila: filaNum, motivo: 'Falta nombre del asegurado' });
        continue;
      }
      if (!payloadBase.estado) payloadBase.estado = 'PENDIENTE';
      if (!payloadBase.evento) payloadBase.evento = eventoClaveFdm(payloadBase);

      const claves = clavesDeduplicacionFdm(payloadBase);
      let existente = null;
      for (const clave of claves) {
        if (indice.has(clave)) {
          existente = indice.get(clave);
          break;
        }
      }

      if (existente) {
        const merge = mergeImportacionFdm(payloadBase, existente);
        if (!merge.consecutivo) {
          secuencial += 1;
          merge.consecutivo = `FDM-${año}-${mes}-${secuencial}`;
        }
        const actualizado = await EquidadFdmCaso.findByIdAndUpdate(existente._id, merge, {
          new: true,
        }).lean();
        resumen.actualizados += 1;
        for (const clave of clavesDeduplicacionFdm(actualizado)) {
          indice.set(clave, actualizado);
        }
      } else {
        secuencial += 1;
        payloadBase.consecutivo = `FDM-${año}-${mes}-${secuencial}`;
        payloadBase.esNuevo = true;
        const creado = await EquidadFdmCaso.create(payloadBase);
        const lean = creado.toObject();
        resumen.creados += 1;
        for (const clave of clavesDeduplicacionFdm(lean)) {
          indice.set(clave, lean);
        }
      }
    } catch (errFila) {
      resumen.omitidos += 1;
      resumen.errores.push({
        fila: filaNum,
        motivo: errFila.message || 'Error al procesar la fila',
      });
    }
  }

  return resumen;
};
