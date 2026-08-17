/**
 * Carga inspectores catastróficos desde el listado operativo (ciudad + celular).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const INSPECTORES = [
  {
    nombre: 'Sergio Diaz',
    telefono: '3226114155',
    ciudad: 'CALI',
  },
  {
    nombre: 'Alvaro Grueso',
    telefono: '3234109568',
    ciudad: 'CALI',
  },
  {
    nombre: 'Fabian Bravo',
    telefono: '3182852067',
    ciudad: 'CALI',
  },
  {
    nombre: 'Rodrigo Andres Bedoya Jimenez',
    telefono: '3185281295',
    ciudad: 'CALI',
  },
  {
    nombre: 'Sandra Patricia Sánchez Cañas',
    telefono: '3104604919',
    ciudad: 'CALI',
  },
  {
    nombre: 'Camilo Ospina Sánchez',
    telefono: '3024261444',
    ciudad: 'CALI',
  },
  {
    nombre: 'Ladys Andrea Escalante',
    telefono: '3022792761',
    ciudad: 'CALI',
  },
  {
    nombre: 'Maria Garcia Manjarres',
    telefono: '3104306355',
    ciudad: 'CALI',
  },
  {
    nombre: 'Santiago Beltran',
    telefono: '3043407939',
    ciudad: 'Bogota',
  },
  {
    nombre: 'Juan Andrés Palacios Palacios',
    telefono: '3203098704',
    ciudad: 'Quibdo',
  },
  {
    nombre: 'Ali Said Soto Liscano',
    telefono: '3142245325',
    ciudad: 'Manizales',
  },
];

function codigoDesde(nombre, telefono) {
  const partes = String(nombre)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  const iniciales = partes.map((p) => p[0]).join('').slice(0, 6);
  const tel = String(telefono).replace(/\D/g, '').slice(-4);
  return `INS-${iniciales}-${tel}`;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('gsk3cAppinspectorcatastrofico');
  let creados = 0;
  let actualizados = 0;

  for (const row of INSPECTORES) {
    const codigo = codigoDesde(row.nombre, row.telefono);
    const filtro = {
      $or: [
        { codigo },
        {
          nombre: new RegExp(`^${row.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
          ciudad: new RegExp(`^${row.ciudad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        },
      ],
    };
    const existente = await col.findOne(filtro);
    const doc = {
      codigo,
      nombre: row.nombre,
      email: '',
      telefono: row.telefono,
      ciudad: row.ciudad,
      updatedAt: new Date(),
    };
    if (existente) {
      await col.updateOne({ _id: existente._id }, { $set: doc });
      actualizados += 1;
      console.log('upd', codigo, row.nombre, row.ciudad);
    } else {
      await col.insertOne({ ...doc, createdAt: new Date() });
      creados += 1;
      console.log('new', codigo, row.nombre, row.ciudad);
    }
  }

  const total = await col.countDocuments();
  console.log(JSON.stringify({ creados, actualizados, total }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
