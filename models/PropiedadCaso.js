import mongoose from 'mongoose';

/**
 * Casos del módulo Propiedades (ficha del cliente / inmueble).
 * Los datos básicos alimentan el formulario de inspección desde el reporte.
 */
const PropiedadCasoSchema = new mongoose.Schema(
  {
    /** Formato PROP-YYYY-MM-N (asignado al crear; no editable) */
    consecutivo: String,
    /** Nombre del cliente / asegurado / inmueble */
    nombreCliente: { type: String, required: true },
    documento: String,
    celular: String,
    email: String,
    direccion: String,
    localizacion: String,
    ciudad: String,
    departamento: String,
    claseInmueble: String,
    tipoInmueble: String,
    /** Quién recibe la visita */
    destinacion: String,
    aseguradora: String,
    poliza: String,
    numeroSiniestro: String,
    numeroCaso: String,
    responsable: String,
    fechaSolicitud: Date,
    observaciones: String,
    /** ID del HistorialFormulario (inspeccion-propiedades) cuando ya se diligenció */
    inspeccionId: { type: String, default: null, index: true },
    inspeccionTitulo: String,
    inspeccionFecha: Date,
  },
  {
    collection: 'gsk3cApppropiedadCasos',
    timestamps: true,
  }
);

const PropiedadCaso = mongoose.model('PropiedadCaso', PropiedadCasoSchema, 'gsk3cApppropiedadCasos');

export default PropiedadCaso;
