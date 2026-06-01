import mongoose from 'mongoose';

const EstadoConteoSchema = new mongoose.Schema(
  {
    estado: { type: String, required: true },
    cantidad: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const EstadoExpressCierreMensualSchema = new mongoose.Schema(
  {
    anio: { type: Number, required: true },
    mes: { type: Number, required: true, min: 1, max: 12 },
    totalCasos: { type: Number, required: true, min: 0 },
    totalSinEstado: { type: Number, required: true, min: 0, default: 0 },
    estados: { type: [EstadoConteoSchema], default: [] },
    fechaCorte: { type: Date, required: true },
  },
  {
    collection: 'gsk3cAppestadoExpressCierreMensual',
    timestamps: true,
  }
);

EstadoExpressCierreMensualSchema.index({ anio: 1, mes: 1 }, { unique: true });

const EstadoExpressCierreMensual = mongoose.model(
  'EstadoExpressCierreMensual',
  EstadoExpressCierreMensualSchema,
  'gsk3cAppestadoExpressCierreMensual'
);

export default EstadoExpressCierreMensual;

