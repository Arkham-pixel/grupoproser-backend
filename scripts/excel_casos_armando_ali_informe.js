/**
 * Excel: casos del ajustador Armando Fontalvo y del inspector Ali,
 * con columna de si tienen informe o no.
 *
 * Uso: node scripts/excel_casos_armando_ali_informe.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import { conectarMongoRobusto } from './_conectarMongoRobusto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FUENTES_CAT = [
  { modulo: 'Allianz', coleccion: 'gsk3cAppallianzCasos', tipo: 'cat' },
  { modulo: 'Allianz listado', coleccion: 'gsk3cAppallianzListadoCasos', tipo: 'cat' },
  { modulo: 'Zurich', coleccion: 'gsk3cAppzurichCasos', tipo: 'cat' },
  { modulo: 'Zurich listado', coleccion: 'gsk3cAppzurichListadoCasos', tipo: 'cat' },
  { modulo: 'BBVA CAT', coleccion: 'gsk3cAppbbvaCatCasos', tipo: 'cat' },
  { modulo: 'BBVA CAT listado', coleccion: 'gsk3cAppbbvaCatListadoCasos', tipo: 'cat' },
  { modulo: 'Previsora', coleccion: 'gsk3cAppprevisoraCasos', tipo: 'cat' },
  { modulo: 'Previsora listado', coleccion: 'gsk3cAppprevisoraListadoCasos', tipo: 'cat' },
  { modulo: 'Seguros Alfa', coleccion: 'gsk3cAppsegurosAlfaCasos', tipo: 'cat' },
  { modulo: 'Seguros Sura', coleccion: 'gsk3cAppsegurosSuraCasos', tipo: 'cat' },
  { modulo: 'Equidad CAT', coleccion: 'gsk3cAppequidadCatCasos', tipo: 'cat' },
  { modulo: 'Equidad FDM', coleccion: 'gsk3cAppequidadFdmCasos', tipo: 'fdm' },
];

const ETIQUETAS_INFORME = new Set([
  'INFORME_UNICO',
  'INFORME_PRELIMINAR',
  'INFORME_FINAL',
  'INFORME',
]);

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

function coincidenPersonas(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const tokA = tokens(a);
  const tokB = tokens(b);
  if (!tokA.length || !tokB.length) return false;
  const comunes = tokA.filter((t) => tokB.includes(t));
  return comunes.length >= 2;
}

function esArmandoFontalvo(nombre) {
  const n = norm(nombre);
  if (!n) return false;
  if (n.includes('FONTALVO') && n.includes('ARMANDO')) return true;
  return coincidenPersonas(nombre, 'Armando Fontalvo');
}

function esInspectorAli(nombre) {
  const n = norm(nombre);
  if (!n) return false;
  if (n.includes('ALI SAID') || n.includes('SOTO LISCANO')) return true;
  const toks = tokens(nombre);
  if (!toks.includes('ALI')) return false;
  if (toks.some((t) => t.startsWith('ALICIA') || t === 'ALISON' || t === 'ALINA')) return false;
  return coincidenPersonas(nombre, 'Ali Said Soto Liscano') || toks[0] === 'ALI';
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

function tieneArchivoInforme(archivos = []) {
  if (!Array.isArray(archivos)) return false;
  return archivos.some((a) => {
    const etq = String(a?.etiqueta || '').trim().toUpperCase();
    const nom = String(a?.nombreOriginal || a?.nombre || '').toLowerCase();
    return ETIQUETAS_INFORME.has(etq) || nom.includes('informe') || /\.docx$/i.test(nom);
  });
}

function evaluarInformeCat(doc) {
  const inf = doc.informeUnico && typeof doc.informeUnico === 'object' ? doc.informeUnico : null;
  const agil = doc.informeAgil && typeof doc.informeAgil === 'object' ? doc.informeAgil : null;
  const historial = String(doc.historialCatastroficoId || '').trim();
  const narrativa =
    textoLargo(inf?.descripcionDanios) ||
    textoLargo(inf?.conclusiones) ||
    textoLargo(inf?.recomendacion) ||
    textoLargo(inf?.analisisCobertura) ||
    textoLargo(inf?.analisisNexoCausal);
  const fotos = Array.isArray(inf?.fotosInspeccion) && inf.fotosInspeccion.length > 0;
  const archivo = tieneArchivoInforme(doc.archivos);
  const detalles = [];
  if (narrativa) detalles.push('textos del informe');
  if (fotos) detalles.push('fotos de inspección');
  if (archivo) detalles.push('archivo de informe');
  if (historial) detalles.push('formulario catastrófico');
  if (agil && !narrativa) detalles.push('informe ágil');
  const tiene = Boolean(narrativa || fotos || archivo || historial || (agil && Object.keys(agil).length > 2));
  return {
    tieneInforme: tiene ? 'SI' : 'NO',
    tipoInforme: inf?.tipoInforme || (agil ? 'agil' : '') || '',
    detalleInforme: tiene ? detalles.join('; ') : 'Sin informe',
  };
}

function evaluarInformeFdm(doc) {
  const archivos = Array.isArray(doc.archivos) ? doc.archivos : [];
  const hay = archivos.some((a) => {
    const etq = String(a?.etiqueta || '').trim().toUpperCase();
    const nom = String(a?.nombreOriginal || '').toLowerCase();
    return etq === 'INFORME' || nom.includes('informe');
  });
  return {
    tieneInforme: hay ? 'SI' : 'NO',
    tipoInforme: hay ? 'INFORME' : '',
    detalleInforme: hay ? 'archivo INFORME en archivero' : 'Sin informe',
  };
}

function evaluarInformeComplex(doc) {
  const prelim = Boolean(doc.fchaInfoPrelm || String(doc.anxoInfPrelim || '').trim());
  const final = Boolean(doc.fchaInfoFnal || String(doc.anxoInfoFnal || '').trim());
  const detalles = [];
  if (prelim) detalles.push(`preliminar${doc.fchaInfoPrelm ? ` ${fechaTxt(doc.fchaInfoPrelm)}` : ''}`);
  if (final) detalles.push(`final${doc.fchaInfoFnal ? ` ${fechaTxt(doc.fchaInfoFnal)}` : ''}`);
  return {
    tieneInforme: prelim || final ? 'SI' : 'NO',
    tipoInforme: final ? 'final' : prelim ? 'preliminar' : '',
    detalleInforme: prelim || final ? detalles.join('; ') : 'Sin informe preliminar ni final',
  };
}

function evaluarInformeExpress(doc) {
  const anexos = Array.isArray(doc.anexos) ? doc.anexos : [];
  const hayAnexo = anexos.some((a) => String(a?.nombre || '').toLowerCase().includes('informe'));
  const liq = doc.liquidador && typeof doc.liquidador === 'object';
  const detalles = [];
  if (hayAnexo) detalles.push('anexo informe');
  if (liq) detalles.push('liquidador');
  return {
    tieneInforme: hayAnexo ? 'SI' : 'NO',
    tipoInforme: hayAnexo ? 'anexo' : '',
    detalleInforme: hayAnexo ? detalles.join('; ') : 'Sin anexo de informe',
  };
}

function filaBase(doc, fuente, persona, rol, informe) {
  return {
    Persona: persona,
    Rol: rol,
    Modulo: fuente.modulo,
    Coleccion: fuente.coleccion,
    Consecutivo: doc.consecutivo || doc.nmroAjste || doc.caso || '',
    Siniestro: doc.siniestro || doc.nmroSinstro || doc.numeroSiniestro || '',
    ZC: doc.zc || '',
    Asegurado: doc.asegurado || doc.asgrBenfcro || doc.aseguradoBeneficiario || doc.nombre || '',
    Ciudad: doc.ciudad || doc.ciudadSiniestro || doc.nombreCiudad || doc.municipio || '',
    Estado: doc.estado || doc.descripcionEstado || doc.codiEstdo || doc.estadoProceso || '',
    Ajustador: doc.ajustador || doc.responsable || doc.nombreResponsable || doc.codiRespnsble || '',
    Inspector: doc.inspector || '',
    'Ajustador lider': doc.ajustadorLider || '',
    'Tiene informe': informe.tieneInforme,
    'Tipo informe': informe.tipoInforme,
    'Detalle informe': informe.detalleInforme,
    'Fecha siniestro': fechaTxt(doc.fechaSiniestro || doc.fchaSinstro),
    Actualizado: fechaTxt(doc.updatedAt),
  };
}

function matchRegexNombre(fragmento) {
  return { $regex: fragmento, $options: 'i' };
}

async function main() {
  const db = await conectarMongoRobusto();

  const [responsables, inspectoresCat, ajustadoresCat, usuarios] = await Promise.all([
    db.collection('gsk3cAppresponsable').find({
      $or: [
        { nmbrRespnsble: matchRegexNombre('Fontalvo') },
        { nmbrRespnsble: matchRegexNombre('Armando') },
      ],
    }).project({ codiRespnsble: 1, nmbrRespnsble: 1, email: 1 }).toArray(),
    db.collection('gsk3cAppinspectorcatastrofico').find({
      nombre: matchRegexNombre('Ali'),
    }).project({ codigo: 1, nombre: 1, ciudad: 1 }).toArray(),
    db.collection('gsk3cAppajustadorcatastrofico').find({
      $or: [
        { nombre: matchRegexNombre('Fontalvo') },
        { nombre: matchRegexNombre('Ali') },
      ],
    }).project({ codigo: 1, nombre: 1 }).toArray(),
    db.collection('securUsers').find({
      $or: [
        { name: matchRegexNombre('Fontalvo') },
        { name: matchRegexNombre('Ali Said') },
        { login: matchRegexNombre('fontalvo') },
      ],
    }).project({ login: 1, name: 1, role: 1 }).toArray(),
  ]);

  const armandoResp = responsables.filter((r) => esArmandoFontalvo(r.nmbrRespnsble));
  const codigosArmando = [...new Set(armandoResp.map((r) => String(r.codiRespnsble || '').trim()).filter(Boolean))];
  const aliInspectores = inspectoresCat.filter((r) => esInspectorAli(r.nombre));

  console.log('Responsables Armando:', armandoResp);
  console.log('Códigos Armando:', codigosArmando);
  console.log('Inspectores Ali:', aliInspectores);
  console.log('Ajustadores CAT coincidentes:', ajustadoresCat);
  console.log('Usuarios coincidentes:', usuarios);

  const filasArmando = [];
  const filasAli = [];

  for (const fuente of FUENTES_CAT) {
    const col = db.collection(fuente.coleccion);
    const docs = await col
      .find({
        $or: [
          { ajustador: matchRegexNombre('Fontalvo') },
          { ajustador: matchRegexNombre('Armando') },
          { inspector: matchRegexNombre('Ali') },
          { ajustadorLider: matchRegexNombre('Fontalvo') },
        ],
      })
      .project({
        consecutivo: 1,
        siniestro: 1,
        zc: 1,
        caso: 1,
        asegurado: 1,
        nombre: 1,
        ciudad: 1,
        municipio: 1,
        estado: 1,
        ajustador: 1,
        inspector: 1,
        ajustadorLider: 1,
        fechaSiniestro: 1,
        updatedAt: 1,
        informeUnico: 1,
        informeAgil: 1,
        historialCatastroficoId: 1,
        'archivos.etiqueta': 1,
        'archivos.nombreOriginal': 1,
      })
      .toArray();

    for (const doc of docs) {
      const informe = fuente.tipo === 'fdm' ? evaluarInformeFdm(doc) : evaluarInformeCat(doc);
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

  const complex = await db.collection('gsk3cAppsiniestro')
    .find({
      $or: [
        ...(codigosArmando.length ? [{ codiRespnsble: { $in: codigosArmando } }] : []),
        { codiRespnsble: matchRegexNombre('Fontalvo') },
        { responsable: matchRegexNombre('Fontalvo') },
        { nombreResponsable: matchRegexNombre('Fontalvo') },
      ],
    })
    .project({
      nmroAjste: 1,
      nmroSinstro: 1,
      asgrBenfcro: 1,
      ciudadSiniestro: 1,
      nombreCiudad: 1,
      descripcionEstado: 1,
      codiEstdo: 1,
      codiRespnsble: 1,
      responsable: 1,
      nombreResponsable: 1,
      fchaSinstro: 1,
      updatedAt: 1,
      fchaInfoPrelm: 1,
      anxoInfPrelim: 1,
      fchaInfoFnal: 1,
      anxoInfoFnal: 1,
    })
    .toArray();

  const fuenteComplex = { modulo: 'Complex', coleccion: 'gsk3cAppsiniestro' };
  for (const doc of complex) {
    const nombreResp = doc.nombreResponsable || doc.responsable || '';
    const esEl =
      (doc.codiRespnsble && codigosArmando.includes(String(doc.codiRespnsble).trim())) ||
      esArmandoFontalvo(nombreResp) ||
      esArmandoFontalvo(doc.codiRespnsble);
    if (!esEl) continue;
    filasArmando.push(filaBase(doc, fuenteComplex, 'Armando Fontalvo', 'Ajustador', evaluarInformeComplex(doc)));
  }
  console.log(`Complex: ${complex.length} candidatos, ${filasArmando.filter((f) => f.Modulo === 'Complex').length} de Armando`);

  const express = await db.collection('gsk3cAppsiniestroExpress')
    .find({ responsable: matchRegexNombre('Fontalvo') })
    .project({
      consecutivo: 1,
      numeroSiniestro: 1,
      aseguradoBeneficiario: 1,
      ciudadSiniestro: 1,
      estadoProceso: 1,
      responsable: 1,
      fechaSiniestro: 1,
      updatedAt: 1,
      liquidador: 1,
      'anexos.nombre': 1,
    })
    .toArray();

  const fuenteExpress = { modulo: 'Express', coleccion: 'gsk3cAppsiniestroExpress' };
  for (const doc of express) {
    if (!esArmandoFontalvo(doc.responsable)) continue;
    filasArmando.push(filaBase(doc, fuenteExpress, 'Armando Fontalvo', 'Ajustador', evaluarInformeExpress(doc)));
  }
  console.log(`Express: ${express.length} candidatos`);

  const ordenar = (a, b) =>
    String(a.Modulo).localeCompare(String(b.Modulo)) ||
    String(a.Siniestro).localeCompare(String(b.Siniestro), undefined, { numeric: true }) ||
    String(a.Consecutivo).localeCompare(String(b.Consecutivo), undefined, { numeric: true });

  filasArmando.sort(ordenar);
  filasAli.sort(ordenar);

  const contar = (filas, siNo) => filas.filter((f) => f['Tiene informe'] === siNo).length;
  const resumen = [
    { Concepto: 'Casos Armando Fontalvo (ajustador)', Cantidad: filasArmando.length },
    { Concepto: 'Armando CON informe', Cantidad: contar(filasArmando, 'SI') },
    { Concepto: 'Armando SIN informe', Cantidad: contar(filasArmando, 'NO') },
    { Concepto: 'Casos Ali inspector', Cantidad: filasAli.length },
    { Concepto: 'Ali CON informe', Cantidad: contar(filasAli, 'SI') },
    { Concepto: 'Ali SIN informe', Cantidad: contar(filasAli, 'NO') },
    { Concepto: 'Códigos Complex Armando', Cantidad: codigosArmando.join(', ') || 'no encontrado' },
    { Concepto: 'Inspector Ali en catálogo', Cantidad: aliInspectores.map((x) => x.nombre).join(', ') || 'Ali Said Soto Liscano' },
    { Concepto: 'Fecha de este Excel', Cantidad: new Date().toISOString() },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasArmando), 'Armando Fontalvo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasAli), 'Ali inspector');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      ...filasArmando.filter((f) => f['Tiene informe'] === 'SI'),
      ...filasAli.filter((f) => f['Tiene informe'] === 'SI'),
    ]),
    'Con informe'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      ...filasArmando.filter((f) => f['Tiene informe'] === 'NO'),
      ...filasAli.filter((f) => f['Tiene informe'] === 'NO'),
    ]),
    'Sin informe'
  );

  const nombre = `casos_armando_fontalvo_ali_informe_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const outProyecto = path.join(__dirname, '..', '..', nombre);
  const outDesktop = path.join(process.env.USERPROFILE || '', 'Desktop', nombre);
  XLSX.writeFile(wb, outProyecto);
  try {
    XLSX.writeFile(wb, outDesktop);
  } catch (err) {
    console.warn('No se pudo copiar al Escritorio:', err.message);
  }

  console.log('Excel:', outProyecto);
  console.log('Escritorio:', outDesktop);
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
