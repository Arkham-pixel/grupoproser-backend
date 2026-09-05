/**
 * Crea/actualiza usuarios externos ERA (login = INE, rol contractor_era).
 * Equipo: módulo Alfa, solo los casos que Proser asigne a la firma (sin autoasignar).
 * Cadena: Líder Proser Ajustes → Líder ERA (Erick) → Ajustador ERA → Inspector ERA.
 *
 * Uso: desde backend/ → node scripts/crear_usuarios_era.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import SecurUser from '../models/SecurUser.js';
import { aplicarSufijoNombrePorRol } from '../config/roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const ROL_ERA = 'contractor_era';
const PASSWORD_GENERICO = process.env.SEED_PASSWORD_ERA || 'Externos2026*';
const EMPRESA = 'ERA';

const PERSONAS = [
  {
    nombre: 'Erick Aramis Quevedo Gonzalez',
    email: 'erick.quevedo@erareinsurance.com',
    celular: '+52 (55) 1452.3505',
    fechaNacimiento: '1981-12-28',
    cedula: '4201038754011',
  },
  {
    nombre: 'César Rodríguez Gutiérrez',
    email: 'cesar.rodriguez@qm-adjusters.com.mx',
    celular: '+52 (55) 1860.9432',
    fechaNacimiento: '1991-12-30',
    cedula: '2272085666324',
  },
  {
    nombre: 'Fernando Murillo Ánimas',
    email: 'fernando.murillo@qm-adjusters.com.mx',
    celular: '+52 (55) 8760.1005',
    fechaNacimiento: '1977-04-04',
    cedula: '1003038350891',
  },
  {
    nombre: 'Ángel Jael Soto Cruz',
    email: 'angel.soto@qm-adjusters.com.mx',
    celular: '+52 (55) 7487.5396',
    fechaNacimiento: '1996-06-27',
    cedula: '3987100038612',
  },
  {
    nombre: 'Rogelio Montoya de la Vega',
    email: 'rogelio.montoya@qm-adjusters.com.mx',
    celular: '+52 (55) 4884.4542',
    fechaNacimiento: '1976-05-28',
    cedula: '5473026805654',
  },
  {
    nombre: 'Yolanda Iris Vázquez Martínez',
    email: 'yolanda.vazquez@qm-adjusters.com.mx',
    celular: '+52 (744) 1033.443',
    fechaNacimiento: '1990-05-08',
    cedula: '3744082652881',
  },
  {
    nombre: 'Mitzy Yuriko Rangel Marin',
    email: 'Yurikogrimm1225@gmail.com',
    celular: '+52 (56) 2791.1514',
    fechaNacimiento: '1994-03-12',
    cedula: '4240092522140',
  },
  {
    nombre: 'Mauricio Alfredo Zamora Hernandez',
    email: 'mauricioalfredo48@gmail.com',
    celular: '+52 (66) 3390.0089',
    fechaNacimiento: '1997-08-28',
    cedula: '0815104122085',
  },
  {
    nombre: 'Jorge Luis Perez Angulo',
    email: 'eg_rojsiul@hotmail.com',
    celular: '+52 (22) 2510.4796',
    fechaNacimiento: '1987-06-14',
    cedula: '0519072577601',
  },
  {
    nombre: 'Carlos Eduardo Luz Contreras',
    email: 'charlyluz24@gmail.com',
    celular: '+52 (55) 6764.3113',
    fechaNacimiento: '1990-07-14',
    cedula: '5346081408584',
  },
  {
    nombre: 'Blanca Estela Rivera Diaz',
    email: 'estela_rd84@msn.com',
    celular: '+52 (24) 6122.8750',
    fechaNacimiento: '1984-05-20',
    cedula: '0186050007215',
  },
];

async function buscarUsuario(persona) {
  const ced = persona.cedula;
  const email = String(persona.email || '').trim().toLowerCase();
  return SecurUser.findOne({
    $or: [{ login: ced }, { cedula: ced }, { email }],
  });
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
        `| ${i + 1} | ${r.nombre} | \`${r.login}\` | ${r.email} | ERA | ${r.usuarioEstado} |`
    )
    .join('\n');

  const resumenRapido = resultados
    .map((r) => `- \`${r.login}\` → ${r.nombre}`)
    .join('\n');

  return `# Credenciales de acceso — Rol ERA

**Sistema:** Arnald DataFlow (Grupo Proser)  
**Módulos:** Alfa (casos que Proser asigne a la firma; no crean cartera)  
**Cadena:** Líder Proser Ajustes → Líder ERA (Erick) → Ajustador ERA → Inspector ERA  
**Fecha de generación:** ${fecha}  
**Estado:** Usuarios activos con rol \`contractor_era\` (etiqueta **ERA**)

---

## Contraseña genérica (todos los usuarios)

| Campo | Valor |
|-------|-------|
| **Contraseña** | \`${PASSWORD_GENERICO}\` |

> Esta contraseña cumple los requisitos del sistema: mínimo 8 caracteres, mayúscula, minúscula, número y carácter especial.

---

## Instrucciones de ingreso

1. Abrir la plataforma e ir a **Iniciar sesión**.
2. En **Usuario**, ingresar el **número de identificación (INE)** (login).
3. En **Contraseña**, ingresar: \`${PASSWORD_GENERICO}\`
4. Al entrar, el sistema redirige al **reporte Previsora**.
5. Se recomienda cambiar la contraseña en **Mi Cuenta** después del primer acceso.

---

## Listado de usuarios

| # | Nombre completo | Usuario (login) | Correo | Rol | Estado |
|---|-----------------|-----------------|--------|-----|--------|
${filas}

---

## Notas

- **Login:** el número de identificación (INE) de cada persona.
- **Acceso:** estos usuarios ven **Alfa** (reporte, mis casos, dashboard, caso) y **Mi Cuenta**. No ven el resto de módulos catastróficos ni Equidad FDM.
- **Casos:** hasta que Proser asigne el cupo en Alfa, el reporte sale vacío. No se autoasignan casos al crear usuarios.
- **Líder ERA:** Erick Aramis Quevedo Gonzalez. Los movimientos (estado, liquidador, informe) avisan a Erick y al Líder Proser Ajustes.
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
    const nombreUsuario = aplicarSufijoNombrePorRol(persona.nombre, ROL_ERA);
    const payload = {
      name: nombreUsuario,
      login: ced,
      cedula: ced,
      email,
      pswd: hashedPassword,
      role: ROL_ERA,
      active: 'Y',
      empresa: EMPRESA,
      phone: persona.celular,
      celulares: persona.celular,
      fechaNacimiento: persona.fechaNacimiento ? new Date(`${persona.fechaNacimiento}T12:00:00.000Z`) : null,
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

    resultados.push({
      nombre: persona.nombre,
      login: ced,
      email,
      usuarioEstado,
    });
  }

  const outPath = path.join(__dirname, '../../CREDENCIALES_USUARIOS_ERA.md');
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
