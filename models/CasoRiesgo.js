import mongoose from 'mongoose';

const riesgoSchema = new mongoose.Schema({
  nmroRiesgo: String, // Formato: YYYY-MM-NNN (año-mes-consecutivo)
  codiIspector: String,
  codiAsgrdra: String,
  asgrBenfcro: String,
  nmroConsecutivo: String,
  fchaAsgncion: Date,
  observAsignacion: String,
  adjuntoAsignacion: String,
  fchaContIni: Date,
  observContIni: String,
  adjuntoContIni: String,
  fchaInspccion: Date,
  observInspeccion: String,
  adjuntoInspeccion: String,
  codiClasificacion: String,
  fchaInforme: Date,
  anxoInfoFnal: String,
  observInforme: String,
  codDireccion: String,
  funcSolicita: String,
  codigoPoblado: String,
  ciudadSucursal: String,
  codiEstdo: Number,
  vlorTarifaAseguradora: Number,
  vlorHonorarios: Number,
  vlorGastos: Number,
  nmroFactra: Number,
  fchaFactra: Date,
  totalPagado: Number,
  anxoFactra: String
}, { 
  collection: 'gsk3cAppriesgos',
  timestamps: true // Agregar createdAt y updatedAt automáticamente
});

// Índices para mejorar el rendimiento de las consultas
riesgoSchema.index({ _id: -1 }); // Índice para ordenar por ID (más eficiente)
riesgoSchema.index({ createdAt: -1 }); // Índice para ordenar por fecha de creación
riesgoSchema.index({ fchaAsgncion: -1 }); // Índice para ordenar por fecha de asignación
riesgoSchema.index({ nmroRiesgo: 1 }); // Índice para búsquedas por número de riesgo
riesgoSchema.index({ codiEstdo: 1, _id: -1 }); // Índice compuesto para filtros por estado

const Riesgo = mongoose.model('Riesgo', riesgoSchema);
export default Riesgo;