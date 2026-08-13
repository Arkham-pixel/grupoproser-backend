import mongoose from 'mongoose';

/**
 * Casos Fundación de la Mujer (módulo EQUIDAD FDM).
 * Campos alineados a los Excel OLA INVERNAL y TERREMOTO 10 AGOSTO 2026 FDLM.
 */
const EquidadFdmCasoSchema = new mongoose.Schema({
  /** Formato FDM-YYYY-MM-N (asignado al crear; no editable) */
  consecutivo: String,
  /** N° de fila del Excel original (referencia) */
  numero: Number,
  /** Evento catastrófico: OLA INVERNAL | TERREMOTO 10 AGOSTO 2026 */
  evento: String,
  nombre: { type: String, required: true },
  cedula: String,
  celular: String,
  direccionAfectada: String,
  municipio: String,
  departamento: String,
  oficinaRadicadora: String,
  fechaRegistro: Date,
  ajustador: String,
  /** Asesor Integral Fundación (AIF) */
  aif: String,
  /** SI | NO */
  polizaDanosVigente: String,
  polizaAfectar: String,
  orden: String,
  vigenciaPoliza: String,
  afectacionesAnteriores: String,
  siniestroIndemnizado: String,
  valorEdificio: Number,
  valorContenido: Number,
  /** VALORES QUE SE PUEDE INDEMNIZAR */
  valoresIndemnizables: Number,
  subsidioEmpresarial: String,
  cobertura: String,
  primas: String,
  tipoNegocio: String,
  perdidaContenidos: Number,
  perdidaEdificio: Number,
  totalPerdida: Number,
  deducible: Number,
  totalLiquidado: Number,
  subsidio: Number,
  valorIndemnizadoAjustador: Number,
  caso: String,
  siniestro: String,
  fechaLiquidacion: Date,
  fechaAviso: Date,
  /** Puede ser un valor numérico o un texto explicativo de la objeción */
  valorObjecion: String,
  fechaCausacion: Date,
  valorIndemnizado: Number,
  fechaGiro: Date,
  estado: { type: String, required: true },
  observaciones: String,
  detalle: String,
  /** true = ingresó en una carga reciente (p. ej. terremoto); no pisa casos anteriores */
  esNuevo: { type: Boolean, default: false },
  /** Estado del liquidador FDM (encabezado, ítems, deducible, constancia) */
  liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  collection: 'gsk3cAppequidadFdmCasos',
  timestamps: true,
});

const EquidadFdmCaso = mongoose.model('EquidadFdmCaso', EquidadFdmCasoSchema, 'gsk3cAppequidadFdmCasos');

export default EquidadFdmCaso;
