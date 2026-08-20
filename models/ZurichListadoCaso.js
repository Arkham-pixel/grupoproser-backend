import mongoose from 'mongoose';

/**
 * Casos del listado cliente Zurich (ZC / STRO).
 * Colección independiente de gsk3cAppzurichCasos (inspección CAT).
 */
const ZurichListadoCasoSchema = new mongoose.Schema(
  {
    /** Formato ZURICH-LST-YYYY-MM-N */
    consecutivo: String,
    zc: { type: String, index: true },
    siniestro: String,
    identificacion: { type: String, required: true },
    tipoIdentificacion: String,
    numeroPoliza: String,
    tipoPoliza: String,
    causa: String,
    asegurado: String,
    /** Nombre del intermediario (columna INTERMEDIARIO) */
    intermediario: String,
    correoIntermediario: String,
    telefonoIntermediario: String,
    /** Texto legado: nombre | correo | teléfono */
    contactoIntermediario: String,
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
  },
  {
    collection: 'gsk3cAppzurichListadoCasos',
    timestamps: true,
  }
);

ZurichListadoCasoSchema.index({ zc: 1 }, { unique: false, sparse: true });

const ZurichListadoCaso = mongoose.model(
  'ZurichListadoCaso',
  ZurichListadoCasoSchema,
  'gsk3cAppzurichListadoCasos'
);

export default ZurichListadoCaso;
