/**
 * Quién modificó estado de 4 casos Alfa de Valentina.
 * node scripts/auditQuienCambioEstadoAlfa.js
 */
import '../config/loadEnv.js';
import mongoose from 'mongoose';
import SegurosAlfaCaso from '../models/SegurosAlfaCaso.js';
import ArnaldAuditLog from '../models/ArnaldAuditLog.js';
import AlfaExcelOutboundUpdate from '../models/AlfaExcelOutboundUpdate.js';

const IDS = ['66923335', '31793436', '31989592', '29675387'];

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const casos = await SegurosAlfaCaso.find({
  identificacion: { $in: IDS },
})
  .select(
    'consecutivo identificacion asegurado ajustador estado estadoGestion updatedAt createdAt fechaEnvioAseguradora'
  )
  .lean();

// por si vienen con puntos/formato
if (casos.length < IDS.length) {
  const extra = await SegurosAlfaCaso.find({
    $or: IDS.map((id) => ({
      identificacion: new RegExp(id.split('').join('\\D*')),
    })),
  })
    .select(
      'consecutivo identificacion asegurado ajustador estado estadoGestion updatedAt createdAt fechaEnvioAseguradora'
    )
    .lean();
  const seen = new Set(casos.map((c) => String(c._id)));
  for (const c of extra) {
    if (!seen.has(String(c._id))) casos.push(c);
  }
}

console.log('=== CASOS ===');
for (const c of casos) {
  console.log(
    JSON.stringify({
      id: c.identificacion,
      consecutivo: c.consecutivo,
      asegurado: c.asegurado,
      ajustador: c.ajustador,
      estado: c.estado,
      estadoGestion: c.estadoGestion,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
      _id: String(c._id),
    })
  );
}

const caseIds = casos.map((c) => String(c._id));
const objectIds = casos.map((c) => c._id);

const audits = await ArnaldAuditLog.find({
  modulo: 'alfa',
  accion: 'UPDATE',
  recursoId: { $in: caseIds },
})
  .sort({ occurredAt: -1 })
  .limit(100)
  .lean();

console.log('\n=== AUDIT PUT por caseId ===', audits.length);
for (const a of audits) {
  console.log(
    JSON.stringify({
      at: a.occurredAt,
      login: a.login,
      nombre: a.nombre,
      rol: a.rol,
      recursoId: a.recursoId,
      ruta: a.ruta,
      statusCode: a.statusCode,
      resumen: a.resumen,
    })
  );
}

const outbox = await AlfaExcelOutboundUpdate.find({
  caseId: { $in: objectIds },
})
  .sort({ createdAt: -1 })
  .lean();

console.log('\n=== OUTBOX con cambio estado* ===');
for (const o of outbox) {
  const changes =
    o.changes instanceof Map ? Object.fromEntries(o.changes) : o.changes || {};
  const relevant = {};
  for (const [k, v] of Object.entries(changes)) {
    if (/estado/i.test(k)) relevant[k] = v;
  }
  if (!Object.keys(relevant).length) continue;
  console.log(
    JSON.stringify({
      consecutivo: o.consecutivo,
      status: o.status,
      createdAt: o.createdAt,
      syncedAt: o.syncedAt,
      source: o.source,
      changes: relevant,
    })
  );
}

// Últimos UPDATE alfa cerca de updatedAt de cada caso (por si recursoId falló)
for (const c of casos) {
  const from = new Date(new Date(c.updatedAt).getTime() - 2 * 60 * 60 * 1000);
  const to = new Date(new Date(c.updatedAt).getTime() + 2 * 60 * 60 * 1000);
  const near = await ArnaldAuditLog.find({
    modulo: 'alfa',
    accion: 'UPDATE',
    occurredAt: { $gte: from, $lte: to },
    $or: [
      { recursoId: String(c._id) },
      { ruta: new RegExp(String(c._id)) },
      { resumen: new RegExp(String(c._id)) },
    ],
  })
    .sort({ occurredAt: -1 })
    .limit(10)
    .lean();
  console.log(
    `\n=== NEAR updatedAt ${c.consecutivo} (${c.updatedAt?.toISOString?.() || c.updatedAt}) ===`,
    near.length
  );
  for (const a of near) {
    console.log(
      JSON.stringify({
        at: a.occurredAt,
        login: a.login,
        nombre: a.nombre,
        rol: a.rol,
        ruta: a.ruta,
        statusCode: a.statusCode,
      })
    );
  }
}

await mongoose.disconnect();
