import cron from 'node-cron';
import { getNextCronRun } from '../utils/cronNextRun.js';
import SiniestroExpress from '../models/SiniestroExpress.js';
import EstadoExpressCierreMensual from '../models/EstadoExpressCierreMensual.js';
import EstadoExpress from '../models/EstadoExpress.js';

const CRON_SCHEDULE = process.env.EXPRESS_CIERRE_MENSUAL_CRON_SCHEDULE || '59 23 * * *';
const ENABLE_CRON = process.env.ENABLE_EXPRESS_CIERRE_MENSUAL_CRON !== 'false';
const CRON_TIMEZONE = 'America/Bogota';

const norm = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const inicioMesUtc = (anio, mes) => new Date(Date.UTC(anio, mes - 1, 1, 0, 0, 0, 0));
const inicioMesSiguienteUtc = (anio, mes) => new Date(Date.UTC(anio, mes, 1, 0, 0, 0, 0));
const finMesUtc = (anio, mes) => new Date(Date.UTC(anio, mes, 0, 23, 59, 59, 999));

const obtenerPeriodoAnteriorColombia = () => {
  const now = new Date();
  const colombia = new Date(now.toLocaleString('en-US', { timeZone: CRON_TIMEZONE }));
  let anio = colombia.getFullYear();
  let mes = colombia.getMonth(); // 0-11 => mes anterior en base 1
  if (mes === 0) {
    anio -= 1;
    mes = 12;
  }
  return { anio, mes };
};

class CronExpressCierreMensualService {
  constructor() {
    this.isRunning = false;
    this.lastExecution = null;
    this.nextExecution = null;
    this.task = null;
  }

  async generarCierreMensual({ anio, mes, force = false } = {}) {
    const periodo = {
      anio: Number(anio),
      mes: Number(mes),
    };

    if (!periodo.anio || !periodo.mes || periodo.mes < 1 || periodo.mes > 12) {
      throw new Error('Periodo inválido para cierre mensual Express');
    }

    const existente = await EstadoExpressCierreMensual.findOne(periodo).lean();
    if (existente && !force) {
      return {
        success: true,
        skipped: true,
        reason: 'Cierre ya existe para ese periodo',
        periodo,
      };
    }

    const [catalogoEstados, docs] = await Promise.all([
      EstadoExpress.find().lean(),
      SiniestroExpress.find(
        {
          avisoSiniestro: {
            $gte: inicioMesUtc(periodo.anio, periodo.mes),
            $lt: inicioMesSiguienteUtc(periodo.anio, periodo.mes),
          },
        },
        { estadoProceso: 1 }
      ).lean(),
    ]);

    const estadoPorCodigo = new Map();
    const estadoPorDescNorm = new Map();
    for (const e of catalogoEstados) {
      const desc = String(e.descEstdo ?? e.descEstado ?? '').trim();
      const codigo = String(e.codiEstdo ?? e.codiEstado ?? '').trim();
      if (codigo && desc) estadoPorCodigo.set(codigo, desc);
      if (desc) estadoPorDescNorm.set(norm(desc), desc);
    }

    const conteo = new Map();
    let totalSinEstado = 0;
    for (const doc of docs) {
      const raw = String(doc.estadoProceso ?? '').trim();
      let estado = '';

      if (!raw) {
        estado = 'SIN_ESTADO';
        totalSinEstado += 1;
      } else {
        estado =
          estadoPorCodigo.get(raw) ||
          estadoPorDescNorm.get(norm(raw)) ||
          raw.toUpperCase();
      }
      conteo.set(estado, (conteo.get(estado) || 0) + 1);
    }

    const estados = [...conteo.entries()]
      .map(([estado, cantidad]) => ({ estado, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);

    const payload = {
      ...periodo,
      totalCasos: docs.length,
      totalSinEstado,
      estados,
      fechaCorte: finMesUtc(periodo.anio, periodo.mes),
    };

    await EstadoExpressCierreMensual.findOneAndUpdate(periodo, payload, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });

    return {
      success: true,
      skipped: false,
      periodo,
      totalCasos: payload.totalCasos,
      totalSinEstado: payload.totalSinEstado,
      estados: payload.estados.length,
    };
  }

  async ejecutarCierreAutomatico() {
    try {
      const now = new Date();
      const colombia = new Date(now.toLocaleString('en-US', { timeZone: CRON_TIMEZONE }));
      const manana = new Date(colombia);
      manana.setDate(colombia.getDate() + 1);

      // Solo correr realmente en último día de mes.
      if (manana.getDate() !== 1) {
        console.log('ℹ️ Cierre mensual Express: hoy no es fin de mes, se omite.');
        this.lastExecution = new Date();
        return { success: true, skipped: true, reason: 'No es fin de mes' };
      }

      const periodo = {
        anio: colombia.getFullYear(),
        mes: colombia.getMonth() + 1,
      };

      const resultado = await this.generarCierreMensual(periodo);
      this.lastExecution = new Date();
      return resultado;
    } catch (error) {
      this.lastExecution = new Date();
      console.error('❌ Error en cierre mensual Express:', error);
      return { success: false, error: error.message };
    }
  }

  async asegurarCierreMesAnterior() {
    try {
      const periodo = obtenerPeriodoAnteriorColombia();
      const existente = await EstadoExpressCierreMensual.findOne(periodo).lean();
      if (existente) return;
      const resultado = await this.generarCierreMensual(periodo);
      console.log('✅ Backfill cierre mensual Express mes anterior:', resultado);
    } catch (error) {
      console.error('⚠️ No se pudo generar backfill de cierre mensual Express:', error.message);
    }
  }

  start() {
    if (!ENABLE_CRON) {
      console.log('⚠️ Cron de cierre mensual Express deshabilitado por configuración');
      return;
    }
    if (this.isRunning) {
      console.log('⚠️ Cron de cierre mensual Express ya está ejecutándose');
      return;
    }

    this.task = cron.schedule(
      CRON_SCHEDULE,
      async () => {
        const resultado = await this.ejecutarCierreAutomatico();
        console.log('📌 Resultado cierre mensual Express:', resultado);
      },
      {
        scheduled: true,
        timezone: CRON_TIMEZONE,
      }
    );

    this.isRunning = true;
    this.calcularProximaEjecucion();
    console.log(`✅ Cron cierre mensual Express iniciado (${CRON_SCHEDULE}, ${CRON_TIMEZONE})`);
    this.asegurarCierreMesAnterior();
  }

  stop() {
    if (!this.isRunning) return;
    if (this.task) {
      this.task.stop();
      this.task.destroy();
      this.task = null;
    }
    this.isRunning = false;
  }

  calcularProximaEjecucion() {
    try {
      this.nextExecution = getNextCronRun(CRON_SCHEDULE, CRON_TIMEZONE);
    } catch {
      this.nextExecution = null;
    }
  }
}

const cronExpressCierreMensualService = new CronExpressCierreMensualService();

export const iniciarCronExpressCierreMensual = () => cronExpressCierreMensualService.start();
export const detenerCronExpressCierreMensual = () => cronExpressCierreMensualService.stop();
export const ejecutarCierreMensualExpressManual = ({ anio, mes, force = false } = {}) =>
  cronExpressCierreMensualService.generarCierreMensual({ anio, mes, force });
export const ejecutarCierreMensualExpressAutomatico = () =>
  cronExpressCierreMensualService.ejecutarCierreAutomatico();

export default cronExpressCierreMensualService;

