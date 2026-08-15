/**
 * Sync Excel SharePoint ↔ Equidad FDM (BASE TERREMOTO).
 * Defaults OFF hasta piloto.
 */

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getEquidadFdmExcelSharePointConfig() {
  return Object.freeze({
    integrationKey: 'equidad-fdm-base-terremoto',
    rootPath: String(
      process.env.SHAREPOINT_EQUIDAD_FDM_EXCEL_IMPORT_PATH || 'SEGUROS EQUIDAD'
    ).trim(),
    fileName: String(
      process.env.SHAREPOINT_EQUIDAD_FDM_EXCEL_FILE_NAME ||
        'BASE TERREMOTO 10 DE AGOSTO.xlsx'
    ).trim(),
    importCronEnabled: boolEnv('SHAREPOINT_EQUIDAD_FDM_EXCEL_IMPORT_ENABLED', false),
    importCronSchedule: String(
      process.env.SHAREPOINT_EQUIDAD_FDM_EXCEL_IMPORT_CRON || '*/5 * * * *'
    ).trim(),
    outboundCronEnabled: boolEnv('SHAREPOINT_EQUIDAD_FDM_EXCEL_OUTBOUND_ENABLED', false),
    outboundCronSchedule: String(
      process.env.SHAREPOINT_EQUIDAD_FDM_EXCEL_OUTBOUND_CRON || '*/2 * * * *'
    ).trim(),
    outboundBatchSize: intEnv('SHAREPOINT_EQUIDAD_FDM_EXCEL_OUTBOUND_BATCH_SIZE', 10),
    outboundMaxAttempts: intEnv('SHAREPOINT_EQUIDAD_FDM_EXCEL_OUTBOUND_MAX_ATTEMPTS', 5),
    /** Preferir este evento al matchear / crear desde el Excel terremoto. */
    eventoPreferido: 'TERREMOTO 10 AGOSTO 2026',
  });
}

/** Campos que el Excel puede empujar a ARNALD (inbound). */
export const FDM_EXCEL_INBOUND_FIELDS = Object.freeze([
  'nombre',
  'cedula',
  'celular',
  'direccionAfectada',
  'municipio',
  'departamento',
  'oficinaRadicadora',
  'ajustador',
  'aif',
  'polizaDanosVigente',
  'polizaAfectar',
  'orden',
  'vigenciaPoliza',
  'caso',
  'siniestro',
  'estado',
  'observaciones',
  'cobertura',
  'valorEdificio',
  'valorContenido',
  'valoresIndemnizables',
  'perdidaContenidos',
  'perdidaEdificio',
  'totalPerdida',
  'deducible',
  'subsidio',
  'totalLiquidado',
  'valorIndemnizadoAjustador',
  'valorIndemnizado',
  'fechaRegistro',
  'fechaAviso',
  'fechaLiquidacion',
]);

/** Campos que ARNALD escribe de vuelta al Excel (outbound). */
export const FDM_EXCEL_OUTBOUND_FIELDS = Object.freeze([
  'siniestro',
  'ajustador',
  'caso',
  'estado',
  'celular',
  'observaciones',
  'valorEdificio',
  'valorContenido',
  'valoresIndemnizables',
  'perdidaContenidos',
  'perdidaEdificio',
  'totalPerdida',
  'deducible',
  'subsidio',
  'totalLiquidado',
  'valorIndemnizadoAjustador',
  'valorIndemnizado',
  'fechaLiquidacion',
]);
