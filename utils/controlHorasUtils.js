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
