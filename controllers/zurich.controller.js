import mongoose from 'mongoose';
import ZurichCaso from '../models/ZurichCaso.js';
import { deleteStoredFile } from '../services/fileStorageService.js';
import {
  obtenerAlertasZurichPorAjustadores,
  enviarAlertasTodosZurich,
  enviarAlertasZurichAjustador,
} from '../services/alertasZurichService.js';
import { ROL_SOLO_ZURICH, normalizarRol } from '../config/roles.js';
import { aplicarRestriccionRolCaso } from '../utils/permisosCasoPorRol.js';

const esValorVacio = (valor) =>
  valor === undefined || valor === null || valor === '' || valor === 'null' || valor === 'undefined';

/** Vacío / «por confirmar» / N/A / desiste → pendiente de dato real (no pisa lo bueno). */
const esPlaceholderOPendiente = (valor) => {
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
  if (/^POR CONFIRM/.test(t)) return true; // POR CONFIRMAR, POR CONFIRMAR OPERACIONES…
  if (/^(N\/?A|NA|NULL|UNDEFINED|DESISTE|-|SIN DATO|PENDIENTE)$/i.test(t)) return true;
  return false;
};

const esValorUtil = (valor) => !esPlaceholderOPendiente(valor);

/**
 * Excel trae dato real → actualiza (incluye reemplazar «por confirmar» / vacío).
 * Excel vacío / por confirmar / error parseado → conserva lo útil ya guardado.
 */
const mergeCampoImport = (incoming, existing) => {
  if (esValorUtil(incoming)) return incoming;
  if (esValorUtil(existing)) return existing;
  if (!esValorVacio(incoming)) return incoming;
  return existing ?? null;
};

const normalizeSeveridadNivelItem = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const aplica =
      raw.aplica === 'SI' || raw.aplica === 'NO'
        ? raw.aplica
        : raw.aplica === true
          ? 'SI'
          : raw.aplica === false
            ? 'NO'
            : null;
    return {
      aplica,
      observacion: raw.observacion != null ? String(raw.observacion) : '',
    };
  }
  if (raw === true) return { aplica: 'SI', observacion: '' };
  if (raw === false) return { aplica: 'NO', observacion: '' };
  return { aplica: null, observacion: '' };
};

const itemNivelDesdeRaw = (raw, n) => {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    const porNivel = raw.find((it) => Number(it?.nivel) === n);
    return porNivel ?? raw[n] ?? raw[n - 1];
  }
  if (typeof raw !== 'object') return undefined;
  return raw[`nivel${n}`] ?? raw[String(n)] ?? raw[n];
};

const normalizeSeveridadCatNiveles = (raw = {}, severidadCatLegacy = null) => {
  const out = {};
  for (let n = 1; n <= 6; n += 1) {
    out[String(n)] = normalizeSeveridadNivelItem(itemNivelDesdeRaw(raw, n));
  }
  const legacy = Number(severidadCatLegacy);
  const hayAlguno = Object.values(out).some((v) => v.aplica === 'SI' || v.aplica === 'NO');
  if (!hayAlguno && Number.isFinite(legacy) && legacy >= 1 && legacy <= 6) {
    out[String(legacy)] = { aplica: 'SI', observacion: '' };
  }
  return out;
};

/** Claves nivel1…nivel6: Mongo no convierte el Mixed en arreglo (pasaba con "1"…"6"). */
const serializarSeveridadCatNiveles = (raw = {}, severidadCatLegacy = null) => {
  const norm = normalizeSeveridadCatNiveles(raw, severidadCatLegacy);
  const out = {};
  for (let n = 1; n <= 6; n += 1) {
    out[`nivel${n}`] = norm[String(n)];
  }
  return out;
};

const nivelesTienenRespuesta = (raw) =>
  Object.values(normalizeSeveridadCatNiveles(raw, null)).some(
    (v) => v.aplica === 'SI' || v.aplica === 'NO'
  );

const derivarSeveridadCatDesdeNiveles = (niveles = {}) => {
  const norm = normalizeSeveridadCatNiveles(niveles);
  let max = null;
  for (let n = 1; n <= 6; n += 1) {
    if (norm[String(n)]?.aplica === 'SI') max = n;
  }
  return max;
};

const aplicaRespondido = (valor) =>
  valor === 'SI' || valor === 'NO' || valor === true || valor === false;

/** Checklist CAT lleno: los 6 niveles de severidad tienen APLICA o NO APLICA (tras guardar la inspección). */
const esChecklistCatLleno = (caso = {}) => {
  const norm = normalizeSeveridadCatNiveles(caso.severidadCatNiveles, caso.severidadCat);
  return [1, 2, 3, 4, 5, 6].every((n) => aplicaRespondido(norm[String(n)]?.aplica));
};

/** Filtro Mongo para casos con checklist CAT completo (flag o niveles 1–6 respondidos). */
const filtroMongoChecklistCatLleno = () => {
  const aplica = { $in: ['SI', 'NO', true, false] };
  const porPrefijo = [1, 2, 3, 4, 5, 6].map((n) => ({
    [`severidadCatNiveles.nivel${n}.aplica`]: aplica,
  }));
  const porNumero = [1, 2, 3, 4, 5, 6].map((n) => ({
    [`severidadCatNiveles.${n}.aplica`]: aplica,
  }));
  return {
    $or: [{ checklistCatCompleto: true }, { $and: porPrefijo }, { $and: porNumero }],
  };
};

const rolDesdeReq = (req) =>
  normalizarRol(req?.user?.role || req?.usuario?.role || '');

const debeFiltrarChecklistParaUsuario = (req) => {
  if (rolDesdeReq(req) === ROL_SOLO_ZURICH) return true;
  const q = String(req?.query?.soloChecklistLleno || '').toLowerCase();
  return q === '1' || q === 'true';
};

const EVIDENCIA_CAT_KEYS = [
  'fotoGeneral',
  'fotoDanos',
  'equiposCriticos',
  'mitigacion',
  'noAcceso',
];

const normalizeEvidenciaItem = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const aplica =
      raw.aplica === 'SI' || raw.aplica === 'NO'
        ? raw.aplica
        : raw.aplica === true
          ? 'SI'
          : raw.aplica === false
            ? 'NO'
            : null;
    return {
      aplica,
      observacion: raw.observacion != null ? String(raw.observacion) : '',
    };
  }
  if (raw === true) return { aplica: 'SI', observacion: '' };
  if (raw === false) return { aplica: 'NO', observacion: '' };
  return { aplica: null, observacion: '' };
};

const normalizeEvidenciaCat = (raw = {}) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of EVIDENCIA_CAT_KEYS) {
    out[key] = normalizeEvidenciaItem(src[key]);
  }
  return out;
};

const parseDate = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.trim().split('-').map(Number);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
      return new Date(year, month - 1, day, 12, 0, 0);
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseDateFlexible = (value, fallback = null) => {
  if (esValorVacio(value) || esPlaceholderOPendiente(value)) return fallback ?? null;
  return parseDate(value) ?? fallback ?? null;
};

const parseNumberFlexible = (value, fallback = null) => {
  if (esValorVacio(value) || esPlaceholderOPendiente(value)) return fallback ?? null;
  const texto = String(value).trim();
  if (!/\d/.test(texto) && typeof value !== 'number') return fallback ?? null;
  const limpio = texto.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!limpio || limpio === '-' || limpio === '.' || limpio === '-.') return fallback ?? null;
  const number = Number(limpio);
  return Number.isNaN(number) ? fallback ?? null : number;
};

const toStringOrNull = (value, fallback = null) => {
  if (esValorVacio(value)) return fallback ?? null;
  return String(value).trim();
};

const normClave = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

/** Listado cliente: solo ZC. No cruzar con casos CAT de inspección. */
const clavesDeduplicacionListado = (caso = {}) => {
  const zc = normClave(caso.zc);
  return zc ? [`ZC:${zc}`] : [];
};

/** Claves de deduplicación CAT/Zurich.
 * Risk ID solo no basta: el Excel CAT reutiliza el mismo Risk ID en distintos asegurados/predios.
 */
const clavesDeduplicacion = (caso = {}) => {
  const claves = [];
  const zc = normClave(caso.zc);
  const riskId = normClave(caso.riskId);
  const asegurado = normClave(caso.asegurado);
  const siniestro = normClave(caso.siniestro);
  const identificacion = normClave(caso.identificacion);
  const numeroCredito = normClave(caso.numeroCredito);
  const numeroPoliza = normClave(caso.numeroPoliza);
  const direccionPredio = normClave(caso.direccionPredio);
  const direccionInspeccion = normClave(caso.direccionInspeccionSugerida);
  const grupoInspeccion = normClave(caso.grupoInspeccion);

  if (zc) claves.push(`ZC:${zc}`);
  if (riskId && asegurado) claves.push(`R:${riskId}|A:${asegurado}`);
  if (riskId && direccionInspeccion) claves.push(`R:${riskId}|DI:${direccionInspeccion}`);
  if (riskId && grupoInspeccion && asegurado) {
    claves.push(`R:${riskId}|G:${grupoInspeccion}|A:${asegurado}`);
  }
  // Solo Risk ID si no hay asegurado (evitar fusionar distintos asegurados con mismo Risk ID)
  if (riskId && !asegurado) claves.push(`R:${riskId}`);
  if (siniestro) claves.push(`S:${siniestro}`);
  if (identificacion && numeroCredito) claves.push(`I:${identificacion}|C:${numeroCredito}`);
  if (identificacion && numeroPoliza) claves.push(`I:${identificacion}|P:${numeroPoliza}`);
  if (identificacion && direccionPredio) claves.push(`I:${identificacion}|D:${direccionPredio}`);
  return claves;
};

const completarIdentificacionZurich = (payload = {}) => {
  if (payload.identificacion) return payload;
  if (payload.zc) payload.identificacion = String(payload.zc);
  else if (payload.siniestro) payload.identificacion = String(payload.siniestro);
  else if (payload.riskId) payload.identificacion = String(payload.riskId);
  return payload;
};

const obtenerMaxSecuencialZurich = async () => {
  const patron = /^ZURICH-(\d{4})-(\d{2})-(\d+)$/i;
  const registros = await ZurichCaso.find({
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

/** Formato: ZURICH-YYYY-MM-N (asignado solo al crear) */
const generarConsecutivoZurich = async () => {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const maxSecuencial = await obtenerMaxSecuencialZurich();
  return `ZURICH-${año}-${mes}-${maxSecuencial + 1}`;
};

const buscarCasoPorId = async (idParam) => {
  if (idParam == null || idParam === '') return null;
  const id = String(idParam).trim();
  if (mongoose.Types.ObjectId.isValid(id)) {
    const porObjectId = await ZurichCaso.findById(id);
    if (porObjectId) return porObjectId;
  }
  return null;
};

const buildZurichPayload = (data = {}, base = {}) => {
  const payload = {
  consecutivo: base.consecutivo ?? null,
  expressCasoId:
    data.expressCasoId !== undefined
      ? data.expressCasoId || null
      : base.expressCasoId ?? null,
  consecutivoExpress: toStringOrNull(
    data.consecutivoExpress,
    base.consecutivoExpress ?? null
  ),
  siniestro: toStringOrNull(data.siniestro, base.siniestro ?? null),
  zc: toStringOrNull(data.zc, base.zc ?? null),
  identificacion: toStringOrNull(data.identificacion, base.identificacion ?? null),
  tipoIdentificacion: toStringOrNull(data.tipoIdentificacion, base.tipoIdentificacion ?? null),
  asegurado: toStringOrNull(data.asegurado, base.asegurado ?? null),
  intermediario: toStringOrNull(data.intermediario, base.intermediario ?? null),
  correoIntermediario: toStringOrNull(data.correoIntermediario, base.correoIntermediario ?? null),
  telefonoIntermediario: toStringOrNull(data.telefonoIntermediario, base.telefonoIntermediario ?? null),
  contactoIntermediario: toStringOrNull(
    data.contactoIntermediario,
    base.contactoIntermediario ?? null
  ),
  contactoAsegurado: toStringOrNull(data.contactoAsegurado, base.contactoAsegurado ?? null),
  observaciones: toStringOrNull(data.observaciones, base.observaciones ?? null),
  tomador: toStringOrNull(data.tomador, base.tomador ?? null),
  ajustadorLider: toStringOrNull(data.ajustadorLider, base.ajustadorLider ?? null),
  ajustador: toStringOrNull(data.ajustador, base.ajustador ?? null),
  inspector: toStringOrNull(data.inspector, base.inspector ?? null),
  numeroPoliza: toStringOrNull(data.numeroPoliza, base.numeroPoliza ?? null),
  tipoPoliza: toStringOrNull(data.tipoPoliza, base.tipoPoliza ?? null),
  causa: toStringOrNull(data.causa, base.causa ?? null),
  direccionPredio: toStringOrNull(data.direccionPredio, base.direccionPredio ?? null),
  numeroCredito: toStringOrNull(data.numeroCredito, base.numeroCredito ?? null),
  informacionContacto: toStringOrNull(data.informacionContacto, base.informacionContacto ?? null),
  correo: toStringOrNull(data.correo, base.correo ?? null),
  celular: toStringOrNull(data.celular, base.celular ?? null),
  canalRadicacion: toStringOrNull(data.canalRadicacion, base.canalRadicacion ?? null),
  ciudad: toStringOrNull(data.ciudad, base.ciudad ?? null),
  departamento: toStringOrNull(data.departamento, base.departamento ?? null),
  fechaSiniestro: parseDateFlexible(data.fechaSiniestro, base.fechaSiniestro ?? null),
  fechaInicioPoliza: parseDateFlexible(data.fechaInicioPoliza, base.fechaInicioPoliza ?? null),
  fechaFinPoliza: parseDateFlexible(data.fechaFinPoliza, base.fechaFinPoliza ?? null),
  valorAseguradoInmueble: parseNumberFlexible(
    data.valorAseguradoInmueble,
    base.valorAseguradoInmueble ?? null
  ),
  valorAseguradoContenidos: parseNumberFlexible(
    data.valorAseguradoContenidos,
    base.valorAseguradoContenidos ?? null
  ),
  cobertura: toStringOrNull(data.cobertura, base.cobertura ?? null),
  estadoPagoPrimas: toStringOrNull(data.estadoPagoPrimas, base.estadoPagoPrimas ?? null),
  valorReservaPreventivaPromedio: parseNumberFlexible(
    data.valorReservaPreventivaPromedio,
    base.valorReservaPreventivaPromedio ?? null
  ),
  valorComercialInmueble: parseNumberFlexible(
    data.valorComercialInmueble,
    base.valorComercialInmueble ?? null
  ),
  reserva: parseNumberFlexible(data.reserva, base.reserva ?? null),
  valorReclamado: parseNumberFlexible(data.valorReclamado, base.valorReclamado ?? null),
  valorLiquidado: parseNumberFlexible(data.valorLiquidado, base.valorLiquidado ?? null),
  fechaInspeccion: parseDateFlexible(data.fechaInspeccion, base.fechaInspeccion ?? null),
  fechaUltimoDocumento: parseDateFlexible(
    data.fechaUltimoDocumento,
    base.fechaUltimoDocumento ?? null
  ),
  fechaLiquidado: parseDateFlexible(data.fechaLiquidado, base.fechaLiquidado ?? null),
  fechaAceptacionLiquidacion: parseDateFlexible(
    data.fechaAceptacionLiquidacion,
    base.fechaAceptacionLiquidacion ?? null
  ),
  fechaEnvioAseguradora: parseDateFlexible(
    data.fechaEnvioAseguradora,
    base.fechaEnvioAseguradora ?? null
  ),
  estado: toStringOrNull(data.estado, base.estado ?? null),
  riskId: toStringOrNull(data.riskId, base.riskId ?? null),
  distanciaEpicentroKm: parseNumberFlexible(
    data.distanciaEpicentroKm,
    base.distanciaEpicentroKm ?? null
  ),
  tipoNegocioHomologado: toStringOrNull(
    data.tipoNegocioHomologado,
    base.tipoNegocioHomologado ?? null
  ),
  catUbicacionReferencia: toStringOrNull(
    data.catUbicacionReferencia,
    base.catUbicacionReferencia ?? null
  ),
  addressNumber: toStringOrNull(data.addressNumber, base.addressNumber ?? null),
  direccionInspeccionSugerida: toStringOrNull(
    data.direccionInspeccionSugerida,
    base.direccionInspeccionSugerida ?? null
  ),
  linkGoogleMaps: toStringOrNull(data.linkGoogleMaps, base.linkGoogleMaps ?? null),
  grupoInspeccion: toStringOrNull(data.grupoInspeccion, base.grupoInspeccion ?? null),
  afectacion: toStringOrNull(data.afectacion, base.afectacion ?? null),
  gradoAfectacion: toStringOrNull(data.gradoAfectacion, base.gradoAfectacion ?? null),
  lucroCesante: toStringOrNull(data.lucroCesante, base.lucroCesante ?? null),
  severidadCatNiveles: (() => {
    const incoming = data.severidadCatNiveles;
    const prevNorm = normalizeSeveridadCatNiveles(base.severidadCatNiveles, base.severidadCat);
    if (incoming === undefined || incoming === null) {
      return serializarSeveridadCatNiveles(prevNorm);
    }
    if (typeof incoming !== 'object') {
      return serializarSeveridadCatNiveles(prevNorm);
    }
    if (!nivelesTienenRespuesta(incoming)) {
      return serializarSeveridadCatNiveles(prevNorm);
    }
    const incomingNorm = normalizeSeveridadCatNiveles(incoming, null);
    const merged = {};
    for (let n = 1; n <= 6; n += 1) {
      const key = String(n);
      const inc = incomingNorm[key];
      merged[key] =
        inc?.aplica === 'SI' || inc?.aplica === 'NO' ? inc : prevNorm[key];
    }
    return serializarSeveridadCatNiveles(merged);
  })(),
  severidadCat: (() => {
    // Solo derivar desde niveles si el payload trae respuestas reales (no borrar con vacío)
    if (
      data.severidadCatNiveles &&
      typeof data.severidadCatNiveles === 'object' &&
      nivelesTienenRespuesta(data.severidadCatNiveles)
    ) {
      return derivarSeveridadCatDesdeNiveles(
        normalizeSeveridadCatNiveles(data.severidadCatNiveles, null)
      );
    }
    const raw = data.severidadCat !== undefined ? data.severidadCat : base.severidadCat;
    if (esValorVacio(raw) || esPlaceholderOPendiente(raw)) return base.severidadCat ?? null;
    const n = parseNumberFlexible(raw, null);
    if (n == null) return base.severidadCat ?? null;
    const nivel = Math.round(n);
    if (nivel < 1 || nivel > 6) return base.severidadCat ?? null;
    return nivel;
  })(),
  accesoPredio: toStringOrNull(data.accesoPredio, base.accesoPredio ?? null),
  observacionesCat: toStringOrNull(data.observacionesCat, base.observacionesCat ?? null),
  evidenciaCat: (() => {
    const incoming = data.evidenciaCat;
    const prev = base.evidenciaCat || {};
    if (incoming && typeof incoming === 'object') {
      return normalizeEvidenciaCat({ ...prev, ...incoming });
    }
    return normalizeEvidenciaCat(prev);
  })(),
  liquidador:
    data.liquidador !== undefined
      ? data.liquidador && typeof data.liquidador === 'object'
        ? data.liquidador
        : null
      : base.liquidador ?? null,
  informeUnico:
    data.informeUnico !== undefined
      ? data.informeUnico && typeof data.informeUnico === 'object'
        ? data.informeUnico
        : null
      : base.informeUnico ?? null,
  historialCatastroficoId: toStringOrNull(
    data.historialCatastroficoId,
    base.historialCatastroficoId ?? null
  ),
  };
  payload.checklistCatCompleto = esChecklistCatLleno(payload);
  return payload;
};

/** Mapea un SiniestroExpress → campos Zurich (estructura Alfa). */
export const mapExpressAZurich = (express = {}) => ({
  expressCasoId: express._id || null,
  consecutivoExpress: express.consecutivo || null,
  siniestro: express.numeroSiniestro || null,
  identificacion: express.nit || express.numeroSiniestro || 'SIN-ID',
  asegurado: express.aseguradoBeneficiario || null,
  tomador: express.intermediario || null,
  ajustador: express.responsable || null,
  numeroPoliza: null,
  direccionPredio: null,
  numeroCredito: null,
  informacionContacto: null,
  correo: express.correoNotificacion || null,
  celular: null,
  canalRadicacion: 'EXPRESS',
  ciudad: express.ciudadSiniestro || null,
  departamento: null,
  fechaSiniestro: express.fechaSiniestro || null,
  fechaInicioPoliza: null,
  fechaFinPoliza: null,
  valorAseguradoInmueble: null,
  valorAseguradoContenidos: null,
  cobertura: express.amparo || null,
  estadoPagoPrimas: null,
  valorReservaPreventivaPromedio: null,
  valorComercialInmueble: null,
  reserva: express.reserva ?? null,
  valorReclamado: null,
  valorLiquidado: express.valorIndemnizacion ?? null,
  fechaInspeccion: null,
  fechaUltimoDocumento: express.fechaUltimoDocumento || null,
  fechaLiquidado: express.fechaDefinicionCaso || null,
  fechaAceptacionLiquidacion: null,
  fechaEnvioAseguradora: express.fechaEnvioAutorizacion || null,
  estado: express.estadoProceso || 'PENDIENTE',
  liquidador: express.liquidador && typeof express.liquidador === 'object' ? express.liquidador : null,
});

/** Une fila Excel con caso existente: solo pisa placeholders / vacíos / errores parseados. */
const mergeImportacionZurich = (incomingPayload = {}, existente = {}) => {
  const campos = [
    'siniestro',
    'zc',
    'identificacion',
    'tipoIdentificacion',
    'asegurado',
    'intermediario',
    'correoIntermediario',
    'telefonoIntermediario',
    'contactoIntermediario',
    'contactoAsegurado',
    'observaciones',
    'tomador',
    'ajustador',
    'numeroPoliza',
    'tipoPoliza',
    'causa',
    'direccionPredio',
    'numeroCredito',
    'informacionContacto',
    'correo',
    'celular',
    'canalRadicacion',
    'ciudad',
    'departamento',
    'fechaSiniestro',
    'fechaInicioPoliza',
    'fechaFinPoliza',
    'valorAseguradoInmueble',
    'valorAseguradoContenidos',
    'cobertura',
    'estadoPagoPrimas',
    'valorReservaPreventivaPromedio',
    'valorComercialInmueble',
    'reserva',
    'valorReclamado',
    'valorLiquidado',
    'fechaInspeccion',
    'fechaUltimoDocumento',
    'fechaLiquidado',
    'fechaAceptacionLiquidacion',
    'fechaEnvioAseguradora',
    'estado',
    'riskId',
    'distanciaEpicentroKm',
    'tipoNegocioHomologado',
    'catUbicacionReferencia',
    'addressNumber',
    'direccionInspeccionSugerida',
    'linkGoogleMaps',
    'grupoInspeccion',
    'afectacion',
    'gradoAfectacion',
    'lucroCesante',
    'severidadCat',
    'accesoPredio',
    'observacionesCat',
  ];
  const out = {
    consecutivo: existente.consecutivo || null,
    archivos: existente.archivos || [],
    liquidador: existente.liquidador ?? null,
    informeUnico: existente.informeUnico ?? null,
    historialCatastroficoId: existente.historialCatastroficoId ?? null,
    expressCasoId: existente.expressCasoId ?? null,
    consecutivoExpress: existente.consecutivoExpress ?? null,
    severidadCatNiveles: serializarSeveridadCatNiveles(
      existente.severidadCatNiveles,
      existente.severidadCat
    ),
    evidenciaCat: existente.evidenciaCat
      ? normalizeEvidenciaCat(existente.evidenciaCat)
      : normalizeEvidenciaCat({}),
  };
  for (const campo of campos) {
    out[campo] = mergeCampoImport(incomingPayload[campo], existente[campo]);
  }
  if (incomingPayload.severidadCatNiveles && typeof incomingPayload.severidadCatNiveles === 'object') {
    if (nivelesTienenRespuesta(incomingPayload.severidadCatNiveles)) {
      out.severidadCatNiveles = serializarSeveridadCatNiveles(incomingPayload.severidadCatNiveles);
      out.severidadCat = derivarSeveridadCatDesdeNiveles(out.severidadCatNiveles);
    }
  }
  // evidenciaCat: merge por sección (aplica + observación)
  if (incomingPayload.evidenciaCat && typeof incomingPayload.evidenciaCat === 'object') {
    out.evidenciaCat = normalizeEvidenciaCat({
      ...normalizeEvidenciaCat(existente.evidenciaCat),
      ...incomingPayload.evidenciaCat,
    });
  }
  if (!out.estado) out.estado = 'PENDIENTE';
  out.checklistCatCompleto = esChecklistCatLleno(out);
  return out;
};

const validarRequeridos = (payload) => {
  const camposRequeridos = [
    ['identificacion', 'identificación'],
    ['estado', 'estado'],
  ];
  return camposRequeridos
    .map(([campo, etiqueta]) => (!payload[campo] ? etiqueta : null))
    .filter(Boolean);
};

export const crearCasoZurich = async (req, res) => {
  try {
    const payload = completarIdentificacionZurich(buildZurichPayload(req.body));
    payload.consecutivo = await generarConsecutivoZurich();

    const faltantes = validarRequeridos(payload);
    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    const documento = await ZurichCaso.create(payload);
    res.status(201).json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al crear caso Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar el caso Zurich',
      detalle: error.message,
    });
  }
};

export const listarCasosZurich = async (req, res) => {
  try {
    const { limit = 25, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filtro = debeFiltrarChecklistParaUsuario(req) ? filtroMongoChecklistCatLleno() : {};
    const [total, documentos] = await Promise.all([
      ZurichCaso.countDocuments(filtro),
      ZurichCaso.find(filtro)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
    ]);

    res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      data: documentos,
    });
  } catch (error) {
    console.error('❌ Error al listar casos Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener los casos Zurich',
      detalle: error.message,
    });
  }
};

export const obtenerCasoZurich = async (req, res) => {
  try {
    const documento = await buscarCasoPorId(req.params.id);
    if (!documento) {
      return res.status(404).json({ success: false, error: 'Caso Zurich no encontrado' });
    }
    res.json({ success: true, data: documento });
  } catch (error) {
    console.error('❌ Error al obtener caso Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener el caso Zurich',
      detalle: error.message,
    });
  }
};

export const actualizarCasoZurich = async (req, res) => {
  try {
    const registroActual = await buscarCasoPorId(req.params.id);
    if (!registroActual) {
      return res.status(404).json({ success: false, error: 'Caso Zurich no encontrado' });
    }

    const base = registroActual.toObject();
    const { data: bodyFiltrado } = aplicarRestriccionRolCaso(req, req.body || {}, base);
    const payload = buildZurichPayload(bodyFiltrado, base);
    if (!payload.consecutivo) {
      payload.consecutivo = base.consecutivo || (await generarConsecutivoZurich());
    }

    const faltantes = validarRequeridos(payload);
    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Los siguientes campos son obligatorios: ${faltantes.join(', ')}`,
      });
    }

    const actualizado = await ZurichCaso.findByIdAndUpdate(
      registroActual._id,
      { $set: payload },
      { new: true, runValidators: false }
    );

    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('❌ Error al actualizar caso Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el caso Zurich',
      detalle: error.message,
    });
  }
};

export const eliminarCasoZurich = async (req, res) => {
  try {
    const registro = await buscarCasoPorId(req.params.id);
    if (!registro) {
      return res.status(404).json({ success: false, error: 'Caso Zurich no encontrado' });
    }

    await ZurichCaso.deleteOne({ _id: registro._id });
    res.json({ success: true, message: 'Caso Zurich eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar caso Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el caso Zurich',
      detalle: error.message,
    });
  }
};

/**
 * Importación masiva con deduplicación.
 * modo=listado: solo empareja por ZC (no cruza casos CAT de inspección).
 * Si el caso ya existe, se actualiza; no se duplica.
 */
export const importarCasosZurich = async (req, res) => {
  try {
    const filas = Array.isArray(req.body?.casos) ? req.body.casos : null;
    if (!filas || filas.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Debe enviar un arreglo "casos" con al menos un registro',
      });
    }

    if (filas.length > 5000) {
      return res.status(400).json({
        success: false,
        error: 'El lote supera el máximo de 5000 casos por importación',
      });
    }

    const reemplazarTodo = req.body?.reemplazarTodo === true;
    const esListado =
      String(req.body?.modo || req.body?.origen || '')
        .trim()
        .toLowerCase() === 'listado';
    const clavesDe = esListado ? clavesDeduplicacionListado : clavesDeduplicacion;

    if (reemplazarTodo) {
      await ZurichCaso.deleteMany({});
    }

    const existentes = await ZurichCaso.find().lean();
    const indice = new Map();
    for (const doc of existentes) {
      for (const clave of clavesDe(doc)) {
        if (!indice.has(clave)) indice.set(clave, doc);
      }
    }

    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    let secuencial = await obtenerMaxSecuencialZurich();

    const resumen = {
      totalRecibidos: filas.length,
      creados: 0,
      actualizados: 0,
      omitidos: 0,
      reemplazados: reemplazarTodo,
      errores: [],
    };

    for (let i = 0; i < filas.length; i += 1) {
      const fila = filas[i] || {};
      const filaNum = i + 1;

      try {
        const payloadBase = completarIdentificacionZurich(
          buildZurichPayload({
            ...fila,
            estado: fila.estado || 'PENDIENTE',
          })
        );

        if (esListado) {
          if (!payloadBase.zc && !payloadBase.siniestro && !payloadBase.asegurado) {
            resumen.omitidos += 1;
            resumen.errores.push({
              fila: filaNum,
              motivo: 'Falta ZC, STRO o asegurado',
            });
            continue;
          }
        } else if (!payloadBase.identificacion) {
          resumen.omitidos += 1;
          resumen.errores.push({
            fila: filaNum,
            motivo: 'Falta identificación',
          });
          continue;
        }
        if (!payloadBase.estado) {
          payloadBase.estado = 'PENDIENTE';
        }

        const claves = clavesDe(payloadBase);
        let existente = null;
        for (const clave of claves) {
          if (indice.has(clave)) {
            existente = indice.get(clave);
            break;
          }
        }

        if (existente) {
          const merge = mergeImportacionZurich(payloadBase, existente);
          if (!merge.consecutivo) {
            secuencial += 1;
            merge.consecutivo = `ZURICH-${año}-${mes}-${secuencial}`;
          }

          const actualizado = await ZurichCaso.findByIdAndUpdate(existente._id, merge, {
            new: true,
          }).lean();

          resumen.actualizados += 1;
          for (const clave of clavesDe(actualizado)) {
            indice.set(clave, actualizado);
          }
        } else {
          secuencial += 1;
          payloadBase.consecutivo = `ZURICH-${año}-${mes}-${secuencial}`;
          const creado = await ZurichCaso.create(payloadBase);
          const lean = creado.toObject();
          resumen.creados += 1;
          for (const clave of clavesDe(lean)) {
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

    res.json({
      success: true,
      data: resumen,
    });
  } catch (error) {
    console.error('❌ Error al importar casos Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al importar los casos Zurich',
      detalle: error.message,
    });
  }
};

const usuarioDesdeReq = (req) => {
  const u = req.usuario || req.user || {};
  return {
    id: String(u.id || u._id || ''),
    login: String(u.login || u.email || 'usuario'),
    nombre: String(u.nombre || u.name || u.login || 'Usuario'),
  };
};

const buildArchivoFromUpload = (req, etiqueta, { descripcion = '', orden = 0 } = {}) => {
  const file = req.file;
  const usuario = usuarioDesdeReq(req);
  const base = {
    etiqueta: etiqueta || 'GENERAL',
    descripcion: descripcion != null ? String(descripcion) : '',
    orden: Number.isFinite(Number(orden)) ? Number(orden) : 0,
    subidoPor: usuario,
    fechaSubida: new Date(),
  };
  if (req.fileStorage?.driver === 's3') {
    return {
      nombreOriginal: file.originalname,
      nombreArchivo: req.fileStorage.filename,
      ruta: req.fileStorage.publicPath,
      tamaño: req.fileStorage.size,
      tipoMime: req.fileStorage.mimetype,
      ...base,
    };
  }
  return {
    nombreOriginal: file.originalname,
    nombreArchivo: file.filename,
    ruta: `/uploads/zurich/${file.filename}`,
    tamaño: file.size,
    tipoMime: file.mimetype,
    ...base,
  };
};

const siguienteOrdenArchivos = (archivos = []) => {
  let max = -1;
  for (const a of archivos || []) {
    const n = Number(a?.orden);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
};

/** POST /api/zurich/:id/archivos */
export const subirArchivoZurich = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se proporcionó ningún archivo' });
    }

    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Zurich no encontrado' });
    }

    const etiqueta = toStringOrNull(req.body?.etiqueta) || 'GENERAL';
    const descripcion =
      req.body?.descripcion != null ? String(req.body.descripcion) : '';
    caso.archivos = caso.archivos || [];
    const orden = siguienteOrdenArchivos(caso.archivos);
    const archivo = buildArchivoFromUpload(req, etiqueta, { descripcion, orden });
    caso.archivos.push(archivo);
    caso.fechaUltimoDocumento = new Date();
    await caso.save();

    const creado = caso.archivos[caso.archivos.length - 1];
    res.status(201).json({ success: true, data: creado, casoId: caso._id });
  } catch (error) {
    console.error('❌ Error subiendo archivo Zurich:', error);
    res.status(500).json({
      success: false,
      error: error?.storageError
        ? 'Error al guardar el archivo en almacenamiento'
        : 'Error al subir el archivo',
      detalle: error.message,
    });
  }
};

/** PATCH /api/zurich/:id/archivos/:archivoId — descripción / etiqueta / orden */
export const actualizarArchivoZurich = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Zurich no encontrado' });
    }

    const archivo = caso.archivos?.id?.(req.params.archivoId);
    if (!archivo) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    if (req.body?.descripcion !== undefined) {
      archivo.descripcion = String(req.body.descripcion ?? '');
    }
    if (req.body?.etiqueta !== undefined) {
      const et = toStringOrNull(req.body.etiqueta);
      if (et) archivo.etiqueta = et;
    }
    if (req.body?.orden !== undefined) {
      const n = Number(req.body.orden);
      if (Number.isFinite(n)) archivo.orden = n;
    }

    await caso.save();
    res.json({ success: true, data: archivo });
  } catch (error) {
    console.error('❌ Error actualizando archivo Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar el archivo',
      detalle: error.message,
    });
  }
};

/** PUT /api/zurich/:id/archivos/orden — reordenar por lista de IDs */
export const reordenarArchivosZurich = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Zurich no encontrado' });
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) {
      return res.status(400).json({ success: false, error: 'Se requiere ids[] con el nuevo orden' });
    }

    const mapa = new Map();
    for (const a of caso.archivos || []) {
      mapa.set(String(a._id), a);
    }

    ids.forEach((id, index) => {
      const arch = mapa.get(String(id));
      if (arch) arch.orden = index;
    });

    // Archivos no incluidos conservan orden relativo al final
    let next = ids.length;
    for (const a of caso.archivos || []) {
      if (!ids.includes(String(a._id))) {
        a.orden = next++;
      }
    }

    await caso.save();
    res.json({
      success: true,
      data: (caso.archivos || []).map((a) => ({
        _id: a._id,
        orden: a.orden,
        descripcion: a.descripcion,
        etiqueta: a.etiqueta,
      })),
    });
  } catch (error) {
    console.error('❌ Error reordenando archivos Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al reordenar archivos',
      detalle: error.message,
    });
  }
};

/** DELETE /api/zurich/:id/archivos/:archivoId */
export const eliminarArchivoZurich = async (req, res) => {
  try {
    const caso = await buscarCasoPorId(req.params.id);
    if (!caso) {
      return res.status(404).json({ success: false, error: 'Caso Zurich no encontrado' });
    }

    const archivo = caso.archivos?.id?.(req.params.archivoId);
    if (!archivo) {
      return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
    }

    if (archivo.ruta) {
      await deleteStoredFile(archivo.ruta).catch((err) => {
        console.warn('No se pudo eliminar archivo Zurich del almacenamiento:', err.message);
      });
    }
    archivo.deleteOne();
    await caso.save();

    res.json({ success: true, message: 'Archivo eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error eliminando archivo Zurich:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar el archivo',
      detalle: error.message,
    });
  }
};

/** GET /api/zurich/alertas */
export const getAlertasZurich = async (_req, res) => {
  try {
    const data = await obtenerAlertasZurichPorAjustadores();
    return res.json(data);
  } catch (error) {
    console.error('Error alertas Zurich:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** POST /api/zurich/alertas/enviar */
export const postEnviarAlertasZurichTodas = async (req, res) => {
  try {
    const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
    const data = await enviarAlertasTodosZurich({ forzar });
    return res.json(data);
  } catch (error) {
    console.error('Error enviando alertas Zurich (todas):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/** POST /api/zurich/alertas/enviar/:ajustador */
export const postEnviarAlertasZurichAjustador = async (req, res) => {
  try {
    const { ajustador } = req.params;
    if (!ajustador) {
      return res.status(400).json({ success: false, error: 'Código de ajustador requerido' });
    }
    const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
    const data = await enviarAlertasZurichAjustador(ajustador, { forzar });
    return res.json(data);
  } catch (error) {
    console.error('Error enviando alertas Zurich (ajustador):', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Sincroniza casos desde SiniestroExpress → colección Zurich.
 * Deduplica por expressCasoId o siniestro (numeroSiniestro).
 * Body opcional: { ids: string[] } para sincronizar solo esos Express.
 */
export const syncDesdeExpress = async (req, res) => {
  try {
    const { default: SiniestroExpress } = await import('../models/SiniestroExpress.js');
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : null;

    const filtro = ids?.length
      ? { _id: { $in: ids.filter((id) => mongoose.Types.ObjectId.isValid(id)) } }
      : {};

    const expressCasos = await SiniestroExpress.find(filtro).lean();
    if (!expressCasos.length) {
      return res.json({
        success: true,
        data: { totalExpress: 0, creados: 0, actualizados: 0, omitidos: 0 },
      });
    }

    const existentes = await ZurichCaso.find({
      $or: [
        { expressCasoId: { $exists: true, $ne: null } },
        { canalRadicacion: 'EXPRESS' },
      ],
    }).lean();

    const porExpressId = new Map();
    const porSiniestro = new Map();
    for (const doc of existentes) {
      if (doc.expressCasoId) porExpressId.set(String(doc.expressCasoId), doc);
      for (const clave of clavesDeduplicacion(doc)) {
        if (!porSiniestro.has(clave)) porSiniestro.set(clave, doc);
      }
    }

    let secuencial = await obtenerMaxSecuencialZurich();
    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');

    const resumen = {
      totalExpress: expressCasos.length,
      creados: 0,
      actualizados: 0,
      omitidos: 0,
      errores: [],
    };

    for (const exp of expressCasos) {
      try {
        const mapped = mapExpressAZurich(exp);
        const payloadBase = buildZurichPayload({
          ...mapped,
          estado: mapped.estado || 'PENDIENTE',
        });

        if (!payloadBase.identificacion) {
          resumen.omitidos += 1;
          continue;
        }

        let existente =
          (exp._id && porExpressId.get(String(exp._id))) ||
          null;
        if (!existente) {
          for (const clave of clavesDeduplicacion(payloadBase)) {
            if (porSiniestro.has(clave)) {
              existente = porSiniestro.get(clave);
              break;
            }
          }
        }

        if (existente) {
          const merged = mergeImportacionZurich(payloadBase, existente);
          merged.expressCasoId = payloadBase.expressCasoId || existente.expressCasoId;
          merged.consecutivoExpress =
            payloadBase.consecutivoExpress || existente.consecutivoExpress;
          const actualizado = await ZurichCaso.findByIdAndUpdate(existente._id, merged, {
            new: true,
          }).lean();
          resumen.actualizados += 1;
          if (actualizado) {
            porExpressId.set(String(exp._id), actualizado);
            for (const clave of clavesDeduplicacion(actualizado)) {
              porSiniestro.set(clave, actualizado);
            }
          }
        } else {
          secuencial += 1;
          payloadBase.consecutivo = `ZURICH-${año}-${mes}-${secuencial}`;
          const creado = await ZurichCaso.create(payloadBase);
          const lean = creado.toObject();
          resumen.creados += 1;
          porExpressId.set(String(exp._id), lean);
          for (const clave of clavesDeduplicacion(lean)) {
            porSiniestro.set(clave, lean);
          }
        }
      } catch (err) {
        resumen.omitidos += 1;
        resumen.errores.push({
          expressId: String(exp?._id || ''),
          siniestro: exp?.numeroSiniestro || '',
          motivo: err.message,
        });
      }
    }

    return res.json({ success: true, data: resumen });
  } catch (error) {
    console.error('❌ Error al sincronizar Express → Zurich:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al sincronizar casos desde Express',
      detalle: error.message,
    });
  }
};
