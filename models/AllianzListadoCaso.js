import mongoose from 'mongoose';
import { aplicarPluginNotificacionesOperativas } from '../services/notificacionesOperativasService.js';
import { aplicarCamposAgendaCatastrofico } from '../utils/agendaCatastrofico.js';

const ArchivoAllianzListadoSchema = new mongoose.Schema(
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
    direccionPredio: String,
    ciudad: String,
    departamento: String,
    ajustadorLider: String,
    ajustador: String,
    inspector: String,
    fechaAsignacion: Date,
    fechaVisita: Date,
    valorAseguradoInmueble: Number,
    valorAseguradoContenidos: Number,
    valorReservaPreventivaPromedio: Number,
    valorComercialInmueble: Number,
    reserva: Number,
    observacionReserva: { type: String, default: '' },
    valorReclamado: Number,
    valorLiquidado: Number,
    estado: { type: String, required: true, default: 'CASO NUEVO' },
    modalidadAtencion: String,
    fechaCasoNuevo: Date,
    fechaCoordinandoInspeccion: Date,
    fechaAnalisisCaso: Date,
    fechaSolicitudDocumento: Date,
    fechaRecepcionDocumento: Date,
    fechaObjecion: Date,
    fechaObjetado: Date,
    fechaAutorizacionAnalista: Date,
    fechaCasoParaPago: Date,
    fechaCasoPagado: Date,
    fechaAnulado: Date,
    documentoFaltante: String,
    observacionPendienteDocumento: String,
    motivoObjecion: String,
    responsableAporteDocumento: String,
    liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
    informeUnico: { type: mongoose.Schema.Types.Mixed, default: null },
    informeAgil: { type: mongoose.Schema.Types.Mixed, default: null },
    archivos: { type: [ArchivoAllianzListadoSchema], default: [] },
    /**
     * Correo masivo de apertura (GRUPO PROSER designado por Allianz).
     * Evita reenvíos al volver a correr el script.
     */
    fechaEmailAperturaAllianz: Date,
    emailAperturaAllianzMessageId: String,
  },
  {
    collection: 'gsk3cAppallianzListadoCasos',
    timestamps: true,
  }
);

AllianzListadoCasoSchema.index({ zc: 1 }, { unique: false, sparse: true });
aplicarCamposAgendaCatastrofico(AllianzListadoCasoSchema);
aplicarPluginNotificacionesOperativas(AllianzListadoCasoSchema, { modulo: 'allianzListado' });

const AllianzListadoCaso = mongoose.model(
  'AllianzListadoCaso',
  AllianzListadoCasoSchema,
  'gsk3cAppallianzListadoCasos'
);

export default AllianzListadoCaso;
