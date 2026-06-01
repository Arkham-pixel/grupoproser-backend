import mongoose from 'mongoose';

const TIPOS = ['amparo', 'analista', 'intermediario'];

const ExpressCatalogoSchema = new mongoose.Schema(
  {
    tipo: { type: String, enum: TIPOS, required: true, index: true },
    nombre: { type: String, required: true, trim: true },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'gsk3cAppcatalogosExpress' }
);

ExpressCatalogoSchema.index({ tipo: 1, nombre: 1 }, { unique: true });

const ExpressCatalogo = mongoose.model(
  'ExpressCatalogo',
  ExpressCatalogoSchema,
  'gsk3cAppcatalogosExpress'
);

export { TIPOS };
export default ExpressCatalogo;
