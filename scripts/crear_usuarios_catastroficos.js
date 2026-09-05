/**
 * Crea/actualiza usuarios externos Catastróficos (login = cédula, rol contractor_catastroficos)
 * y los registra como ajustador e inspector CAT (catálogo general: todas menos Alfa/BBVA).
 *
 * Uso: desde backend/ → node scripts/crear_usuarios_catastroficos.js
 * Solo una cédula: CEDULA=<cedula> node scripts/crear_usuarios_catastroficos.js
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
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import { aplicarSufijoNombrePorRol } from '../config/roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const ROL_CATASTROFICOS = 'contractor_catastroficos';
const PASSWORD_GENERICO = process.env.SEED_PASSWORD_CATASTROFICOS || 'Externos2026*';
const EMPRESA = 'Externo Catastróficos';

const PERSONAS = [
  {
    nombre: 'Marisol Gómez Carreño',
    cedula: '1140829990',
    email: 'Marisolgmz15@gmail.com',
    celular: '3239652220',
    fechaNacimiento: '1990-03-15',
  },
  {
    nombre: 'Cesar Octavio Cantillo Piraquive',
    cedula: '80255152',
    email: 'COpc06@GMAIL.COM',
    celular: '3209035458',
  },
  {
    nombre: 'Javier Bernardo Jaramillo Villegas',
    cedula: '19358017',
    email: 'javijarvi@yahoo.com',
    celular: '3103438055',
    fechaNacimiento: '1956-10-19',
  },
  {
    nombre: 'Yury Carolina Morantes',
    cedula: '1083433781',
    email: 'ing.karom22@gmail.com',
    fechaNacimiento: '1989-07-22',
  },
  {
    nombre: 'Ricardo Javier Guzman Gil',
    cedula: '79592767',
    email: 'rjguzmanarquitectura@gmail.com',
    fechaNacimiento: '1972-11-23',
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

function codigoInspector(cedula) {
  return `INS-${cedula}`;
}

async function buscarUsuario(persona) {
  const ced = persona.cedula;
  const email = String(persona.email || '').trim().toLowerCase();
  return SecurUser.findOne({
    $or: [{ login: ced }, { cedula: ced }, { email }],
  });
}

/** Vacío = catálogo general (Zurich, Sura, Previsora, Allianz, Equidad CAT; no Alfa ni BBVA). */
async function upsertCatalogo(Model, { codigo, nombre, email, telefono }) {
  const nombreNorm = norm(nombre);
  const existentes = await Model.find({})
    .select('codigo nombre email ciudad telefono modulos')
    .lean();
  const match = existentes.find((e) => {
    if (String(e.codigo || '').trim() === codigo) return true;
    if (norm(e.nombre) === nombreNorm) return true;
    return false;
  });

  const docSet = {
    codigo: match?.codigo || codigo,
    nombre,
    email: email || match?.email || '',
    telefono: telefono || match?.telefono || '',
    ciudad: match?.ciudad || 'Todas',
    modulos: [],
    updatedAt: new Date(),
  };

  if (match) {
    await Model.updateOne({ _id: match._id }, { $set: docSet });
    return { estado: 'ACTUALIZADO', codigo: docSet.codigo };
  }

  await Model.create({
    codigo: docSet.codigo,
    nombre: docSet.nombre,
    email: docSet.email,
    telefono: docSet.telefono,
    ciudad: docSet.ciudad,
    modulos: [],
  });
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
        `| ${i + 1} | ${r.nombre} | \`${r.login}\` | ${r.email} | ${r.celular || '—'} | Catastróficos | ${r.usuarioEstado} |`
    )
    .join('\n');

  const resumenRapido = resultados
    .map((r) => `- \`${r.login}\` → ${r.nombre}`)
    .join('\n');

  return `# Credenciales de acceso — Rol Catastróficos

**Sistema:** Arnald DataFlow (Grupo Proser)  
**Módulos:** Previsora, Zurich, BBVA CAT, Alfa, Sura, Allianz y Equidad CAT  
**Fecha de generación:** ${fecha}  
**Estado:** Usuarios activos con rol \`contractor_catastroficos\` (etiqueta **Catastróficos**)

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
4. Al entrar, el sistema redirige al **reporte Previsora**.
5. Se recomienda cambiar la contraseña en **Mi Cuenta** después del primer acceso.

---

## Listado de usuarios

| # | Nombre completo | Usuario (login) | Correo | Celular | Rol | Estado |
|---|-----------------|-----------------|--------|---------|-----|--------|
${filas}

---

## Ajustadores e inspectores CAT

Catálogo general (cobertura nacional / Todas): Zurich, Sura, Previsora, Allianz y Equidad CAT. **No** aparecen en Alfa ni BBVA.

| # | Nombre | Código ajustador | Estado aj. | Código inspector | Estado insp. |
|---|--------|------------------|------------|------------------|--------------|
${resultados
  .map(
    (r, i) =>
      `| ${i + 1} | ${r.nombre} | \`${r.codigoAjustador}\` | ${r.ajustadorEstado} | \`${r.codigoInspector}\` | ${r.inspectorEstado} |`
  )
  .join('\n')}

---

## Notas

- **Login:** la cédula (CC) de cada persona.
- **Acceso:** Previsora, Zurich, BBVA CAT, Alfa, Sura, Allianz, Equidad CAT, Agenda CAT y **Mi Cuenta**. No tienen Equidad FDM, Express, Complex ni Administración.
- **Catálogo asignación:** ajustador/inspector en todas las compañías catastróficas **excepto** Alfa y BBVA.
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

  const filtroCedula = String(process.env.CEDULA || '').replace(/\D/g, '');
  const personas = filtroCedula
    ? PERSONAS.filter((p) => String(p.cedula).replace(/\D/g, '') === filtroCedula)
    : PERSONAS;
  if (filtroCedula && !personas.length) {
    console.error(`❌ No hay persona con cédula ${filtroCedula} en PERSONAS`);
    process.exit(1);
  }
  if (filtroCedula) {
    console.log(`🎯 Solo procesando cédula ${filtroCedula}\n`);
  }

  const hashedPassword = await bcrypt.hash(PASSWORD_GENERICO, 10);
  const resultados = [];

  for (const persona of personas) {
    const ced = String(persona.cedula).trim();
    const email = String(persona.email || '').trim().toLowerCase();
    const celular = String(persona.celular || '').trim();
    const nombreUsuario = aplicarSufijoNombrePorRol(persona.nombre, ROL_CATASTROFICOS);
    const payload = {
      name: nombreUsuario,
      login: ced,
      cedula: ced,
      email,
      pswd: hashedPassword,
      role: ROL_CATASTROFICOS,
      active: 'Y',
      empresa: EMPRESA,
      phone: celular || undefined,
      celulares: celular || undefined,
      fechaNacimiento: persona.fechaNacimiento
        ? new Date(`${persona.fechaNacimiento}T12:00:00.000Z`)
        : null,
    };

    let usuarioEstado = 'CREADO';
    const existente = await buscarUsuario({ ...persona, cedula: ced });
    if (existente) {
      Object.assign(existente, payload);
      await existente.save();
      usuarioEstado = 'ACTUALIZADO';
      console.log(`🔄 Usuario actualizado: ${persona.nombre} (login: ${ced})`);
    } else {
      await SecurUser.create(payload);
      console.log(`✅ Usuario creado: ${persona.nombre} (login: ${ced})`);
    }

    const ajustador = await upsertCatalogo(AjustadorCatastrofico, {
      codigo: codigoAjustador(ced),
      nombre: persona.nombre,
      email,
      telefono: celular,
    });
    const inspector = await upsertCatalogo(InspectorCatastrofico, {
      codigo: codigoInspector(ced),
      nombre: persona.nombre,
      email,
      telefono: celular,
    });
    console.log(
      `   CAT aj ${ajustador.estado} (${ajustador.codigo}) · insp ${inspector.estado} (${inspector.codigo}) · Todas · sin Alfa/BBVA`
    );

    resultados.push({
      nombre: persona.nombre,
      login: ced,
      email,
      celular,
      usuarioEstado,
      codigoAjustador: ajustador.codigo,
      ajustadorEstado: ajustador.estado,
      codigoInspector: inspector.codigo,
      inspectorEstado: inspector.estado,
    });
  }

  const outPath = path.join(__dirname, '../../CREDENCIALES_USUARIOS_CATASTROFICOS.md');
  if (!filtroCedula) {
    fs.writeFileSync(outPath, construirDocumento(resultados), 'utf8');
    console.log(`📄 Documento: ${outPath}`);
  } else {
    console.log('📄 Documento MD no regenerado (filtro CEDULA); actualizar a mano si hace falta.');
  }

  console.log('\n========== RESUMEN ==========');
  console.log(JSON.stringify(resultados, null, 2));
  console.log(`\nContraseña genérica: ${PASSWORD_GENERICO}`);

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
