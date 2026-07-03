const texto = (v) => String(v || '').trim();

const PLACEHOLDER_ESTADO = /^x{3,}$/i;

function lineaMercanciaValida(linea) {
  return texto(linea?.producto) && texto(linea?.cantidad);
}

const SECCIONES = [
  {
    id: 'portada',
    nombre: 'Portada',
    completada: (caso) =>
      texto(caso.numeroSolicitud) && texto(caso.codiAsgrdra) && texto(caso.fechaInforme),
  },
  {
    id: 'datosIntro',
    nombre: 'Datos generales',
    completada: (caso) => {
      const inf = caso.informeExportacion || {};
      return texto(caso.asgrBenfcro) && texto(caso.actividad) && texto(inf.introduccion);
    },
  },
  {
    id: 'buqueMercancia',
    nombre: 'Buque y mercancía',
    completada: (caso) => {
      const inf = caso.informeExportacion || {};
      const buque = inf.buque || {};
      const lineas = Array.isArray(inf.lineasMercancia) ? inf.lineasMercancia : [];
      return texto(buque.nombre) && texto(buque.fechaArribo) && lineas.some(lineaMercanciaValida);
    },
  },
  {
    id: 'supervision',
    nombre: 'Supervisión',
    completada: (caso) => {
      const inf = caso.informeExportacion || {};
      const seguimiento = Array.isArray(inf.seguimiento) ? inf.seguimiento : [];
      const tieneSeguimiento = seguimiento.some(
        (fila) =>
          texto(fila.fecha) ||
          texto(fila.placa) ||
          (Array.isArray(fila.contenedores) &&
            fila.contenedores.some((c) => texto(c.numeroContenedor)))
      );
      const tieneFotos =
        (inf.imagenesRegistroInicialSupervision?.length || 0) > 0 ||
        (inf.imagenesCondicionCarga?.length || 0) > 0 ||
        (inf.imagenesInspeccionArribo?.length || 0) > 0;
      return tieneSeguimiento || tieneFotos || texto(inf.comentariosSupervision);
    },
  },
  {
    id: 'conclusiones',
    nombre: 'Conclusiones',
    completada: (caso) => {
      const inf = caso.informeExportacion || {};
      const puntos = Array.isArray(inf.conclusionesPuntos) ? inf.conclusionesPuntos : [];
      const registros = Array.isArray(inf.registrosFotograficosContenedores)
        ? inf.registrosFotograficosContenedores
        : [];
      return (
        texto(inf.conclusionesTexto) ||
        puntos.some((p) => texto(typeof p === 'string' ? p : p?.texto)) ||
        registros.some((r) => (r.imagenes?.length || 0) > 0)
      );
    },
  },
];

const ETIQUETAS = {
  borrador: 'Borrador',
  en_curso: 'En curso',
  terminado: 'Terminado',
};

export function calcularEstadoCasoExportacion(caso = {}) {
  const completadas = SECCIONES.filter((s) => s.completada(caso));
  const total = SECCIONES.length;
  const n = completadas.length;
  const pendiente = SECCIONES.find((s) => !s.completada(caso));

  if (n === 0 && !texto(caso.consecutivo) && !texto(caso.numeroSolicitud)) {
    return {
      codigo: 'borrador',
      etiqueta: ETIQUETAS.borrador,
      progreso: 0,
      total,
      detalle: '',
    };
  }

  if (n === total) {
    return {
      codigo: 'terminado',
      etiqueta: ETIQUETAS.terminado,
      progreso: total,
      total,
      detalle: `${total}/${total} secciones`,
    };
  }

  return {
    codigo: 'en_curso',
    etiqueta: ETIQUETAS.en_curso,
    progreso: n,
    total,
    detalle: `${n}/${total} secciones${pendiente?.nombre ? ` · pendiente: ${pendiente.nombre}` : ''}`,
    seccionPendiente: pendiente?.nombre || '',
  };
}

export function aplicarEstadoCasoExportacion(datos = {}) {
  const estado = calcularEstadoCasoExportacion(datos);
  return {
    ...datos,
    codiEstdo: estado.codigo,
    descripcionEstado: estado.etiqueta,
  };
}

/** Ignora valores viejos tipo «xxxxxxx» guardados en BD. */
export function estadoListaDesdeCaso(doc) {
  const calculado = calcularEstadoCasoExportacion(doc);
  const guardado = texto(doc.descripcionEstado);
  if (guardado && !PLACEHOLDER_ESTADO.test(guardado)) {
    const codigoGuardado = normalizarCodigoLegacy(doc.codiEstdo);
    if (codigoGuardado === calculado.codigo) {
      return { ...calculado, etiqueta: guardado };
    }
  }
  return calculado;
}

function normalizarCodigoLegacy(codigo) {
  const c = texto(codigo).toLowerCase();
  if (c === 'completo') return 'terminado';
  if (c === 'iniciado' || c === 'en_progreso') return 'en_curso';
  return c;
}
