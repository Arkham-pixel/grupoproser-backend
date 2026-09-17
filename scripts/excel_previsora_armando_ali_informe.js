/**
 * Excel Previsora: casos del ajustador Armando Fontalvo y del inspector Ali,
 * con columna de si tienen informe lleno o no.
 *
 * Uso: node scripts/excel_previsora_armando_ali_informe.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FUENTES = [
  { modulo: 'Previsora CAT', coleccion: 'gsk3cAppprevisoraCasos' },
  { modulo: 'Previsora listado', coleccion: 'gsk3cAppprevisoraListadoCasos' },
];

const ETIQUETAS_INFORME = new Set(['INFORME_UNICO', 'INFORME_PRELIMINAR', 'INFORME_FINAL']);

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function tokens(valor) {
  return norm(valor)
    .split(' ')
    .filter((t) => t.length >= 2);
}

function esArmandoFontalvo(nombre) {
  const n = norm(nombre);
  if (!n) return false;
  return n.includes('FONTALVO') && n.includes('ARMANDO');
}

function esInspectorAli(nombre) {
  const n = norm(nombre);
  if (!n) return false;
  if (n.includes('ALI SAID') || n.includes('SOTO LISCANO')) return true;
  const toks = tokens(nombre);
  if (!toks.includes('ALI')) return false;
  if (toks.some((t) => t.startsWith('ALICIA') || t === 'ALISON' || t === 'ALINA')) return false;
  return toks[0] === 'ALI' || n.includes('ALI SOTO');
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

function evaluarInforme(doc) {
  const inf = doc.informeUnico && typeof doc.informeUnico === 'object' ? doc.informeUnico : null;
  const archivos = Array.isArray(doc.archivos) ? doc.archivos : [];
  const narrativa = [];
  if (textoLargo(inf?.descripcionDanios)) narrativa.push('descripción de daños');
  if (textoLargo(inf?.conclusiones)) narrativa.push('conclusiones');
  if (textoLargo(inf?.recomendacion)) narrativa.push('recomendación');
  if (textoLargo(inf?.analisisCobertura)) narrativa.push('análisis de cobertura');
  if (textoLargo(inf?.analisisNexoCausal)) narrativa.push('nexo causal');
  const fotos = Array.isArray(inf?.fotosInspeccion) ? inf.fotosInspeccion.length : 0;
  const archivosInf = archivos.filter((a) =>
    ETIQUETAS_INFORME.has(String(a?.etiqueta || '').trim().toUpperCase())
  );
  const tiene = narrativa.length > 0 || fotos > 0 || archivosInf.length > 0;
  const detalles = [];
  if (narrativa.length) detalles.push(narrativa.join(', '));
  if (fotos) detalles.push(`${fotos} foto(s) de inspección`);
  if (archivosInf.length) {
    detalles.push(
      archivosInf
        .map((a) => a.etiqueta || a.nombreOriginal || 'archivo informe')
        .join(', ')
    );
  }
  return {
    tieneInforme: tiene ? 'SI' : 'NO',
    tipoInforme: inf?.tipoInforme || (archivosInf[0]?.etiqueta || ''),
    detalleInforme: tiene ? detalles.join('; ') : 'Sin informe lleno',
  };
}

function filaBase(doc, fuente, persona, rol, informe) {
  return {
    Persona: persona,
    Rol: rol,
    Modulo: fuente.modulo,
    Consecutivo: doc.consecutivo || '',
    'No. caso': doc.noCaso || '',
    Siniestro: doc.siniestro || '',
    ZC: doc.zc || '',
    Asegurado: doc.asegurado || '',
    Identificacion: doc.identificacion || '',
    Ciudad: doc.ciudad || '',
    Estado: doc.estado || '',
    Ajustador: doc.ajustador || '',
    Inspector: doc.inspector || '',
    'Ajustador lider': doc.ajustadorLider || '',
    'Tiene informe': informe.tieneInforme,
    'Tipo informe': informe.tipoInforme || '',
    'Detalle informe': informe.detalleInforme,
    'Fecha siniestro': fechaTxt(doc.fechaSiniestro),
    'Fecha asignacion': fechaTxt(doc.fechaAsignacion),
    Actualizado: fechaTxt(doc.updatedAt),
  };
}

function matchRegexNombre(fragmento) {
  return { $regex: fragmento, $options: 'i' };
}

const COLUMNAS = [
  ['Persona', 22],
  ['Rol', 16],
  ['Modulo', 20],
  ['Consecutivo', 28],
  ['No. caso', 16],
  ['Siniestro', 16],
  ['ZC', 14],
  ['Asegurado', 36],
  ['Identificacion', 16],
  ['Ciudad', 18],
  ['Estado', 22],
  ['Ajustador', 24],
  ['Inspector', 28],
  ['Ajustador lider', 24],
  ['Tiene informe', 16],
  ['Tipo informe', 16],
  ['Detalle informe', 48],
  ['Fecha siniestro', 16],
  ['Fecha asignacion', 18],
  ['Actualizado', 14],
];

function pintarHoja(wb, nombre, filas) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNAS.map(([header, width]) => ({ header, key: header, width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  for (const fila of filas) {
    const row = ws.addRow(fila);
    const celda = row.getCell('Tiene informe');
    if (fila['Tiene informe'] === 'SI') {
      celda.font = { bold: true, color: { argb: 'FF166534' } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
    } else {
      celda.font = { bold: true, color: { argb: 'FF991B1B' } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    }
  }
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, filas.length + 1), column: COLUMNAS.length },
  };
  return ws;
}

async function main() {
  const db = await conectarMongoRobusto();

  const [inspectoresCat, ajustadoresCat] = await Promise.all([
    db.collection('gsk3cAppinspectorcatastrofico').find({
      nombre: matchRegexNombre('Ali'),
    }).project({ codigo: 1, nombre: 1, ciudad: 1 }).toArray(),
    db.collection('gsk3cAppajustadorcatastrofico').find({
      $or: [{ nombre: matchRegexNombre('Fontalvo') }, { nombre: matchRegexNombre('Ali') }],
    }).project({ codigo: 1, nombre: 1 }).toArray(),
  ]);

  const aliInspectores = inspectoresCat.filter((r) => esInspectorAli(r.nombre));
  console.log('Inspectores Ali:', aliInspectores);
  console.log('Ajustadores CAT coincidentes:', ajustadoresCat);

  const filasArmando = [];
  const filasAli = [];
  const nombresAjustador = new Map();
  const nombresInspector = new Map();

  for (const fuente of FUENTES) {
    const docs = await db.collection(fuente.coleccion)
      .find({
        $or: [
          { ajustador: matchRegexNombre('Fontalvo') },
          { ajustador: matchRegexNombre('Armando') },
          { ajustadorLider: matchRegexNombre('Fontalvo') },
          { inspector: matchRegexNombre('Ali') },
        ],
      })
      .project({
        consecutivo: 1,
        noCaso: 1,
        siniestro: 1,
        zc: 1,
        asegurado: 1,
        identificacion: 1,
        ciudad: 1,
        estado: 1,
        ajustador: 1,
        inspector: 1,
        ajustadorLider: 1,
        fechaSiniestro: 1,
        fechaAsignacion: 1,
        updatedAt: 1,
        informeUnico: 1,
        'archivos.etiqueta': 1,
        'archivos.nombreOriginal': 1,
      })
      .toArray();

    for (const doc of docs) {
      if (doc.ajustador) {
        nombresAjustador.set(doc.ajustador, (nombresAjustador.get(doc.ajustador) || 0) + 1);
      }
      if (doc.inspector) {
        nombresInspector.set(doc.inspector, (nombresInspector.get(doc.inspector) || 0) + 1);
      }
      const informe = evaluarInforme(doc);
      if (esArmandoFontalvo(doc.ajustador) || esArmandoFontalvo(doc.ajustadorLider)) {
        const rol = esArmandoFontalvo(doc.ajustador) ? 'Ajustador' : 'Ajustador líder';
        filasArmando.push(filaBase(doc, fuente, 'Armando Fontalvo', rol, informe));
      }
      if (esInspectorAli(doc.inspector)) {
        filasAli.push(filaBase(doc, fuente, 'Ali Said Soto Liscano', 'Inspector', informe));
      }
    }
    console.log(`${fuente.modulo}: ${docs.length} candidatos`);
  }

  const ordenar = (a, b) =>
    String(a.Modulo).localeCompare(String(b.Modulo)) ||
    String(a['Tiene informe']).localeCompare(String(b['Tiene informe'])) ||
    String(a.Siniestro).localeCompare(String(b.Siniestro), undefined, { numeric: true }) ||
    String(a.Consecutivo).localeCompare(String(b.Consecutivo), undefined, { numeric: true });

  filasArmando.sort(ordenar);
  filasAli.sort(ordenar);

  const contar = (filas, siNo) => filas.filter((f) => f['Tiene informe'] === siNo).length;
  console.log('Ajustadores vistos:', [...nombresAjustador.entries()]);
  console.log('Inspectores vistos:', [...nombresInspector.entries()]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grupo Proser';
  wb.created = new Date();

  const resumen = wb.addWorksheet('Resumen');
  resumen.columns = [
    { header: 'Concepto', key: 'Concepto', width: 48 },
    { header: 'Cantidad', key: 'Cantidad', width: 50 },
  ];
  resumen.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  resumen.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  const filasResumen = [
    { Concepto: 'Módulo', Cantidad: 'Previsora (CAT + listado)' },
    { Concepto: 'Casos Armando Fontalvo (ajustador)', Cantidad: filasArmando.length },
    { Concepto: 'Armando CON informe', Cantidad: contar(filasArmando, 'SI') },
    { Concepto: 'Armando SIN informe', Cantidad: contar(filasArmando, 'NO') },
    { Concepto: 'Casos Ali inspector', Cantidad: filasAli.length },
    { Concepto: 'Ali CON informe', Cantidad: contar(filasAli, 'SI') },
    { Concepto: 'Ali SIN informe', Cantidad: contar(filasAli, 'NO') },
    {
      Concepto: 'Inspector Ali en catálogo',
      Cantidad: aliInspectores.map((x) => x.nombre).join(', ') || 'Ali Said Soto Liscano',
    },
    { Concepto: 'Fecha de este Excel', Cantidad: new Date().toISOString() },
    {
      Concepto: 'Criterio de informe',
      Cantidad:
        'Informe lleno = textos >40 caracteres, fotos de inspección o archivo INFORME_UNICO / PRELIMINAR / FINAL',
    },
  ];
  filasResumen.forEach((f) => resumen.addRow(f));

  pintarHoja(wb, 'Armando Fontalvo', filasArmando);
  pintarHoja(wb, 'Ali inspector', filasAli);
  pintarHoja(wb, 'Con informe', [
    ...filasArmando.filter((f) => f['Tiene informe'] === 'SI'),
    ...filasAli.filter((f) => f['Tiene informe'] === 'SI'),
  ]);
  pintarHoja(wb, 'Sin informe', [
    ...filasArmando.filter((f) => f['Tiene informe'] === 'NO'),
    ...filasAli.filter((f) => f['Tiene informe'] === 'NO'),
  ]);

  const nombre = `previsora_armando_fontalvo_ali_informe_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const destinos = [
    path.join(__dirname, '..', '..', nombre),
    path.join(process.env.USERPROFILE || '', 'Desktop', nombre),
    path.join(process.env.USERPROFILE || '', 'Downloads', nombre),
  ];
  for (const destino of destinos) {
    try {
      await wb.xlsx.writeFile(destino);
      console.log('Excel:', destino);
    } catch (err) {
      console.warn('No se pudo escribir', destino, err.message);
    }
  }

  console.log(
    `Armando ${filasArmando.length} (SI ${contar(filasArmando, 'SI')} / NO ${contar(filasArmando, 'NO')}) | Ali ${filasAli.length} (SI ${contar(filasAli, 'SI')} / NO ${contar(filasAli, 'NO')})`
  );

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
