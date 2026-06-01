import mongoose from 'mongoose';

const SiniestroSchema = new mongoose.Schema({
  // Campos principales con nombres exactos que envía el formulario
  nmroAjste: String,
  codiRespnsble: { type: String, ref: 'Responsable' },
  codiAsgrdra: String,
  nmroSinstro: String,
  codWorkflow: String,
  funcAsgrdra: { type: String, ref: 'FuncionarioAseguradora' },
  fchaAsgncion: Date,
  asgrBenfcro: String,
  tipoDucumento: String,
  numDocumento: String,
  tipoPoliza: String,
  nmroPolza: String,
  amprAfctdo: String,
  fchaSinstro: Date,
  descSinstro: String,
  causa_siniestro: String,
  ciudadSiniestro: String,
  fchaInspccion: Date,
  codiEstdo: String,
  fchaContIni: Date,
  
  // Campos adicionales
  obse_cont_ini: String,
  anex_cont_ini: String,
  obse_inspccion: String,
  anex_acta_inspccion: String,
  anex_sol_doc: String,
  obse_soli_docu: String,
  anxo_inf_prelim: String,
  obse_info_prelm: String,
  anxo_info_fnal: String,
  obse_info_fnal: String,
  anxo_repo_acti: String,
  obse_repo_acti: String,
  anxo_presentacion_cifras: String,
  obse_presentacion_cifras: String,
  anxo_envio_finiquito: String,
  obse_envio_finiquito: String,
  anxo_factra: String,
  anxo_honorarios: String,
  anxo_honorariosdefinit: String,
  anxo_autorizacion: String,
  obse_comprmsi: String,
  obse_segmnto: String,
  
  // Campos de fechas
  fcha_soli_docu: Date,
  fcha_info_prelm: Date,
  fcha_info_fnal: Date,
  fcha_repo_acti: Date,
  fcha_presentacion_cifras: Date,
  fcha_envio_finiquito: Date,
  fcha_ult_segui: Date,
  fcha_act_segui: Date,
  fcha_finqto_indem: Date,
  fcha_factra: Date,
  fcha_ult_revi: Date,
  fcha_control_horas: Date,
  fcha_envio_control_horas: Date, // Fecha de envío control de horas (Gerencia)
  fcha_recibido_control_horas: Date, // Fecha de recibido control de horas (Gerencia)
  control_horas: {
    valor_hora: Number,
    valor_hora_origen: String,
    gastos: Number,
    filas: [
      {
        id: String,
        fecha: Date,
        descripcion: String,
        nombre_funcionario: String,
        cargo: String,
        horas_viaje: Number,
        horas_campo: Number,
        horas_oficina: Number,
        horas_secretaria: Number,
      },
    ],
    actualizado_en: Date,
    actualizado_por: String,
  },
  anxo_evidencia: String, // Adjunto de evidencia (Gerencia)
  fcha_seguimiento_envio_control_horas: Date, // Fecha de seguimiento de envío control de horas
  obse_seguimiento_envio_control_horas: String, // Observaciones/comentarios de seguimiento de envío control de horas
  anxo_seguimiento_envio_control_horas: String, // Adjunto de documentos de seguimiento de envío control de horas
  
  // Campos numéricos
  dias_transcrrdo: Number,
  vlor_resrva: Number,
  vlor_reclmo: Number,
  monto_indmzar: Number,
  vlor_servcios: Number,
  vlor_gastos: Number,
  total: Number,
  total_general: Number,
  total_pagado: Number,
  iva: Number,
  reteiva: Number,
  retefuente: Number,
  reteica: Number,
  porc_iva: Number,
  porc_reteiva: Number,
  porc_retefuente: Number,
  porc_reteica: Number,
  observacionesValores: String,
  envios_facturacion: [mongoose.Schema.Types.Mixed],
  ultimo_envio_facturacion: mongoose.Schema.Types.Mixed,

  // Campo para historial de documentos
  historialDocs: [{ type: mongoose.Schema.Types.Mixed }]
}, { 
  collection: 'gsk3cAppsiniestro',
  strict: false // Permitir campos adicionales no definidos en el schema
});

const Siniestro = mongoose.model('Siniestro', SiniestroSchema, 'gsk3cAppsiniestro');
export default Siniestro;
