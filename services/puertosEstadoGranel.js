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
      const inf = caso.informeGranel || {};
      return texto(caso.asgrBenfcro) && texto(caso.actividad) && texto(inf.introduccion);
    },
  },
  {
    id: 'buqueMercancia',
    nombre: 'Buque y mercancía',
    completada: (caso) => {
      const inf = caso.informeGranel || {};
      const buque = inf.buque || {};
      const lineas = Array.isArray(inf.lineasMercancia) ? inf.lineasMercancia : [];
      return texto(buque.nombre) && texto(buque.fechaArribo) && lineas.some(lineaMercanciaValida);
    },
  },
  {
    id: 'supervision',
    nombre: 'Supervisión',
    completada: (caso) => {
      const inf = caso.informeGranel || {};
      const seguimiento = Array.isArray(inf.seguimientoGranel) ? inf.seguimientoGranel : [];
      const tieneSeguimiento = seguimiento.some(
        (fila) => texto(fila.fecha) || texto(fila.anunciada) || texto(fila.producto)
      );
      const tieneFotos =
        (inf.imagenesCondicionCarga?.length || 0) > 0 ||
        (inf.imagenesNovedadesAverias?.length || 0) > 0 ||
        (inf.imagenesEquiposOperacion?.length || 0) > 0;
      const puntosNov = Array.isArray(inf.novedadesAveriasPuntos) ? inf.novedadesAveriasPuntos : [];
      return (
        tieneSeguimiento ||
        tieneFotos ||
        texto(inf.comentariosSupervision) ||
        texto(inf.novedadesAveriasTexto) ||
        puntosNov.some((p) => texto(typeof p === 'string' ? p : p?.texto))
      );
    },
  },
  {
    id: 'conclusiones',
    nombre: 'Conclusiones',
    completada: (caso) => {
      const inf = caso.informeGranel || {};
      const puntos = Array.isArray(inf.conclusionesPuntos) ? inf.conclusionesPuntos : [];
      const registros = Array.isArray(inf.registrosFotograficosBodegas)
        ? inf.registrosFotograficosBodegas
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

export function calcularEstadoCasoGranel(caso = {}) {
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

export function aplicarEstadoCasoGranel(datos = {}) {
  const estado = calcularEstadoCasoGranel(datos);
  return {
    ...datos,
    tipoRegistro: 'caso_granel',
    codiEstdo: estado.codigo,
    descripcionEstado: estado.etiqueta,
  };
}

export function estadoListaDesdeCasoGranel(doc) {
  const calculado = calcularEstadoCasoGranel(doc);
  const guardado = texto(doc.descripcionEstado);
  if (guardado && !PLACEHOLDER_ESTADO.test(guardado)) {
    const c = texto(doc.codiEstdo).toLowerCase();
    if (c === calculado.codigo) {
      return { ...calculado, etiqueta: guardado };
    }
  }
  return calculado;
}
