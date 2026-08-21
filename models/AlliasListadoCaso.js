import mongoose from 'mongoose';

/**
 * Casos del listado cliente Allias (ZC / STRO).
 * Colección independiente de gsk3cAppalliasCasos (inspección CAT).
 */
const AlliasListadoCasoSchema = new mongoose.Schema(
  {
    /** Formato ALLIAS-LST-YYYY-MM-N */
    consecutivo: String,
    zc: { type: String, index: true },
    siniestro: String,
    identificacion: { type: String, required: true },
    tipoIdentificacion: String,
    numeroPoliza: String,
    tipoPoliza: String,
    tipoPolizaOtro: String,
    causa: String,
    asegurado: String,
    /** Nombre del intermediario (columna INTERMEDIARIO) */
    intermediario: String,
    correoIntermediario: String,
    telefonoIntermediario: String,
    /** Texto legado: nombre | correo | teléfono */
    contactoIntermediario: String,
    correoAsegurado: String,
    telefonoAsegurado: String,
    /** Texto legado del contacto asegurado */
    contactoAsegurado: String,
    observaciones: String,
    ciudad: String,
    departamento: String,
    ajustadorLider: String,
    ajustador: String,
    inspector: String,
    fechaAsignacion: Date,
    fechaVisita: Date,
    estado: { type: String, required: true, default: 'PENDIENTE' },
    liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
    informeUnico: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    collection: 'gsk3cAppalliasListadoCasos',
    timestamps: true,
  }
);

AlliasListadoCasoSchema.index({ zc: 1 }, { unique: false, sparse: true });

const AlliasListadoCaso = mongoose.model(
  'AlliasListadoCaso',
  AlliasListadoCasoSchema,
  'gsk3cAppalliasListadoCasos'
);

export default AlliasListadoCaso;
