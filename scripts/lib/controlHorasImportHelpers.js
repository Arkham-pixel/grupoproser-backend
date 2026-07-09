const parseNumero = (valor) => {
  if (valor === '' || valor === null || valor === undefined) return 0;
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

export const crearFilaVacia = (defaults = {}) => ({
  id: `fila-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  fecha: '',
  descripcion: '',
  nombre_funcionario: defaults.nombre_funcionario || '',
  cargo: defaults.cargo || 'Ajustador',
  horas_viaje: '',
  horas_campo: '',
  horas_oficina: '',
  horas_secretaria: '',
});

export const totalFila = (fila) =>
  parseNumero(fila.horas_viaje) +
  parseNumero(fila.horas_campo) +
  parseNumero(fila.horas_oficina) +
  parseNumero(fila.horas_secretaria);

export const calcularTotalesControlHoras = (controlHoras) => {
  const filas = Array.isArray(controlHoras?.filas) ? controlHoras.filas : [];
  const totales = { viaje: 0, campo: 0, oficina: 0, secretaria: 0, total_horas: 0 };
  filas.forEach((fila) => {
    totales.viaje += parseNumero(fila.horas_viaje);
    totales.campo += parseNumero(fila.horas_campo);
    totales.oficina += parseNumero(fila.horas_oficina);
    totales.secretaria += parseNumero(fila.horas_secretaria);
  });
  totales.total_horas =
    totales.viaje + totales.campo + totales.oficina + totales.secretaria;
  const valorHora = parseNumero(controlHoras?.valor_hora);
  const gastos = parseNumero(controlHoras?.gastos);
  const subtotal = totales.total_horas * valorHora;
  return {
    ...totales,
    valor_hora: valorHora,
    gastos,
    subtotal_honorarios: subtotal,
    total: subtotal + gastos,
  };
};

export const fechaParaInput = (valor) => {
  if (!valor) return '';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) {
    return valor.slice(0, 10);
  }
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toISOString().slice(0, 10);
};

export const normalizarControlHorasParaGuardar = (controlHoras, usuario = 'recuperar-lote') => ({
  valor_hora: parseNumero(controlHoras.valor_hora),
  valor_hora_origen: controlHoras.valor_hora_origen || 'manual',
  gastos: parseNumero(controlHoras.gastos),
  filas: (controlHoras.filas || []).map((f) => ({
    id: f.id,
    fecha: f.fecha || null,
    descripcion: f.descripcion || '',
    nombre_funcionario: f.nombre_funcionario || '',
    cargo: f.cargo || '',
    horas_viaje: parseNumero(f.horas_viaje),
    horas_campo: parseNumero(f.horas_campo),
    horas_oficina: parseNumero(f.horas_oficina),
    horas_secretaria: parseNumero(f.horas_secretaria),
  })),
  actualizado_en: new Date().toISOString(),
  actualizado_por: usuario,
});

export const resolverTarifaHora = () => ({
  origen: 'manual',
  valorHora: 0,
  mensaje: '',
});
