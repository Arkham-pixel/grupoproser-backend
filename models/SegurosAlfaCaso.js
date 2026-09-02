import mongoose from 'mongoose';
import { aplicarPluginNotificacionesOperativas } from '../services/notificacionesOperativasService.js';
import { aplicarCamposAgendaCatastrofico } from '../utils/agendaCatastrofico.js';

const ArchivoAlfaSchema = new mongoose.Schema(
  {
    nombreOriginal: { type: String, required: true },
    nombreArchivo: String,
    ruta: { type: String, required: true },
    tamaño: Number,
    tipoMime: String,
    /** Póliza, inspección, liquidación, fotos, otro… */
    etiqueta: { type: String, default: 'GENERAL' },
    /** Leyenda / descripción para el informe Word (fotos de inspección). */
    descripcion: { type: String, default: '' },
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
    /** Ajustador líder (quien asigna) */
    ajustadorLider: String,
    /** Código/nombre del ajustador (catálogo Responsable) para alertas */
    ajustador: String,
    /** Inspector del caso */
    inspector: String,
    numeroPoliza: String,
    direccionPredio: String,
    numeroCredito: String,
    informacionContacto: String,
    correo: String,
    /** Celular del asegurado o de quien lo asiste (cierre del siniestro) */
    celular: String,
    /** Canal de radicación (Seguros Alfa, presencial, etc.) */
    canalRadicacion: String,
    ciudad: String,
    departamento: String,
    fechaSiniestro: Date,
    /** Fecha de aviso / radicación del siniestro (columna FECHA AVISO Excel). */
    fechaAviso: Date,
    /** Vigencia de la póliza (hoja PENDIENTES: FECHA INICIO / FECHA FIN) */
    fechaInicioPoliza: Date,
    fechaFinPoliza: Date,
    /** Valor asegurado SID (columna N del consolidado BD). */
    valorAseguradoSid: Number,
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
    /** Nota libre que complementa la fecha de llamada (solo ARNALD). */
    observacionLlamada: { type: String, default: '' },
    fechaInspeccion: Date,
    fechaUltimoDocumento: Date,
    fechaLiquidado: Date,
    fechaAceptacionLiquidacion: Date,
    fechaEnvioAseguradora: Date,
    /** Estado único del caso (barra Alfa: gestión + cierre). */
    estado: { type: String, required: true },
    /**
     * Espejo para Excel AD (ESTADO GESTION): los 5 del correo.
     * Se deriva automáticamente desde `estado`.
     */
    estadoGestion: {
      type: String,
      default: 'Sin contactar',
    },
    /** Observaciones de gestión (obligatorias en ciertos estados). */
    observacionesGestion: { type: String, default: '' },
    /** Asegurado no aceptó la oferta de liquidación (exige observación). */
    noAceptacionOferta: { type: Boolean, default: false },
    /** Zona territorial asignada al proveedor de ajuste. */
    zonaAsignada: { type: String, default: '' },
    /** Caso fuera de la zona asignada (requiere aviso / reasignación). */
    fueraDeZona: { type: Boolean, default: false },
    /** Multi-predio: id del caso padre / grupo de reclamación. */
    casoPadreId: { type: mongoose.Schema.Types.ObjectId, ref: 'SegurosAlfaCaso', default: null },
    grupoReclamacion: { type: String, default: '' },
    /** Fecha en que se marcó bajo deducible / se envió comunicación. */
    fechaComunicacionBajoDeducible: Date,
    /**
     * Correo masivo de apertura (PROSER designado por Alfa).
     * Evita reenvíos al volver a correr el script.
     */
    fechaEmailAperturaProser: Date,
    emailAperturaProserMessageId: String,
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
      /** ROOFTOP | RANGE_INTERPOLATED | APPROXIMATE | … (Google Geocoding). */
      locationType: String,
      formattedAddress: String,
    },
    /** Estado del liquidador Alfa (ítems, deducible, cuadro reclamado vs indemnizable) */
    liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Borrador del informe único (texto evento, conclusiones, fotos) */
    informeUnico: { type: mongoose.Schema.Types.Mixed, default: null },
    archivos: { type: [ArchivoAlfaSchema], default: [] },
    /**
     * Soft-archive: caso retirado de la base limpia Alfa (duplicados eliminados por la aseguradora).
     * No borra documentos ni avance; se oculta del listado operativo.
     */
    excluidoBaseAlfa: { type: Boolean, default: false, index: true },
    excluidoBaseAlfaAt: Date,
    excluidoBaseAlfaReason: String,
    /**
     * Firma externa del pool (ERA). Se sella al asignar un ajustador/inspector ERA.
     * No implica cupo ni asignación masiva por sí sola.
     */
    firmaAjuste: { type: String, default: '', index: true },
  },
  {
    collection: 'gsk3cAppsegurosAlfaCasos',
    timestamps: true,
  }
);

aplicarCamposAgendaCatastrofico(SegurosAlfaCasoSchema);
aplicarPluginNotificacionesOperativas(SegurosAlfaCasoSchema, { modulo: 'alfa' });

const SegurosAlfaCaso = mongoose.model(
  'SegurosAlfaCaso',
  SegurosAlfaCasoSchema,
  'gsk3cAppsegurosAlfaCasos'
);

export default SegurosAlfaCaso;
