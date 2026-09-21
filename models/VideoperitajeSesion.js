import mongoose from 'mongoose';

const GeoSchema = new mongoose.Schema(
  {
    lat: Number,
    lng: Number,
    accuracy: Number,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const MediaSchema = new mongoose.Schema(
  {
    nombreOriginal: String,
    nombreArchivo: String,
    ruta: { type: String, required: true },
    tamaño: Number,
    tipoMime: String,
    tipo: { type: String, enum: ['foto', 'video'], default: 'foto' },
    pasoId: { type: String, default: '' },
    descripcion: { type: String, default: '' },
    subidoPorRol: { type: String, enum: ['perito', 'asegurado'], default: 'asegurado' },
    fechaSubida: { type: Date, default: Date.now },
  },
  { _id: true }
);

const PasoSnapshotSchema = new mongoose.Schema(
  {
    id: String,
    titulo: String,
    instruccion: String,
    minFotos: Number,
    maxFotos: Number,
    obligatorio: Boolean,
  },
  { _id: false }
);

const VideoperitajeSesionSchema = new mongoose.Schema(
  {
    tipo: { type: String, enum: ['live', 'guided'], required: true, default: 'live' },
    estado: {
      type: String,
      enum: ['pendiente', 'en_proceso', 'finalizada', 'cancelada'],
      default: 'pendiente',
      index: true,
    },
    modulo: { type: String, default: '', index: true },
    casoId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    expediente: { type: String, default: '' },
    siniestro: { type: String, default: '' },
    aseguradoNombre: { type: String, default: '' },
    celular: { type: String, default: '' },
    email: { type: String, default: '' },
    peritoUserId: { type: String, default: '' },
    peritoNombre: { type: String, default: '' },
    peritoLogin: { type: String, default: '' },
    tokenHash: { type: String, required: true, unique: true, index: true },
    tokenExpira: { type: Date, default: null },
    livekitRoom: { type: String, default: '' },
    inicio: Date,
    fin: Date,
    duracionSeg: { type: Number, default: 0 },
    geo: GeoSchema,
    medias: { type: [MediaSchema], default: [] },
    plantillaId: { type: mongoose.Schema.Types.ObjectId, default: null },
    plantillaTitulo: { type: String, default: '' },
    pasos: { type: [PasoSnapshotSchema], default: [] },
    pasosCumplidos: { type: [String], default: [] },
    notas: { type: String, default: '' },
    invitacion: {
      emailEnviado: { type: Boolean, default: false },
      emailError: { type: String, default: '' },
      whatsappUrl: { type: String, default: '' },
      whatsappEnviado: { type: Boolean, default: false },
      whatsappError: { type: String, default: '' },
    },
    adjuntadoAlCaso: { type: Boolean, default: false },
  },
  {
    collection: 'gsk3cAppvideoperitajeSesiones',
    timestamps: true,
  }
);

VideoperitajeSesionSchema.index({ createdAt: -1 });
VideoperitajeSesionSchema.index({ peritoUserId: 1, createdAt: -1 });
VideoperitajeSesionSchema.index({ estado: 1, tipo: 1, createdAt: -1 });

const VideoperitajeSesion = mongoose.model('VideoperitajeSesion', VideoperitajeSesionSchema);

export default VideoperitajeSesion;
