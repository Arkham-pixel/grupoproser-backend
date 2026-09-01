/**
 * Crea/actualiza usuarios externos Equidad CAT (login = cédula, rol contractor_solo_equidad_cat)
 * y los registra como ajustador CAT (módulo Equidad CAT).
 *
 * Uso: desde backend/ → node scripts/crear_usuarios_equidad_cat.js
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

const ROL_EQUIDAD_CAT = 'contractor_solo_equidad_cat';
const PASSWORD_GENERICO = process.env.SEED_PASSWORD_EQUIDAD_CAT || 'Externos2026*';
const EMPRESA = 'Externo Equidad CAT';

const PERSONAS = [
  {
    nombre: 'Kimberlys Aguilar Arias',
    cedula: '22588713',
    email: 'kimberly3018@gmail.com',
  },
  {
    nombre: 'Joe Buelvas',
    cedula: '72001444',
    email: 'jbuelvas77@hotmail.com',
  },
  {
    nombre: 'Miguel Gallo',
    cedula: '1044425681',
    email: 'miguelgallo1205@hotmail.com',
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

function codigoAjustador(cedula) {
  return `AJU-${cedula}`;
}

async function buscarUsuario(persona) {
  const ced = persona.cedula;
  const email = String(persona.email || '').trim().toLowerCase();
  return SecurUser.findOne({
    $or: [{ login: ced }, { cedula: ced }, { email }],
  });
}

async function upsertAjustador({ codigo, nombre, email }) {
  const nombreNorm = norm(nombre);
  const existentes = await AjustadorCatastrofico.find({})
    .select('codigo nombre email ciudad modulos')
    .lean();
  const match = existentes.find((e) => {
    if (String(e.codigo || '').trim() === codigo) return true;
    if (norm(e.nombre) === nombreNorm) return true;
    return false;
  });

  if (match) {
    await AjustadorCatastrofico.updateOne(
      { _id: match._id },
      {
        $set: {
          codigo: match.codigo || codigo,
          nombre,
          email: email || match.email || '',
          ciudad: match.ciudad || 'Todas',
          updatedAt: new Date(),
        },
        $addToSet: { modulos: 'equidadCat' },
      }
    );
    return { estado: 'ACTUALIZADO', codigo: match.codigo || codigo };
  }

  await AjustadorCatastrofico.create({
    codigo,
    nombre,
    email: email || '',
    telefono: '',
    ciudad: 'Todas',
    modulos: ['equidadCat'],
  });
  return { estado: 'CREADO', codigo };
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
        `| ${i + 1} | ${r.nombre} | \`${r.login}\` | ${r.email} | Equidad CAT | ${r.usuarioEstado} |`
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

  return `# Credenciales de acceso — Rol Equidad CAT

**Sistema:** Arnald DataFlow (Grupo Proser)  
**Módulo:** Equidad CAT  
**Fecha de generación:** ${fecha}  
**Estado:** Usuarios activos con rol \`contractor_solo_equidad_cat\` (etiqueta **Equidad CAT**)

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
4. Al entrar, el sistema redirige al **Reporte Equidad CAT**.
5. Se recomienda cambiar la contraseña en **Mi Cuenta** después del primer acceso.

---

## Listado de usuarios

| # | Nombre completo | Usuario (login) | Correo | Rol | Estado |
|---|-----------------|-----------------|--------|-----|--------|
${filas}

---

## Ajustadores CAT

Quedaron registrados en el catálogo de ajustadores, solo para el módulo Equidad CAT, con cobertura nacional (Todas).

| # | Nombre | Código ajustador | Estado catálogo |
|---|--------|------------------|-----------------|
${catalogo}

---

## Notas

- **Login:** la cédula (CC) de cada persona.
- **Acceso limitado:** estos usuarios solo ven el módulo **Equidad CAT** y **Mi Cuenta**. No tienen acceso a Complex, Riesgos, Express, Zurich, Alfa, Sura, BBVA, Previsora, Allianz, Equidad FDM ni Administración.
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
  const resultados = [];

  for (const persona of PERSONAS) {
    const ced = String(persona.cedula).trim();
    const email = String(persona.email || '').trim().toLowerCase();
    const nombreUsuario = aplicarSufijoNombrePorRol(persona.nombre, ROL_EQUIDAD_CAT);

    let usuarioEstado = 'CREADO';
    const existente = await buscarUsuario({ ...persona, cedula: ced });
    if (existente) {
      existente.name = nombreUsuario;
      existente.login = ced;
      existente.cedula = ced;
      existente.email = email;
      existente.pswd = hashedPassword;
      existente.role = ROL_EQUIDAD_CAT;
      existente.active = 'Y';
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
        role: ROL_EQUIDAD_CAT,
        active: 'Y',
        empresa: EMPRESA,
      });
      console.log(`✅ Usuario creado: ${persona.nombre} (login: ${ced})`);
    }

    const ajustador = await upsertAjustador({
      codigo: codigoAjustador(ced),
      nombre: persona.nombre,
      email,
    });
    console.log(
      `   CAT ajustador ${ajustador.estado} (${ajustador.codigo}) · Todas · equidadCat`
    );

    resultados.push({
      nombre: persona.nombre,
      login: ced,
      email,
      usuarioEstado,
      codigoAjustador: ajustador.codigo,
      ajustadorEstado: ajustador.estado,
    });
  }

  const outPath = path.join(__dirname, '../../CREDENCIALES_USUARIOS_EQUIDAD_CAT.md');
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
