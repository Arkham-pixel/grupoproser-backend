/**
 * Recalcula montos de liquidación desde liquidador JSON (corrige ×100 por parseo de comas)
 * y empuja a SharePoint.
 */
import '../config/loadEnv.js';
import dns from 'dns';
import mongoose from 'mongoose';
import EquidadFdmCaso from '../models/EquidadFdmCaso.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const SMMLV_POR_ANIO = {
  2020: 877803,
  2021: 908526,
  2022: 1000000,
  2023: 1160000,
  2024: 1300000,
  2025: 1423500,
  2026: 1750905,
};
const SMMLV_DEFAULT = SMMLV_POR_ANIO[2026];

function parsearNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  if (typeof valor === 'number') return Number.isNaN(valor) ? 0 : valor;
  let numero = String(valor).replace(/[^\d.,-]/g, '');
  if (numero.includes(',') && numero.includes('.')) {
    if (numero.lastIndexOf(',') > numero.lastIndexOf('.')) {
      numero = numero.replace(/\./g, '').replace(',', '.');
    } else {
      numero = numero.replace(/,/g, '');
    }
  } else if (numero.includes('.') && !numero.includes(',')) {
    const partes = numero.split('.');
    if (partes.length > 2 || (partes[1] && partes[1].length === 3)) {
      numero = numero.replace(/\./g, '');
    }
  } else if (numero.includes(',')) {
    const partes = numero.split(',');
    if (partes.length === 2 && partes[1].length <= 2) {
      numero = `${partes[0].replace(/\./g, '')}.${partes[1]}`;
    } else {
      numero = numero.replace(/,/g, '');
    }
  }
  const n = parseFloat(numero);
  return Number.isNaN(n) ? 0 : n;
}

function numDeducible(valor, defaultVal) {
  if (valor === '' || valor === null || valor === undefined) return defaultVal;
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor).replace(',', '.'));
  return Number.isNaN(n) ? defaultVal : n;
}

function calcularLiquidacionFdm(liquidador = {}) {
  const contenidos = liquidador.contenidos || [];
  const edificios = liquidador.edificios || [];
  const subtotalContenidos = contenidos.reduce((s, i) => s + parsearNumero(i.valor), 0);
  const subtotalEdificios = edificios.reduce((s, i) => s + parsearNumero(i.valor), 0);
  const totalPerdida = subtotalContenidos + subtotalEdificios;
  const cantidadSMMLV = numDeducible(liquidador.deducible?.cantidadSMMLV, 0.75);
  const anioSMMLV = Number(liquidador.deducible?.anioSMMLV) || new Date().getFullYear();
  const valorSMMLV = parsearNumero(
    liquidador.deducible?.valorSMMLV ?? SMMLV_POR_ANIO[anioSMMLV] ?? SMMLV_DEFAULT
  );
  const deducibleSMMLV = valorSMMLV * cantidadSMMLV;
  const deduciblePorcentajeExcel = totalPerdida * 0.1;
  const deducibleAplicado = Math.max(deducibleSMMLV, deduciblePorcentajeExcel);
  const subsidio = parsearNumero(liquidador.subsidio);
  const totalAntesSubsidio =
    totalPerdida - deducibleAplicado < 0 ? 0 : totalPerdida - deducibleAplicado;
  const totalIndemnizar = totalAntesSubsidio + subsidio;
  return {
    subtotalContenidos,
    subtotalEdificios,
    totalPerdida,
    deducibleAplicado,
    subsidio,
    totalIndemnizar,
  };
}

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 45000,
});

const casos = await EquidadFdmCaso.find({
  liquidador: { $exists: true, $ne: null },
  estado: /liquidado|girado|objetado/i,
}).lean();

const samples = [];
let fixed = 0;
let skipped = 0;

for (const caso of casos) {
  const t = calcularLiquidacionFdm(caso.liquidador || {});
  if (!t.totalPerdida && !t.deducibleAplicado && !t.totalIndemnizar) {
    skipped += 1;
    continue;
  }
  const before = {
    deducible: caso.deducible,
    totalLiquidado: caso.totalLiquidado,
    totalPerdida: caso.totalPerdida,
  };
  const changed =
    Math.abs(Number(caso.deducible || 0) - t.deducibleAplicado) > 0.5 ||
    Math.abs(Number(caso.totalLiquidado || 0) - t.totalIndemnizar) > 0.5 ||
    Math.abs(Number(caso.totalPerdida || 0) - t.totalPerdida) > 0.5;

  if (!changed) {
    skipped += 1;
    continue;
  }

  await EquidadFdmCaso.updateOne(
    { _id: caso._id },
    {
      $set: {
        perdidaContenidos: t.subtotalContenidos,
        perdidaEdificio: t.subtotalEdificios,
        totalPerdida: t.totalPerdida,
        deducible: t.deducibleAplicado,
        subsidio: t.subsidio,
        totalLiquidado: t.totalIndemnizar,
        valorIndemnizado: t.totalIndemnizar,
        valorIndemnizadoAjustador: t.totalIndemnizar,
      },
    }
  );
  fixed += 1;
  if (samples.length < 12) {
    samples.push({
      consecutivo: caso.consecutivo,
      caso: caso.caso,
      before,
      after: {
        deducible: t.deducibleAplicado,
        totalLiquidado: t.totalIndemnizar,
        totalPerdida: t.totalPerdida,
      },
    });
  }
}

console.log(JSON.stringify({ total: casos.length, fixed, skipped, samples }, null, 2));
await mongoose.disconnect();
