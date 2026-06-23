import mongoose from 'mongoose';

const PuertosActaSchema = new mongoose.Schema(
  {
    tipoRegistro: { type: String, default: 'acta' },
    nroActa: { type: String, unique: true, sparse: true },
    regional: String,
    fechaActa: Date,
    fechaLlegada: Date,
    ciudad: String,
    tipoInspeccion: String,
    codiRespnsble: String,
    nombreInspector: String,
    estado: String,
    codiAsgrdra: String,
    sucursal: String,
    asegurado: String,
    mercancia: String,
    empaque: String,
    nroPiezas: Number,
    fechaConstruccion: Date,
    pedido: String,
    transporteExterior: { type: mongoose.Schema.Types.Mixed, default: {} },
    transporteInterior: { type: mongoose.Schema.Types.Mixed, default: {} },
    detalleInspeccion: { type: mongoose.Schema.Types.Mixed, default: {} },
    fotos: { type: [mongoose.Schema.Types.Mixed], default: [] },
    documentos: { type: [mongoose.Schema.Types.Mixed], default: [] },
    facturacion: { type: mongoose.Schema.Types.Mixed, default: {} },
    observaciones: String,
    recomendaciones: String,
    creadoPor: String,
    actualizadoPor: String,
  },
  {
    collection: 'puertos_actas',
    timestamps: true,
    strict: false,
  }
);

PuertosActaSchema.index({ regional: 1, fechaActa: -1 });

export default mongoose.models.PuertosActa || mongoose.model('PuertosActa', PuertosActaSchema);
