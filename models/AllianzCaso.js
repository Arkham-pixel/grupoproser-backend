import mongoose from 'mongoose';

const ArchivoAllianzSchema = new mongoose.Schema(
  {
    nombreOriginal: { type: String, required: true },
    nombreArchivo: String,
    ruta: { type: String, required: true },
    tamaño: Number,
    tipoMime: String,
    /** Póliza, inspección, liquidación, fotos, otro… */
    etiqueta: { type: String, default: 'GENERAL' },
    /** Leyenda / descripción de la foto (inspección CAT u otros) */
    descripcion: { type: String, default: '' },
    /** Orden de visualización en galerías (menor = primero) */
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
 * Casos Allianz (módulo catastrófico estilo Alfa).
 * Puede alimentarse desde Excel o sincronizarse desde Express (SiniestroExpress).
 */
const AllianzCasoSchema = new mongoose.Schema(
  {
    /** Formato ALLIANZ-YYYY-MM-N (asignado al crear; no editable) */
    consecutivo: String,
    /** Vínculo opcional al caso Express origen */
    expressCasoId: { type: mongoose.Schema.Types.ObjectId, default: null },
    consecutivoExpress: String,
    siniestro: String,
    /** Código ZC del listado cliente (columna ZC). Clave de alta/importación. */
    zc: String,
    identificacion: { type: String, required: true },
    /** CC, CE, NIT, PASAPORTE, PEP, RC, TI, OTRO */
    tipoIdentificacion: String,
    /** Nombre del asegurado (columna ASEGURADO / NOMBRE del Excel) */
    asegurado: String,
    intermediario: String,
    correoIntermediario: String,
    telefonoIntermediario: String,
    /** Contacto del intermediario (listado cliente, legado) */
    contactoIntermediario: String,
    correoAsegurado: String,
    telefonoAsegurado: String,
    /** Contacto del asegurado (listado cliente, legado) */
    contactoAsegurado: String,
    /** Notas libres del listado cliente */
    observaciones: String,
    tomador: String,
    /** Ajustador líder (quien asigna) */
    ajustadorLider: String,
    /** Código/nombre del ajustador (catálogo Responsable) para alertas */
    ajustador: String,
    /** Inspector del caso */
    inspector: String,
    numeroPoliza: String,
    tipoPoliza: String,
    tipoPolizaOtro: String,
    /** Causa del siniestro */
    causa: String,
    direccionPredio: String,
    numeroCredito: String,
    informacionContacto: String,
    correo: String,
    /** Celular del asegurado o de quien lo asiste (cierre del siniestro) */
    celular: String,
    /** Canal de radicación (Allianz, presencial, etc.) */
    canalRadicacion: String,
    ciudad: String,
    departamento: String,
    fechaSiniestro: Date,
    /** Vigencia de la póliza */
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
    fechaInspeccion: Date,
    fechaUltimoDocumento: Date,
    fechaLiquidado: Date,
    fechaAceptacionLiquidacion: Date,
    fechaEnvioAseguradora: Date,
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
    /** Campos operativos CAT Allianz (hoja CAT_ALLIANZ / exposición) */
    riskId: { type: String, default: null },
    distanciaEpicentroKm: { type: Number, default: null },
    tipoNegocioHomologado: { type: String, default: null },
    catUbicacionReferencia: { type: String, default: null },
    addressNumber: { type: String, default: null },
    direccionInspeccionSugerida: { type: String, default: null },
    linkGoogleMaps: { type: String, default: null },
    grupoInspeccion: { type: String, default: null },
    afectacion: { type: String, default: null },
    gradoAfectacion: { type: String, default: null },
    lucroCesante: { type: String, default: null },
    /**
     * Severidad CAT Allianz (Manual CAT Ajustadores): 1–6 para reporte de exposición.
     * Valor derivado (máximo nivel con APLICA=SI). Distinta de la escala NSR-10 (1–4).
     */
    severidadCat: { type: Number, min: 1, max: 6, default: null },
    /**
     * Cada descripción de daño con APLICA / NO APLICA + observación.
     * Claves nivel1…nivel6 (evita que Mongo convierta "1"…"6" en arreglo).
     */
    severidadCatNiveles: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        nivel1: { aplica: null, observacion: '' },
        nivel2: { aplica: null, observacion: '' },
        nivel3: { aplica: null, observacion: '' },
        nivel4: { aplica: null, observacion: '' },
        nivel5: { aplica: null, observacion: '' },
        nivel6: { aplica: null, observacion: '' },
      }),
    },
    /** Acceso al predio en inspección CAT */
    accesoPredio: { type: String, default: null },
    /**
     * Checklist evidencia CAT por sección:
     * { fotoGeneral: { aplica: 'SI'|'NO'|null, observacion }, ... }
     * Compatible con legacy boolean.
     */
    evidenciaCat: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        fotoGeneral: { aplica: null, observacion: '' },
        fotoDanos: { aplica: null, observacion: '' },
        equiposCriticos: { aplica: null, observacion: '' },
        mitigacion: { aplica: null, observacion: '' },
        noAcceso: { aplica: null, observacion: '' },
      }),
    },
    /** Observaciones operativas de la inspección CAT (hechos observables) */
    observacionesCat: { type: String, default: null },
    /**
     * true cuando la inspección CAT (checklist de severidad 1–6) está completa.
     * Se recalcula al guardar el caso.
     */
    checklistCatCompleto: { type: Boolean, default: false, index: true },
    /** Estado del liquidador Allianz */
    liquidador: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Borrador del informe único embebido (legado / respaldo) */
    informeUnico: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Id del historial formType=catastrofico (informe Complex) */
    historialCatastroficoId: { type: String, default: null },
    archivos: { type: [ArchivoAllianzSchema], default: [] },
  },
  {
    collection: 'gsk3cAppallianzCasos',
    timestamps: true,
  }
);

const AllianzCaso = mongoose.model(
  'AllianzCaso',
  AllianzCasoSchema,
  'gsk3cAppallianzCasos'
);

export default AllianzCaso;
