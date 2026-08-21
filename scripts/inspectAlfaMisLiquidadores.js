import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);

const users = mongoose.connection.collection('gsk3cAppusuarios');
const casos = mongoose.connection.collection('gsk3cAppsegurosAlfaCasos');

const user = await users.findOne({
  $or: [
    { login: '1065012991' },
    { cedula: '1065012991' },
    { identificacion: '1065012991' },
  ],
});

console.log(
  'USER:',
  user
    ? {
        login: user.login,
        cedula: user.cedula,
        nombre: user.nombre,
        rol: user.rol,
      }
    : null
);

const nombre = user?.nombre || '';
const login = user?.login || '1065012991';

const misCasos = await casos
  .find({
    $or: [
      { ajustador: new RegExp(nombre.split(/\s+/)[0] || login, 'i') },
      { ajustador: login },
      { inspector: login },
      { inspector: new RegExp(nombre.split(/\s+/)[0] || 'NOPE', 'i') },
    ],
  })
  .project({
    consecutivo: 1,
    asegurado: 1,
    ajustador: 1,
    inspector: 1,
    liquidador: 1,
    informeUnico: 1,
    updatedAt: 1,
  })
  .sort({ updatedAt: -1 })
  .limit(50)
  .toArray();

const textoItem = (it = {}) =>
  String(it?.actividad || it?.concepto || it?.descripcion || '').trim();

const out = misCasos.map((c) => {
  const items = c.liquidador?.evaluacionSismicaNSR10?.presupuesto?.items;
  const n = Array.isArray(items) ? items.filter((it) => textoItem(it)).length : 0;
  return {
    consecutivo: c.consecutivo,
    asegurado: c.asegurado,
    ajustador: c.ajustador,
    tieneLiqObj: Boolean(c.liquidador),
    items: n,
    tieneInforme: Boolean(c.informeUnico),
  };
});

console.log(
  JSON.stringify(
    {
      encontrados: out.length,
      conLiq: out.filter((x) => x.tieneLiqObj).length,
      conItems: out.filter((x) => x.items > 0).length,
      casos: out,
    },
    null,
    2
  )
);

// Also: how many of the 65 with liquidador have no ajustador?
const sinAjustador = await casos.countDocuments({
  liquidador: { $exists: true, $ne: null, $type: 'object' },
  $or: [{ ajustador: null }, { ajustador: '' }, { ajustador: { $exists: false } }],
});
console.log('conLiqSinAjustador:', sinAjustador);

await mongoose.disconnect();
