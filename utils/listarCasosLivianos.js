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

export const BANDERAS_LISTA_CASO = {
  tieneInforme: { $eq: [{ $type: '$informeUnico' }, 'object'] },
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
