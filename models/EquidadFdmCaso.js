import mongoose from 'mongoose';

/**
 * Casos Fundación de la Mujer (módulo EQUIDAD FDM).
 * Campos alineados al Excel "OLA INVERNAL ... FUNDACION DE LA MUJER".
 */
const EquidadFdmCasoSchema = new mongoose.Schema({
  /** Formato FDM-YYYY-MM-N (asignado al crear; no editable) */
  consecutivo: String,
  /** N° de fila del Excel original (referencia) */
  numero: Number,
  nombre: { type: String, required: true },
  cedula: String,
  celular: String,
  direccionAfectada: String,
  municipio: String,
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
}, {
  collection: 'gsk3cAppequidadFdmCasos',
  timestamps: true,
});

const EquidadFdmCaso = mongoose.model('EquidadFdmCaso', EquidadFdmCasoSchema, 'gsk3cAppequidadFdmCasos');

export default EquidadFdmCaso;
