import mongoose from 'mongoose';

const InspectorCatastroficoSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true },
    nombre: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    telefono: { type: String, default: '', trim: true },
    /** Ciudad de cobertura (catálogo /api/ciudades) */
    ciudad: { type: String, required: true, trim: true },
  },
  { collection: 'gsk3cAppinspectorcatastrofico', timestamps: true }
);

InspectorCatastroficoSchema.index({ codigo: 1 }, { unique: true });
InspectorCatastroficoSchema.index({ ciudad: 1 });

const InspectorCatastrofico = mongoose.model('InspectorCatastrofico', InspectorCatastroficoSchema);
export default InspectorCatastrofico;
