/**
 * Upsert ajustadores catastróficos de Cali.
 * Si ya existe (mismo nombre o cédula/código), actualiza teléfono y ciudad.
 * Si no existe, lo crea.
 *
 * Uso: node scripts/seedAjustadoresCali.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const AJUSTADORES_CALI = [
  {
    nombre: 'Sergio Diaz',
    cedula: '1044210888',
    telefono: '3226114155',
    actividad: 'CAMPO',
  },
  {
    nombre: 'Alvaro Grueso',
    cedula: '1059444235',
    telefono: '3234109568',
    actividad: 'CAMPO',
  },
  {
    nombre: 'Fabian Bravo',
    cedula: '1094269632',
    telefono: '3182852067',
    actividad: 'CAMPO',
  },
  {
    nombre: 'Rodrigo Andres Bedoya Jimenez',
    cedula: '1144073946',
    telefono: '3185281295',
    actividad: 'CAMPO',
  },
  {
    nombre: 'Sandra Patricia Sánchez Cañas',
    cedula: '41923444',
    telefono: '3104604919',
    actividad: 'CAMPO',
  },
  {
    nombre: 'Camilo Ospina Sánchez',
    cedula: '1094963429',
    telefono: '3024261444',
    actividad: 'CAMPO',
  },
  {
    nombre: 'Ladys Andrea Escalante',
    cedula: '',
    telefono: '3022792761',
    actividad: 'ESCRITORIO/CAMPO',
  },
  {
    nombre: 'Maria Garcia Manjarres',
    cedula: '',
    telefono: '3104306355',
    actividad: 'ESCRITORIO/CAMPO',
  },
];

function norm(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.\s-]/g, '')
    .trim()
    .toUpperCase();
}

function codigoDesde({ nombre, cedula, telefono }) {
  const cc = String(cedula || '').replace(/\D/g, '');
  if (cc) return `AJU-${cc}`;
  const partes = String(nombre)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  const iniciales = partes.map((p) => p[0]).join('').slice(0, 6);
  const tel = String(telefono || '').replace(/\D/g, '').slice(-4);
  return `AJU-${iniciales}-${tel || '0000'}`;
}

async function resolverCiudadCali(db) {
  const ciudades = await db
    .collection('gsk3cAppciudades')
    .find({
      $or: [
        { descMunicipio: /cali/i },
        { nombre: /cali/i },
        { ciudad: /cali/i },
      ],
    })
    .project({ descMunicipio: 1, nombre: 1, ciudad: 1 })
    .toArray();
  const exacta = ciudades.find((c) => {
    const n = String(c.descMunicipio || c.nombre || c.ciudad || '').trim();
    return norm(n) === 'CALI';
  });
  return {
    ciudad: exacta
      ? String(exacta.descMunicipio || exacta.nombre || exacta.ciudad).trim()
      : 'Cali',
    coincidencias: ciudades.map((c) =>
      String(c.descMunicipio || c.nombre || c.ciudad || '').trim()
    ),
  };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const col = db.collection('gsk3cAppajustadorcatastrofico');
  const { ciudad, coincidencias } = await resolverCiudadCali(db);

  const existentes = await col
    .find({})
    .project({ codigo: 1, nombre: 1, telefono: 1, ciudad: 1, email: 1 })
    .toArray();

  const resumen = {
    ciudadUsada: ciudad,
    ciudadesCatalogoConCali: coincidencias,
    creados: [],
    actualizados: [],
    omitidos: [],
  };

  for (const row of AJUSTADORES_CALI) {
    const codigo = codigoDesde(row);
    const nombreNorm = norm(row.nombre);
    const cedula = String(row.cedula || '').replace(/\D/g, '');
    const tel = String(row.telefono || '').replace(/\D/g, '');

    const match = existentes.find((e) => {
      const eNombre = norm(e.nombre);
      const eCodigo = String(e.codigo || '').replace(/\D/g, '');
      const eTel = String(e.telefono || '').replace(/\D/g, '');
      if (eNombre === nombreNorm) return true;
      if (cedula && (eCodigo === cedula || String(e.codigo) === `AJU-${cedula}`)) return true;
      if (tel && eTel === tel && eNombre.includes(nombreNorm.slice(0, 8))) return true;
      return false;
    });

    const docSet = {
      nombre: row.nombre,
      telefono: tel,
      ciudad,
      updatedAt: new Date(),
    };

    if (match) {
      await col.updateOne(
        { _id: match._id },
        {
          $set: {
            ...docSet,
            email: match.email || '',
            codigo: match.codigo || codigo,
          },
        }
      );
      resumen.actualizados.push({
        nombre: row.nombre,
        codigo: match.codigo || codigo,
        ciudadAntes: match.ciudad,
        telefonoAntes: match.telefono,
      });
    } else {
      const insert = {
        codigo,
        nombre: row.nombre,
        email: '',
        telefono: tel,
        ciudad,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await col.insertOne(insert);
      existentes.push(insert);
      resumen.creados.push({ nombre: row.nombre, codigo, ciudad });
    }
  }

  const cali = await col
    .find({ ciudad: { $regex: /^cali$/i } })
    .project({ codigo: 1, nombre: 1, telefono: 1, ciudad: 1 })
    .sort({ nombre: 1 })
    .toArray();

  console.log(
    JSON.stringify(
      {
        ...resumen,
        totalCali: cali.length,
        ajustadoresCali: cali,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
