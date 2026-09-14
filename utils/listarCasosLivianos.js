/**
 * Listados / dashboards / reportes: no mandar blobs Mixed
 * (liquidador, informeUnico, archivos, fotos).
 *
 * Con strict:false, `.select('-informeUnico')` de Mongoose no recorta el documento.
 * Proyección de inclusión + banderas livianas (mismo patrón Zurich / BBVA listado).
 */

export const quiereListaCompleta = (query = {}) => {
  const v = String(query?.completo ?? '').toLowerCase();
  return v === '1' || v === 'true';
};

const mongoTexto = (path) => ({
  $convert: { input: { $ifNull: [path, ''] }, to: 'string', onError: '', onNull: '' },
});

const mongoStrLen = (path) => ({
  $strLenCP: { $trim: { input: mongoTexto(path) } },
});

const mongoTieneTexto = (path, min = 40) => ({ $gt: [mongoStrLen(path), min] });

const mongoArrayOVacio = (path) => ({
  $cond: [{ $isArray: path }, path, []],
});

const ETIQUETAS_ARCHIVO_INFORME = ['INFORME_UNICO', 'INFORME_PRELIMINAR', 'INFORME_FINAL'];

/**
 * Informe con contenido real: narrativa, fotos del informe o Word archivado.
 * No usa filas de póliza ni infoEvento (llevan plantilla).
 */
export const BANDERA_INFORME_LLENO = {
  $or: [
    mongoTieneTexto('$informeUnico.descripcionDanios'),
    mongoTieneTexto('$informeUnico.conclusiones'),
    mongoTieneTexto('$informeUnico.recomendacion'),
    mongoTieneTexto('$informeUnico.analisisCobertura'),
    mongoTieneTexto('$informeUnico.analisisNexoCausal'),
    {
      $gt: [{ $size: mongoArrayOVacio('$informeUnico.fotosInspeccion') }, 0],
    },
    {
      $gt: [
        {
          $size: {
            $filter: {
              input: mongoArrayOVacio('$archivos'),
              as: 'a',
              cond: {
                $in: [
                  {
                    $toUpper: mongoTexto('$$a.etiqueta'),
                  },
                  ETIQUETAS_ARCHIVO_INFORME,
                ],
              },
            },
          },
        },
        0,
      ],
    },
  ],
};

export const BANDERAS_LISTA_CASO = {
  tieneInforme: { $eq: [{ $type: '$informeUnico' }, 'object'] },
  tieneInformeLleno: BANDERA_INFORME_LLENO,
  tieneLiquidador: { $eq: [{ $type: '$liquidador' }, 'object'] },
  nArchivos: {
    $cond: [{ $isArray: '$archivos' }, { $size: '$archivos' }, 0],
  },
  tipoInforme: '$informeUnico.tipoInforme',
};

export const BANDERAS_LISTA_SURA = {
  ...BANDERAS_LISTA_CASO,
  tieneFotosAgil: {
    $gt: [
      {
        $size: {
          $cond: [{ $isArray: '$fotosAgil.imagenes' }, '$fotosAgil.imagenes', []],
        },
      },
      0,
    ],
  },
  tieneSalvamento: { $eq: [{ $type: '$salvamento' }, 'object'] },
  // Totales de liquidación sin mandar el liquidador completo
  liquidacionPresupuestoTotal: {
    $ifNull: ['$liquidacionPresupuestoTotal', '$liquidador.resumenReporte.totalPresupuesto'],
  },
  liquidacionDeduciblePresupuesto: {
    $ifNull: [
      '$liquidacionDeduciblePresupuesto',
      '$liquidador.resumenReporte.deduciblePresupuesto',
    ],
  },
  liquidacionValorIndemnizarPresupuesto: {
    $ifNull: [
      '$liquidacionValorIndemnizarPresupuesto',
      '$liquidador.resumenReporte.valorIndemnizarPresupuesto',
    ],
  },
  liquidacionTotalContenidos: {
    $ifNull: ['$liquidacionTotalContenidos', '$liquidador.resumenReporte.totalContenidos'],
  },
  liquidacionDeducibleContenidos: {
    $ifNull: [
      '$liquidacionDeducibleContenidos',
      '$liquidador.resumenReporte.deducibleContenidos',
    ],
  },
  liquidacionValorIndemnizarContenidos: {
    $ifNull: [
      '$liquidacionValorIndemnizarContenidos',
      '$liquidador.resumenReporte.valorIndemnizarContenidos',
    ],
  },
  liquidacionTotalIndemnizar: {
    $ifNull: ['$liquidacionTotalIndemnizar', '$liquidador.resumenReporte.totalIndemnizar'],
  },
  valorAseguradoFechaSiniestro: {
    $ifNull: [
      '$valorAseguradoFechaSiniestro',
      {
        $ifNull: [
          '$liquidador.resumenReporte.valorAseguradoFechaSiniestro',
          '$liquidador.evaluacionSismicaNSR10.presupuesto.calculoValorAsegurado.valorAseguradoFechaSiniestro',
        ],
      },
    ],
  },
  valorDeducibleCalculo: {
    $ifNull: [
      '$valorDeducibleCalculo',
      {
        $ifNull: [
          '$liquidador.resumenReporte.valorDeducibleCalculo',
          '$liquidador.evaluacionSismicaNSR10.presupuesto.calculoValorAsegurado.valorDeducible',
        ],
      },
    ],
  },
};

const clavesProyeccionBanderas = (addFields = {}) =>
  Object.fromEntries(Object.keys(addFields).map((clave) => [clave, 1]));

export async function listarCasosLivianos({
  Model,
  filtro = {},
  collation,
  page = 1,
  limit = 25,
  quiereCompleto = false,
  proyeccion,
  addFields = BANDERAS_LISTA_CASO,
}) {
  const limite = Math.max(1, Number(limit) || 25);
  const pagina = Math.max(1, Number(page) || 1);
  const skip = (pagina - 1) * limite;

  const countQuery = Model.countDocuments(filtro || {});
  if (collation) countQuery.collation(collation);

  let dataQuery;
  if (quiereCompleto) {
    dataQuery = Model.find(filtro || {})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limite)
      .lean();
    if (collation) dataQuery.collation(collation);
  } else {
    const stages = [
      { $match: filtro && typeof filtro === 'object' ? filtro : {} },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limite },
      { $addFields: addFields },
      {
        $project: {
          ...proyeccion,
          ...clavesProyeccionBanderas(addFields),
        },
      },
    ];
    dataQuery = Model.aggregate(stages);
    if (collation) dataQuery.collation(collation);
  }

  const [total, documentos] = await Promise.all([countQuery, dataQuery]);
  return {
    total,
    page: pagina,
    limit: limite,
    data: documentos,
  };
}
