/**
 * Geocodificación y bloques de cercanía para BBVA CAT (solo ARNALD).
 * No escribe a SharePoint / Excel.
 */

import crypto from 'crypto';
import BbvaCatCaso from '../models/BbvaCatCaso.js';

const EARTH_RADIUS_KM = 6371;

export function hashDireccionBbvaCat(direccion = '', ciudad = '', departamento = '') {
  const raw = [direccion, ciudad, departamento]
    .map((v) =>
      String(v || '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ')
    )
    .join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

/**
 * Expande abreviaturas colombianas (CL/KR/…) para mejorar el hit de Google.
 */
export function normalizarDireccionColombiaBbvaCat(direccion = '') {
  let s = String(direccion || '')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u2010-\u2015\u2212\u0096\u0097]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';

  s = s
    .replace(/\bCLL?\b\.?/gi, 'Calle')
    .replace(/\bKR\b\.?/gi, 'Carrera')
    .replace(/\bCRA?\b\.?/gi, 'Carrera')
    .replace(/\bCR\b\.?/gi, 'Carrera')
    .replace(/\bAV(ENIDA)?\b\.?/gi, 'Avenida')
    .replace(/\bDG\b\.?/gi, 'Diagonal')
    .replace(/\bTV\b\.?/gi, 'Transversal')
    .replace(/\bTRANSVERSAL\b/gi, 'Transversal')
    .replace(/\bAPTO?\b\.?/gi, 'Apartamento')
    .replace(/\bAPARTAMENTO\b/gi, 'Apartamento')
    .replace(/\bTO(RRE)?\b\.?/gi, 'Torre')
    .replace(/\bEDIF?\b\.?/gi, 'Edificio')
    .replace(/\bURB(ANIZACI[OÓ]N)?\b\.?/gi, 'Urbanización')
    .replace(/\bCONJ(UNTO)?\b\.?/gi, 'Conjunto')
    .replace(/\bCJ\b\.?/gi, 'Conjunto')
    .replace(/\bNTE?\b\.?/gi, 'Norte')
    .replace(/\bNOR\b\.?/gi, 'Norte')
    .replace(/\bSUR\b\.?/gi, 'Sur')
    .replace(/\bOESTE\b/gi, 'Oeste')
    .replace(/\bESTE\b/gi, 'Este')
    .replace(/\bN[°ºo]\.?\b/gi, '#')
    .replace(/\bNO\.?\b/gi, '#');

  // "Calle 63 3E-70" / "Calle 15A 69 85" → insertar # si falta
  s = s.replace(
    /\b(Calle|Carrera|Avenida|Diagonal|Transversal)\s+(\d+[A-Za-z]*)\s+(?!\d+\s*[-–]\s*\d)(\d)/gi,
    '$1 $2 # $3'
  );

  // "94210" pegado tras vía → "94-210" (patrón bancario frecuente)
  s = s.replace(
    /\b(Calle|Carrera|Avenida|Diagonal|Transversal)\s+(\d+[A-Za-z]*)\s*#?\s*(\d{2,3})(\d{2,3})\b/gi,
    (full, via, n, a, b) => `${via} ${n} # ${a}-${b}`
  );

  return s.replace(/\s+/g, ' ').trim();
}

export function construirQueryGeocodeBbvaCat(caso = {}) {
  const dirNorm = normalizarDireccionColombiaBbvaCat(caso.direccionPredio);
  const ciudad = String(caso.ciudad || '').trim();
  const depto = String(caso.departamento || '').trim();
  const partes = [dirNorm];
  const blob = dirNorm
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  if (ciudad) {
    const cNorm = ciudad
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toUpperCase();
    if (!blob.includes(cNorm)) partes.push(ciudad);
  }
  if (depto) {
    const dNorm = depto
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toUpperCase();
    if (!blob.includes(dNorm)) partes.push(depto);
  }
  partes.push('Colombia');
  return partes.filter(Boolean).join(', ');
}

/** Segunda consulta: nombre de conjunto/urbanización + ciudad. */
export function construirQueryLugarNombradoBbvaCat(caso = {}) {
  const raw = String(caso.direccionPredio || '');
  const m = raw.match(
    /((?:Conjunto|CONJ|Urbanizaci[oó]n|URB|Edificio|EDIF|Residencial|CJ)\s+[A-Za-zÁÉÍÓÚáéíóúÑñ0-9][A-Za-zÁÉÍÓÚáéíóúÑñ0-9\s.-]{2,50})/i
  );
  if (!m) return '';
  const lugar = normalizarDireccionColombiaBbvaCat(m[1]);
  return [lugar, caso.ciudad, caso.departamento, 'Colombia']
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Textos tipo PENDIENTE / POR CONFIRMAR no son direcciones reales.
 * Google a veces las “ubica” por ciudad → pins falsos.
 */
export function esDireccionPredioGeocodableBbvaCat(direccion = '') {
  const s = String(direccion || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!s) return false;
  if (/^POR\s*CONFIRM/.test(s)) return false;
  const placeholders = new Set([
    'PENDIENTE',
    'POR CONFIRMAR',
    'PORCONFIRM',
    'N/A',
    'NA',
    'S/D',
    'SD',
    'SIN DIRECCION',
    'NINGUNA',
    'NO APLICA',
    '-',
    '.',
  ]);
  return !placeholders.has(s);
}

export function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function casoTieneCoordsValidas(caso) {
  const u = caso?.ubicacionPredio;
  return (
    u &&
    esDireccionPredioGeocodableBbvaCat(caso?.direccionPredio) &&
    Number.isFinite(Number(u.lat)) &&
    Number.isFinite(Number(u.lng)) &&
    (u.geocodeStatus === 'ok' || u.geocodeStatus === 'manual') &&
    ubicacionTienePrecisionCalle(u)
  );
}

export function casoNecesitaGeocode(caso, { force = false } = {}) {
  if (!esDireccionPredioGeocodableBbvaCat(caso?.direccionPredio)) return false;
  if (force) return true;
  const u = caso?.ubicacionPredio;
  if (!u) return true;
  if (u.geocodeStatus === 'stale' || u.geocodeStatus === 'pending') return true;
  if (u.geocodeStatus === 'failed') {
    // Reintentar solo si la query normalizada cambió (p. ej. CL→Calle)
    const newQuery = construirQueryGeocodeBbvaCat(caso);
    return !u.geocodeQuery || u.geocodeQuery !== newQuery;
  }
  const hash = hashDireccionBbvaCat(caso.direccionPredio, caso.ciudad, caso.departamento);
  if (u.direccionHash && u.direccionHash !== hash) return true;
  // Legacy / impreciso: tenía pin pero a nivel ciudad → re-geocodificar
  if (!ubicacionTienePrecisionCalle(u)) return true;
  if (!casoTieneCoordsValidas(caso)) return true;
  return false;
}

function getGoogleMapsApiKey() {
  return (
    String(process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim() ||
    null
  );
}

/**
 * Geocodifica una dirección con Google Geocoding API (HTTP).
 * Acepta calle/tramo y APPROXIMATE de lugar (barrio, conjunto, establecimiento).
 * Rechaza APPROXIMATE solo-ciudad (genera bloques falsos).
 */
export async function geocodeDireccionGoogle(query) {
  const key = getGoogleMapsApiKey();
  if (!key) {
    return { status: 'failed', error: 'GOOGLE_MAPS_API_KEY no configurada en el backend' };
  }
  const q = String(query || '').trim();
  if (!q) return { status: 'sin_direccion' };

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', q);
  url.searchParams.set('region', 'co');
  url.searchParams.set('language', 'es');
  url.searchParams.set('components', 'country:CO');
  url.searchParams.set('key', key);

  const resp = await fetch(url.toString());
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return { status: 'failed', error: `HTTP ${resp.status}` };
  }
  if (data.status !== 'OK' || !Array.isArray(data.results) || !data.results.length) {
    return {
      status: 'failed',
      error: data.status || 'ZERO_RESULTS',
      geocodeStatusGoogle: data.status,
    };
  }

  const elegido = elegirResultadoGeocodeUtil(data.results);
  if (!elegido?.geometry?.location) {
    const tipo = data.results[0]?.geometry?.location_type || 'APPROXIMATE';
    return {
      status: 'failed',
      error: 'PRECISION_TOO_LOW',
      locationType: tipo,
      geocodeStatusGoogle: data.status,
      formattedAddress: data.results[0]?.formatted_address || q,
    };
  }

  const loc = elegido.geometry.location;
  return {
    status: 'ok',
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    formattedAddress: elegido.formatted_address || q,
    locationType: elegido.geometry.location_type || '',
    partialMatch: Boolean(elegido.partial_match),
    placeTypes: Array.isArray(elegido.types) ? elegido.types : [],
  };
}

/** Tipos Google que indican solo ciudad/departamento (demasiado grosero para bloques). */
const TIPOS_SOLO_CIUDAD = new Set([
  'locality',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'country',
  'political',
  'postal_code',
]);

const LOCATION_TYPES_PRECISOS = new Set([
  'ROOFTOP',
  'RANGE_INTERPOLATED',
  'GEOMETRIC_CENTER',
]);

/**
 * ¿El resultado de Google sirve para planear visitas?
 * - Calle/tramo: sí
 * - APPROXIMATE de barrio/conjunto/establecimiento: sí
 * - APPROXIMATE solo ciudad/municipio: no
 */
export function resultadoGeocodeEsUtil(result) {
  if (!result?.geometry?.location) return false;
  const locType = String(result.geometry.location_type || '').toUpperCase();
  if (LOCATION_TYPES_PRECISOS.has(locType)) return true;
  if (locType !== 'APPROXIMATE') return false;
  const types = Array.isArray(result.types) ? result.types : [];
  if (!types.length) return false;
  return types.some((t) => !TIPOS_SOLO_CIUDAD.has(String(t)));
}

export function elegirResultadoGeocodeUtil(results = []) {
  const lista = Array.isArray(results) ? results : [];
  return (
    lista.find((r) => LOCATION_TYPES_PRECISOS.has(String(r?.geometry?.location_type || '').toUpperCase())) ||
    lista.find((r) => resultadoGeocodeEsUtil(r)) ||
    null
  );
}

/** Precisión útil para planear visitas. Solo-ciudad no se guarda como ok. */
export function ubicacionTienePrecisionCalle(u = {}) {
  if (u.geocodeStatus === 'manual') return true;
  const tipo = String(u.locationType || '').toUpperCase();
  if (LOCATION_TYPES_PRECISOS.has(tipo)) return true;
  // APPROXIMATE con status ok = lugar (barrio/conjunto), no centro de ciudad
  if (tipo === 'APPROXIMATE' && u.geocodeStatus === 'ok') return true;
  return false;
}

/** Caso ya visitado/inspeccionado: no aporta a planear rutas. */
export function casoYaInspeccionadoBbvaCat(caso = {}) {
  if (caso?.fechaInspeccion) return true;
  const e = String(caso?.estado || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
  return (
    e === 'CASO PARA PAGO' ||
    e === 'AUTORIZACION ANALISTA' ||
    e === 'LIQUIDADO' ||
    e === 'ENVIADO ASEGURADORA' ||
    e === 'CERRADO' ||
    e.startsWith('LIQUID')
  );
}

/** Placeholder geocodificado por error (p. ej. "POR CONFIRMAR" → pin en ciudad). */
function casoNecesitaLimpiezaPlaceholder(caso) {
  if (esDireccionPredioGeocodableBbvaCat(caso?.direccionPredio)) return false;
  const u = caso?.ubicacionPredio;
  if (!u) return false;
  if (
    u.geocodeStatus === 'sin_direccion' &&
    !Number.isFinite(Number(u.lat)) &&
    !Number.isFinite(Number(u.lng))
  ) {
    return false;
  }
  return (
    Number.isFinite(Number(u.lat)) ||
    Number.isFinite(Number(u.lng)) ||
    u.geocodeStatus === 'ok' ||
    u.geocodeStatus === 'manual' ||
    u.geocodeStatus === 'failed' ||
    u.geocodeStatus == null
  );
}

export async function geocodeCasosBbvaCatPendientes({ limit = 100, force = false } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 250);
  const casos = await BbvaCatCaso.find({}).sort({ updatedAt: -1 }).lean();
  const todosPendientes = casos.filter(
    (c) => casoNecesitaLimpiezaPlaceholder(c) || casoNecesitaGeocode(c, { force })
  );
  const pendientes = todosPendientes.slice(0, lim);

  const resumen = {
    evaluados: casos.length,
    pendientes: pendientes.length,
    quedanPendientes: Math.max(0, todosPendientes.length - pendientes.length),
    ok: 0,
    failed: 0,
    sinDireccion: 0,
    resultados: [],
  };

  for (const caso of pendientes) {
    const query = construirQueryGeocodeBbvaCat(caso);
    const hash = hashDireccionBbvaCat(caso.direccionPredio, caso.ciudad, caso.departamento);

    if (!esDireccionPredioGeocodableBbvaCat(caso.direccionPredio)) {
      await BbvaCatCaso.findByIdAndUpdate(caso._id, {
        $set: {
          'ubicacionPredio.geocodeStatus': 'sin_direccion',
          'ubicacionPredio.geocodeQuery': query,
          'ubicacionPredio.direccionHash': hash,
          'ubicacionPredio.geocodedAt': new Date(),
        },
        $unset: {
          'ubicacionPredio.lat': '',
          'ubicacionPredio.lng': '',
        },
      });
      resumen.sinDireccion += 1;
      resumen.resultados.push({
        casoId: String(caso._id),
        consecutivo: caso.consecutivo,
        status: 'sin_direccion',
      });
      continue;
    }

    try {
      let geo = await geocodeDireccionGoogle(query);
      if (geo.status !== 'ok' && geo.error === 'PRECISION_TOO_LOW') {
        const qLugar = construirQueryLugarNombradoBbvaCat(caso);
        if (qLugar && qLugar !== query) {
          const geo2 = await geocodeDireccionGoogle(qLugar);
          if (geo2.status === 'ok') geo = { ...geo2, geocodeQuery: qLugar };
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      if (geo.status === 'ok') {
        await BbvaCatCaso.findByIdAndUpdate(caso._id, {
          ubicacionPredio: {
            lat: geo.lat,
            lng: geo.lng,
            geocodeStatus: 'ok',
            geocodeQuery: geo.geocodeQuery || query,
            direccionHash: hash,
            geocodedAt: new Date(),
            locationType: geo.locationType || '',
            formattedAddress: geo.formattedAddress || '',
          },
        });
        resumen.ok += 1;
        resumen.resultados.push({
          casoId: String(caso._id),
          consecutivo: caso.consecutivo,
          status: 'ok',
          lat: geo.lat,
          lng: geo.lng,
          locationType: geo.locationType || '',
        });
      } else {
        await BbvaCatCaso.findByIdAndUpdate(caso._id, {
          $set: {
            'ubicacionPredio.geocodeStatus':
              geo.status === 'sin_direccion' ? 'sin_direccion' : 'failed',
            'ubicacionPredio.geocodeQuery': query,
            'ubicacionPredio.direccionHash': hash,
            'ubicacionPredio.geocodedAt': new Date(),
            'ubicacionPredio.locationType': geo.locationType || '',
            'ubicacionPredio.formattedAddress': geo.formattedAddress || '',
          },
          $unset: {
            'ubicacionPredio.lat': '',
            'ubicacionPredio.lng': '',
          },
        });
        if (geo.status === 'sin_direccion') resumen.sinDireccion += 1;
        else resumen.failed += 1;
        resumen.resultados.push({
          casoId: String(caso._id),
          consecutivo: caso.consecutivo,
          status: geo.status === 'sin_direccion' ? 'sin_direccion' : 'failed',
          error: geo.error,
          locationType: geo.locationType || '',
        });
      }
    } catch (err) {
      resumen.failed += 1;
      resumen.resultados.push({
        casoId: String(caso._id),
        consecutivo: caso.consecutivo,
        status: 'failed',
        error: err.message,
      });
    }

    // Rate-limit suave (~5/s)
    await new Promise((r) => setTimeout(r, 200));
  }

  // Recalcular pendientes reales tras el lote
  const casosAfter = await BbvaCatCaso.find({})
    .select('direccionPredio ciudad departamento estado fechaInspeccion ubicacionPredio')
    .lean();
  resumen.quedanPendientes = casosAfter.filter(
    (c) => casoNecesitaLimpiezaPlaceholder(c) || casoNecesitaGeocode(c, { force: false })
  ).length;

  return resumen;
}

/**
 * Aplica ubicaciones geocodificadas en el cliente (fallback sin key en backend).
 */
export async function aplicarUbicacionesPredioBbvaCat(items = []) {
  const aplicados = [];
  for (const item of items) {
    const id = item?.casoId || item?._id;
    if (!id) continue;
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    let status =
      item.geocodeStatus || (Number.isFinite(lat) && Number.isFinite(lng) ? 'ok' : 'failed');
    const locationType = String(item.locationType || '').toUpperCase();
    const placeTypes = Array.isArray(item.placeTypes) ? item.placeTypes : [];
    // No aceptar coords imprecisas (mismas reglas que geocode backend)
    if (status === 'ok' && item.geocodeStatus !== 'manual') {
      const fakeResult = {
        geometry: { location: { lat, lng }, location_type: locationType || 'APPROXIMATE' },
        types: placeTypes.length ? placeTypes : locationType === 'APPROXIMATE' ? ['neighborhood'] : [],
      };
      // Sin locationType no confiamos; APPROXIMATE sin types del cliente se acepta si ya filtró el helper
      if (!locationType) {
        status = 'failed';
      } else if (
        !LOCATION_TYPES_PRECISOS.has(locationType) &&
        locationType !== 'APPROXIMATE'
      ) {
        status = 'failed';
      } else if (locationType === 'APPROXIMATE' && placeTypes.length && !resultadoGeocodeEsUtil(fakeResult)) {
        status = 'failed';
      }
    }    const clearCoords =
      status === 'sin_direccion' ||
      status === 'failed' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng);
    const update = clearCoords
      ? {
          $set: {
            'ubicacionPredio.geocodeStatus': status,
            'ubicacionPredio.geocodeQuery': item.geocodeQuery || '',
            'ubicacionPredio.direccionHash': item.direccionHash || undefined,
            'ubicacionPredio.geocodedAt': new Date(),
            'ubicacionPredio.locationType': locationType || item.locationType || '',
            'ubicacionPredio.formattedAddress': item.formattedAddress || '',
          },
          $unset: {
            'ubicacionPredio.lat': '',
            'ubicacionPredio.lng': '',
          },
        }
      : {
          ubicacionPredio: {
            lat,
            lng,
            geocodeStatus: status,
            geocodeQuery: item.geocodeQuery || '',
            direccionHash: item.direccionHash || undefined,
            geocodedAt: new Date(),
            locationType: locationType || item.locationType || '',
            formattedAddress: item.formattedAddress || '',
          },
        };
    const doc = await BbvaCatCaso.findByIdAndUpdate(id, update, { new: true }).lean();
    if (doc) {
      aplicados.push({
        casoId: String(doc._id),
        consecutivo: doc.consecutivo,
        status: doc.ubicacionPredio?.geocodeStatus,
        locationType: doc.ubicacionPredio?.locationType || '',
      });
    }
  }
  return { aplicados: aplicados.length, items: aplicados };
}

/**
 * Clustering greedy:
 * - Semillas en orden geográfico fijo (lat → lng → consecutivo)
 * - Numeración/listado de bloques de mayor a menor cantidad
 */
export function clusterizarPorRadio(puntos = [], radioKm = 2.5) {
  const radio = Math.max(0.1, Number(radioKm) || 2.5);
  const restantes = puntos
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ ...p }))
    .sort((a, b) => {
      const dLat = Number(a.lat) - Number(b.lat);
      if (Math.abs(dLat) > 1e-9) return dLat;
      const dLng = Number(a.lng) - Number(b.lng);
      if (Math.abs(dLng) > 1e-9) return dLng;
      return String(a.consecutivo || a._id || '').localeCompare(
        String(b.consecutivo || b._id || ''),
        'es'
      );
    });
  const bloques = [];

  while (restantes.length) {
    // Semilla = primer punto restante (orden geográfico estable)
    const semilla = restantes.shift();
    const miembros = [semilla];
    let centro = { lat: semilla.lat, lng: semilla.lng };

    let cambio = true;
    while (cambio) {
      cambio = false;
      for (let i = restantes.length - 1; i >= 0; i -= 1) {
        const cand = restantes[i];
        if (haversineKm(centro, cand) <= radio) {
          miembros.push(cand);
          restantes.splice(i, 1);
          centro = {
            lat: miembros.reduce((s, m) => s + m.lat, 0) / miembros.length,
            lng: miembros.reduce((s, m) => s + m.lng, 0) / miembros.length,
          };
          cambio = true;
        }
      }
    }

    const conDist = miembros
      .map((m) => ({
        ...m,
        distanciaKmCentro: Math.round(haversineKm(centro, m) * 100) / 100,
      }))
      .sort((a, b) => {
        const d = a.distanciaKmCentro - b.distanciaKmCentro;
        if (d !== 0) return d;
        return String(a.consecutivo || a._id || '').localeCompare(
          String(b.consecutivo || b._id || ''),
          'es'
        );
      });

    bloques.push({
      id: `bloque-tmp-${bloques.length + 1}`,
      nombre: `Bloque tmp`,
      centro,
      radioKm: radio,
      cantidad: conDist.length,
      casos: conDist,
    });
  }

  // Mayor a menor cantidad (empate: geografía del centro)
  bloques.sort((a, b) => {
    const dCant = (b.cantidad || 0) - (a.cantidad || 0);
    if (dCant !== 0) return dCant;
    const dLat = Number(a.centro.lat) - Number(b.centro.lat);
    if (Math.abs(dLat) > 1e-9) return dLat;
    const dLng = Number(a.centro.lng) - Number(b.centro.lng);
    if (Math.abs(dLng) > 1e-9) return dLng;
    return String(a.casos?.[0]?.consecutivo || '').localeCompare(
      String(b.casos?.[0]?.consecutivo || ''),
      'es'
    );
  });
  bloques.forEach((b, i) => {
    b.id = `bloque-${i + 1}`;
    b.nombre = `Bloque ${i + 1}`;
  });

  return bloques;
}

export async function obtenerBloquesCercaniaBbvaCat({
  radioKm = 2.5,
  ciudad = '',
  estado = '',
} = {}) {
  const filtro = {};
  if (ciudad) {
    filtro.ciudad = new RegExp(`^${String(ciudad).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  }
  if (estado) {
    filtro.estado = new RegExp(`^${String(estado).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  }

  const casos = await BbvaCatCaso.find(filtro).sort({ createdAt: -1 }).lean();
  const ubicados = [];
  const sinUbicar = [];
  let omitidosInspeccionados = 0;

  for (const c of casos) {
    // Ya inspeccionados: no salen en el mapa de rutas (planear visitas)
    if (casoYaInspeccionadoBbvaCat(c)) {
      omitidosInspeccionados += 1;
      continue;
    }
    const base = {
      _id: String(c._id),
      consecutivo: c.consecutivo,
      siniestro: c.siniestro,
      asegurado: c.asegurado || c.tomador,
      tomador: c.tomador,
      direccionPredio: c.direccionPredio,
      ciudad: c.ciudad,
      departamento: c.departamento,
      estado: c.estado,
      ajustador: c.ajustador,
      geocodeStatus: c.ubicacionPredio?.geocodeStatus || null,
      locationType: c.ubicacionPredio?.locationType || null,
    };
    if (casoTieneCoordsValidas(c)) {
      ubicados.push({
        ...base,
        lat: Number(c.ubicacionPredio.lat),
        lng: Number(c.ubicacionPredio.lng),
      });
    } else {
      const sinDireccion = !esDireccionPredioGeocodableBbvaCat(c.direccionPredio);
      sinUbicar.push({
        ...base,
        motivoSinUbicar: sinDireccion ? 'sin_direccion' : 'geocode_fallido',
      });
    }
  }

  const sinDireccionCount = sinUbicar.filter((c) => c.motivoSinUbicar === 'sin_direccion').length;
  const geocodeFallidoCount = sinUbicar.filter((c) => c.motivoSinUbicar === 'geocode_fallido').length;

  const bloques = clusterizarPorRadio(ubicados, radioKm);
  return {
    radioKm: Math.max(0.1, Number(radioKm) || 2.5),
    totalCasos: casos.length,
    omitidosInspeccionados,
    planificar: casos.length - omitidosInspeccionados,
    ubicados: ubicados.length,
    sinUbicarCount: sinUbicar.length,
    sinDireccionCount,
    geocodeFallidoCount,
    bloques,
    sinUbicar,
  };
}
