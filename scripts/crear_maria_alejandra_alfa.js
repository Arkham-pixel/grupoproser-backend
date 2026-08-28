/**
 * Crea a Maria Alejandra Solano Mondragon (usuario + catálogo Alfa)
 * y asigna casos Alfa sin ajustador:
 *   200 → Maria Alejandra
 *   100 → Valentina Collazos Diaz
 *
 * Uso: node scripts/crear_maria_alejandra_alfa.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import SecurUser from '../models/SecurUser.js';
import AjustadorCatastrofico from '../models/AjustadorCatastrofico.js';
import InspectorCatastrofico from '../models/InspectorCatastrofico.js';
import { aplicarSufijoNombrePorRol } from '../config/roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const ROL = 'contractor_zurich';
const PASSWORD = process.env.SEED_PASSWORD_AJUSTADORES_ALFA || 'Externos2026*';
const EMPRESA = 'Externo CAT';

const MARIA = {
  nombre: 'MARIA ALEJANDRA SOLANO MONDRAGON',
  nombreUsuario: 'Maria Alejandra Solano Mondragon',
  email: 'alejandrasolano@gmx.es',
  telefono: '3184575858',
  cedula: '1130629353',
  fechaNacimiento: new Date(1986, 7, 18),
};

const VALENTINA = 'VALENTINA COLLAZOS DIAZ';
const CUOTA_MARIA = 200;
const CUOTA_VALENTINA = 100;

function vacio(valor) {
  const s = String(valor ?? '')
    .trim()
    .toUpperCase();
  return !s || /^(N\/?A|NA|NULL|-|0|POR CONFIRMAR|SIN DATO|SIN ASIGNAR|PENDIENTE)$/.test(s);
}

function numCaso(consecutivo) {
  const m = String(consecutivo || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

function codigoAjustador(cedula) {
  return `AJU-${String(cedula).replace(/\D/g, '')}`;
}

function codigoInspector(cedula) {
  return `INS-${String(cedula).replace(/\D/g, '')}`;
}

async function upsertCatalogoAlfa(Model, { codigo, nombre, email, telefono }) {
  const tel = String(telefono || '').replace(/\D/g, '');
  const existente = await Model.findOne({
    $or: [{ codigo }, { nombre: new RegExp(`^${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }],
  });
  const docSet = {
    codigo: existente?.codigo || codigo,
    nombre,
    email: email || existente?.email || '',
    telefono: tel || existente?.telefono || '',
    ciudad: 'Todas',
    updatedAt: new Date(),
  };
  if (existente) {
    await Model.updateOne(
      { _id: existente._id },
      { $set: docSet, $addToSet: { modulos: 'alfa' } }
    );
    return { codigo: docSet.codigo, estado: 'ACTUALIZADO' };
  }
  await Model.create({ ...docSet, modulos: ['alfa'], createdAt: new Date() });
  return { codigo: docSet.codigo, estado: 'CREADO' };
}

async function asignarLote(col, ids, nombre) {
  let ok = 0;
  for (const id of ids) {
    const r = await col.updateOne(
      {
        _id: id,
        $or: [{ ajustador: null }, { ajustador: '' }, { ajustador: { $exists: false } }],
      },
      {
        $set: {
          ajustador: nombre,
          inspector: nombre,
          updatedAt: new Date(),
        },
      }
    );
    if (r.modifiedCount) ok += 1;
  }
  return ok;
}

async function main() {
  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
  } else if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  const hashed = await bcrypt.hash(PASSWORD, 10);
  const ced = String(MARIA.cedula).replace(/\D/g, '');
  const tel = String(MARIA.telefono).replace(/\D/g, '');
  const email = MARIA.email.trim().toLowerCase();
  const nombreUsuario = aplicarSufijoNombrePorRol(MARIA.nombreUsuario, ROL);

  let usuarioEstado = 'CREADO';
  const existente = await SecurUser.findOne({
    $or: [{ login: ced }, { cedula: ced }, { email }],
  });
  if (existente) {
    existente.name = nombreUsuario;
    existente.login = ced;
    existente.cedula = ced;
    existente.email = email;
    existente.pswd = hashed;
    existente.role = ROL;
    existente.active = 'Y';
    existente.phone = tel;
    existente.celulares = tel;
    existente.fechaNacimiento = MARIA.fechaNacimiento;
    existente.empresa = EMPRESA;
    await existente.save();
    usuarioEstado = 'ACTUALIZADO';
  } else {
    await SecurUser.create({
      name: nombreUsuario,
      login: ced,
      cedula: ced,
      email,
      pswd: hashed,
      role: ROL,
      active: 'Y',
      phone: tel,
      celulares: tel,
      fechaNacimiento: MARIA.fechaNacimiento,
      empresa: EMPRESA,
    });
  }

  const aj = await upsertCatalogoAlfa(AjustadorCatastrofico, {
    codigo: codigoAjustador(ced),
    nombre: MARIA.nombre,
    email,
    telefono: tel,
  });
  const insp = await upsertCatalogoAlfa(InspectorCatastrofico, {
    codigo: codigoInspector(ced),
    nombre: MARIA.nombre,
    email,
    telefono: tel,
  });

  console.log(
    `✅ Usuario ${usuarioEstado} · login ${ced} · aj ${aj.estado} (${aj.codigo}) · insp ${insp.estado} (${insp.codigo})`
  );

  const col = mongoose.connection.db.collection('gsk3cAppsegurosAlfaCasos');
  const casos = await col
    .find({})
    .project({ consecutivo: 1, ajustador: 1, inspector: 1 })
    .toArray();
  const sinAj = casos
    .filter((c) => vacio(c.ajustador))
    .sort((a, b) => numCaso(a.consecutivo) - numCaso(b.consecutivo));

  if (sinAj.length < CUOTA_MARIA + CUOTA_VALENTINA) {
    throw new Error(
      `No hay casos suficientes sin ajustador: ${sinAj.length} (se necesitan ${CUOTA_MARIA + CUOTA_VALENTINA})`
    );
  }

  const loteMaria = sinAj.slice(0, CUOTA_MARIA);
  const loteValentina = sinAj.slice(CUOTA_MARIA, CUOTA_MARIA + CUOTA_VALENTINA);

  const aplicadosMaria = await asignarLote(
    col,
    loteMaria.map((c) => c._id),
    MARIA.nombre
  );
  const aplicadosValentina = await asignarLote(
    col,
    loteValentina.map((c) => c._id),
    VALENTINA
  );

  const valentinaTotal = await col.countDocuments({
    ajustador: { $regex: /valentina/i },
  });
  const mariaTotal = await col.countDocuments({
    ajustador: { $regex: /solano\s+mondragon/i },
  });

  console.log('\n========== RESUMEN ==========');
  console.log(
    JSON.stringify(
      {
        usuario: {
          nombre: nombreUsuario,
          login: ced,
          email,
          telefono: tel,
          estado: usuarioEstado,
          contraseña: PASSWORD,
          rol: 'contractor_zurich (Zurich, Alfa, Sura y BBVA)',
        },
        catalogo: { ajustador: aj, inspector: insp },
        asignacion: {
          disponiblesSinAjustador: sinAj.length,
          mariaAsignados: aplicadosMaria,
          mariaRango: [loteMaria[0]?.consecutivo, loteMaria.at(-1)?.consecutivo],
          valentinaAsignados: aplicadosValentina,
          valentinaRango: [loteValentina[0]?.consecutivo, loteValentina.at(-1)?.consecutivo],
          mariaTotalCasos: mariaTotal,
          valentinaTotalCasos: valentinaTotal,
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
