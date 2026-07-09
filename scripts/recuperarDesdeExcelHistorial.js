import { resolveFileForRead } from '../services/fileStorageService.js';
import { controlHorasTieneDatos } from '../utils/controlHorasUtils.js';
import { importarControlHorasDesdeBuffer } from './lib/importarControlHorasDesdeBuffer.js';

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function referenciaDocumento(doc) {
  return doc?.ruta || doc?.url || doc?.path || '';
}

/**
 * Intenta reconstruir control_horas desde el Excel adjunto en historialDocs.
 */
export async function controlHorasDesdeHistorialDocs(caso) {
  const docs = (caso.historialDocs || []).filter(
    (d) =>
      (d.tipo === 'controlHoras' || d.categoria === 'controlHoras') &&
      /\.xlsx?/i.test(d.nombre || d.filename || '')
  );

  if (!docs.length) return null;

  for (let i = docs.length - 1; i >= 0; i -= 1) {
    const doc = docs[i];
    const ref = referenciaDocumento(doc);
    if (!ref) continue;

    try {
      const resolved = await resolveFileForRead(ref);
      if (!resolved?.stream) {
        console.warn('  ⚠️ Archivo no encontrado:', doc.nombre || ref);
        continue;
      }

      const buffer = await streamToBuffer(resolved.stream);
      const { normalizado, totales } = await importarControlHorasDesdeBuffer(
        buffer,
        doc.nombre || doc.filename || 'control.xlsx',
        {
        formData: {
          codiAsgrdra: caso.codiAsgrdra,
          nombreCliente: caso.asgrBenfcro,
          fchaAsgncion: caso.fchaAsgncion,
        },
        nombreAseguradora: caso.codiAsgrdra || caso.asgrBenfcro || '',
        }
      );

      if (!controlHorasTieneDatos(normalizado)) {
        console.warn('  ⚠️ Excel sin filas válidas:', doc.nombre);
        continue;
      }

      return {
        controlHoras: normalizado,
        resumenControlHoras: {
          subtotal_honorarios: totales.subtotal_honorarios,
          gastos: totales.gastos,
          total_horas: totales.total_horas,
        },
        origen: `historial:${doc.nombre || doc.filename}`,
      };
    } catch (error) {
      console.warn('  ⚠️ Error leyendo Excel:', doc.nombre, '-', error.message);
    }
  }

  return null;
}
