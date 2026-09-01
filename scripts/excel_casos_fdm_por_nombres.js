/**
 * Cruza SOLO los nombres de los PDF (capturas del usuario)
 * con gsk3cAppequidadFdmCasos. No inventa filas: caso, siniestro y cédula
 * salen de FDM; si no hay caso ni siniestro, no entra al Excel.
 *
 * Uso: node scripts/excel_casos_fdm_por_nombres.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const NOMBRES_PDF = [
  'Adriana Serna Palacios',
  'ALFONSO OBREGON URRUTIA',
  'Angel Lucio Mosquera Mena',
  'ARIS PATRICIA CHALA MORENO',
  'CARMEN LUCY MOSQUERA MOSQUERA',
  'DANIELA GALARZA GRUESO',
  'DARLY PATRICIA HURTADO HURTADO',
  'Darwin Hilario Agudelo',
  'DEIVIS VALENCIA ROMAÑA',
  'DIANA MARCELA CORDOBA MOSQUERA',
  'ESTER CUESTA MENA',
  'FABIO PALACIOS CORDOBA',
  'FRANCIA ELENA CABRERA SERNA',
  'HAMILTON RIASCO MORRENO',
  'HUGO FERNELIS PALACIOS QUEJADA',
  'IRSA MARIA SANTOS QUEJADA',
  'JESUS VALERIANO MOSQUERA MOSQUERA',
  'JHON FREDY MORENO ASPRILLA',
  'Jorge Armando Morales Castillo',
  'KELLY JHOANA CORREA BEJARANO',
  'ALBA YOLI NIÑO RUANO',
  'CLAUDIA YAMILE PEÑA CALDAS',
  'DAVID HASBON PALACIOS',
  'FERNANDO RAMIREZ',
  'JAVIER HERNAN OSORIO SANTA',
  'JEIMY TATIANA ROMERO RIOS',
  'JULIAN DAVID SEPULVEDA CASADIEGO',
  'JULIETH ALEJANDRA PRIETO CEDEÑO',
  'MARIA YANED OSORIO ROJAS',
  'MARIBEL PEÑA PELAEZ',
  'MARLENY COLINA',
  'RUBIALBA ARISTIZABAL OSPINA',
  'SINDI YULIANA ESPINAL VALLE',
  'ALEJANDRA SANDOVAL DUSAN',
  'ALEXANDRA DELGADO CEBALLOS',
  'BEISY GUTIERREZ SANCHEZ',
  'CRISTHIAN DAVID DUARTE VEGA',
  'DANIELA LIZETH LERMA SANCHEZ',
  'DERLY DAYANA BOLAÑOS AGREDO',
  'DILIA NELCY HOYOS GUTIERREZ',
  'FLOR DE LUZ MINOTTA PERLZA',
  'FRANCIA VALENCIA OROZCO',
  'FRANCO FLOREZ URIBE',
  'GEISON BAICUE CHICUNQUE',
  'GILBERTO CORDOBA VIAFARA',
  'GLORIA SERNA GOMEZ',
  'HUMBERTO VELEZ GONZALEZ',
  'ISABELLA RODRIGUEZ CASTRILLON',
  'JAMES SEPULVEDA MONTOYA',
  'JENNIFER ANDREA MUÑOS FLOREZ',
  'KAREN TRUJILLO OCAZAL',
  'KELLI VALCARCEL ARAGON',
  'MARCELA ALCANTARA OROZCO',
  'MARGOTH CAMPO',
  'MARIA VICTORIA VARELA',
  'MARTHA LUCIA CRUZ YULE',
  'MIGUEL VALENCIA PRECIADO',
  'MONICA ANACONA PIPICANO',
  'NATALIA RAMIREZ AGUDELO',
  'NATHALIA RODRIGUEZ MORALES',
  'RUTH GUTIERREZ LENIS',
  'SHIRLEY ALZATE RIVERA',
  'SINDY MANZANO PEÑA',
  'SONIA FANNY PINTO BRAVO',
  'WILMAR EDILSON MUÑOS JJIMENEZ',
  'YAMILETH ANGULO VALDES',
  'YULIANA SANTIBAÑEZ MORALES',
  'LUIS ABAD CONTO MOSQUERA',
  'MARIA CLAUDIA VALECIA PALACIOS',
  'Maria Delfina Guevara Maturana',
  'MARIA ELEUTERIA PINO PALACIOS',
  'MARIA MARCIANA PANESSO CORDOBA',
  'Marlin Stella Cuesta Palacios',
  'MARLYN YADIRA PALACIOS CORDOBA',
  'MARTHA CECILIA PALACIOS QUEJADA',
  'MARTHA SOFIA SANCHEZ MOSQUERA',
  'MARVIS LEIDA MARMOLEJO DIAZ',
  'MIRLEDIS VALENCIA MORENO',
  'MIRNA MARIEZA MENA MENA',
  'Neritina Palacios Hinestroza',
  'NEYLA MURILLO POTES',
  'ROSA EUFEMIA BECERRA VALENCIA',
  'ROSALBA MARTINEZ PALACIOS',
  'RUBY DEL SOCORRO MARTINEZ PALACIOS',
  'RUT ESNODIA MORENO MAYO',
  'SALLYS MARIA MARTINEZ BLANDON',
  'SARA LORENA SEPULVEDA HURTADO',
  'TIRSA IRENE CHALACHAVERRA',
  'WENDY PAOLA PANESO MOSQUERA',
  'WILSON HERNANDO ESCOBAR AUSIQUE',
  'YANCY ADRIANA MOSQUERA PEREA',
  'Yenyffer Cuesta Rodriguez',
  'YESSICA ASPRILLA RAMIREZ',
  'YUVER ROBLEDO GARCIA',
  'FANERY RAMIREZ RAMIREZ',
  'GABRIEL CHAYANN RUMBOS ZUÑIGA',
  'FELIPE HERNANDEZ ANGULO',
  'GERSON HESBAN HENAO CASTAÑEDA',
  'FERNEY ROJAS HURTADO',
  'EDITH YANIBE PENAGOS AREVALO',
  'EURYS YOLAINE CONTRERAS BOADA',
  'JESÚS ADRIAN PAJOY',
  'LAURA CAMILA CÁCERES MACHADO',
  'MELANY ARCHIBOLD LOPEZ',
  'FRANKLIN ALFONZO MAZO',
  'WILDER PAZ HERRERA',
  'DARLIN ACEVEDO CHANTRE',
  'LINDA GOMEZ CARDONA',
  'ANA CORREA ESCOBAR',
  'DIBIER ANDRES MARTINEZ LEDESMA',
  'DURLEY FERIA JOSA',
  'INES LABRADA LOPEZ',
  'MARIA DE JESUS ARANGO',
  'CARMEN VALAREZO MONTAÑO',
  'MIRYAM JIMENEZ BUENO',
  'ANGIE REINA MONTENEGRO',
  'DIANA HERNANDEZ MARTINEZ',
  'ISIRDORA ROMAÑA SACNHEZ',
  'LEOCADIA CABRERA CABRERA',
  'Carmelia Dogirama Dequia',
  'CARLOS ALBERTO ARROYAVE TORRES',
  'BLANCA RUBY LOPEZ ESCOBAR',
  'DORA LUCIA ALARCON GOMEZ',
  'CLAUDIA MARCELA GIRALDO RIOS',
  'DANIEL NIETO NIETO',
  'DANIEL FELIPE BEDOYA ARENAS',
  'DANNA GISELLA BEDOYA',
  'ANGELO STIVEN HERNANDEZ RIVERA',
  'ANA MARIA HERNANDEZ PESCADOR',
  'BLANCA LILIA SALAS ASPRILLA',
  'HECTOR VALENCIA LOPEZ',
  'ELSY FERIA JOSA',
  'LINA CASTILLO OCAMPO',
  'EDWIN CAMILO MEDINA ZULUAGA',
  'LUZ DELLY OSORIO CARDENAS',
  'RICARDO CELIS MENDEZ',
  'DIANA BARONA ADRADA',
  'ADELA BONILLA USA',
  'YESICA CABEZAS SOLIS',
  'LUZ DARY ANGULO MINA',
  'LAURA OJEDA VASQUEZ',
  'GUSTAVO BEDOYA AVILA',
  'DIANA LORENA GOMEZ',
  'MARIANA LENIS DUQUE',
  'ORLANDO CARDOSO ANTURY',
  'HERWING OLIVEROS RONCANCIO',
  'JORGE WILLIAM OSORIO VALENCIA',
  'ESTEFANIA BARRERA GUTIERREZ',
  'BYAN STEVEN ORDOÑEZ LOAIZA',
  'NICOL TORRES CASTRILLON',
  'ANGIE BRIGETTE SANCHEZ ZAMBRANO',
  'JENNIFER JIMENEZ BOTINA',
  'JHON FREDY IQUINA HERNANDEZ',
  'JORGE ENRIQUE FRANCO MEJIA',
  'LUIS DARIO RIOS CANO',
  'MARIA DEL PILAR JARAMILLO',
  'JOHAN STIVEN PIEDRAHITA MARTINEZ',
  'EDER ELVIS GUERERRO RIASCOS',
  'ELIZABETH ALOMIA URRUTIA',
  'LORNEYS GARCIA GORDILLO',
  'ALICIA QUIGUANA GUEGIA',
  'MARIA NELSI CARDONA VARGAS',
  'WILLIAM DAVID PEÑA QUIRAMA',
  'LUZ DORIS RESTREPO SANMARTIN',
  'WILLIAM MARTINEZ ARCILA',
  'ANTONIO SANCHEZ VERA',
  'SANDRA ALZATE GONZALES',
  'DEIDY YUFANY MEDINA ALVAREZ',
  'HECTOR ANDRADE ZUÑIGA',
  'VIVIANA MARCELA CHAVEZ',
  'NANCY TAPIERO TORRES',
  'JHULES ANGELICA ARCILA ELEJALDE',
  'JESSICA ALEJANDRA DUQUE MONTOYA',
  'JHON JAIRO ORREGO',
  'JESUS DARIO PEREZ',
  'GLORIA PATRICIA RAMIREZ VELEZ',
  'JHON EVER OCAMPO MONCADA',
  'GLORIA ESTELLA ARICAPA CASTAÑO',
  'HOOVER OSPINA VILLA',
  'JENIFER ARIAS ESCOBAR',
  'JESICA MARCELA BUSTAMANTE',
  'LISEC QUINTERO HENAO',
  'GLADYS TORRES VIDAL',
  'LAURA MARULANDA SABOGAL',
  'GLORIA AMPARO ARBOLEDA GIRALDO',
  'KELLY ALEJANDRA SERNA QUINTERO',
  'LINA MARIA MARIN CHALARCA',
  'GILBERTO DE JESUS GIRALDO GARCIA',
  'FERNELY HURTADO ARREDONDO',
  'JESSICA MINA MONTAÑO',
  'FELIPE VALENCIA MURILLO',
  'AELEEN CORREA TOVAR',
  'EUCARIS ARANGO HIDALGO',
  'GELEN CAMACHO MEJIA',
  'JHON JAIRO ZULETA FERNANDEZ',
  'MARIA MUÑOZ NAVIA',
  'NOHEMI PUERTA MEDINA',
  'SANDRA CORDOBA LOPEZ',
  'SIGRY DANIELA PALOMINO ORTEGA',
  'STEPHEN SANTIAGO MONTOYA MUÑOZ',
  'VALENTINA GONZALES CHAVARRIA',
  'VIVIANA ANDREA LOPEZ HURTADO',
  'ALEXANDAR FERNANDEZ FERNANDEZ',
  'AMANDA VALENCIA LENIS',
  'ANA NEYER BASTIDAS',
  'ANAIS RIVAS ANGOLA',
  'AURORA SANCHEZ SUAREZ',
  'AYDE LORENA CHANTRE INCHIMA',
  'CAROLINA VILLOTA ANGEL',
  'CRISTIAN MOTTA SALAZAR',
  'DAIRA VIVEROS NUÑEZ',
  'DAIRO RADA BARRETO',
  'DANIEL RENGIFO VELASCO',
  'DANILO RIOS PEREIRA',
  'DIANA QUIJANO BOLAÑOS',
  'DIOSELINA GLORIA STELLA MUÑOS LOPEZ',
  'DORALBA FLOREZ GUTIERREZ',
  'ELIECER FRANCO MENDOZA',
  'ELISABETH VELEZ LOPEZ',
  'EMANUEL REINA SERNA',
  'EMMANUEL GIRALDO VARGAS',
  'ENEIDA VALVERDE TENORIO',
  'FANNY SANCHEZ MORALES',
  'FARIDI CASTILLO GALEANO',
  'FLOR NURY GUARIN RIOS',
  'HERNAN GEOVANY MUÑOZ OSORIO',
  'HEYDY DUCON LOPEZ',
  'INGRI SANCHEZ MUÑOZ',
  'ISABEL CASANOVA MENDEZ',
  'JAIRO LOPEZ BRAVO',
  'JAMES HERNANDEZ ESCOBAR',
  'JOHAN NICOLAS CARMONA MARTINEZ',
  'JOHANA GOMEZ ORTIZ',
  'JORGE DUQUE CAICEDO',
  'JOSE LIBARDO PALACIOS',
  'JUAN DAVID MELCHOR RAMIREZ',
  'KIARA MAYLEEN BRAVO ANGULO',
  'LEONIDAS ENRIQUE OYAGA',
  'LESTER MUÑOZ LOSADA',
  'LILIANA GARCIA LARA',
  'LILIANA OSPINA OSORIO',
  'LINA LEYES GALEANO',
  'LUZ KARINA TOCORA TAO',
  'MAURICIO BURBANO ARREDONDO',
  'MAYRA ELISA LOZANO OBREGON',
  'MIGUEL DAVID SANABRIA',
  'TATIANA CORTES DAGUA',
  'UBER OCAMPO ALVAREZ',
  'LUCEIDA GONZALEZ GUTIERREZ',
  'OSCAR ANDRES KLINDER LOZANO',
  'MARIA IBED CADENA CARDOSO',
  'NATALIA GONZALEZ PALMA',
  'MAURICIO SERRANO RAMIREZ',
  'NELCY OCAMPO MONTOYA',
  'LUIS FELIPE OROZCO RESTREPO',
  'MARLON VIVEROS RIVAS',
  'NATHALIA NOGUERA BOLAÑOS',
  'MARIA ESMERALDA ROJAS MONTOYA',
  'MIRTA CARMENZA ARAUJO HURTADO',
  'MARIA FERNANDA DIAZ PLAZA',
  'NORALBA RIVERA OLAYA',
  'OLGA LUCIA GONZALEZ BARRIOS',
  'YERALDI CLAVIJO MAZO',
  'MARTHA CAÑAVERAL ARIQUI',
  'WILLIAM BOLAÑOS REALPE',
  'SEBINET ALVAREZ PLAZA',
  'MARIA ALEJANDRA BADILLO',
];

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

function puntuar(query, candidato) {
  const nq = norm(query);
  const nc = norm(candidato);
  if (!nq || !nc) return 0;
  if (nq === nc) return 100;
  if (nc.startsWith(nq) || nq.startsWith(nc)) return 92;
  if (nc.includes(nq) || nq.includes(nc)) return 85;

  const tq = tokens(query);
  const tc = new Set(tokens(candidato));
  if (!tq.length) return 0;
  const hits = tq.filter((t) => tc.has(t)).length;
  const jaccard = hits / new Set([...tq, ...tc]).size;
  if (hits === tq.length && tq.length >= 2) return 80 + Math.round(jaccard * 10);
  if (hits >= Math.max(2, tq.length - 1)) return 70 + Math.round(jaccard * 10);
  return Math.round(jaccard * 60);
}

function claveCaso(doc) {
  return `${norm(doc.nombre)}|${String(doc.caso || '')}|${String(doc.siniestro || '')}|${String(doc.consecutivo || '')}`;
}

function calidadRegistro(doc) {
  let n = 0;
  if (String(doc.caso || '').trim()) n += 4;
  if (String(doc.siniestro || '').trim()) n += 4;
  if (/\d{5,}/.test(String(doc.cedula || ''))) n += 2;
  return n;
}

function elegirMejor(candidatos, usados) {
  if (!candidatos.length) return null;
  const libres = candidatos.filter((x) => !usados.has(claveCaso(x.c)));
  if (!libres.length) return null;
  libres.sort((a, b) => calidadRegistro(b.c) - calidadRegistro(a.c) || b.score - a.score);
  return libres[0];
}

function cedulaClave(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function mejorFilaMismaPersona(a, b) {
  const score = (f) => Number(Boolean(f.caso && f.siniestro)) * 10 + Number(Boolean(f.caso)) * 2 + Number(Boolean(f.siniestro));
  return score(b) - score(a);
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('❌ Defina MONGO_URI en backend/.env');
    process.exit(1);
  }

  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const col = mongoose.connection.db.collection('gsk3cAppequidadFdmCasos');
  const casos = await col
    .find({}, { projection: { nombre: 1, caso: 1, siniestro: 1, consecutivo: 1, cedula: 1, estado: 1 } })
    .toArray();

  console.log(`Casos FDM en BD: ${casos.length}`);

  const usados = new Set();
  const filas = [];
  const sinMatch = [];
  const nombresUnicos = [];
  const vistosPdf = new Set();
  for (const nombrePdf of NOMBRES_PDF) {
    const clave = norm(nombrePdf);
    if (!clave || vistosPdf.has(clave)) continue;
    vistosPdf.add(clave);
    nombresUnicos.push(nombrePdf);
  }

  for (const nombrePdf of nombresUnicos) {
    const ranked = casos
      .map((c) => ({ c, score: puntuar(nombrePdf, c.nombre) }))
      .filter((x) => x.score >= 70)
      .sort((a, b) => b.score - a.score);

    const exactos = ranked.filter((x) => x.score >= 92);
    const elegido = elegirMejor(exactos.length ? exactos : ranked, usados);

    if (!elegido) {
      sinMatch.push(nombrePdf);
      filas.push({
        nombrePdf,
        nombreBd: '',
        caso: '',
        siniestro: '',
        cedula: '',
        consecutivo: '',
        coincidencia: 'NO ENCONTRADO',
      });
      continue;
    }

    usados.add(claveCaso(elegido.c));
    filas.push({
      nombrePdf,
      nombreBd: elegido.c.nombre || '',
      caso: String(elegido.c.caso || '').trim(),
      siniestro: String(elegido.c.siniestro || '').trim(),
      cedula: elegido.c.cedula != null && elegido.c.cedula !== '' ? String(elegido.c.cedula).trim() : '',
      consecutivo: elegido.c.consecutivo || '',
      coincidencia: elegido.score >= 92 ? 'EXACTA' : `PARCIAL (${elegido.score})`,
    });
  }

  const filasValidas = [];
  const vistosPersona = new Set();
  filas
    .filter((f) => {
      const tieneCasoOSiniestro = Boolean(f.caso || f.siniestro);
      const tieneCedula = String(f.cedula || '').replace(/\D/g, '').length >= 5;
      const tieneNombre = Boolean(f.nombreBd || f.nombrePdf);
      return tieneCasoOSiniestro && tieneCedula && tieneNombre;
    })
    .sort((a, b) => mejorFilaMismaPersona(a, b))
    .forEach((f) => {
      const clave = cedulaClave(f.cedula) || `${norm(f.nombreBd)}|${f.caso}|${f.siniestro}`;
      if (vistosPersona.has(clave)) return;
      vistosPersona.add(clave);
      filasValidas.push(f);
    });
  filasValidas.sort((a, b) => {
    const ambosA = Number(Boolean(a.caso && a.siniestro));
    const ambosB = Number(Boolean(b.caso && b.siniestro));
    return ambosB - ambosA;
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grupo Proser';
  wb.created = new Date();

  const ws = wb.addWorksheet('Casos FDM', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Número de caso', key: 'caso', width: 22 },
    { header: 'Número de siniestro', key: 'siniestro', width: 24 },
    { header: 'Cédula', key: 'cedula', width: 18 },
    { header: 'Nombre', key: 'nombreBd', width: 42 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E79' },
  };

  for (const f of filasValidas) {
    ws.addRow({
      caso: f.caso,
      siniestro: f.siniestro,
      cedula: f.cedula,
      nombreBd: f.nombreBd || f.nombrePdf,
    });
  }

  const outPathPrincipal = path.join(__dirname, '../../Casos_Fundacion_de_la_Mujer.xlsx');
  const outPathRespaldo = path.join(__dirname, '../../Casos_Fundacion_de_la_Mujer_actualizado.xlsx');
  let outPath = outPathPrincipal;
  try {
    await wb.xlsx.writeFile(outPath);
  } catch (err) {
    if (err.code !== 'EBUSY' && err.errno !== -4082) throw err;
    outPath = outPathRespaldo;
    await wb.xlsx.writeFile(outPath);
    console.warn(`Archivo original abierto; se guardó en ${outPath}`);
  }

  const excluidos = filas.filter((f) => !filasValidas.includes(f)).map((f) => ({
    nombre: f.nombreBd || f.nombrePdf,
    caso: f.caso || null,
    siniestro: f.siniestro || null,
    cedula: f.cedula || null,
  }));

  console.log(
    JSON.stringify(
      {
        pdfs: nombresUnicos.length,
        filasEnExcel: filasValidas.length,
        conAmbos: filasValidas.filter((f) => f.caso && f.siniestro).length,
        soloCasoOSiniestro: filasValidas.filter((f) => Boolean(f.caso) !== Boolean(f.siniestro)).length,
        excluidos,
        outPath,
      },
      null,
      2
    )
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
