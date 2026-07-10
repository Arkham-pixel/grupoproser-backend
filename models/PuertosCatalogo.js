import mongoose from 'mongoose';

const TIPOS = [
  'regional',
  'inspector',
  'empaque',
  'tipo_averia',
  'tipo_inspeccion',
  'tipo_transporte',
  'tipo_mercancia',
  'aseguradora',
  'sucursal',
  'estado_acta',
];

const PuertosCatalogoSchema = new mongoose.Schema(
  {
    tipo: { type: String, enum: TIPOS, required: true, index: true },
    nombre: { type: String, required: true, trim: true },
    activo: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'puertos_catalogos' }
);

PuertosCatalogoSchema.index({ tipo: 1, nombre: 1 }, { unique: true });

const PuertosCatalogo =
  mongoose.models.PuertosCatalogo ||
  mongoose.model('PuertosCatalogo', PuertosCatalogoSchema, 'puertos_catalogos');

export { TIPOS };
export default PuertosCatalogo;
