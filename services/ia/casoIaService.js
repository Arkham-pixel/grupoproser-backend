/**
 * Contexto de caso CAT para el asistente: metadatos + bytes de fotos y PDF
 * de cotización (visión / lectura real, no solo nombres de archivo).
 */
import sharp from 'sharp';
import { cargarCasoVinculado, normalizarModulo } from '../videoperitajeCasoService.js';
import { parseS3KeyFromStoredPath } from '../../utils/storageKeyBuilder.js';
import { getObjectStream } from '../s3StorageService.js';
import { resolveFileForRead } from '../fileStorageService.js';

const MAX_FOTOS = 4;
const MAX_PDF = 1;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

async function leerBufferDesdeRuta(ruta) {
  if (!ruta) return null;
  try {
    const key = parseS3KeyFromStoredPath(ruta);
    if (key) {
      const obj = await getObjectStream(key);
      return streamToBuffer(obj.Body);
    }
    const resolved = await resolveFileForRead(ruta);
    if (resolved?.stream) return streamToBuffer(resolved.stream);
    if (resolved?.localPath) {
      const fs = await import('fs/promises');
      return fs.readFile(resolved.localPath);
    }
  } catch (err) {
    console.warn('[ia] no se pudo leer', String(ruta).slice(0, 80), err?.message || err);
  }
  return null;
}

function esFotoArchivo(a) {
  const et = String(a?.etiqueta || '').toUpperCase();
  const nombre = String(a?.nombreOriginal || a?.nombreArchivo || a?.nombre || '');
  if (et === 'COTIZACION') return false;
  return (
    et === 'FOTOS' ||
    et === 'VIDEOPERITAJE' ||
    et === 'INSPECCION' ||
    et.startsWith('FOTO_') ||
    /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(nombre) ||
    String(a?.tipoMime || '').startsWith('image/')
  );
}

function esPdfCotizacion(a) {
  const et = String(a?.etiqueta || '').toUpperCase();
  const nombre = String(a?.nombreOriginal || a?.nombreArchivo || a?.nombre || '');
  const mime = String(a?.tipoMime || '');
  return (
    et === 'COTIZACION' ||
    mime === 'application/pdf' ||
    /\.pdf$/i.test(nombre)
  );
}

function sampleFotos(fotos) {
  const sorted = [...fotos].sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  if (sorted.length <= MAX_FOTOS) return sorted;
  const picked = [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]];
  const need = MAX_FOTOS - picked.length;
  for (let i = 0; i < need; i += 1) {
    const idx = Math.round(((i + 1) * (sorted.length - 1)) / (need + 1));
    const f = sorted[idx];
    if (f && !picked.includes(f)) picked.push(f);
  }
  return picked.slice(0, MAX_FOTOS);
}

async function jpegVision(buf) {
  return sharp(buf)
    .rotate()
    .resize(960, 960, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 62, mozjpeg: true })
    .toBuffer();
}

function listarCandidatosFoto(caso, informe) {
  const fromArchivos = (caso.archivos || []).filter(esFotoArchivo);
  const fromInforme = (Array.isArray(informe?.fotosInspeccion) ? informe.fotosInspeccion : [])
    .filter((f) => f?.ruta)
    .map((f) => ({
      ruta: f.ruta,
      nombreOriginal: f.nombreOriginal || f.nombre || 'foto-informe.jpg',
      tipoMime: f.tipoMime || 'image/jpeg',
      etiqueta: f.etiqueta || 'FOTOS',
      descripcion: f.descripcion || '',
      orden: f.orden,
    }));
  const byRuta = new Map();
  [...fromArchivos, ...fromInforme].forEach((a) => {
    const k = String(a.ruta || '');
    if (k && !byRuta.has(k)) byRuta.set(k, a);
  });
  return sampleFotos([...byRuta.values()]);
}

function listarPdfs(caso, informe) {
  const fromArchivos = (caso.archivos || []).filter(esPdfCotizacion);
  const fromLiq = [];
  const cot = caso.liquidador?.cotizacionPdf || informe?.cotizacionPdf;
  if (cot?.ruta) {
    fromLiq.push({
      ruta: cot.ruta,
      nombreOriginal: cot.nombreOriginal || 'cotizacion.pdf',
      tipoMime: 'application/pdf',
      etiqueta: 'COTIZACION',
    });
  }
  const byRuta = new Map();
  [...fromArchivos, ...fromLiq].forEach((a) => {
    const k = String(a.ruta || '');
    if (k && !byRuta.has(k)) byRuta.set(k, a);
  });
  return [...byRuta.values()].slice(0, MAX_PDF);
}

export async function construirContextoCasoIa(modulo, casoId, { conBinarios = true } = {}) {
  const caso = await cargarCasoVinculado(modulo, casoId);
  if (!caso) return null;
  const informe = caso.informeUnico && typeof caso.informeUnico === 'object' ? caso.informeUnico : {};
  const fotosMeta = listarCandidatosFoto(caso, informe);
  const pdfsMeta = listarPdfs(caso, informe);

  const adjuntos = [];
  if (conBinarios) {
    for (const f of fotosMeta) {
      const raw = await leerBufferDesdeRuta(f.ruta);
      if (!raw?.length) continue;
      try {
        const jpeg = await jpegVision(raw);
        adjuntos.push({
          tipo: 'image',
          mime: 'image/jpeg',
          base64: jpeg.toString('base64'),
          nombre: f.nombreOriginal || 'foto.jpg',
          descripcion: f.descripcion || '',
        });
      } catch (err) {
        console.warn('[ia] foto no procesable', f.nombreOriginal, err?.message || err);
      }
    }
    for (const p of pdfsMeta) {
      const raw = await leerBufferDesdeRuta(p.ruta);
      if (!raw?.length || raw.length > MAX_PDF_BYTES) continue;
      adjuntos.push({
        tipo: 'pdf',
        mime: 'application/pdf',
        base64: raw.toString('base64'),
        nombre: p.nombreOriginal || 'cotizacion.pdf',
        descripcion: p.descripcion || 'Cotización PDF',
      });
    }
  }

  const texto = [
    `Módulo: ${normalizarModulo(modulo)}`,
    `Expediente: ${caso.consecutivo || ''}`,
    `Siniestro: ${caso.siniestro || ''}`,
    `Asegurado: ${caso.asegurado || ''}`,
    `Dirección: ${caso.direccionPredio || caso.direccion || ''}`,
    `Ciudad: ${caso.ciudad || ''}`,
    `Estado: ${caso.estado || caso.estadoGestion || ''}`,
    '',
    'Campos actuales del informe (pueden estar vacíos):',
    `- infoEvento: ${(informe.infoEvento || '').slice(0, 800)}`,
    `- descripcionDanios: ${(informe.descripcionDanios || '').slice(0, 800)}`,
    `- conclusiones: ${(informe.conclusiones || '').slice(0, 500)}`,
    `- recomendacion: ${(informe.recomendacion || informe.recomendaciones || '').slice(0, 500)}`,
    '',
    `Fotos adjuntas a esta consulta: ${adjuntos.filter((a) => a.tipo === 'image').length} (de ${fotosMeta.length} en el caso).`,
    `PDF cotización adjunto: ${adjuntos.filter((a) => a.tipo === 'pdf').length} (candidatos ${pdfsMeta.length}).`,
    'Archivos:',
    ...fotosMeta.map(
      (a, i) =>
        `- foto ${i + 1}: ${a.nombreOriginal || a.nombreArchivo} [${a.etiqueta || ''}] ${a.descripcion || ''}`
    ),
    ...pdfsMeta.map((a) => `- PDF: ${a.nombreOriginal || a.nombreArchivo} [${a.etiqueta || ''}]`),
  ].join('\n');

  return {
    caso,
    informe,
    texto,
    adjuntos,
    nEvidencias: fotosMeta.length + pdfsMeta.length,
    nAdjuntos: adjuntos.length,
  };
}

export function promptSugerirCamposInforme(contextoTexto) {
  return [
    {
      role: 'system',
      content: `Eres el Asistente Arnald (Grupo Proser). Analizas FOTOS y PDF de cotización del expediente (adjuntos multimodales).
Responde SOLO un JSON válido (sin markdown) con:
{
  "descripcionDanios": "texto profesional en español",
  "conclusiones": "texto profesional en español",
  "recomendacion": "texto profesional en español"
}
REGLAS OBLIGATORIAS:
- NO pidas al usuario que te describa las fotos ni el PDF: ya los tienes adjuntos. Analízalos.
- Basa montos y conceptos en el PDF si está presente; si no hay monto legible, indícalo sin inventar cifras.
- Sé concreto y listo para pegar en el informe del ajustador.`,
    },
    {
      role: 'user',
      content: `Redacta descripción de daños, conclusiones y recomendaciones con base en las evidencias adjuntas y este expediente:\n\n${contextoTexto}`,
    },
  ];
}

export function promptChatConEvidencias(preguntaUsuario, contextoTexto) {
  return [
    {
      role: 'system',
      content: `Eres el Asistente Arnald de Grupo Proser.
Tienes adjuntas las fotos de inspección/videoperitaje y, si existe, el PDF de cotización del caso.
REGLAS:
- NO digas que necesitas que te compartan las fotos o el PDF: ya están adjuntos.
- NO inventes montos ni daños que no se vean en las evidencias.
- Si la pregunta pide conclusiones/recomendaciones, redacta textos listos para el informe (español profesional).
- Si falta una evidencia concreta, dilo en una frase y igual entrega el mejor borrador posible con lo disponible.`,
    },
    {
      role: 'user',
      content: `Expediente:\n${contextoTexto}\n\nPregunta del ajustador:\n${preguntaUsuario}`,
    },
  ];
}

export function parseSugerenciasInforme(text = '') {
  const raw = String(text || '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      descripcionDanios: raw,
      conclusiones: '',
      recomendacion: '',
    };
  }
  try {
    const obj = JSON.parse(jsonMatch[0]);
    return {
      descripcionDanios: String(obj.descripcionDanios || obj.descripcion || '').trim(),
      conclusiones: String(obj.conclusiones || '').trim(),
      recomendacion: String(obj.recomendacion || obj.recomendaciones || '').trim(),
    };
  } catch {
    return { descripcionDanios: raw, conclusiones: '', recomendacion: '' };
  }
}
