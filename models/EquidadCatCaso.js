import mongoose from 'mongoose';
import { aplicarPluginNotificacionesOperativas } from '../services/notificacionesOperativasService.js';
import { aplicarCamposAgendaCatastrofico } from '../utils/agendaCatastrofico.js';

const ArchivoEquidadCatSchema = new mongoose.Schema(
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
 * Casos Equidad CAT (listado cliente, liquidador FDM e informe único).
 * Colección única: gsk3cAppequidadCatCasos.
 */
const EquidadCatCasoSchema = new mongoose.Schema(
  {
    /** Formato EQUIDAD-CAT-YYYY-MM-N */
    consecutivo: String,
    zc: { type: String, index: true },
    siniestro: { type: String, index: true },
    /** Número de caso de Equidad (columna CASO del listado). */
    numeroCasoCliente: String,
    identificacion: { type: String, default: '' },
    tipoIdentificacion: String,
    numeroPoliza: String,
    tipoPoliza: String,
    tipoPolizaOtro: String,
    /** Producto del listado Equidad (ej. VIVIENDA SEGURA). */
    producto: String,
    causa: String,
    asegurado: String,
    tomador: String,
    analista: String,
    /** Nombre del intermediario (columna INTERMEDIARIO) */
    intermediario: String,
    correoIntermediario: String,
    telefonoIntermediario: String,
    /** Texto legado: nombre | correo | teléfono */
    contactoIntermediario: String,
    correoAsegurado: String,
    telefonoAsegurado: String,
    celular: String,
    /** Texto legado del contacto asegurado */
    contactoAsegurado: String,
    observaciones: String,
    comentariosAnalista: String,
    ciudad: String,
    departamento: String,
    /** SI | NO — columna ASIGNACION del listado Equidad */
    asignacion: String,
    /** SI | NO — columna «Ya se asigno a Ajustador?» */
    asignadoAAjustador: String,
    visita: String,
    ajustadorLider: String,
    ajustador: String,
    inspector: String,
    fechaAviso: Date,
    fechaAsignacion: Date,
    fechaVisita: Date,
    fechaDefinicion: Date,
    fechaUltimoDocumento: Date,
    fechaCausacion: Date,
    fechaGiro: Date,
    valorAsegurado: Number,
    valorAseguradoInmueble: Number,
    valorAseguradoContenidos: Number,
    valorReservaPreventivaPromedio: Number,
    valorComercialInmueble: Number,
    reserva: Number,
    reservaDirecta: Number,
    reservaGastos: Number,
    diferenciaReserva: Number,
    observacionReserva: { type: String, default: '' },
    valorReclamado: Number,
    valorLiquidado: Number,
    valorIndemnizado: Number,
    deducibleMaxPct: Number,
    tipoDeducible: String,
    deducibleSmmlv: Number,
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
    informeAgil: { type: mongoose.Schema.Types.Mixed, default: null },
    archivos: { type: [ArchivoEquidadCatSchema], default: [] },
    /**
     * Correo masivo de apertura (GRUPO PROSER designado por EquidadCat).
     * Evita reenvíos al volver a correr el script.
     */
    fechaEmailAperturaEquidadCat: Date,
    emailAperturaEquidadCatMessageId: String,
  },
  {
    collection: 'gsk3cAppequidadCatCasos',
    timestamps: true,
  }
);

EquidadCatCasoSchema.index({ zc: 1 }, { unique: false, sparse: true });
aplicarCamposAgendaCatastrofico(EquidadCatCasoSchema);
aplicarPluginNotificacionesOperativas(EquidadCatCasoSchema, { modulo: 'equidadCat' });

const EquidadCatCaso = mongoose.model(
  'EquidadCatCaso',
  EquidadCatCasoSchema,
  'gsk3cAppequidadCatCasos'
);

export default EquidadCatCaso;
