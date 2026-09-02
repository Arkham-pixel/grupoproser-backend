import mongoose from 'mongoose';
import { aplicarPluginNotificacionesOperativas } from '../services/notificacionesOperativasService.js';
import { aplicarCamposAgendaCatastrofico } from '../utils/agendaCatastrofico.js';

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
    observacionesCat: String,
    ciudad: String,
    departamento: String,
    tomador: String,
    direccionPredio: String,
    fechaInicioPoliza: Date,
    fechaFinPoliza: Date,
    cobertura: String,
    ajustadorLider: String,
    ajustador: String,
    inspector: String,
    fechaAsignacion: Date,
    fechaVisita: Date,
    fechaSiniestro: Date,
    /** Reserva entregada por el perito (informe). */
    reserva: Number,
    valorAseguradoInmueble: Number,
    valorReclamado: Number,
    valorLiquidado: Number,
    estado: { type: String, required: true, default: 'CASO NUEVO' },
    modalidadAtencion: String,
    fechaCasoNuevo: Date,
    fechaCoordinandoInspeccion: Date,
    fechaInspeccionado: Date,
    fechaVerificado: Date,
    fechaAnalisisCaso: Date,
    fechaSolicitudDocumento: Date,
    fechaRecepcionDocumento: Date,
    fechaInformePreliminar: Date,
    fechaInformeFinal: Date,
    fechaAutoridadDelegada: Date,
    fechaAceptacionCliente: Date,
    fechaFinalizado: Date,
    documentoFaltante: String,
    observacionPendienteDocumento: String,
    motivoObjecion: String,
    responsableAporteDocumento: String,
    liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
    informeUnico: { type: mongoose.Schema.Types.Mixed, default: null },
    archivos: { type: [ArchivoZurichListadoSchema], default: [] },
    /**
     * Correo masivo de apertura (GRUPO PROSER designado por Zurich).
     * Evita reenvíos al volver a correr el script.
     */
    fechaEmailAperturaZurich: Date,
    emailAperturaZurichMessageId: String,
  },
  {
    collection: 'gsk3cAppzurichListadoCasos',
    timestamps: true,
    /** Evita que un schema cacheado del proceso descarte tomador/vigencia/cobertura. */
    strict: false,
  }
);

ZurichListadoCasoSchema.index({ zc: 1 }, { unique: false, sparse: true });

ZurichListadoCasoSchema.add({
  tomador: String,
  direccionPredio: String,
  fechaInicioPoliza: Date,
  fechaFinPoliza: Date,
  cobertura: String,
  departamento: String,
  valorAseguradoInmueble: Number,
  valorReclamado: Number,
  valorLiquidado: Number,
});
aplicarCamposAgendaCatastrofico(ZurichListadoCasoSchema);
aplicarPluginNotificacionesOperativas(ZurichListadoCasoSchema, { modulo: 'zurichListado' });

const ZurichListadoCaso =
  mongoose.models.ZurichListadoCaso ||
  mongoose.model('ZurichListadoCaso', ZurichListadoCasoSchema, 'gsk3cAppzurichListadoCasos');

if (ZurichListadoCaso?.schema) {
  ZurichListadoCaso.schema.add({
    tomador: String,
    direccionPredio: String,
    fechaInicioPoliza: Date,
    fechaFinPoliza: Date,
    cobertura: String,
    departamento: String,
    valorAseguradoInmueble: Number,
    valorReclamado: Number,
    valorLiquidado: Number,
  });
  ZurichListadoCaso.schema.set('strict', false);
}

export default ZurichListadoCaso;
