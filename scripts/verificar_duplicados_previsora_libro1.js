/**
 * Cruza Libro1 (2).xlsx (Previsora sin duplicados) con ARNALD
 * y reporta grupos duplicados + cuál ficha tiene documentación.
 *
 * Uso: node scripts/verificar_duplicados_previsora_libro1.js
 */
import path from 'path';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';

const EXCEL_PATH = path.join(
  process.env.USERPROFILE || '',
  'Downloads',
  'Libro1 (2).xlsx'
);

const ETIQUETAS_INFORME = new Set(['INFORME_UNICO', 'INFORME_PRELIMINAR', 'INFORME_FINAL']);

function cellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((p) => p.text || '').join('');
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function normClave(valor) {
  if (valor == null || valor === '') return '';
  let t = String(valor)
    .replace(/[\u00A0\t]/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '');
  t = t.replace(/\.0+$/, '');
  return t;
}

function headerKey(valor) {
  return cellText(valor)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/[_\-\/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function textoLargo(valor, min = 40) {
  return String(valor ?? '').trim().length > min;
}

function fechaTxt(valor) {
  if (!valor) return '';
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toISOString().slice(0, 10);
}

function evaluarDoc(doc) {
  const inf = doc.informeUnico && typeof doc.informeUnico === 'object' ? doc.informeUnico : null;
  const archivos = Array.isArray(doc.archivos) ? doc.archivos : [];
  const nArchivos = archivos.length;
  const archivosInf = archivos.filter((a) =>
    ETIQUETAS_INFORME.has(String(a?.etiqueta || '').trim().toUpperCase())
  );
  const narrativa =
    textoLargo(inf?.descripcionDanios) ||
    textoLargo(inf?.conclusiones) ||
    textoLargo(inf?.recomendacion) ||
    textoLargo(inf?.analisisCobertura) ||
    textoLargo(inf?.analisisNexoCausal);
  const fotos = Array.isArray(inf?.fotosInspeccion) ? inf.fotosInspeccion.length : 0;
  const tieneInforme = Boolean(narrativa || fotos || archivosInf.length);
  const tieneLiquidador = Boolean(doc.liquidador && typeof doc.liquidador === 'object');
  const historial = String(doc.historialCatastroficoId || '').trim();
  let score = 0;
  score += Math.min(40, nArchivos * 4);
  if (tieneInforme) score += 30;
  if (tieneLiquidador) score += 15;
  if (historial) score += 8;
  if (doc.inspector) score += 2;
  if (doc.ajustador) score += 2;
  if (doc.estado && !['CASO NUEVO', 'Sin contactar'].includes(doc.estado)) score += 5;
  const detalles = [];
  if (nArchivos) detalles.push(`${nArchivos} archivo(s)`);
  if (tieneInforme) detalles.push(archivosInf.length ? 'informe archivado' : 'informe lleno');
  if (tieneLiquidador) detalles.push('liquidador');
  if (fotos) detalles.push(`${fotos} foto(s) informe`);
  return {
    nArchivos,
    tieneInforme: tieneInforme ? 'SI' : 'NO',
    tieneLiquidador: tieneLiquidador ? 'SI' : 'NO',
    tieneDocumentacion: nArchivos > 0 || tieneInforme || tieneLiquidador ? 'SI' : 'NO',
    detalleDocumentacion: detalles.length ? detalles.join('; ') : 'Sin documentación',
    score,
  };
}

function filaCaso(doc, fuente) {
  const d = evaluarDoc(doc);
  return {
    id: String(doc._id),
    fuente,
    consecutivo: doc.consecutivo || '',
    noCaso: doc.noCaso || '',
    siniestro: doc.siniestro || '',
    zc: doc.zc || '',
    identificacion: doc.identificacion || '',
    asegurado: doc.asegurado || '',
    ciudad: doc.ciudad || '',
    estado: doc.estado || '',
    ajustador: doc.ajustador || '',
    inspector: doc.inspector || '',
    actualizado: fechaTxt(doc.updatedAt),
    ...d,
  };
}

function mapHeaders(ws, headerRowNum) {
  const map = {};
  const row = ws.getRow(headerRowNum);
  const maxC = Math.max(ws.columnCount || 0, 90);
  for (let c = 1; c <= maxC; c += 1) {
    const k = headerKey(row.getCell(c).value);
    if (k && map[k] == null) map[k] = c;
  }
  return map;
}

function col(map, ...nombres) {
  for (const n of nombres) {
    if (map[n] != null) return map[n];
  }
  return null;
}

async function leerExcel() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);
  const ws = wb.worksheets[0];
  const headers = mapHeaders(ws, 3);
  const cCaso = col(headers, 'NO CASO');
  const cSin = col(headers, 'NO SINIESTRO');
  const cAseg = col(headers, 'ASEGURADO');
  const cId = col(headers, 'ID ASEGURADO');
  const cCiudad = col(headers, 'CIUDAD SINIESTRO', 'CIUDAD');
  const cEstado = col(headers, 'ESTADO');
  const cPoliza = col(headers, 'POLIZA');
  const filas = [];
  for (let r = 4; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const noCaso = cellText(cCaso ? row.getCell(cCaso).value : '');
    const siniestro = cellText(cSin ? row.getCell(cSin).value : '');
    if (!normClave(noCaso) && !normClave(siniestro)) continue;
    filas.push({
      filaExcel: r,
      noCaso: String(noCaso).replace(/\.0$/, ''),
      siniestro: String(siniestro).replace(/\.0$/, ''),
      asegurado: cellText(cAseg ? row.getCell(cAseg).value : ''),
      identificacion: cellText(cId ? row.getCell(cId).value : ''),
      ciudad: cellText(cCiudad ? row.getCell(cCiudad).value : ''),
      estadoExcel: cellText(cEstado ? row.getCell(cEstado).value : ''),
      poliza: cellText(cPoliza ? row.getCell(cPoliza).value : ''),
    });
  }
  return { hoja: ws.name, headers: Object.keys(headers), filas };
}

function clavesDe(siniestro, noCaso) {
  const s = normClave(siniestro);
  const c = normClave(noCaso);
  const keys = [];
  if (s && c) keys.push(`SC:${s}|${c}`);
  if (s) keys.push(`S:${s}`);
  if (c) keys.push(`C:${c}`);
  return keys;
}

function pintarHoja(wb, nombre, filas, columnas) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columnas.map(([header, width]) => ({ header, key: header, width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  for (const fila of filas) ws.addRow(fila);
  if (filas.length) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: filas.length + 1, column: columnas.length },
    };
  }
}

async function main() {
  const { hoja, filas: excelFilas } = await leerExcel();
  console.log(`Excel ${hoja}: ${excelFilas.length} filas`);

  const db = await conectarMongoRobusto();
  const [listado, cat] = await Promise.all([
    db.collection('gsk3cAppprevisoraListadoCasos')
      .find({})
      .project({
        consecutivo: 1,
        noCaso: 1,
        siniestro: 1,
        zc: 1,
        identificacion: 1,
        asegurado: 1,
        ciudad: 1,
        estado: 1,
        ajustador: 1,
        inspector: 1,
        updatedAt: 1,
        informeUnico: 1,
        liquidador: 1,
        historialCatastroficoId: 1,
        'archivos.etiqueta': 1,
        'archivos.nombreOriginal': 1,
      })
      .toArray(),
    db.collection('gsk3cAppprevisoraCasos')
      .find({})
      .project({
        consecutivo: 1,
        siniestro: 1,
        zc: 1,
        identificacion: 1,
        asegurado: 1,
        ciudad: 1,
        estado: 1,
        ajustador: 1,
        inspector: 1,
        updatedAt: 1,
        informeUnico: 1,
        liquidador: 1,
        historialCatastroficoId: 1,
        'archivos.etiqueta': 1,
        'archivos.nombreOriginal': 1,
      })
      .toArray(),
  ]);

  const arnald = [
    ...listado.map((d) => filaCaso(d, 'Previsora listado')),
    ...cat.map((d) => filaCaso(d, 'Previsora CAT')),
  ];
  console.log(`ARNALD listado=${listado.length} CAT=${cat.length}`);

  const grupos = new Map();
  const idxSC = new Map();
  const idxS = new Map();
  const idxC = new Map();
  for (const x of excelFilas) {
    const s = normClave(x.siniestro);
    const c = normClave(x.noCaso);
    const clave = s && c ? `SC:${s}|${c}` : s ? `S:${s}` : `C:${c}`;
    if (!grupos.has(clave)) grupos.set(clave, { excel: x, matches: [], clave });
    if (s && c) idxSC.set(`${s}|${c}`, clave);
    if (s && !idxS.has(s)) idxS.set(s, clave);
    if (c && !idxC.has(c)) idxC.set(c, clave);
  }

  const resolverClaveExcel = (caso) => {
    const s = normClave(caso.siniestro);
    const c = normClave(caso.noCaso);
    if (s && c && idxSC.has(`${s}|${c}`)) return idxSC.get(`${s}|${c}`);
    if (s && idxS.has(s)) return idxS.get(s);
    if (c && idxC.has(c)) return idxC.get(c);
    return null;
  };

  const usados = new Set();
  for (const caso of arnald) {
    const hit = resolverClaveExcel(caso);
    if (!hit) continue;
    grupos.get(hit).matches.push(caso);
    usados.add(caso.id);
  }

  const duplicados = [];
  const unicos = [];
  const excelSinArnald = [];
  for (const g of grupos.values()) {
    if (g.matches.length > 1) {
      const orden = [...g.matches].sort((a, b) => b.score - a.score || String(b.actualizado).localeCompare(String(a.actualizado)));
      const keeper = orden[0];
      const conDoc = orden.filter((c) => c.tieneDocumentacion === 'SI');
      const sinDoc = orden.filter((c) => c.tieneDocumentacion === 'NO');
      duplicados.push({
        clave: g.clave,
        noCaso: g.excel.noCaso,
        siniestro: g.excel.siniestro,
        aseguradoExcel: g.excel.asegurado,
        identificacionExcel: g.excel.identificacion,
        ciudadExcel: g.excel.ciudad,
        nFichas: orden.length,
        nConDocumentacion: conDoc.length,
        nSinDocumentacion: sinDoc.length,
        conservar: `${keeper.fuente} · ${keeper.consecutivo || keeper.id} · score ${keeper.score} · ${keeper.detalleDocumentacion}`,
        fichas: orden,
      });
    } else if (g.matches.length === 1) {
      unicos.push({ excel: g.excel, caso: g.matches[0] });
    } else {
      excelSinArnald.push(g.excel);
    }
  }

  const arnaldSinExcel = arnald.filter((c) => !usados.has(c.id));

  // Duplicados internos ARNALD no vistos por Excel (misma clave S o C)
  const internos = new Map();
  for (const caso of arnald) {
    for (const k of clavesDe(caso.siniestro, caso.noCaso).filter((x) => x.startsWith('S:') || x.startsWith('C:'))) {
      if (!internos.has(k)) internos.set(k, []);
      internos.get(k).push(caso);
    }
  }

  const duplicadosInternos = [...internos.entries()]
    .filter(([, arr]) => {
      const ids = new Set(arr.map((x) => x.id));
      return ids.size > 1;
    })
    .map(([clave, arr]) => {
      const uniq = [...new Map(arr.map((x) => [x.id, x])).values()].sort((a, b) => b.score - a.score);
      return { clave, nFichas: uniq.length, fichas: uniq };
    });

  duplicados.sort((a, b) => b.nFichas - a.nFichas || String(a.siniestro).localeCompare(String(b.siniestro), undefined, { numeric: true }));

  const filasDup = [];
  for (const g of duplicados) {
    g.fichas.forEach((f, i) => {
      filasDup.push({
        Grupo: g.clave,
        'No. caso Excel': g.noCaso,
        'Siniestro Excel': g.siniestro,
        Asegurado: g.aseguradoExcel,
        Identificacion: g.identificacionExcel,
        Ciudad: g.ciudadExcel,
        'Fichas en ARNALD': g.nFichas,
        'Con documentacion': g.nConDocumentacion,
        Rol: i === 0 ? 'CONSERVAR (más documentación)' : 'DUPLICADO',
        Fuente: f.fuente,
        Consecutivo: f.consecutivo,
        'No. caso ARNALD': f.noCaso,
        'Siniestro ARNALD': f.siniestro,
        ZC: f.zc,
        Estado: f.estado,
        Ajustador: f.ajustador,
        Inspector: f.inspector,
        'Tiene documentacion': f.tieneDocumentacion,
        Archivos: f.nArchivos,
        Informe: f.tieneInforme,
        Liquidador: f.tieneLiquidador,
        Detalle: f.detalleDocumentacion,
        Score: f.score,
        Actualizado: f.actualizado,
        'Id Mongo': f.id,
      });
    });
  }

  const resumen = [
    { Concepto: 'Filas Excel (Libro1 sin duplicados)', Cantidad: excelFilas.length },
    { Concepto: 'Casos Previsora listado', Cantidad: listado.length },
    { Concepto: 'Casos Previsora CAT', Cantidad: cat.length },
    { Concepto: 'Total fichas ARNALD', Cantidad: arnald.length },
    { Concepto: 'Excel con 1 ficha en ARNALD', Cantidad: unicos.length },
    { Concepto: 'Excel con 2+ fichas (duplicados)', Cantidad: duplicados.length },
    { Concepto: 'Fichas extra en duplicados', Cantidad: duplicados.reduce((n, g) => n + g.nFichas - 1, 0) },
    { Concepto: 'Duplicados donde ALGUNA ficha tiene docs', Cantidad: duplicados.filter((g) => g.nConDocumentacion > 0).length },
    { Concepto: 'Duplicados donde NINGUNA tiene docs', Cantidad: duplicados.filter((g) => g.nConDocumentacion === 0).length },
    { Concepto: 'Duplicados donde VARIAS tienen docs', Cantidad: duplicados.filter((g) => g.nConDocumentacion > 1).length },
    { Concepto: 'Excel sin match en ARNALD', Cantidad: excelSinArnald.length },
    { Concepto: 'ARNALD sin match en Excel', Cantidad: arnaldSinExcel.length },
    { Concepto: 'Fecha', Cantidad: new Date().toISOString() },
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grupo Proser';
  const wsR = wb.addWorksheet('Resumen');
  wsR.columns = [
    { header: 'Concepto', key: 'Concepto', width: 52 },
    { header: 'Cantidad', key: 'Cantidad', width: 18 },
  ];
  wsR.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  wsR.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  resumen.forEach((f) => wsR.addRow(f));

  pintarHoja(
    wb,
    'Duplicados',
    filasDup,
    [
      ['Grupo', 28],
      ['No. caso Excel', 14],
      ['Siniestro Excel', 16],
      ['Asegurado', 36],
      ['Identificacion', 16],
      ['Ciudad', 16],
      ['Fichas en ARNALD', 16],
      ['Con documentacion', 18],
      ['Rol', 28],
      ['Fuente', 20],
      ['Consecutivo', 28],
      ['No. caso ARNALD', 16],
      ['Siniestro ARNALD', 16],
      ['ZC', 14],
      ['Estado', 22],
      ['Ajustador', 22],
      ['Inspector', 24],
      ['Tiene documentacion', 18],
      ['Archivos', 12],
      ['Informe', 12],
      ['Liquidador', 12],
      ['Detalle', 40],
      ['Score', 10],
      ['Actualizado', 14],
      ['Id Mongo', 26],
    ]
  );

  pintarHoja(
    wb,
    'Excel sin ARNALD',
    excelSinArnald.map((x) => ({
      'Fila Excel': x.filaExcel,
      'No. caso': x.noCaso,
      Siniestro: x.siniestro,
      Asegurado: x.asegurado,
      Identificacion: x.identificacion,
      Ciudad: x.ciudad,
      Estado: x.estadoExcel,
    })),
    [
      ['Fila Excel', 12],
      ['No. caso', 14],
      ['Siniestro', 16],
      ['Asegurado', 36],
      ['Identificacion', 16],
      ['Ciudad', 16],
      ['Estado', 16],
    ]
  );

  pintarHoja(
    wb,
    'ARNALD sin Excel',
    arnaldSinExcel.map((c) => ({
      Fuente: c.fuente,
      Consecutivo: c.consecutivo,
      'No. caso': c.noCaso,
      Siniestro: c.siniestro,
      ZC: c.zc,
      Asegurado: c.asegurado,
      Identificacion: c.identificacion,
      Ciudad: c.ciudad,
      Estado: c.estado,
      'Tiene documentacion': c.tieneDocumentacion,
      Detalle: c.detalleDocumentacion,
      Score: c.score,
    })),
    [
      ['Fuente', 20],
      ['Consecutivo', 28],
      ['No. caso', 14],
      ['Siniestro', 16],
      ['ZC', 14],
      ['Asegurado', 36],
      ['Identificacion', 16],
      ['Ciudad', 16],
      ['Estado', 22],
      ['Tiene documentacion', 18],
      ['Detalle', 36],
      ['Score', 10],
    ]
  );

  const nombre = `previsora_duplicados_vs_libro1_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const destinos = [
    path.join(process.env.USERPROFILE || '', 'Desktop', nombre),
    path.join(process.env.USERPROFILE || '', 'Downloads', nombre),
  ];
  for (const d of destinos) {
    await wb.xlsx.writeFile(d);
    console.log('Excel:', d);
  }

  const payload = {
    resumen: Object.fromEntries(resumen.map((r) => [r.Concepto, r.Cantidad])),
    duplicados: duplicados.map((g) => ({
      noCaso: g.noCaso,
      siniestro: g.siniestro,
      asegurado: g.aseguradoExcel,
      identificacion: g.identificacionExcel,
      ciudad: g.ciudadExcel,
      nFichas: g.nFichas,
      nConDocumentacion: g.nConDocumentacion,
      nSinDocumentacion: g.nSinDocumentacion,
      conservar: g.conservar,
      fichas: g.fichas.map((f) => ({
        fuente: f.fuente,
        consecutivo: f.consecutivo,
        noCaso: f.noCaso,
        siniestro: f.siniestro,
        estado: f.estado,
        ajustador: f.ajustador,
        inspector: f.inspector,
        tieneDocumentacion: f.tieneDocumentacion,
        nArchivos: f.nArchivos,
        tieneInforme: f.tieneInforme,
        tieneLiquidador: f.tieneLiquidador,
        detalle: f.detalleDocumentacion,
        score: f.score,
      })),
    })),
    excelSinArnald: excelSinArnald.slice(0, 30),
    arnaldSinExcelResumen: {
      listado: arnaldSinExcel.filter((c) => c.fuente.includes('listado')).length,
      cat: arnaldSinExcel.filter((c) => c.fuente.includes('CAT')).length,
      conDocs: arnaldSinExcel.filter((c) => c.tieneDocumentacion === 'SI').length,
    },
    duplicadosInternosTop: duplicadosInternos.slice(0, 5).map((g) => ({
      clave: g.clave,
      n: g.nFichas,
    })),
  };

  const fs = await import('fs');
  const jsonPath = path.join(
    process.env.USERPROFILE || '',
    'Downloads',
    'previsora_duplicados_vs_libro1.json'
  );
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  console.log('JSON:', jsonPath);
  console.log(JSON.stringify(payload.resumen, null, 2));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
