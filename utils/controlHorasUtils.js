/** Indica si el control de horas tiene filas con horas o descripción registradas. */
export const controlHorasTieneDatos = (controlHoras) => {
  if (!controlHoras || !Array.isArray(controlHoras.filas) || controlHoras.filas.length === 0) {
    return false;
  }

  return controlHoras.filas.some((fila) => {
    const horas =
      Number(fila.horas_viaje || 0) +
      Number(fila.horas_campo || 0) +
      Number(fila.horas_oficina || 0) +
      Number(fila.horas_secretaria || 0);
    const descripcion = String(fila.descripcion || '').trim();
    return horas > 0 || descripcion !== '';
  });
};

/** Usa control_horas del caso o el último snapshot en envios_facturacion (tipo control_horas). */
export const resolverControlHorasDesdeEnvios = (caso) => {
  if (controlHorasTieneDatos(caso?.control_horas)) {
    return caso.control_horas;
  }

  const envios = Array.isArray(caso?.envios_facturacion) ? caso.envios_facturacion : [];
  for (let i = envios.length - 1; i >= 0; i -= 1) {
    const envio = envios[i];
    if (envio?.tipo === 'control_horas' && controlHorasTieneDatos(envio.controlHoras)) {
      return envio.controlHoras;
    }
  }

  return caso?.control_horas ?? null;
};

/** Campos a persistir en el caso al registrar un envío de control de horas. */
export const buildCamposPersistenciaControlHoras = (controlHoras, resumenControlHoras) => {
  if (!controlHorasTieneDatos(controlHoras)) {
    return {};
  }

  const campos = { control_horas: controlHoras };

  if (resumenControlHoras?.subtotal_honorarios != null) {
    campos.vlorServcios = Math.round(Number(resumenControlHoras.subtotal_honorarios) || 0);
  }
  if (resumenControlHoras?.gastos != null) {
    campos.vlorGastos = Math.round(Number(resumenControlHoras.gastos) || 0);
  }

  return campos;
};
