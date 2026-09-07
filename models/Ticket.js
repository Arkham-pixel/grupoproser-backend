import mongoose from 'mongoose';

const AdjuntoSchema = new mongoose.Schema(
  {
    nombre: { type: String, default: '' },
    ruta: { type: String, required: true },
    tipoMime: { type: String, default: '' },
    tamaño: { type: Number, default: 0 },
  },
  { _id: false }
);

const ComentarioSchema = new mongoose.Schema(
  {
    autorUserId: { type: String, default: '' },
    autorLogin: { type: String, default: '' },
    autorNombre: { type: String, default: '' },
    texto: { type: String, required: true },
    creadoEn: { type: Date, default: Date.now },
  },
  { _id: true }
);

const TicketSchema = new mongoose.Schema(
  {
    numero: { type: String, required: true, unique: true, index: true },
    titulo: { type: String, required: true, trim: true, maxlength: 200 },
    descripcion: { type: String, required: true, trim: true, maxlength: 5000 },
    tipo: {
      type: String,
      enum: ['queja', 'bug', 'mejora', 'otro'],
      default: 'queja',
      index: true,
    },
    modulo: { type: String, default: 'plataforma', trim: true, maxlength: 120 },
    prioridad: {
      type: String,
      enum: ['baja', 'media', 'alta'],
      default: 'media',
      index: true,
    },
    estado: {
      type: String,
      enum: ['abierto', 'en_progreso', 'resuelto', 'cerrado'],
      default: 'abierto',
      index: true,
    },
    creadoPorUserId: { type: String, required: true, index: true },
    creadoPorLogin: { type: String, required: true, index: true },
    creadoPorNombre: { type: String, default: '' },
    creadoPorEmail: { type: String, default: '' },
    creadoPorRol: { type: String, default: '' },
    asignadoALogin: { type: String, default: '' },
    adjuntos: { type: [AdjuntoSchema], default: [] },
    comentarios: { type: [ComentarioSchema], default: [] },
    cerradoEn: { type: Date, default: null },
  },
  {
    collection: 'gsk3cApptickets',
    timestamps: true,
  }
);

TicketSchema.index({ createdAt: -1 });
TicketSchema.index({ estado: 1, createdAt: -1 });
TicketSchema.index({ creadoPorLogin: 1, createdAt: -1 });

const Ticket = mongoose.model('Ticket', TicketSchema, 'gsk3cApptickets');

export default Ticket;
