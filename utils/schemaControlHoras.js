import mongoose from 'mongoose';

const ControlHorasFilaSchema = new mongoose.Schema(
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
  { _id: false }
);

/** Campos de control de horas / facturación alineados con SURA y Complex. */
export const camposControlHorasFacturacion = () => ({
  fcha_control_horas: Date,
  fcha_envio_control_horas: Date,
  fcha_recibido_control_horas: Date,
  fcha_seguimiento_envio_control_horas: Date,
  obse_seguimiento_envio_control_horas: String,
  anxo_seguimiento_envio_control_horas: String,
  adjunto_control_horas: String,
  adjunto_evidencia: String,
  adjunto_factura: String,
  numero_factura: String,
  fecha_factura: Date,
  fchaUltRevi: Date,
  observacion_compromisos: String,
  vlorServcios: Number,
  vlorGastos: Number,
  control_horas: {
    valor_hora: Number,
    valor_hora_origen: String,
    gastos: Number,
    filas: [ControlHorasFilaSchema],
    actualizado_en: Date,
    actualizado_por: String,
  },
  historialDocs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  envios_facturacion: { type: [mongoose.Schema.Types.Mixed], default: [] },
  ultimo_envio_facturacion: mongoose.Schema.Types.Mixed,
});
