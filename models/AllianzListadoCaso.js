import mongoose from 'mongoose';

/**
 * Casos del listado cliente Allianz (ZC / STRO).
 * Colección independiente de gsk3cAppallianzCasos (inspección CAT).
 */
const AllianzListadoCasoSchema = new mongoose.Schema(
  {
    /** Formato ALLIANZ-LST-YYYY-MM-N */
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
    collection: 'gsk3cAppallianzListadoCasos',
    timestamps: true,
  }
);

AllianzListadoCasoSchema.index({ zc: 1 }, { unique: false, sparse: true });

const AllianzListadoCaso = mongoose.model(
  'AllianzListadoCaso',
  AllianzListadoCasoSchema,
  'gsk3cAppallianzListadoCasos'
);

export default AllianzListadoCaso;
