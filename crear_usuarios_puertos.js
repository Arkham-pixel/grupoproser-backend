import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import SecurUser from './models/SecurUser.js';

const MONGO_URI = process.env.MONGO_URI;
const PASSWORD_GENERICO = process.env.SEED_PASSWORD_PUERTOS || 'ProserPuertos2026!';

const USUARIOS_PUERTOS = [
  {
    name: 'AUGUSTO NICOLAS CAPARROSO MERCADO',
    cedula: '8734788',
    email: '8734788@empleado.importacion.grupoproser',
    empresa: 'Proser Puertos',
  },
  {
    name: 'BRAYAN STEVEN AGUIRRE ORTIZ',
    cedula: '10061922232',
    email: '10061922232@empleado.importacion.grupoproser',
    empresa: 'Proser Puertos',
  },
  {
    name: 'Karoline Valentina Carreño Guerrero',
    email: 'kvcarrenog@proserpuertos.com.co',
    empresa: 'Proser Puertos',
  },
  {
    name: 'Milagro Navarro',
    email: 'mnavarro@proserpuertos.com.co',
    empresa: 'Proser Puertos',
  },
  {
    name: 'XAVIER EDUARDO ROJAS MARTINEZ',
    cedula: '1050968354',
    email: '1050968354@empleado.importacion.grupoproser',
    empresa: 'Proser Puertos',
  },
  {
    name: 'YANETH DEL CARMEN VITOLA SUAREZ',
    cedula: '45765743',
    email: '45765743@empleado.importacion.grupoproser',
    empresa: 'Proser Puertos',
  },
  {
    name: 'JIMMY GRUESO',
    cedula: '16482259',
    empresa: 'Proser Puertos',
  },
];

async function buscarUsuario(datos) {
  const filtros = [];
  if (datos.cedula) {
    filtros.push({ login: datos.cedula }, { cedula: datos.cedula });
  }
  if (datos.email) {
    filtros.push({ email: datos.email });
  }
  if (datos.name) {
    filtros.push({ name: new RegExp(`^${datos.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  }
  if (!filtros.length) return null;
  return SecurUser.findOne({ $or: filtros });
}

async function main() {
  if (!MONGO_URI) {
    console.error('❌ Defina MONGO_URI en backend/.env');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado a MongoDB\n');

  const hashedPassword = await bcrypt.hash(PASSWORD_GENERICO, 10);
  const resultados = [];

  for (const datos of USUARIOS_PUERTOS) {
    const existente = await buscarUsuario(datos);
    const login = datos.cedula || existente?.login || existente?.cedula;

    if (!login && !existente) {
      resultados.push({
        nombre: datos.name,
        estado: 'PENDIENTE',
        nota: 'Sin cédula/login — no se pudo crear automáticamente',
        email: datos.email || '',
      });
      console.log(`⚠️ ${datos.name}: sin cédula, buscando solo por email/nombre...`);
      continue;
    }

    if (existente) {
      existente.role = 'puertos';
      existente.active = 'Y';
      existente.pswd = hashedPassword;
      if (datos.email) existente.email = datos.email;
      if (datos.cedula) {
        existente.cedula = datos.cedula;
        if (!existente.login) existente.login = datos.cedula;
      }
      if (datos.empresa) existente.empresa = datos.empresa;
      await existente.save();
      resultados.push({
        nombre: existente.name,
        login: existente.login,
        email: existente.email,
        estado: 'ACTUALIZADO',
        rol: existente.role,
        active: existente.active,
      });
      console.log(`🔄 Actualizado: ${existente.name} (login: ${existente.login})`);
      continue;
    }

    const nuevo = new SecurUser({
      name: datos.name,
      email: datos.email || `${datos.cedula}@empleado.importacion.grupoproser`,
      login: datos.cedula,
      cedula: datos.cedula,
      pswd: hashedPassword,
      role: 'puertos',
      active: 'Y',
      empresa: datos.empresa || 'Proser Puertos',
    });
    await nuevo.save();
    resultados.push({
      nombre: nuevo.name,
      login: nuevo.login,
      email: nuevo.email,
      estado: 'CREADO',
      rol: nuevo.role,
      active: nuevo.active,
    });
    console.log(`✅ Creado: ${nuevo.name} (login: ${nuevo.login})`);
  }

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resultados, null, 2));
  console.log(`\nContraseña genérica para todos: ${PASSWORD_GENERICO}`);
  console.log('Login = cédula (CC)\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  mongoose.disconnect();
  process.exit(1);
});
