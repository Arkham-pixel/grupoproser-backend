import mongoose from 'mongoose';

/**
 * Casos del listado cliente BBVA CAT (ZC / STRO).
 * Colección independiente de gsk3cAppbbvaCatCasos (inspección CAT).
 */
const BbvaCatListadoCasoSchema = new mongoose.Schema(
  {
    /** Formato BBVA-CAT-LST-YYYY-MM-N */
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
    estado: { type: String, required: true, default: 'CASO NUEVO' },
    modalidadAtencion: String,
    fechaCasoNuevo: Date,
    fechaCoordinandoInspeccion: Date,
    fechaAnalisisCaso: Date,
    fechaSolicitudDocumento: Date,
    fechaRecepcionDocumento: Date,
    fechaObjecion: Date,
    fechaAutorizacionAnalista: Date,
    fechaCasoParaPago: Date,
    documentoFaltante: String,
    observacionPendienteDocumento: String,
    motivoObjecion: String,
    responsableAporteDocumento: String,
    liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
    informeUnico: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  {
    collection: 'gsk3cAppbbvaCatListadoCasos',
    timestamps: true,
  }
);

BbvaCatListadoCasoSchema.index({ zc: 1 }, { unique: false, sparse: true });

const BbvaCatListadoCaso = mongoose.model(
  'BbvaCatListadoCaso',
  BbvaCatListadoCasoSchema,
  'gsk3cAppbbvaCatListadoCasos'
);

export default BbvaCatListadoCaso;
