import mongoose from 'mongoose';

const archivoEvidenciaSchema = new mongoose.Schema(
  {
    nombreOriginal: { type: String, required: true },
    nombreArchivo: { type: String, required: true },
    ruta: { type: String, required: true },
    tamaño: { type: Number, required: true },
    tipoMime: { type: String, required: true },
    itemId: { type: String, required: true, trim: true },
    subidoPor: {
      id: String,
      login: String,
      nombre: String,
    },
    fechaSubida: { type: Date, default: Date.now },
  },
  { _id: true }
);

const respuestaItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, trim: true },
    codigo: { type: String, default: '' },
    estado: {
      type: String,
      enum: ['', 'cumple', 'no_cumple', 'no_aplica'],
      default: '',
    },
    evidencias: { type: String, default: '' },
    planAccion: { type: String, default: '' },
    responsable: { type: String, default: '' },
    fechaPlazo: { type: String, default: '' },
    recursos: { type: String, default: '' },
    fundamentos: { type: String, default: '' },
  },
  { _id: false }
);

const sgSstCasoSchema = new mongoose.Schema(
  {
    numeroCaso: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    secuencia: {
      type: Number,
      required: true,
      min: 1,
    },
    anio: {
      type: Number,
      required: true,
      index: true,
    },
    empresa: {
      nombre: { type: String, required: true, trim: true },
      nit: { type: String, required: true, trim: true, index: true },
      nitNormalizado: { type: String, required: true, trim: true, index: true },
      numTrabajadores: { type: Number, required: true, min: 1 },
      numTrabajadoresIndirectos: { type: Number, default: 0, min: 0 },
      claseRiesgo: {
        type: String,
        required: true,
        enum: ['I', 'II', 'III', 'IV', 'V'],
      },
      ciudad: { type: String, default: '', trim: true },
      departamento: { type: String, default: '', trim: true },
      sectorEconomico: { type: String, default: '', trim: true },
      realizadoPor: { type: String, default: '', trim: true },
      cargoRealizadoPor: { type: String, default: '', trim: true },
      asesoradoPor: { type: String, default: '', trim: true },
      cargoAsesoradoPor: { type: String, default: '', trim: true },
      anioAutoevaluacion: { type: Number, default: null },
    },
    perfilId: {
      type: String,
      required: true,
      enum: ['CAP1', 'CAP2', 'CAP3'],
    },
    respuestas: {
      type: [respuestaItemSchema],
      default: [],
    },
    archivos: {
      type: [archivoEvidenciaSchema],
      default: [],
    },
    estadoCaso: {
      type: String,
      enum: ['borrador', 'en_progreso', 'cerrado'],
      default: 'borrador',
    },
    creadoPor: {
      id: { type: String, required: true },
      login: { type: String, required: true },
      nombre: { type: String, required: true },
    },
    activo: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

sgSstCasoSchema.index({ 'empresa.nitNormalizado': 1, anio: 1, secuencia: 1 });
sgSstCasoSchema.index({ createdAt: -1 });

export default mongoose.model('SgSstCaso', sgSstCasoSchema);
