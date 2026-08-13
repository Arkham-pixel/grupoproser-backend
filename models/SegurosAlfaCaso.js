import mongoose from 'mongoose';

const ArchivoAlfaSchema = new mongoose.Schema(
  {
    nombreOriginal: { type: String, required: true },
    nombreArchivo: String,
    ruta: { type: String, required: true },
    tamaño: Number,
    tipoMime: String,
    /** Póliza, inspección, liquidación, fotos, otro… */
    etiqueta: { type: String, default: 'GENERAL' },
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
 * Casos Seguros Alfa (módulo carga terremoto / consolidado BD).
 * Campos alineados a la hoja BD del Excel CONSOLIDADO-TERREMOTO.
 */
const SegurosAlfaCasoSchema = new mongoose.Schema(
  {
    /** Formato ALFA-YYYY-MM-N (asignado al crear; no editable) */
    consecutivo: String,
    siniestro: String,
    identificacion: { type: String, required: true },
    /** Nombre del asegurado (columna ASEGURADO / NOMBRE del Excel) */
    asegurado: String,
    tomador: String,
    /** Código/nombre del ajustador (catálogo Responsable) para alertas */
    ajustador: String,
    numeroPoliza: String,
    direccionPredio: String,
    numeroCredito: String,
    informacionContacto: String,
    correo: String,
    /** Canal de radicación (Seguros Alfa, presencial, etc.) */
    canalRadicacion: String,
    ciudad: String,
    departamento: String,
    fechaSiniestro: Date,
    /** Vigencia de la póliza (hoja PENDIENTES: FECHA INICIO / FECHA FIN) */
    fechaInicioPoliza: Date,
    fechaFinPoliza: Date,
    valorAseguradoInmueble: Number,
    valorAseguradoContenidos: Number,
    cobertura: String,
    estadoPagoPrimas: String,
    valorReservaPreventivaPromedio: Number,
    valorComercialInmueble: Number,
    reserva: Number,
    valorReclamado: Number,
    valorLiquidado: Number,
    fechaLlamada: Date,
    fechaInspeccion: Date,
    fechaUltimoDocumento: Date,
    fechaLiquidado: Date,
    fechaAceptacionLiquidacion: Date,
    fechaEnvioAseguradora: Date,
    estado: { type: String, required: true },
    /**
     * Coordenadas del predio para bloques de cercanía (solo ARNALD).
     * No sincroniza con SharePoint / Excel Control y Seguimiento.
     */
    ubicacionPredio: {
      lat: Number,
      lng: Number,
      geocodedAt: Date,
      geocodeStatus: {
        type: String,
        enum: ['ok', 'failed', 'pending', 'stale', 'manual', 'sin_direccion'],
      },
      geocodeQuery: String,
      direccionHash: String,
    },
    /** Estado del liquidador Alfa (ítems, deducible, cuadro reclamado vs indemnizable) */
    liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Borrador del informe único (texto evento, conclusiones, fotos) */
    informeUnico: { type: mongoose.Schema.Types.Mixed, default: null },
    archivos: { type: [ArchivoAlfaSchema], default: [] },
  },
  {
    collection: 'gsk3cAppsegurosAlfaCasos',
    timestamps: true,
  }
);

const SegurosAlfaCaso = mongoose.model(
  'SegurosAlfaCaso',
  SegurosAlfaCasoSchema,
  'gsk3cAppsegurosAlfaCasos'
);

export default SegurosAlfaCaso;
