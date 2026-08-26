/**
 * Reinicia el Authenticator (TOTP) de un usuario SecurUser.
 * Tras el reset puede entrar con cédula + contraseña y volver a escanear el QR.
 *
 * Uso: node scripts/reset_2fa_usuario.js 1001826133
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import SecurUser from '../models/SecurUser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const busqueda = String(process.argv[2] || '').trim();
if (!busqueda) {
  console.error('Uso: node scripts/reset_2fa_usuario.js <cedula|login|email>');
  process.exit(1);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const usuario = await SecurUser.findOne({
    $or: [
      { login: busqueda },
      { cedula: busqueda },
      { email: busqueda.toLowerCase() },
    ],
  }).select('login name email cedula active totpEnabled totpSecret totpTempSecret role');

  if (!usuario) {
    console.error(`No se encontró usuario con: ${busqueda}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const antes = {
    login: usuario.login,
    name: usuario.name,
    email: usuario.email,
    cedula: usuario.cedula,
    active: usuario.active,
    totpEnabled: Boolean(usuario.totpEnabled),
    teniaSecreto: Boolean(usuario.totpSecret),
    teniaPendiente: Boolean(usuario.totpTempSecret),
  };

  usuario.totpSecret = null;
  usuario.totpTempSecret = null;
  usuario.totpEnabled = false;
  await usuario.save();

  console.log(
    JSON.stringify(
      {
        ok: true,
        mensaje: 'Authenticator reiniciado. El usuario puede entrar con cédula y contraseña y configurar 2FA de nuevo.',
        antes,
        despues: {
          totpEnabled: usuario.totpEnabled,
          totpSecret: usuario.totpSecret,
          totpTempSecret: usuario.totpTempSecret,
        },
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
