/**
 * Configuración versionable de la torre de control CAT Zurich (listado).
 * El front la consume vía GET /api/zurich-listado/torre-config.
 *
 * Historial de reserva: el modelo solo guarda `reserva` vigente. No hay
 * `reserva_historial`. Una tabla futura (casoId, reservaAnterior, reservaNueva,
 * fecha, usuario) no se crea hasta que se autorice el impacto en el PUT.
 */

export const TORRE_CONFIG_ZURICH = {
  version: 1,
  ans: {
    inspeccionDias: 15,
    liquidacionDias: 45,
    proximoPct: 0.8,
  },
  cubetasDiasHeatmap: [
    { id: '0-2', min: 0, max: 2, color: 'ok' },
    { id: '3-5', min: 3, max: 5, color: 'ok' },
    { id: '6-7', min: 6, max: 7, color: 'watch' },
    { id: '8-10', min: 8, max: 10, color: 'warn' },
    { id: '11-15', min: 11, max: 15, color: 'warn' },
    { id: '16-30', min: 16, max: 30, color: 'alert' },
    { id: '30+', min: 31, max: null, color: 'alert' },
  ],
  cubetasAntiguedad: [
    { id: '0-7', min: 0, max: 7, label: '0-7 d' },
    { id: '8-15', min: 8, max: 15, label: '8-15 d' },
    { id: '16-30', min: 16, max: 30, label: '16-30 d' },
    { id: '31-45', min: 31, max: 45, label: '31-45 d' },
    { id: '46+', min: 46, max: null, label: '46+ d' },
  ],
  rangosReserva: [
    { id: 'lt50', min: 0, max: 50_000_000, label: '< $50 M' },
    { id: '50-100', min: 50_000_000, max: 100_000_000, label: '$50–100 M' },
    { id: '100-250', min: 100_000_000, max: 250_000_000, label: '$100–250 M' },
    { id: '250-500', min: 250_000_000, max: 500_000_000, label: '$250–500 M' },
    { id: '500+', min: 500_000_000, max: null, label: '> $500 M' },
  ],
  alertas: {
    diasEstadoMedio: 3,
    diasEstadoAlto: 8,
    diasEstadoCritico: 16,
    diasTotalCritico: 45,
    diasSinGestionMedio: 5,
    diasSinGestionAlto: 7,
    reservaAlta: 100_000_000,
    reservaCritica: 250_000_000,
  },
  documentos: {
    categorias: [
      { id: 'fotos', label: 'Fotos / inspección', patrones: ['FOTO', 'INSPECCION', 'VISITA', 'IMAGEN'] },
      { id: 'poliza', label: 'Póliza', patrones: ['POLIZA', 'CARATULA'] },
      { id: 'reclamacion', label: 'Reclamación / aviso', patrones: ['RECLAMA', 'AVISO', 'DENUNCIO'] },
      { id: 'informe', label: 'Informe preliminar / final', patrones: ['INFORME', 'PRELIMINAR'] },
      { id: 'identidad', label: 'Identidad / titularidad', patrones: ['CEDULA', 'CC', 'ESCRITURA', 'TITULO', 'IDENTIF'] },
      { id: 'factura', label: 'Facturas / soportes de pérdida', patrones: ['FACTURA', 'COTIZA', 'SOPORTE'] },
      { id: 'otro', label: 'Otro documento', patrones: [] },
    ],
  },
  completitudCampos: [
    { id: 'reserva', campo: 'reserva' },
    { id: 'valorReclamado', campo: 'valorReclamado' },
    { id: 'valorLiquidado', campo: 'valorLiquidado' },
    { id: 'valorAseguradoInmueble', campo: 'valorAseguradoInmueble' },
    { id: 'tipoPoliza', campo: 'tipoPoliza' },
    { id: 'intermediario', campo: 'intermediario' },
    { id: 'modalidadAtencion', campo: 'modalidadAtencion' },
    { id: 'departamento', campo: 'departamento' },
  ],
  umbralComparacionTriplete: 10,
  limiteIntervencion: 25,
  limiteTopReservas: 15,
  serieDiariaMaxDias: 45,
  serieSemanalMaxSemanas: 16,
};

export default TORRE_CONFIG_ZURICH;
