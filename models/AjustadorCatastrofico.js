import mongoose from 'mongoose';

const AjustadorCatastroficoSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true },
    nombre: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    telefono: { type: String, default: '', trim: true },
    /** Ciudad de cobertura (catálogo /api/ciudades) */
    ciudad: { type: String, required: true, trim: true },
  },
  { collection: 'gsk3cAppajustadorcatastrofico', timestamps: true }
);

AjustadorCatastroficoSchema.index({ codigo: 1 }, { unique: true });
AjustadorCatastroficoSchema.index({ ciudad: 1 });

const AjustadorCatastrofico = mongoose.model('AjustadorCatastrofico', AjustadorCatastroficoSchema);
export default AjustadorCatastrofico;
