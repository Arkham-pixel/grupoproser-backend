import mongoose from 'mongoose';

const PasoPlantillaSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    titulo: { type: String, required: true, trim: true },
    instruccion: { type: String, default: '' },
    minFotos: { type: Number, default: 1, min: 0 },
    maxFotos: { type: Number, default: 3, min: 1 },
    obligatorio: { type: Boolean, default: true },
  },
  { _id: false }
);

const VideoperitajePlantillaSchema = new mongoose.Schema(
  {
    titulo: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    activa: { type: Boolean, default: true },
    archivada: { type: Boolean, default: false },
    pasos: { type: [PasoPlantillaSchema], default: [] },
    creadoPor: {
      id: String,
      login: String,
      nombre: String,
    },
  },
  {
    collection: 'gsk3cAppvideoperitajePlantillas',
    timestamps: true,
  }
);

VideoperitajePlantillaSchema.index({ activa: 1, archivada: 1, updatedAt: -1 });

const VideoperitajePlantilla = mongoose.model(
  'VideoperitajePlantilla',
  VideoperitajePlantillaSchema
);

export default VideoperitajePlantilla;
