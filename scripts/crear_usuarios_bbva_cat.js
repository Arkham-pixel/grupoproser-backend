/**
 * Crea/actualiza usuarios externos BBVA CAT (login = cédula, rol contractor_solo_bbva)
 * y los registra como ajustador CAT (módulo BBVA).
 *
 * Uso: desde backend/ → node scripts/crear_usuarios_bbva_cat.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import SecurUser from '../models/SecurUser.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import { aplicarSufijoNombrePorRol } from '../config/roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const ROL_BBVA = 'contractor_solo_bbva';
const PASSWORD_GENERICO = process.env.SEED_PASSWORD_BBVA_CAT || 'Externos2026*';
const EMPRESA = 'Externo BBVA CAT';

const PERSONAS = [
  {
    nombre: 'SEBASTIAN ALEJANDRO CASTRO GIL',
    profesion: 'INGENIERO CIVIL',
    cedula: '1001826133',
    email: 'scastroingeniero@gmail.com',
    telefono: '3214616740',
    ciudad: 'Barranquilla',
  },
  {
    nombre: 'TATIANA ERAZO',
    profesion: 'INGENIERO CIVIL',
    cedula: '1144098774',
    email: 'tatianaerazovasquez@gmail.com',
    telefono: '3116496303',
    ciudad: 'Cali',
  },
  {
    nombre: 'OMAR RODOLFO PICO QUINTERO',
    profesion: 'INGENIERO CIVIL',
    cedula: '91180692',
    email: 'omarpicoingenieria@hotmail.com',
    telefono: '3162344057',
    ciudad: 'Bucaramanga',
  },
  {
    nombre: 'Jairo Sadoc Puentes Morales',
    profesion: 'INGENIERO CIVIL',
    cedula: '79754443',
    email: 'sadoc85@gmail.com',
    telefono: '3134404339',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Jorge Enrique Salazar Gonzalez',
    profesion: 'ARQUITECTO',
    cedula: '19304748',
    email: 'jorgekike1211@gmail.com',
    telefono: '3144742125',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Nubia Angelica Velasquez Leon',
    profesion: 'ARQUITECTO',
    cedula: '51698891',
    email: '',
    telefono: '3134523736',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Nicolas Andres Contreras Doncel',
    profesion: 'INGENIERO CIVIL',
    cedula: '1007414691',
    email: 'contreras.doncel.nicolas@gmail.com',
    telefono: '3017326197',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Douglas Santiago Puentes Cantor',
    profesion: 'INGENIERO CIVIL',
    cedula: '1032488802',
    email: 'douglassantiago0710@gmail.com',
    telefono: '3172483325',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Jaime Gaona Peña',
    profesion: 'ARQUITECTO',
    cedula: '19419745',
    email: 'jaime.gaona@acacyan.com',
    telefono: '3214257152',
    ciudad: 'Bogotá',
  },
  {
    nombre: 'Ayfa Briced Herrera Merchan',
    profesion: 'ARQUITECTO',
    cedula: '52478912',
    email: 'ayfabh@gmail.com',
    telefono: '3208200213',
    ciudad: 'Bogotá',
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

function emailPlaceholder(cedula) {
  return `${cedula}@externo.bbva.grupoproser`;
}

function emailDe(persona) {
  const mail = String(persona.email || '').trim().toLowerCase();
  return mail || emailPlaceholder(persona.cedula);
}

function codigoAjustador(cedula) {
  return `AJU-${cedula}`;
}

async function resolverCiudad(db, nombreCiudad) {
  const objetivo = norm(nombreCiudad);
  const regex = new RegExp(String(nombreCiudad).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const ciudades = await db
    .collection('gsk3cAppciudades')
    .find({
      $or: [
        { descMunicipio: regex },
        { nombre: regex },
        { ciudad: regex },
      ],
    })
    .project({ descMunicipio: 1, nombre: 1, ciudad: 1 })
    .toArray();

  const exacta = ciudades.find((c) => {
    const n = String(c.descMunicipio || c.nombre || c.ciudad || '').trim();
    return norm(n) === objetivo;
  });

  if (exacta) {
    return String(exacta.descMunicipio || exacta.nombre || exacta.ciudad).trim();
  }
  return nombreCiudad;
}

async function buscarUsuario(persona) {
  const ced = persona.cedula;
  const email = emailDe(persona);
  return SecurUser.findOne({
    $or: [{ login: ced }, { cedula: ced }, { email }],
  });
}

async function upsertCatalogo(Model, { codigo, nombre, email, telefono, ciudad, extra = {} }) {
  const tel = String(telefono || '').replace(/\D/g, '');
  const nombreNorm = norm(nombre);
  const existentes = await Model.find({}).select('codigo nombre telefono ciudad email').lean();
  const match = existentes.find((e) => {
    const eCodigo = String(e.codigo || '').trim();
    const eNombre = norm(e.nombre);
    const eTel = String(e.telefono || '').replace(/\D/g, '');
    if (eCodigo === codigo) return true;
    if (eNombre === nombreNorm) return true;
    if (tel && eTel === tel && eNombre.includes(nombreNorm.slice(0, 8))) return true;
    return false;
  });

  const docSet = {
    codigo: match?.codigo || codigo,
    nombre,
    email: email || match?.email || '',
    telefono: tel,
    ciudad,
    ...extra,
  };

  if (match) {
    await Model.updateOne({ _id: match._id }, { $set: docSet });
    return { estado: 'ACTUALIZADO', codigo: docSet.codigo };
  }

  await Model.create({ ...docSet });
  return { estado: 'CREADO', codigo: docSet.codigo };
}

function construirDocumento(resultados) {
  const fecha = new Date().toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const filas = resultados
    .map(
      (r, i) =>
        `| ${i + 1} | ${r.nombre} | \`${r.login}\` | ${r.email} | ${r.telefono} | ${r.ciudad} | ${r.profesion} | BBVA | ${r.usuarioEstado} |`
    )
    .join('\n');

  const catalogo = resultados
    .map(
      (r, i) =>
        `| ${i + 1} | ${r.nombre} | \`${r.codigoAjustador}\` | ${r.ajustadorEstado} |`
    )
    .join('\n');

  const resumenRapido = resultados
    .map((r) => `- \`${r.login}\` → ${r.nombre}`)
    .join('\n');

  return `# Credenciales de acceso — Rol BBVA (CAT)

**Sistema:** Arnald DataFlow (Grupo Proser)  
**Módulo:** BBVA CAT (ajustadores)  
**Fecha de generación:** ${fecha}  
**Estado:** Usuarios activos con rol \`contractor_solo_bbva\` (etiqueta **BBVA**)

---

## Contraseña genérica (todos los usuarios)

| Campo | Valor |
|-------|-------|
| **Contraseña** | \`${PASSWORD_GENERICO}\` |

> Esta contraseña cumple los requisitos del sistema: mínimo 8 caracteres, mayúscula, minúscula, número y carácter especial.

---

## Instrucciones de ingreso

1. Abrir la plataforma e ir a **Iniciar sesión**.
2. En **Usuario**, ingresar el **número de cédula** (login).
3. En **Contraseña**, ingresar: \`${PASSWORD_GENERICO}\`
4. Al entrar, el sistema redirige al **Reporte analista BBVA CAT**.
5. Se recomienda cambiar la contraseña en **Mi Cuenta** después del primer acceso.

---

## Listado de usuarios

| # | Nombre completo | Usuario (login) | Correo | Celular | Ciudad | Profesión | Rol | Estado |
|---|-----------------|-----------------|--------|---------|--------|-----------|-----|--------|
${filas}

---

## Ajustadores CAT

Quedaron registrados en el catálogo de ajustadores, solo para el módulo BBVA CAT, con cobertura nacional (Todas).

| # | Nombre | Código ajustador | Estado catálogo |
|---|--------|------------------|-----------------|
${catalogo}

---

## Notas

- **Login:** la cédula (CC) de cada persona.
- **Acceso limitado:** estos usuarios solo ven el módulo **BBVA CAT** y **Mi Cuenta**. No tienen acceso a Complex, Riesgos, Express, Zurich, Alfa, Sura ni Administración.
- **Nubia Angelica Velasquez Leon:** no venía correo en el listado; se usó un correo interno placeholder para poder crear la cuenta. Actualizar el correo real en **Administración de usuarios** cuando se tenga.
- **Seguridad:** no compartir este documento por canales públicos. Entregar las credenciales de forma individual o por correo interno.

---

## Resumen rápido para copiar

\`\`\`
Contraseña para todos: ${PASSWORD_GENERICO}

Logins:
${resumenRapido}
\`\`\`

---

*Documento generado para uso interno de Grupo Proser.*
`;
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
    retryWrites: true,
    w: 'majority',
  });
  console.log('✅ Conectado a MongoDB\n');

  const hashedPassword = await bcrypt.hash(PASSWORD_GENERICO, 10);
  const db = mongoose.connection.db;
  const cacheCiudad = new Map();
  const resultados = [];

  for (const persona of PERSONAS) {
    const ced = String(persona.cedula).trim();
    const email = emailDe(persona);
    const telefono = String(persona.telefono || '').replace(/\D/g, '');

    if (!cacheCiudad.has(persona.ciudad)) {
      cacheCiudad.set(persona.ciudad, await resolverCiudad(db, persona.ciudad));
    }
    const ciudad = cacheCiudad.get(persona.ciudad);
    const nombreUsuario = aplicarSufijoNombrePorRol(persona.nombre, ROL_BBVA);

    let usuarioEstado = 'CREADO';
    const existente = await buscarUsuario({ ...persona, cedula: ced });
    if (existente) {
      existente.name = nombreUsuario;
      existente.login = ced;
      existente.cedula = ced;
      existente.email = email;
      existente.pswd = hashedPassword;
      existente.role = ROL_BBVA;
      existente.active = 'Y';
      existente.phone = telefono;
      existente.celulares = telefono;
      existente.sucursal = ciudad;
      existente.cargos = persona.profesion;
      existente.empresa = EMPRESA;
      await existente.save();
      usuarioEstado = 'ACTUALIZADO';
      console.log(`🔄 Usuario actualizado: ${persona.nombre} (login: ${ced})`);
    } else {
      await SecurUser.create({
        name: nombreUsuario,
        login: ced,
        cedula: ced,
        email,
        pswd: hashedPassword,
        role: ROL_BBVA,
        active: 'Y',
        phone: telefono,
        celulares: telefono,
        sucursal: ciudad,
        cargos: persona.profesion,
        empresa: EMPRESA,
      });
      console.log(`✅ Usuario creado: ${persona.nombre} (login: ${ced})`);
    }

    const ajustador = await upsertCatalogo(AjustadorCatastrofico, {
      codigo: codigoAjustador(ced),
      nombre: persona.nombre,
      email,
      telefono,
      ciudad: 'Todas',
      extra: { modulos: ['bbvaCat'] },
    });
    console.log(
      `   CAT ajustador ${ajustador.estado} (${ajustador.codigo}) · Todas · bbvaCat`
    );

    resultados.push({
      nombre: persona.nombre,
      login: ced,
      email,
      telefono,
      ciudad,
      profesion: persona.profesion,
      usuarioEstado,
      codigoAjustador: ajustador.codigo,
      ajustadorEstado: ajustador.estado,
    });
  }

  const outPath = path.join(__dirname, '../../CREDENCIALES_USUARIOS_BBVA_CAT.md');
  fs.writeFileSync(outPath, construirDocumento(resultados), 'utf8');

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resultados, null, 2));
  console.log(`\nContraseña genérica: ${PASSWORD_GENERICO}`);
  console.log(`📄 Documento: ${outPath}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Error:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
