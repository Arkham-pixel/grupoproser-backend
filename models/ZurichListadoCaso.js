import mongoose from 'mongoose';

const ArchivoZurichListadoSchema = new mongoose.Schema(
  {
    nombreOriginal: { type: String, required: true },
    nombreArchivo: String,
    ruta: { type: String, required: true },
    tamaño: Number,
    tipoMime: String,
    etiqueta: { type: String, default: 'GENERAL' },
    descripcion: { type: String, default: '' },
    orden: { type: Number, default: 0 },
    subidoPor: {
      id: String,
      login: String,
      nombre: String,
    },
    fechaSubida: { type: Date, default: Date.now },
  },
  { _id: true }
);

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
    archivos: { type: [ArchivoZurichListadoSchema], default: [] },
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
