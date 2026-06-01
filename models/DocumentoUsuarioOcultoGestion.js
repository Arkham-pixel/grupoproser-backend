import mongoose from 'mongoose';

const DocumentoUsuarioOcultoGestionSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    origen: {
      type: String,
      enum: ['secur', 'normal'],
      required: true
    }
  },
  {
    timestamps: true,
    collection: 'documentoUsuariosOcultosGestion'
  }
);

DocumentoUsuarioOcultoGestionSchema.index({ usuarioId: 1, origen: 1 }, { unique: true });

export default mongoose.model('DocumentoUsuarioOcultoGestion', DocumentoUsuarioOcultoGestionSchema);
