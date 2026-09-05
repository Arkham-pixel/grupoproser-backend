import mongoose from 'mongoose';

/**
 * Seguimiento Portal de Facilitadores SURA.
 * Independiente del caso operativo (reporte, informe único, Excel verificación).
 */
const SuraFacilitadorCasoSchema = new mongoose.Schema(
  {
    reclamacion: { type: String, required: true, trim: true },
    proveedor: { type: String, default: 'PROSER AJUSTES S.A.S', trim: true },
    informacion: { type: String, default: '0', trim: true },
    fechaAsignacion: { type: Date, default: null },
    fechaPrimerContacto: { type: Date, default: null },
    visitaRealizada: { type: String, default: '', trim: true },
    fechaVisita: { type: Date, default: null },
    criterioDetalle: { type: String, default: '', trim: true },
    ultimoComentario: { type: String, default: '', trim: true },
    informeEnviado: { type: String, default: '', trim: true },
    fechaInforme: { type: Date, default: null },
    documentacionCompleta: { type: String, default: '', trim: true },
    fechaDocumentacionCompleta: { type: Date, default: null },
    casoCerrado: { type: String, default: 'NO', trim: true },
    fechaCierre: { type: Date, default: null },
    estadoSiniestro: { type: String, default: '', trim: true },
    casoSuraId: { type: mongoose.Schema.Types.ObjectId, default: null },
    actualizadoPor: { type: String, default: '', trim: true },
  },
  {
    collection: 'gsk3cAppsuraFacilitadorCasos',
    timestamps: true,
  }
);

SuraFacilitadorCasoSchema.index({ reclamacion: 1 }, { unique: true });

const SuraFacilitadorCaso = mongoose.model(
  'SuraFacilitadorCaso',
  SuraFacilitadorCasoSchema,
  'gsk3cAppsuraFacilitadorCasos'
);

export default SuraFacilitadorCaso;
