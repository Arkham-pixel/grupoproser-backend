// backend/controllers/complex.controller.js
import Complex from '../models/Complex.js';
import Siniestro from '../models/CasoComplex.js';
import Responsable from '../models/Responsable.js';
import mongoose from 'mongoose'; // Added missing import
import SecurUser from '../models/SecurUser.js';
import Estado from '../models/Estado.js';
import FuncionarioAseguradora from '../models/FuncionarioAseguradora.js';
import Cliente from '../models/Cliente.js';
import { enviarNotificacionAsignacion, enviarNotificacionAseguradora, enviarNotificacionCreador, enviarNotificacionHonorarios, enviarNotificacionControlHoras, enviarNotificacionGerencia } from '../services/emailService.js';
import {
  listarBandejaFacturacion,
  persistirEnvioFacturacionTrasCorreo,
  corregirDestinatarioEnvioFacturacion,
  eliminarRegistroEnvioFacturacion,
} from '../services/facturacionBandejaService.js';
import {
  normalizarClaveGerente,
  resolverGerenteDesdeLogin,
  usuarioPuedeVerBandejaFacturacion,
  puedeElegirGerenteEnBandeja,
  puedeAdministrarBandejaFacturacion,
} from '../config/gerentesFacturacion.js';
import {
  collectPathsFromComplexRecord,
  deleteComplexRecordFiles,
  deleteOrphanedStoredFiles,
} from '../utils/storedFileCleanup.js';

// Función helper para convertir fechas de string (yyyy-MM-dd) a Date sin problemas de zona horaria
const convertirFechaLocal = (fechaString) => {
  if (!fechaString || fechaString === '' || fechaString === null || fechaString === undefined) {
    return null;
  }
  
  // Si ya es un objeto Date, retornarlo
  if (fechaString instanceof Date) {
    return fechaString;
  }
  
  // Si es un string en formato yyyy-MM-dd, crear la fecha en zona horaria local
  const fechaStr = String(fechaString).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
    // Parsear año, mes y día
    const [año, mes, dia] = fechaStr.split('-').map(Number);
    // Crear fecha en zona horaria local (no UTC) a mediodía para evitar problemas de zona horaria
    // Usar mediodía (12:00) en lugar de medianoche para evitar que cambios de zona horaria afecten el día
    return new Date(año, mes - 1, dia, 12, 0, 0);
  }
  
  // Si es otro formato, intentar parsearlo normalmente
  const fecha = new Date(fechaString);
  return isNaN(fecha.getTime()) ? null : fecha;
};

/** Expone fechas de control de horas en snake_case y camelCase para el frontend */
const extraerCodiEstdoDeBody = (body = {}) => {
  const raw = body.codiEstdo ?? body.codi_estado ?? body.estado;
  if (raw === undefined || raw === null) return undefined;
  return String(raw).trim();
};

const validarCodiEstdoObligatorio = (body, res) => {
  const codigo = extraerCodiEstdoDeBody(body);
  if (codigo === undefined || codigo === '') {
    res.status(400).json({
      error: 'Estado obligatorio',
      detalle: 'Debe seleccionar un estado del siniestro antes de guardar el caso.',
    });
    return false;
  }
  return true;
};

const enriquecerCasoComplexParaFrontend = (caso) => {
  if (!caso) return caso;
  const obj = caso.toObject ? caso.toObject() : { ...caso };

  const fchaControlHoras = obj.fcha_control_horas ?? obj.fchaControlHoras ?? obj.fecha_control_horas ?? null;
  const fchaEnvioControlHoras = obj.fcha_envio_control_horas ?? obj.fchaEnvioControlHoras ?? obj.fecha_envio_control_horas ?? null;
  const fchaRecibidoControlHoras = obj.fcha_recibido_control_horas ?? obj.fchaRecibidoControlHoras ?? obj.fecha_recibido_control_horas ?? null;
  const fchaSeguimientoEnvioControlHoras = obj.fcha_seguimiento_envio_control_horas ?? obj.fchaSeguimientoEnvioControlHoras ?? obj.fecha_seguimiento_envio_control_horas ?? null;

  return {
    ...obj,
    fcha_control_horas: fchaControlHoras,
    fchaControlHoras: fchaControlHoras,
    fecha_control_horas: fchaControlHoras,
    fcha_envio_control_horas: fchaEnvioControlHoras,
    fchaEnvioControlHoras: fchaEnvioControlHoras,
    fecha_envio_control_horas: fchaEnvioControlHoras,
    fcha_recibido_control_horas: fchaRecibidoControlHoras,
    fchaRecibidoControlHoras: fchaRecibidoControlHoras,
    fecha_recibido_control_horas: fchaRecibidoControlHoras,
    fcha_seguimiento_envio_control_horas: fchaSeguimientoEnvioControlHoras,
    fchaSeguimientoEnvioControlHoras: fchaSeguimientoEnvioControlHoras,
    fecha_seguimiento_envio_control_horas: fchaSeguimientoEnvioControlHoras,
  };
};

// Función helper para convertir todas las fechas en un objeto de datos
const convertirFechasEnDatos = (datos) => {
  // Mapeo de campos de fecha del frontend a la BD
  const mapeoFechas = {
    'fcha_coord_inspeccion': 'fchaCoordInspeccion',
    'fecha_coord_inspeccion': 'fchaCoordInspeccion',
    'fcha_prog_inspeccion': 'fchaProgInspeccion',
    'fecha_prog_inspeccion': 'fchaProgInspeccion',
    'fchaControlHoras': 'fcha_control_horas',
    'fechaControlHoras': 'fcha_control_horas',
    'fecha_control_horas': 'fcha_control_horas', // El campo del formulario usa guión bajo
    'fchaEnvioControlHoras': 'fcha_envio_control_horas',
    'fechaEnvioControlHoras': 'fcha_envio_control_horas',
    'fecha_envio_control_horas': 'fcha_envio_control_horas', // Fecha de envío control de horas (Gerencia)
    'fchaRecibidoControlHoras': 'fcha_recibido_control_horas',
    'fechaRecibidoControlHoras': 'fcha_recibido_control_horas',
    'fecha_recibido_control_horas': 'fcha_recibido_control_horas', // Fecha de recibido control de horas (Gerencia)
    'fchaSeguimientoEnvioControlHoras': 'fcha_seguimiento_envio_control_horas',
    'fechaSeguimientoEnvioControlHoras': 'fcha_seguimiento_envio_control_horas',
    'fecha_seguimiento_envio_control_horas': 'fcha_seguimiento_envio_control_horas' // Fecha de seguimiento de envío control de horas
  };
  
  // Aplicar mapeo primero
  const datosMapeados = { ...datos };
  console.log('📅 [convertirFechasEnDatos] Datos recibidos antes de mapeo:', {
    fchaControlHoras: datos.fchaControlHoras,
    fechaControlHoras: datos.fechaControlHoras,
    fecha_control_horas: datos.fecha_control_horas,
    fcha_control_horas: datos.fcha_control_horas,
    fchaEnvioControlHoras: datos.fchaEnvioControlHoras,
    fechaEnvioControlHoras: datos.fechaEnvioControlHoras,
    fecha_envio_control_horas: datos.fecha_envio_control_horas,
    fcha_envio_control_horas: datos.fcha_envio_control_horas
  });
  
  Object.keys(mapeoFechas).forEach(frontendKey => {
    if (datosMapeados[frontendKey] !== undefined) {
      datosMapeados[mapeoFechas[frontendKey]] = datosMapeados[frontendKey];
      console.log(`✅ [convertirFechasEnDatos] Mapeando ${frontendKey} -> ${mapeoFechas[frontendKey]}:`, datosMapeados[frontendKey]);
      // Mantener también el original por si acaso
    }
  });
  
  console.log('📅 [convertirFechasEnDatos] Datos después de mapeo:', {
    fcha_control_horas: datosMapeados.fcha_control_horas,
    fcha_envio_control_horas: datosMapeados.fcha_envio_control_horas,
    fcha_recibido_control_horas: datosMapeados.fcha_recibido_control_horas,
    fcha_seguimiento_envio_control_horas: datosMapeados.fcha_seguimiento_envio_control_horas
  });
  
  const camposFecha = [
    'fchaAsgncion', 'fchaSinstro', 'fchaInspccion', 'fchaContIni',
    'fchaCoordInspeccion', 'fchaProgInspeccion',
    'fchaSoliDocu', 'fchaInfoPrelm', 'fchaInfoFnal', 'fchaRepoActi',
    'fchaPresentacionCifras', 'fchaEnvioFiniquito', 'fchaAceptacionCifrasAseguradora',
    'fchaUltSegui', 'fchaActSegui', 'fchaFinqtoIndem', 'fchaFactra', 'fchaUltRevi', 
    'fchaControlHoras', 'fechaControlHoras', 'fecha_control_horas', 'fcha_control_horas', // Incluir todas las variantes
    'fchaEnvioControlHoras', 'fechaEnvioControlHoras', 'fecha_envio_control_horas', 'fcha_envio_control_horas', // Fecha de envío control de horas (Gerencia)
    'fchaRecibidoControlHoras', 'fechaRecibidoControlHoras', 'fecha_recibido_control_horas', 'fcha_recibido_control_horas', // Fecha de recibido control de horas (Gerencia)
    'fchaSeguimientoEnvioControlHoras', 'fechaSeguimientoEnvioControlHoras', 'fecha_seguimiento_envio_control_horas', 'fcha_seguimiento_envio_control_horas' // Fecha de seguimiento de envío control de horas
  ];
  
  const datosConvertidos = { ...datosMapeados };
  
  camposFecha.forEach(campo => {
    // Si el campo está presente en los datos (incluso si está vacío), procesarlo
    if (datosConvertidos[campo] !== undefined) {
      if (datosConvertidos[campo] !== null && datosConvertidos[campo] !== '') {
        const fechaConvertida = convertirFechaLocal(datosConvertidos[campo]);
        if (fechaConvertida) {
          datosConvertidos[campo] = fechaConvertida;
          console.log(`✅ [convertirFechasEnDatos] ${campo} convertida:`, fechaConvertida);
        } else {
          // Si no se pudo convertir, eliminar el campo para evitar errores
          console.log(`⚠️ [convertirFechasEnDatos] ${campo} no se pudo convertir, eliminando del payload`);
          delete datosConvertidos[campo];
        }
      } else {
        // Si está vacío o null, establecerlo como null explícitamente para poder limpiarlo en BD
        datosConvertidos[campo] = null;
        console.log(`🧹 [convertirFechasEnDatos] ${campo} está vacío, estableciendo como null`);
      }
    } else {
      console.log(`⚠️ [convertirFechasEnDatos] ${campo} no está presente en los datos`);
    }
  });

  if (datosConvertidos.control_horas && Array.isArray(datosConvertidos.control_horas.filas)) {
    datosConvertidos.control_horas = {
      ...datosConvertidos.control_horas,
      filas: datosConvertidos.control_horas.filas.map((fila) => {
        const filaCopia = { ...fila };
        if (filaCopia.fecha) {
          const fechaConvertida = convertirFechaLocal(filaCopia.fecha);
          filaCopia.fecha = fechaConvertida || filaCopia.fecha;
        }
        return filaCopia;
      }),
    };
  }

  return datosConvertidos;
};

const formatearFechaSoloDia = (valor) => {
  if (!valor) return '';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '';
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, '0');
  const day = String(fecha.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const tomarPrimerValor = (...valores) => {
  for (const valor of valores) {
    if (valor !== undefined && valor !== null) {
      const texto = String(valor).trim();
      if (texto !== '') return texto;
    }
  }
  return '';
};

const buscarFuncionarioAsignado = async (caso) => {
  const codigoAseguradora = tomarPrimerValor(caso?.codiAsgrdra);
  const referenciaFuncionario = tomarPrimerValor(
    caso?.funcAsgrdra,
    caso?.funcAsgrdraNombre,
    caso?.funcAsgrdraId
  );

  console.log('🔍 [buscarFuncionarioAsignado] Inputs:', {
    codigoAseguradora,
    referenciaFuncionario,
    funcAsgrdra: caso?.funcAsgrdra,
    funcAsgrdraNombre: caso?.funcAsgrdraNombre
  });

  if (!referenciaFuncionario) {
    console.log('⚠️ [buscarFuncionarioAsignado] Sin referencia de funcionario');
    return null;
  }

  const idNumerico = Number(referenciaFuncionario);
  const referenciaEsNumerica = !Number.isNaN(idNumerico) && referenciaFuncionario !== '';

  // 1) Si la referencia es numérica, intentamos primero match exacto por id.
  //    No condicionamos al codiAsgrdra (a veces no coincide en BD).
  if (referenciaEsNumerica) {
    try {
      const porIdSolo = await FuncionarioAseguradora.findOne({ id: idNumerico });
      if (porIdSolo) {
        console.log('✅ [buscarFuncionarioAsignado] Match por id (sin codiAsgrdra):', {
          id: porIdSolo.id,
          nmbrContcto: porIdSolo.nmbrContcto,
          codiAsgrdra: porIdSolo.codiAsgrdra
        });
        return porIdSolo;
      }
    } catch (e) {
      console.error('❌ [buscarFuncionarioAsignado] Error buscando por id:', e?.message);
    }
  }

  // 2) Si tenemos aseguradora, intentamos por aseguradora + nombre/id.
  if (codigoAseguradora) {
    const ors = [];
    if (referenciaEsNumerica) ors.push({ id: idNumerico });
    ors.push({ nmbrContcto: referenciaFuncionario });

    try {
      const porAseguradora = await FuncionarioAseguradora.findOne({
        codiAsgrdra: codigoAseguradora,
        $or: ors
      });
      if (porAseguradora) {
        console.log('✅ [buscarFuncionarioAsignado] Match por aseguradora + ref:', {
          id: porAseguradora.id,
          nmbrContcto: porAseguradora.nmbrContcto
        });
        return porAseguradora;
      }
    } catch (e) {
      console.error('❌ [buscarFuncionarioAsignado] Error buscando por aseguradora:', e?.message);
    }
  }

  // 3) Última opción: por nombre exacto (case-insensitive) cuando no es solo numérica.
  if (!referenciaEsNumerica) {
    try {
      const escapado = referenciaFuncionario.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const porNombre = await FuncionarioAseguradora.findOne({
        nmbrContcto: { $regex: `^${escapado}$`, $options: 'i' }
      });
      if (porNombre) {
        console.log('✅ [buscarFuncionarioAsignado] Match por nombre (sin aseguradora):', {
          id: porNombre.id,
          nmbrContcto: porNombre.nmbrContcto,
          codiAsgrdra: porNombre.codiAsgrdra
        });
        return porNombre;
      }
    } catch (e) {
      console.error('❌ [buscarFuncionarioAsignado] Error buscando por nombre:', e?.message);
    }
  }

  console.log('⚠️ [buscarFuncionarioAsignado] No se encontró funcionario');
  return null;
};

const buscarNombreComercialAseguradora = async (codigoAseguradora) => {
  const codigo = tomarPrimerValor(codigoAseguradora);
  if (!codigo) return '';

  try {
    // Filtra por codiAsgrdra exacto y devuelve el primero con rzonSocial o nombre.
    const cliente = await Cliente.findOne({ codiAsgrdra: codigo });
    if (cliente) {
      return tomarPrimerValor(cliente.rzonSocial, cliente.nombre);
    }
  } catch (error) {
    console.error('❌ Error buscando nombre comercial de aseguradora:', error?.message || error);
  }
  return '';
};

const mapearCasoAjuste = async (caso) => {
  console.log('🎯 [mapearCasoAjuste] Caso:', {
    _id: caso?._id,
    nmroSinstro: caso?.nmroSinstro,
    nmroAjste: caso?.nmroAjste,
    codiAsgrdra: caso?.codiAsgrdra,
    funcAsgrdra: caso?.funcAsgrdra,
    funcAsgrdraNombre: caso?.funcAsgrdraNombre,
    nombreAseguradora: caso?.nombreAseguradora
  });
  const descSiniestro = tomarPrimerValor(caso?.descSinstro);
  const descEstado = tomarPrimerValor(caso?.descripcionEstado);
  const descripcionCompuesta = descSiniestro && descEstado
    ? `${descSiniestro}\n\nEstado del caso: ${descEstado}`
    : (descSiniestro || descEstado);
  const funcionario = await buscarFuncionarioAsignado(caso);
  const nombreFuncionario = tomarPrimerValor(
    funcionario?.nmbrContcto,
    caso?.funcAsgrdraNombre
  );
  const codigoAseguradora = tomarPrimerValor(caso?.codiAsgrdra);
  const nombreComercial = await buscarNombreComercialAseguradora(codigoAseguradora);
  // Prioridad: nombre comercial resuelto > nombreAseguradora del caso > código (último recurso)
  const nombreEmpresa = tomarPrimerValor(
    nombreComercial,
    caso?.nombreAseguradora,
    codigoAseguradora
  );

  console.log('🎯 [mapearCasoAjuste] Resultados de mapeo:', {
    nombreEmpresa,
    nombreComercial,
    nombreFuncionario,
    funcionario_email: funcionario?.email,
    funcionario_tel: funcionario?.teleCellar
  });

  const tipoEventoValor = tomarPrimerValor(
    caso?.causa_siniestro,
    caso?.amprAfctdo,
    caso?.tipoPoliza
  );

  return {
    numeroSiniestro: tomarPrimerValor(caso?.nmroSinstro),
    numeroCaso: tomarPrimerValor(caso?.nmroAjste),
    numeroPoliza: tomarPrimerValor(caso?.nmroPolza),
    codigoReporte: tomarPrimerValor(caso?.codWorkflow, caso?.nmroAjste),
    aseguradora: nombreEmpresa,
    funcionarioAsigna: nombreFuncionario,
    destinatario: nombreFuncionario,
    cargo: tomarPrimerValor(funcionario?.cargo),
    empresa: nombreEmpresa,
    direccion: tomarPrimerValor(funcionario?.direccion),
    email: tomarPrimerValor(funcionario?.email),
    telefono: tomarPrimerValor(funcionario?.teleCellar),
    asegurado: tomarPrimerValor(caso?.asgrBenfcro, caso?.amprAfctdo),
    tomador: tomarPrimerValor(caso?.asgrBenfcro, caso?.amprAfctdo),
    beneficiario: tomarPrimerValor(caso?.asgrBenfcro),
    identificacionActa: tomarPrimerValor(caso?.numDocumento),
    tipoEvento: tipoEventoValor,
    tipoSiniestro: tipoEventoValor,
    actividad: tomarPrimerValor(caso?.actividad),
    tipoRiesgoActa: tomarPrimerValor(caso?.tipoPoliza, caso?.amprAfctdo),
    /** Fecha inspección acta: trazabilidad suele cargar primero prog./coord. y luego la real */
    fechaInspeccion: formatearFechaSoloDia(
      caso?.fchaInspccion ||
        caso?.fchaProgInspeccion ||
        caso?.fchaCoordInspeccion ||
        caso?.fcha_inspccion ||
        caso?.fcha_prog_inspeccion ||
        caso?.fcha_coord_inspeccion
    ),
    /** Fecha del siniestro (BD: fchaSinstro) — mismo origen que ocurrencia para el acta e informe */
    fechaSiniestro: formatearFechaSoloDia(caso?.fchaSinstro),
    /** Fecha de reporte = fecha de asignación del expediente (fchaAsgncion) */
    fechaAsignacion: formatearFechaSoloDia(caso?.fchaAsgncion),
    fechaReporte: formatearFechaSoloDia(caso?.fchaAsgncion),
    fechaOcurrencia: formatearFechaSoloDia(caso?.fchaSinstro),
    ciudad: tomarPrimerValor(caso?.descripcionCiudad, caso?.nombreCiudad, caso?.ciudadSiniestro),
    departamento: tomarPrimerValor(caso?.departamentoCiudad),
    direccionRiesgo: tomarPrimerValor(caso?.direccionRiesgo, caso?.direccion_riesgo),
    ramo: tomarPrimerValor(caso?.tipoPoliza),
    descripcionSiniestro: descripcionCompuesta,
    nombIntermediario: tomarPrimerValor(caso?.nombIntermediario),
    metadata: {
      intermediario: tomarPrimerValor(caso?.nombIntermediario),
      tipoDocumento: tomarPrimerValor(caso?.tipoDucumento),
      numeroDocumento: tomarPrimerValor(caso?.numDocumento),
      codiAsgrdra: codigoAseguradora,
      funcionarioId: tomarPrimerValor(funcionario?.id),
      fechaAsignacion: formatearFechaSoloDia(caso?.fchaAsgncion),
      // Útil para el frontend si quiere referencias adicionales
      funcAsgrdraRef: tomarPrimerValor(caso?.funcAsgrdra)
    }
  };
};

// Crear un nuevo caso
export const crearComplex = async (req, res) => {
  try {
    // Si viene _id, es una actualización, no una creación
    if (req.body._id) {
      console.log('⚠️ [crearComplex] Se recibió _id en el payload, redirigiendo a actualizarComplex');
      return actualizarComplex({ ...req, params: { id: req.body._id } }, res);
    }
    
         console.log('🎯 ===== INICIANDO CREACIÓN DE COMPLEX =====');
     console.log('📝 DATOS RECIBIDOS EN crearComplex:', JSON.stringify(req.body, null, 2));
           console.log('🔍 CAMPOS CLAVE:');
      console.log('   - responsable:', req.body.codiRespnsble);
      console.log('   - aseguradora:', req.body.codiAsgrdra);
      console.log('   - funcionario_aseguradora:', req.body.funcAsgrdra);
      console.log('   - intermediario:', req.body.nombIntermediario);
      console.log('🔍 VERIFICACIÓN DE CAMPOS:');
      console.log('   - req.body.codiRespnsble existe:', !!req.body.codiRespnsble);
      console.log('   - req.body.codiAsgrdra existe:', !!req.body.codiAsgrdra);
      console.log('   - req.body.funcAsgrdra existe:', !!req.body.funcAsgrdra);
      console.log('   - req.body.nombIntermediario existe:', !!req.body.nombIntermediario);
      console.log('🔍 VALORES COMPLETOS:');
      console.log('   - responsable valor:', req.body.codiRespnsble);
      console.log('   - aseguradora valor:', req.body.codiAsgrdra);
      console.log('   - funcionario_aseguradora valor:', req.body.funcAsgrdra);
      console.log('   - intermediario valor:', req.body.nombIntermediario);
    
         // Generar nmroAjste único si está vacío
     let datosParaGuardar = { ...req.body };
     
     // Convertir todas las fechas a Date local para evitar problemas de zona horaria
     datosParaGuardar = convertirFechasEnDatos(datosParaGuardar);
     
     // Asegurar que descripcionEstado, observacionesPendientes e historialDocs se incluyan
     console.log('🔍 [crearComplex] Verificando campos especiales:', {
       descripcionEstado_en_req: req.body.descripcionEstado,
       observacionesPendientes_en_req: req.body.observacionesPendientes,
       historialDocs_en_req: req.body.historialDocs ? `Array con ${req.body.historialDocs.length} elementos` : 'vacío o undefined'
     });
     
     if (req.body.descripcionEstado !== undefined) {
       datosParaGuardar.descripcionEstado = req.body.descripcionEstado;
       console.log('✅ [crearComplex] descripcionEstado agregado:', datosParaGuardar.descripcionEstado);
     } else {
       console.log('⚠️ [crearComplex] descripcionEstado no está en req.body');
     }
     
     if (req.body.observacionesPendientes !== undefined) {
       datosParaGuardar.observacionesPendientes = req.body.observacionesPendientes;
       console.log('✅ [crearComplex] observacionesPendientes agregado:', datosParaGuardar.observacionesPendientes);
     } else {
       console.log('⚠️ [crearComplex] observacionesPendientes no está en req.body');
     }
     
     if (req.body.historialDocs !== undefined) {
       datosParaGuardar.historialDocs = req.body.historialDocs;
       console.log('✅ [crearComplex] historialDocs agregado:', datosParaGuardar.historialDocs ? `Array con ${datosParaGuardar.historialDocs.length} elementos` : 'vacío');
     } else {
       console.log('⚠️ [crearComplex] historialDocs no está en req.body');
     }
     
     console.log('📅 Fechas convertidas en crearComplex:', Object.keys(datosParaGuardar)
       .filter(key => key.startsWith('fcha'))
       .map(campo => ({
         campo,
         original: req.body[campo],
         convertida: datosParaGuardar[campo]
       }))
       .filter(f => f.original));
     
     console.log('🔍 VERIFICANDO nmroAjste EN REQ.BODY:');
     console.log('   - req.body.nmroAjste:', req.body.nmroAjste);
     console.log('   - Tipo:', typeof req.body.nmroAjste);
     console.log('   - Es null?:', req.body.nmroAjste === null);
     console.log('   - Es undefined?:', req.body.nmroAjste === undefined);
     console.log('   - Es string vacío?:', req.body.nmroAjste === '');
     console.log('   - Trimmed:', req.body.nmroAjste ? String(req.body.nmroAjste).trim() : 'N/A');
     
     // Verificar si nmroAjste está vacío, null, undefined o es solo espacios
     const nmroAjsteVacio = !datosParaGuardar.nmroAjste || 
                            datosParaGuardar.nmroAjste === null ||
                            datosParaGuardar.nmroAjste === undefined ||
                            String(datosParaGuardar.nmroAjste).trim() === '';
     
     console.log('🔍 nmroAjsteVacio:', nmroAjsteVacio);
     
     if (nmroAjsteVacio) {
       console.log('🔢 ===== GENERANDO NUEVO NÚMERO DE AJUSTE =====');
       
       // Obtener año y mes actual
       const ahora = new Date();
       const año = ahora.getFullYear();
       const mes = String(ahora.getMonth() + 1).padStart(2, '0'); // Mes con 2 dígitos (01-12)
       console.log('📅 Año:', año, 'Mes:', mes);
       
       // Buscar todos los casos para encontrar el número más alto
       const patronFormatoNuevo = /^(\d{4})-(\d{2})-(\d+)$/;
       const todosLosCasos = await Complex.find({ nmroAjste: { $exists: true, $ne: '' } });
       console.log('📊 Total de casos encontrados:', todosLosCasos.length);
       
       let nuevoNumero = 1;
       let numeroMaximoEncontrado = 0;
       
       // Buscar el número más alto entre todos los casos
       todosLosCasos.forEach((caso, index) => {
         if (caso.nmroAjste) {
           const ajuste = String(caso.nmroAjste);
           const match = ajuste.match(patronFormatoNuevo);
           
           if (match && match[3]) {
             // Es formato nuevo YYYY-MM-NNN, extraer el número secuencial
             const numeroSecuencial = parseInt(match[3]);
             console.log(`   Caso ${index + 1}: ${ajuste} -> número secuencial: ${numeroSecuencial}`);
             if (numeroSecuencial > numeroMaximoEncontrado) {
               numeroMaximoEncontrado = numeroSecuencial;
             }
           } else {
             // Es formato antiguo (solo número)
             const esFormatoAntiguo = /^\d+$/.test(ajuste);
             if (esFormatoAntiguo) {
               const numeroAntiguo = parseInt(ajuste);
               console.log(`   Caso ${index + 1}: ${ajuste} -> formato antiguo, número: ${numeroAntiguo}`);
               if (numeroAntiguo > numeroMaximoEncontrado) {
                 numeroMaximoEncontrado = numeroAntiguo;
               }
             } else {
               console.log(`   Caso ${index + 1}: ${ajuste} -> formato desconocido, ignorado`);
             }
           }
         }
       });
       
       // El nuevo número será el máximo encontrado + 1, o 1 si no hay casos
       nuevoNumero = numeroMaximoEncontrado > 0 ? numeroMaximoEncontrado + 1 : 1;
       console.log('🔢 Número máximo encontrado:', numeroMaximoEncontrado);
       console.log('🔢 Nuevo número secuencial:', nuevoNumero);
       
       // Formatear como YYYY-MM-NNN (sin padding adicional, solo el número natural)
       datosParaGuardar.nmroAjste = `${año}-${mes}-${nuevoNumero}`;
       console.log('✅ NUEVO NMRO_AJUSTE GENERADO:', datosParaGuardar.nmroAjste);
       console.log('🔢 ===== FIN GENERACIÓN NÚMERO DE AJUSTE =====');
     } else {
       console.log('⚠️ Usando número de ajuste proporcionado por el frontend:', datosParaGuardar.nmroAjste);
     }
     
     console.log('💾 datosParaGuardar.nmroAjste FINAL:', datosParaGuardar.nmroAjste);
    
    if (!validarCodiEstdoObligatorio(datosParaGuardar, res)) {
      return;
    }
    datosParaGuardar.codiEstdo = extraerCodiEstdoDeBody(datosParaGuardar);

    const nuevo = new Complex(datosParaGuardar);
    
    console.log('💾 OBJETO A GUARDAR:', JSON.stringify(nuevo, null, 2));
    
    await nuevo.save();
    
    console.log('✅ COMPLEX GUARDADO EXITOSAMENTE:', JSON.stringify(nuevo, null, 2));
         console.log('🎯 ===== COMPLEX CREADO CON ÉXITO =====');
     console.log('📊 RESUMEN DEL CASO CREADO:');
     console.log(`   📋 Número de Ajuste: ${nuevo.nmroAjste}`);
     console.log(`   👤 Intermediario: ${nuevo.nombIntermediario || 'No especificado'}`);
     console.log(`   🏢 Aseguradora: ${nuevo.codiAsgrdra || 'No especificada'}`);
     console.log(`   👨‍💼 Responsable: ${nuevo.codiRespnsble || 'No especificado'}`);
     console.log(`   📅 Fecha de Creación: ${nuevo.fchaAsgncion}`);
     console.log(`   📅 Fecha Control de Horas: ${nuevo.fcha_control_horas || 'No especificada'}`);
     console.log(`   📅 Fecha Envío Control de Horas: ${nuevo.fcha_envio_control_horas || 'No especificada'}`);
     console.log(`   🆔 ID del Caso: ${nuevo._id}`);
     console.log('🎯 ===== COMPLEX CREADO CON ÉXITO =====');
     
     // Verificar explícitamente que fcha_envio_control_horas se guardó
     if (nuevo.fcha_envio_control_horas) {
       console.log('✅✅✅ [crearComplex] CONFIRMADO: fcha_envio_control_horas está en la BD:', nuevo.fcha_envio_control_horas);
     } else {
       console.log('⚠️⚠️⚠️ [crearComplex] ADVERTENCIA: fcha_envio_control_horas NO está en la BD después de crear');
     }
    
    /** Resumen de correos (asignación / creador) para verificar en cliente sin leer logs del servidor */
    let notificacionesResumen = null;

                 // 📧 ENVIAR NOTIFICACIONES POR EMAIL
        try {
          console.log('📧 Iniciando envío de notificaciones por email...');
          
          // Verificar que los modelos estén disponibles
          console.log('🔍 ===== VERIFICACIÓN DE MODELOS =====');
          console.log('🔍 Modelo Responsable disponible:', !!mongoose.model('Responsable'));
          console.log('🔍 Modelo FuncionarioAseguradora disponible:', !!mongoose.model('FuncionarioAseguradora'));
          console.log('🔍 Conexión MongoDB estado:', mongoose.connection.readyState);
          console.log('🔍 Base de datos:', mongoose.connection.name);
       
                        // Obtener email del responsable desde la base de datos
         let emailResponsable = '';
         let nombreResponsableCompleto = nuevo.codiRespnsble || 'Sin asignar';
         if (nuevo.codiRespnsble) {
           try {
             console.log('🔍 🔍 🔍 ===== BÚSQUEDA RESPONSABLE (CREAR) ===== 🔍 🔍 🔍');
             const valorBuscado = String(nuevo.codiRespnsble).trim();
             console.log('🔍 Valor a buscar (normalizado):', valorBuscado);
             console.log('🔍 Tipo:', typeof valorBuscado);
             
             // Primero intentar búsqueda exacta por código
             let responsableDB = await mongoose.model('Responsable').findOne({ 
               codiRespnsble: valorBuscado
             });
             
             console.log('🔍 Búsqueda exacta por codiRespnsble:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
             
             // Si no se encuentra, buscar por nombre (por si se guardó el nombre en lugar del código)
             if (!responsableDB) {
               console.log('🔍 Intentando búsqueda exacta por nombre...');
               responsableDB = await mongoose.model('Responsable').findOne({ 
                 nmbrRespnsble: valorBuscado
               });
               console.log('🔍 Búsqueda exacta por nmbrRespnsble:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
             }
             
             // Si aún no se encuentra, buscar con regex (case insensitive)
             if (!responsableDB) {
               console.log('🔍 Intentando búsqueda con regex...');
               const valorEscapado = valorBuscado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
               responsableDB = await mongoose.model('Responsable').findOne({ 
                 $or: [
                   { codiRespnsble: { $regex: new RegExp(`^${valorEscapado}$`, 'i') } },
                   { nmbrRespnsble: { $regex: new RegExp(`^${valorEscapado}$`, 'i') } }
                 ]
               });
               console.log('🔍 Búsqueda con regex:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
             }
             
             // Debug: mostrar todos los responsables si no se encuentra
             if (!responsableDB) {
               console.log('🔍 🔍 🔍 DEBUG: Listando TODOS los responsables de la BD 🔍 🔍 🔍');
               const todosResponsables = await mongoose.model('Responsable').find({});
               console.log(`🔍 Total de responsables en BD: ${todosResponsables.length}`);
               todosResponsables.forEach((r, idx) => {
                 const rObj = r.toObject();
                 console.log(`🔍 Responsable ${idx + 1}:`, {
                   codiRespnsble: rObj.codiRespnsble,
                   nmbrRespnsble: rObj.nmbrRespnsble,
                   email: rObj.email,
                   telefono: rObj.telefono,
                   coincideCodigo: rObj.codiRespnsble === valorBuscado,
                   coincideNombre: rObj.nmbrRespnsble === valorBuscado
                 });
               });
             }
             
             if (responsableDB) {
               const responsableObj = responsableDB.toObject();
               console.log('✅ ✅ ✅ RESPONSABLE ENCONTRADO ✅ ✅ ✅');
               console.log('🔍 Datos completos:', JSON.stringify(responsableObj, null, 2));
               
               if (responsableObj.email && responsableObj.email.trim() !== '') {
                 emailResponsable = responsableObj.email.trim();
                 nombreResponsableCompleto = responsableObj.nmbrRespnsble || responsableObj.codiRespnsble || valorBuscado;
                 console.log('✅ ✅ ✅ EMAIL DEL RESPONSABLE ENCONTRADO ✅ ✅ ✅');
                 console.log('📧 Email:', emailResponsable);
                 console.log('👤 Nombre:', nombreResponsableCompleto);
               } else {
                 console.log('⚠️ ⚠️ ⚠️ RESPONSABLE ENCONTRADO PERO SIN EMAIL ⚠️ ⚠️ ⚠️');
                 console.log('⚠️ Email en BD:', responsableObj.email);
                 console.log('⚠️ Todos los campos:', Object.keys(responsableObj));
               }
             } else {
               console.log('❌ ❌ ❌ NO SE ENCONTRÓ EL RESPONSABLE EN LA BD ❌ ❌ ❌');
               console.log('❌ Valor buscado:', valorBuscado);
             }
          } catch (error) {
            console.log('❌ ❌ ❌ ERROR AL BUSCAR RESPONSABLE ❌ ❌ ❌');
            console.log('❌ Error:', error.message);
            console.log('❌ Stack trace:', error.stack);
          }
        } else {
          console.log('⚠️ No hay responsable asignado para buscar email');
        }
         
         console.log('📧 📧 📧 RESUMEN BÚSQUEDA RESPONSABLE (CREAR) 📧 📧 📧');
         console.log('📧 Email encontrado:', emailResponsable || 'NO ENCONTRADO');
         console.log('📧 Nombre responsable:', nombreResponsableCompleto);
       
                        // Obtener email del funcionario de aseguradora desde la base de datos
         let emailFuncionarioAseguradora = '';
         if (nuevo.funcAsgrdra || nuevo.funcAsgrdraNombre || nuevo.funcionarioAseguradora) {
           try {
             console.log('🔍 🔍 🔍 ===== BÚSQUEDA FUNCIONARIO ASEGURADORA (CREAR) ===== 🔍 🔍 🔍');
             const valorBuscado = String(nuevo.funcAsgrdra || nuevo.funcAsgrdraNombre || nuevo.funcionarioAseguradora || '').trim();
             console.log('🔍 Valor a buscar:', valorBuscado);
             console.log('🔍 funcAsgrdra:', nuevo.funcAsgrdra);
             console.log('🔍 funcAsgrdraNombre:', nuevo.funcAsgrdraNombre);
             console.log('🔍 funcionarioAseguradora:', nuevo.funcionarioAseguradora);
             
             if (valorBuscado) {
               // Buscar por nombre de contacto
               let funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
                 nmbrContcto: valorBuscado
               });
               
               console.log('🔍 Búsqueda exacta por nmbrContcto:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
               
               // Si no se encuentra, buscar con regex
               if (!funcionarioDB) {
                 console.log('🔍 Intentando búsqueda con regex...');
                 const valorEscapado = valorBuscado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                 funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
                   nmbrContcto: { $regex: new RegExp(`^${valorEscapado}$`, 'i') }
                 });
                 console.log('🔍 Búsqueda con regex:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
               }
               
               // Si aún no se encuentra, buscar parcialmente
               if (!funcionarioDB) {
                 console.log('🔍 Intentando búsqueda parcial...');
                 funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
                   nmbrContcto: { $regex: valorBuscado, $options: 'i' }
                 });
                 console.log('🔍 Búsqueda parcial:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
               }
               
               if (funcionarioDB) {
                 const funcionarioObj = funcionarioDB.toObject();
                 console.log('✅ ✅ ✅ FUNCIONARIO ENCONTRADO ✅ ✅ ✅');
                 console.log('🔍 Datos completos:', JSON.stringify(funcionarioObj, null, 2));
                 
                 if (funcionarioObj.email && funcionarioObj.email.trim() !== '') {
                   emailFuncionarioAseguradora = funcionarioObj.email.trim();
                   console.log('✅ ✅ ✅ EMAIL DEL FUNCIONARIO ENCONTRADO ✅ ✅ ✅');
                   console.log('📧 Email:', emailFuncionarioAseguradora);
                 } else {
                   console.log('⚠️ ⚠️ ⚠️ FUNCIONARIO ENCONTRADO PERO SIN EMAIL ⚠️ ⚠️ ⚠️');
                   console.log('⚠️ Email en BD:', funcionarioObj.email);
                   console.log('⚠️ Todos los campos:', Object.keys(funcionarioObj));
                 }
               } else {
                 console.log('❌ ❌ ❌ NO SE ENCONTRÓ EL FUNCIONARIO EN LA BD ❌ ❌ ❌');
                 console.log('❌ Valor buscado:', valorBuscado);
               }
             } else {
               console.log('⚠️ No hay valor para buscar funcionario');
             }
            } catch (error) {
              console.log('❌ ❌ ❌ ERROR AL BUSCAR FUNCIONARIO ❌ ❌ ❌');
              console.log('❌ Error:', error.message);
              console.log('❌ Stack trace:', error.stack);
            }
          } else {
            console.log('⚠️ No hay funcionario asignado para buscar email');
          }
         
         console.log('📧 📧 📧 RESUMEN BÚSQUEDA FUNCIONARIO (CREAR) 📧 📧 📧');
         console.log('📧 Email encontrado:', emailFuncionarioAseguradora || 'NO ENCONTRADO');
       
                        // Obtener email del usuario que asigna el caso
         let emailQuienAsigna = '';
         let nombreQuienAsigna = 'Sistema';
         
         if (req.usuario && req.usuario.id) {
           try {
             const usuarioAsignador = await SecurUser.findById(req.usuario.id);
             if (usuarioAsignador && usuarioAsignador.email) {
               emailQuienAsigna = usuarioAsignador.email.trim();
               nombreQuienAsigna = usuarioAsignador.name || usuarioAsignador.login || 'Usuario';
               console.log('✅ Email del usuario que asigna obtenido:', emailQuienAsigna);
               console.log('✅ Nombre del usuario que asigna:', nombreQuienAsigna);
             }
           } catch (error) {
             console.log('⚠️ Error obteniendo email del usuario que asigna:', error.message);
           }
         } else if (req.usuario && req.usuario.login) {
           try {
             const usuarioAsignador = await SecurUser.findOne({ login: req.usuario.login });
             if (usuarioAsignador && usuarioAsignador.email) {
               emailQuienAsigna = usuarioAsignador.email.trim();
               nombreQuienAsigna = usuarioAsignador.name || usuarioAsignador.login || 'Usuario';
               console.log('✅ Email del usuario que asigna obtenido por login:', emailQuienAsigna);
               console.log('✅ Nombre del usuario que asigna:', nombreQuienAsigna);
             }
           } catch (error) {
             console.log('⚠️ Error obteniendo email del usuario que asigna por login:', error.message);
           }
         }
         
         if (!emailQuienAsigna) {
           console.log('⚠️ No se pudo obtener el email del usuario que asigna el caso');
         }
         
                        // Preparar datos para notificación de asignación
         const datosNotificacion = {
           numeroCaso: nuevo.nmroAjste,
           numeroSiniestro: nuevo.nmroSinstro || 'No especificado',
           codigoWorkflow: nuevo.codWorkflow || 'No especificado',
           nombreResponsable: nombreResponsableCompleto,
           aseguradora: nuevo.codiAsgrdra || 'No especificada',
           intermediario: nuevo.nombIntermediario || 'No especificado',
           asegurado: nuevo.nombIntermediario || 'No especificado', // Para compatibilidad
           aseguradoReal: nuevo.asgrBenfcro || 'No especificado',
           funcionarioAseguradora: nuevo.funcAsgrdraNombre || nuevo.funcionarioAseguradora || '',
           funcAsgrdra: nuevo.funcAsgrdra || '',
           funcAsgrdraNombre: nuevo.funcAsgrdraNombre || '',
           codiEstdo: nuevo.codiEstdo || '',
           estado: nuevo.codiEstdo || '',
           descripcionEstado: nuevo.descripcionEstado || '',
           fechaAsignacion: nuevo.fchaAsgncion || new Date(),
           quienAsigna: nombreQuienAsigna,
           emailResponsable: emailResponsable,
           emailQuienAsigna: emailQuienAsigna,
           emailFuncionarioAseguradora: emailFuncionarioAseguradora,
           observaciones: nuevo.obseContIni || nuevo.descSinstro || '',
           numeroPoliza: nuevo.nmroPolza || 'No especificado',
           ciudadSiniestro: nuevo.ciudadSiniestro || 'No especificada',
           descripcionSiniestro: nuevo.descSinstro || 'No especificada'
         };
       
       console.log('📧 Datos para notificación:', JSON.stringify(datosNotificacion, null, 2));
       
       // Enviar notificación de asignación
       const resultadoEmail = await enviarNotificacionAsignacion(datosNotificacion);
       console.log('✅ Notificación de asignación enviada:', resultadoEmail);
       notificacionesResumen = {
         asignacion: {
           success: !!resultadoEmail.success,
           message: resultadoEmail.message || (resultadoEmail.success ? 'Enviado' : (resultadoEmail.error || 'Sin enviar')),
           destinatarios: Array.isArray(resultadoEmail.emailsEnviados) ? resultadoEmail.emailsEnviados : []
         }
       };
       
       // Enviar notificación a aseguradora si hay funcionario asignado
       if (nuevo.funcAsgrdra && emailFuncionarioAseguradora) {
         try {
                       const datosNotificacionAseguradora = {
              numeroCaso: nuevo.nmroAjste,
              numeroSiniestro: nuevo.nmroSinstro || 'No especificado',
              codigoWorkflow: nuevo.codWorkflow || 'No especificado',
              nombreResponsable: nombreResponsableCompleto,
              aseguradora: nuevo.codiAsgrdra || 'No especificada',
              asegurado: nuevo.nombIntermediario || 'No especificado',
              fechaAsignacion: nuevo.fchaAsgncion || new Date(),
              emailFuncionarioAseguradora: emailFuncionarioAseguradora,
              numeroPoliza: nuevo.nmroPolza || 'No especificado',
              ciudadSiniestro: nuevo.ciudadSiniestro || 'No especificada',
              descripcionSiniestro: nuevo.descSinstro || 'No especificada'
            };
           
           const resultadoEmailAseguradora = await enviarNotificacionAseguradora(datosNotificacionAseguradora);
           console.log('✅ Notificación a aseguradora enviada:', resultadoEmailAseguradora);
           
         } catch (emailAseguradoraError) {
           console.error('⚠️ Error enviando notificación a aseguradora:', emailAseguradoraError);
           // No fallar por error de email a aseguradora
         }
       }
       
       // Enviar notificación al creador del caso
       try {
         console.log('📧 ===== ENVIANDO NOTIFICACIÓN AL CREADOR =====');
         
         // Obtener información del usuario que crea el caso
         let emailCreador = null;
         let nombreCreador = 'Sistema';
         
         if (req.usuario && req.usuario.id) {
           try {
             const usuarioCreador = await SecurUser.findById(req.usuario.id);
             if (usuarioCreador && usuarioCreador.email) {
               emailCreador = usuarioCreador.email;
               nombreCreador = usuarioCreador.name || 'Usuario';
               console.log('✅ Email del creador obtenido:', emailCreador);
             }
           } catch (error) {
             console.log('⚠️ Error obteniendo email del creador:', error.message);
           }
         } else if (req.usuario && req.usuario.login) {
           try {
             const usuarioCreador = await SecurUser.findOne({ login: req.usuario.login });
             if (usuarioCreador && usuarioCreador.email) {
               emailCreador = usuarioCreador.email;
               nombreCreador = usuarioCreador.name || 'Usuario';
               console.log('✅ Email del creador obtenido por login:', emailCreador);
             }
           } catch (error) {
             console.log('⚠️ Error obteniendo email del creador por login:', error.message);
           }
         }
         
         if (emailCreador) {
           const datosNotificacionCreador = {
             tipoCaso: 'complex',
             numeroCaso: nuevo.nmroAjste,
             numeroSiniestro: nuevo.nmroSinstro || 'No especificado',
             codigoWorkflow: nuevo.codWorkflow || 'No especificado',
             nombreResponsable: nombreResponsableCompleto,
             aseguradora: nuevo.codiAsgrdra || 'No especificada',
             asegurado: nuevo.nombIntermediario || 'No especificado',
             emailCreador: emailCreador,
             numeroPoliza: nuevo.nmroPolza || 'No especificado',
             funcionarioAseguradora: nuevo.funcAsgrdra || null
           };
           
           const resultadoEmailCreador = await enviarNotificacionCreador(datosNotificacionCreador);
           console.log('✅ Notificación al creador enviada:', resultadoEmailCreador);
           notificacionesResumen = {
             ...notificacionesResumen,
             creador: {
               success: !!resultadoEmailCreador?.success,
               message: resultadoEmailCreador?.message || (resultadoEmailCreador?.success ? 'Enviado' : (resultadoEmailCreador?.error || '')),
               destinatarios: resultadoEmailCreador?.emailEnviado
                 ? [resultadoEmailCreador.emailEnviado]
                 : (Array.isArray(resultadoEmailCreador?.emailsEnviados) ? resultadoEmailCreador.emailsEnviados : [])
             }
           };
         } else {
           console.log('⚠️ No se pudo obtener email del creador, saltando notificación');
         }
       } catch (emailCreadorError) {
         console.error('⚠️ Error enviando notificación al creador:', emailCreadorError);
         // No fallar por error de email al creador
       }
       
     } catch (emailError) {
       console.error('⚠️ Error enviando notificaciones por email:', emailError);
       console.error('⚠️ El caso se creó correctamente, pero falló el envío de notificaciones');
       notificacionesResumen = {
         ...notificacionesResumen,
         error: emailError?.message || String(emailError)
       };
       // NO fallar la creación del caso por error de email
     }
    
    res.status(201).json({
      success: true,
      message: `Caso complex #${datosParaGuardar.nmroAjste} creado exitosamente`,
      complex: enriquecerCasoComplexParaFrontend(nuevo),
      notificaciones: notificacionesResumen,
      /** El correo de "alertas pendientes" del módulo Complex no se envía al crear; es cron o POST /api/alertas/enviar/… */
      alertasComplexAutomaticas: {
        enviadasAlCrear: false,
        nota: 'Las alertas tipo resumen ALERTAS PENDIENTES se envían por cron o manualmente desde Sistema de Alertas.'
      }
    });
  } catch (error) {
    console.error('❌ ERROR AL GUARDAR COMPLEX:', error);
    console.error('❌ DETALLES DEL ERROR:', error.message);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
};

// Obtener todos los casos (unificados de ambas bases, mapeando campos)
export const obtenerTodos = async (req, res) => {
  try {
    console.log('🔍 ===== INICIANDO OBTENCIÓN DE CASOS =====');
    console.log('🔍 Obteniendo casos y siniestros...');
    
    // Verificar conexión a MongoDB
    console.log('🔌 Estado de conexión MongoDB:', mongoose.connection.readyState);
    console.log('🔌 Nombre de la base de datos:', mongoose.connection.name);
    
    // Usar Promise.allSettled para manejar errores individuales
    const [casosResult, siniestrosResult, responsablesResult] = await Promise.allSettled([
      Complex.find().sort({ creado_en: -1 }),
      Siniestro.find(),
      Responsable.find() // Importar directamente desde el modelo
    ]);
    
    // Extraer casos o usar array vacío si hay error
    const casos = casosResult.status === 'fulfilled' ? casosResult.value : [];
    const siniestros = siniestrosResult.status === 'fulfilled' ? siniestrosResult.value : [];
    const responsables = responsablesResult.status === 'fulfilled' ? responsablesResult.value : [];
    
    console.log('📊 Casos Complex encontrados:', casos.length);
    console.log('📊 Siniestros encontrados:', siniestros.length);
    console.log('📊 Responsables encontrados:', responsables.length);
    
    // Crear mapa de responsables para enriquecimiento (igual que en siniestroController.js)
    const mapaResponsables = {};
    responsables.forEach(r => {
      if (r.codiRespnsble) {
        const codigo = String(r.codiRespnsble).trim().toUpperCase();
        mapaResponsables[codigo] = r.nmbrRespnsble;
        // También agregar variantes sin espacios
        mapaResponsables[codigo.replace(/\s+/g, '')] = r.nmbrRespnsble;
      }
    });
    console.log('📊 Total responsables en mapa:', Object.keys(mapaResponsables).length);
    console.log('📊 Muestra de responsables en mapa:', Object.entries(mapaResponsables).slice(0, 5));
    
    if (casosResult.status === 'rejected') {
      console.error('❌ Error al obtener casos Complex:', casosResult.reason);
    }
    if (siniestrosResult.status === 'rejected') {
      console.error('❌ Error al obtener siniestros:', siniestrosResult.reason);
    }
    
    // Log del primer caso si existe
    if (casos.length > 0) {
      console.log('🧪 Primer caso complex:', JSON.stringify(casos[0], null, 2));
    } else {
      console.log('⚠️ No se encontraron casos complex en la base de datos');
      
      // Crear un caso de prueba si no hay datos
      try {
        console.log('🔧 Creando caso de prueba...');
        const casoPrueba = new Complex({
          numero_ajuste: 'TEST001',
          intermediario: 'Intermediario de Prueba',
          aseguradora: 'Aseguradora de Prueba',
          responsable: 'Responsable de Prueba',
          estado: '1',
          creado_en: new Date(),
          historialDocs: [
            {
              tipo: 'Documento de Prueba',
              nombre: 'test.pdf',
              fecha: new Date().toISOString().split('T')[0],
              comentario: 'Este es un caso de prueba'
            }
          ]
        });
        
        await casoPrueba.save();
        console.log('✅ Caso de prueba creado exitosamente');
        casos.push(casoPrueba);
      } catch (error) {
        console.error('❌ Error creando caso de prueba:', error);
      }
    }
    
    // Log del primer siniestro si existe
    if (siniestros.length > 0) {
      console.log('🧪 Primer siniestro:', JSON.stringify(siniestros[0], null, 2));
    } else {
      console.log('⚠️ No se encontraron siniestros en la base de datos');
    }

    // Crear un Set para evitar duplicados basado en número de ajuste
    const casosUnicos = new Map();
    
    // Agregar casos Complex primero (prioridad alta)
    casos.forEach(caso => {
      const numeroAjuste = caso.nmroAjste || caso.numero_ajuste;
      if (numeroAjuste && !casosUnicos.has(String(numeroAjuste))) {
        const casoObj = caso.toObject();
        casosUnicos.set(String(numeroAjuste), {
          ...casoObj,
          origen: 'complex',
          // Mapear campos del modelo Complex a los nombres que espera el frontend
          // Campos principales (usar nombres del modelo directamente)
          nmroAjste: casoObj.nmroAjste || '',
          nmroSinstro: casoObj.nmroSinstro || '',
          nombIntermediario: casoObj.nombIntermediario || '',
          codWorkflow: casoObj.codWorkflow || '',
          nmroPolza: casoObj.nmroPolza || '',
          codiRespnsble: casoObj.codiRespnsble || '',
          codiAsgrdra: casoObj.codiAsgrdra || '',
          funcAsgrdra: casoObj.funcAsgrdra || '',
          asgrBenfcro: casoObj.asgrBenfcro || '',
          codiEstdo: casoObj.codiEstdo || '',
          tipoDucumento: casoObj.tipoDucumento || '',
          numDocumento: casoObj.numDocumento || '',
          tipoPoliza: casoObj.tipoPoliza || '',
          amprAfctdo: casoObj.amprAfctdo || '',
          descSinstro: casoObj.descSinstro || '',
          ciudadSiniestro: casoObj.ciudadSiniestro || '',
          // Campos de descripción (ciudad y estado)
          descripcionCiudad: casoObj.descripcionCiudad || '',
          nombreCiudad: casoObj.nombreCiudad || '',
          departamentoCiudad: casoObj.departamentoCiudad || '',
          descripcionEstado: casoObj.descripcionEstado || '',
          // Fechas
          fchaAsgncion: casoObj.fchaAsgncion || null,
          fchaInspccion: casoObj.fchaInspccion || null,
          fchaContIni: casoObj.fchaContIni || null,
          fchaCoordInspeccion: casoObj.fchaCoordInspeccion || null,
          fchaProgInspeccion: casoObj.fchaProgInspeccion || null,
          fchaSinstro: casoObj.fchaSinstro || null,
          fchaSoliDocu: casoObj.fchaSoliDocu || null,
          fchaInfoPrelm: casoObj.fchaInfoPrelm || null,
          fchaInfoFnal: casoObj.fchaInfoFnal || null,
          fchaRepoActi: casoObj.fchaRepoActi || null,
          fchaUltSegui: casoObj.fchaUltSegui || null,
          fchaActSegui: casoObj.fchaActSegui || null,
          fchaFinqtoIndem: casoObj.fchaFinqtoIndem || null,
          fchaFactra: casoObj.fchaFactra || null,
          fchaUltRevi: casoObj.fchaUltRevi || null,
          fchaControlHoras: casoObj.fchaControlHoras || casoObj.fcha_control_horas || null,
          fcha_envio_control_horas: casoObj.fcha_envio_control_horas ?? casoObj.fchaEnvioControlHoras ?? null,
          fchaEnvioControlHoras: casoObj.fchaEnvioControlHoras ?? casoObj.fcha_envio_control_horas ?? null,
          fecha_envio_control_horas: casoObj.fecha_envio_control_horas ?? casoObj.fcha_envio_control_horas ?? casoObj.fchaEnvioControlHoras ?? null,
          fcha_recibido_control_horas: casoObj.fcha_recibido_control_horas ?? casoObj.fchaRecibidoControlHoras ?? null,
          fchaRecibidoControlHoras: casoObj.fchaRecibidoControlHoras ?? casoObj.fcha_recibido_control_horas ?? null,
          fecha_recibido_control_horas: casoObj.fecha_recibido_control_horas ?? casoObj.fcha_recibido_control_horas ?? casoObj.fchaRecibidoControlHoras ?? null,
          fcha_seguimiento_envio_control_horas: casoObj.fcha_seguimiento_envio_control_horas ?? casoObj.fchaSeguimientoEnvioControlHoras ?? null,
          fchaSeguimientoEnvioControlHoras: casoObj.fchaSeguimientoEnvioControlHoras ?? casoObj.fcha_seguimiento_envio_control_horas ?? null,
          fecha_seguimiento_envio_control_horas: casoObj.fecha_seguimiento_envio_control_horas ?? casoObj.fcha_seguimiento_envio_control_horas ?? null,
          // Valores numéricos
          diasTranscrrdo: casoObj.diasTranscrrdo || null,
          vlorResrva: casoObj.vlorResrva || null,
          vlorReclmo: casoObj.vlorReclmo || null,
          montoIndmzar: casoObj.montoIndmzar || null,
          vlorServcios: casoObj.vlorServcios || null,
          vlorGastos: casoObj.vlorGastos || null,
          total: casoObj.total || null,
          iva: casoObj.iva || null,
          reteiva: casoObj.reteiva || null,
          retefuente: casoObj.retefuente || null,
          reteica: casoObj.reteica || null,
          totalGeneral: casoObj.totalGeneral || null,
          totalPagado: casoObj.totalPagado || null,
          porcIva: casoObj.porcIva || null,
          porcReteiva: casoObj.porcReteiva || null,
          porcRetefuente: casoObj.porcRetefuente || null,
          porcReteica: casoObj.porcReteica || null,
          // Observaciones
          obseContIni: casoObj.obseContIni || '',
          obseCoordInspeccion: casoObj.obseCoordInspeccion || '',
          obseInspccion: casoObj.obseInspccion || '',
          obseSoliDocu: casoObj.obseSoliDocu || '',
          obseInfoPrelm: casoObj.obseInfoPrelm || '',
          obseInfoFnal: casoObj.obseInfoFnal || '',
          obseRepoActi: casoObj.obseRepoActi || '',
          obseComprmsi: casoObj.obseComprmsi || '',
          obseSegmnto: casoObj.obseSegmnto || '',
          // Anexos
          anexContIni: casoObj.anexContIni || '',
          anexActaInspccion: casoObj.anexActaInspccion || '',
          anexSolDoc: casoObj.anexSolDoc || '',
          anxoInfPrelim: casoObj.anxoInfPrelim || '',
          anxoInfoFnal: casoObj.anxoInfoFnal || '',
          anxoRepoActi: casoObj.anxoRepoActi || '',
          anxoFactra: casoObj.anxoFactra || '',
          anxoHonorarios: casoObj.anxoHonorarios || '',
          anxoHonorariosdefinit: casoObj.anxoHonorariosdefinit || '',
          anxoAutorizacion: casoObj.anxoAutorizacion || '',
          nmroFactra: casoObj.nmroFactra || '',
          // Historial de documentos
          historialDocs: casoObj.historialDocs || [],
          // Campos de timestamps
          createdAt: casoObj.createdAt || null,
          updatedAt: casoObj.updatedAt || null,
          // Campos legacy para compatibilidad (opcional)
          numero_ajuste: casoObj.nmroAjste || '',
          intermediario: casoObj.nombIntermediario || '',
          aseguradora: casoObj.codiAsgrdra || '',
          responsable: casoObj.codiRespnsble || '',
        });
      }
    });
    
    // Agregar siniestros solo si no hay duplicado por número de ajuste
    siniestros.forEach(siniestro => {
      const numeroAjuste = siniestro.nmroAjste || siniestro.numero_ajuste;
      if (numeroAjuste && !casosUnicos.has(String(numeroAjuste))) {
        const siniestroObj = siniestro.toObject ? siniestro.toObject() : siniestro;
        casosUnicos.set(String(numeroAjuste), {
          _id: siniestroObj._id,
          origen: 'siniestro',
          // Mapear campos del modelo CasoComplex (Siniestro) usando nombres correctos
          // Campos principales
          nmroAjste: siniestroObj.nmroAjste || '',
          codWorkflow: siniestroObj.codWorkflow || '',
          nmroSinstro: siniestroObj.nmroSinstro || '',
          nombIntermediario: siniestroObj.nombIntermediario || '',
          codiAsgrdra: siniestroObj.codiAsgrdra || '',
          funcAsgrdra: siniestroObj.funcAsgrdra || '',
          codiRespnsble: siniestroObj.codiRespnsble || '',
          asgrBenfcro: siniestroObj.asgrBenfcro || '',
          codiEstdo: siniestroObj.codiEstdo || '',
          tipoDucumento: siniestroObj.tipoDucumento || '',
          numDocumento: siniestroObj.numDocumento || '',
          tipoPoliza: siniestroObj.tipoPoliza || '',
          nmroPolza: siniestroObj.nmroPolza || '',
          amprAfctdo: siniestroObj.amprAfctdo || '',
          descSinstro: siniestroObj.descSinstro || '',
          ciudadSiniestro: siniestroObj.ciudadSiniestro || '',
          // Fechas (usar nombres del modelo)
          fchaAsgncion: siniestroObj.fchaAsgncion || null,
          fchaInspccion: siniestroObj.fchaInspccion || null,
          fchaContIni: siniestroObj.fchaContIni || null,
          fchaCoordInspeccion: siniestroObj.fchaCoordInspeccion || null,
          fchaProgInspeccion: siniestroObj.fchaProgInspeccion || null,
          fchaSinstro: siniestroObj.fchaSinstro || null,
          fchaSoliDocu: siniestroObj.fchaSoliDocu || siniestroObj.fcha_soli_docu || null,
          fchaInfoPrelm: siniestroObj.fchaInfoPrelm || siniestroObj.fcha_info_prelm || null,
          fchaInfoFnal: siniestroObj.fchaInfoFnal || siniestroObj.fcha_info_fnal || null,
          fchaRepoActi: siniestroObj.fchaRepoActi || siniestroObj.fcha_repo_acti || null,
          fchaPresentacionCifras: siniestroObj.fchaPresentacionCifras || siniestroObj.fcha_presentacion_cifras || null,
          fchaAceptacionCifrasAseguradora: siniestroObj.fchaAceptacionCifrasAseguradora || siniestroObj.fcha_aceptacion_cifras_aseguradora || null,
          fchaEnvioFiniquito: siniestroObj.fchaEnvioFiniquito || siniestroObj.fcha_envio_finiquito || null,
          fchaUltSegui: siniestroObj.fchaUltSegui || siniestroObj.fcha_ult_segui || null,
          fchaActSegui: siniestroObj.fchaActSegui || siniestroObj.fcha_act_segui || null,
          fchaFinqtoIndem: siniestroObj.fchaFinqtoIndem || siniestroObj.fcha_finqto_indem || null,
          fchaFactra: siniestroObj.fchaFactra || siniestroObj.fcha_factra || null,
          fchaUltRevi: siniestroObj.fchaUltRevi || siniestroObj.fcha_ult_revi || null,
          fchaControlHoras: siniestroObj.fchaControlHoras || siniestroObj.fcha_control_horas || null,
          fcha_envio_control_horas: siniestroObj.fcha_envio_control_horas ?? siniestroObj.fchaEnvioControlHoras ?? null,
          fchaEnvioControlHoras: siniestroObj.fchaEnvioControlHoras ?? siniestroObj.fcha_envio_control_horas ?? null,
          fecha_envio_control_horas: siniestroObj.fecha_envio_control_horas ?? siniestroObj.fcha_envio_control_horas ?? null,
          fcha_recibido_control_horas: siniestroObj.fcha_recibido_control_horas ?? siniestroObj.fchaRecibidoControlHoras ?? null,
          fchaRecibidoControlHoras: siniestroObj.fchaRecibidoControlHoras ?? siniestroObj.fcha_recibido_control_horas ?? null,
          fecha_recibido_control_horas: siniestroObj.fecha_recibido_control_horas ?? siniestroObj.fcha_recibido_control_horas ?? null,
          fcha_seguimiento_envio_control_horas: siniestroObj.fcha_seguimiento_envio_control_horas ?? siniestroObj.fchaSeguimientoEnvioControlHoras ?? null,
          fchaSeguimientoEnvioControlHoras: siniestroObj.fchaSeguimientoEnvioControlHoras ?? siniestroObj.fcha_seguimiento_envio_control_horas ?? null,
          fecha_seguimiento_envio_control_horas: siniestroObj.fecha_seguimiento_envio_control_horas ?? siniestroObj.fcha_seguimiento_envio_control_horas ?? null,
          // Valores numéricos
          diasTranscrrdo: siniestroObj.diasTranscrrdo || siniestroObj.dias_transcrrdo || null,
          vlorResrva: siniestroObj.vlorResrva || siniestroObj.vlor_resrva || null,
          vlorReclmo: siniestroObj.vlorReclmo || siniestroObj.vlor_reclmo || null,
          montoIndmzar: siniestroObj.montoIndmzar || siniestroObj.monto_indmzar || null,
          vlorServcios: siniestroObj.vlorServcios || siniestroObj.vlor_servcios || null,
          vlorGastos: siniestroObj.vlorGastos || siniestroObj.vlor_gastos || null,
          total: siniestroObj.total || null,
          iva: siniestroObj.iva || null,
          reteiva: siniestroObj.reteiva || null,
          retefuente: siniestroObj.retefuente || null,
          reteica: siniestroObj.reteica || null,
          totalGeneral: siniestroObj.totalGeneral || siniestroObj.total_general || null,
          totalPagado: siniestroObj.totalPagado || siniestroObj.total_pagado || null,
          porcIva: siniestroObj.porcIva || siniestroObj.porc_iva || null,
          porcReteiva: siniestroObj.porcReteiva || siniestroObj.porc_reteiva || null,
          porcRetefuente: siniestroObj.porcRetefuente || siniestroObj.porc_retefuente || null,
          porcReteica: siniestroObj.porcReteica || siniestroObj.porc_reteica || null,
          // Observaciones
          obseContIni: siniestroObj.obseContIni || siniestroObj.obse_cont_ini || '',
          obseCoordInspeccion: siniestroObj.obseCoordInspeccion || siniestroObj.obse_coord_inspeccion || '',
          obseInspccion: siniestroObj.obseInspccion || siniestroObj.obse_inspccion || '',
          obseSoliDocu: siniestroObj.obseSoliDocu || siniestroObj.obse_soli_docu || '',
          obseInfoPrelm: siniestroObj.obseInfoPrelm || siniestroObj.obse_info_prelm || '',
          obseInfoFnal: siniestroObj.obseInfoFnal || siniestroObj.obse_info_fnal || '',
          obseRepoActi: siniestroObj.obseRepoActi || siniestroObj.obse_repo_acti || '',
          obsePresentacionCifras: siniestroObj.obsePresentacionCifras || siniestroObj.obse_presentacion_cifras || '',
          obseEnvioFiniquito: siniestroObj.obseEnvioFiniquito || siniestroObj.obse_envio_finiquito || '',
          obseComprmsi: siniestroObj.obseComprmsi || siniestroObj.obse_comprmsi || '',
          obseSegmnto: siniestroObj.obseSegmnto || siniestroObj.obse_segmnto || '',
          // Anexos
          anexContIni: siniestroObj.anexContIni || siniestroObj.anex_cont_ini || '',
          anexActaInspccion: siniestroObj.anexActaInspccion || siniestroObj.anex_acta_inspccion || '',
          anexSolDoc: siniestroObj.anexSolDoc || siniestroObj.anex_sol_doc || '',
          anxoInfPrelim: siniestroObj.anxoInfPrelim || siniestroObj.anxo_inf_prelim || '',
          anxoInfoFnal: siniestroObj.anxoInfoFnal || siniestroObj.anxo_info_fnal || '',
          anxoRepoActi: siniestroObj.anxoRepoActi || siniestroObj.anxo_repo_acti || '',
          anxoPresentacionCifras: siniestroObj.anxoPresentacionCifras || siniestroObj.anxo_presentacion_cifras || '',
          anxoEnvioFiniquito: siniestroObj.anxoEnvioFiniquito || siniestroObj.anxo_envio_finiquito || '',
          anxoFactra: siniestroObj.anxoFactra || siniestroObj.anxo_factra || '',
          anxoHonorarios: siniestroObj.anxoHonorarios || siniestroObj.anxo_honorarios || '',
          anxoHonorariosdefinit: siniestroObj.anxoHonorariosdefinit || siniestroObj.anxo_honorariosdefinit || '',
          anxoAutorizacion: siniestroObj.anxoAutorizacion || siniestroObj.anxo_autorizacion || '',
          nmroFactra: siniestroObj.nmroFactra || siniestroObj.nmro_factra || '',
          // Historial de documentos
          historialDocs: siniestroObj.historialDocs || [],
          // Campos de timestamps
          createdAt: siniestroObj.createdAt || null,
          updatedAt: siniestroObj.updatedAt || null,
          // Campos legacy para compatibilidad (opcional)
          numero_ajuste: siniestroObj.nmroAjste || '',
          intermediario: siniestroObj.nombIntermediario || '',
          aseguradora: siniestroObj.codiAsgrdra || '',
          responsable: siniestroObj.codiRespnsble || '',
        });
      }
    });
    
    // Convertir el Map a array y ordenar por fecha de creación
    let casosFinales = Array.from(casosUnicos.values()).sort((a, b) => {
      const fechaA = new Date(a.creado_en || a.fecha_asignacion || a.fchaAsgncion || 0);
      const fechaB = new Date(b.creado_en || b.fecha_asignacion || b.fchaAsgncion || 0);
      return fechaB - fechaA; // Orden descendente (más nuevo primero)
    });
    
    // Enriquecer casos con nombreResponsable (igual que en siniestroController.js)
    let sinAsignar = 0;
    let conAsignar = 0;
    casosFinales = casosFinales.map(caso => {
      // Responsable - intentar múltiples variantes
      let nombreResponsable = 'Sin asignar';
      if (caso.codiRespnsble) {
        const codResp = String(caso.codiRespnsble).trim().toUpperCase();
        const codRespSinEspacios = codResp.replace(/\s+/g, '');
        nombreResponsable = mapaResponsables[codResp] || 
                          mapaResponsables[codRespSinEspacios] || 
                          'Sin asignar';
      }
      
      if (nombreResponsable === 'Sin asignar') {
        sinAsignar++;
      } else {
        conAsignar++;
      }
      
      return {
        ...caso,
        nombreResponsable,
        codiRespnsbleOriginal: caso.codiRespnsble // Para debug
      };
    });
    
    console.log(`📊 Resumen de enriquecimiento: ${conAsignar} con responsable, ${sinAsignar} sin asignar de ${casosFinales.length} total`);
    
    console.log('📊 Total casos únicos después de eliminar duplicados:', casosFinales.length);
    console.log('📊 Casos Complex:', casosFinales.filter(c => c.origen === 'complex').length);
    console.log('📊 Casos Siniestro:', casosFinales.filter(c => c.origen === 'siniestro').length);
    
    // Log de algunos casos para verificar
    if (casosFinales.length > 0) {
      console.log('🧪 Primer caso final:', {
        numero_ajuste: casosFinales[0].numero_ajuste || casosFinales[0].nmroAjste,
        origen: casosFinales[0].origen,
        intermediario: casosFinales[0].intermediario || casosFinales[0].nombIntermediario,
        codiRespnsble: casosFinales[0].codiRespnsble,
        nombreResponsable: casosFinales[0].nombreResponsable
      });
    }

    // Asegurar que siempre retornemos un array
    const respuestaFinal = Array.isArray(casosFinales) ? casosFinales : [];
    
    console.log('📤 Enviando respuesta al frontend:');
    console.log('   - Tipo:', Array.isArray(respuestaFinal) ? 'Array' : typeof respuestaFinal);
    console.log('   - Cantidad de casos:', respuestaFinal.length);
    
    res.json(respuestaFinal);
  } catch (error) {
    console.error('❌ Error al obtener los casos:', error);
    console.error('❌ Stack trace:', error.stack);
    // Retornar array vacío en lugar de error para que el frontend no se rompa
    res.status(500).json([]);
  }
};

// Obtener un caso por ID
export const obtenerPorId = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Identificador de caso no válido' });
    }
    const caso = await Complex.findById(id);
    if (!caso) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json(enriquecerCasoComplexParaFrontend(caso));
  } catch (error) {
    console.error('❌ Error al obtener el caso por ID:', error);
    res.status(500).json({ error: 'Error al obtener el caso' });
  }
};

// Obtener datos mapeados para autollenado de ajuste
export const obtenerAutofillAjuste = async (req, res) => {
  try {
    const idCaso = String(req.params.idCaso || '').trim();
    if (!idCaso) {
      return res.status(400).json({ error: 'Debes enviar un identificador de caso válido' });
    }

    let caso = await Complex.findOne({
      $or: [
        { nmroSinstro: idCaso },
        { nmroAjste: idCaso },
        { codWorkflow: idCaso }
      ]
    }).sort({ createdAt: -1, _id: -1 });

    // Fallback a colección de siniestros cuando no exista en Complex
    if (!caso) {
      caso = await Siniestro.findOne({
        $or: [
          { nmroSinstro: idCaso },
          { nmroAjste: idCaso },
          { codWorkflow: idCaso }
        ]
      }).sort({ createdAt: -1, _id: -1 });
    }

    if (!caso && mongoose.Types.ObjectId.isValid(idCaso)) {
      caso = await Complex.findById(idCaso);
      if (!caso) {
        caso = await Siniestro.findById(idCaso);
      }
    }

    if (!caso) {
      return res.status(404).json({ error: 'Caso no encontrado para autollenado' });
    }

    const data = await mapearCasoAjuste(caso);
    const campos = Object.keys(data).filter((k) => k !== 'metadata');
    const camposConValor = campos.filter((k) => String(data[k] || '').trim() !== '');
    const metadataConValor = Object.entries(data.metadata || {})
      .filter(([, valor]) => String(valor || '').trim() !== '')
      .map(([clave]) => `metadata.${clave}`);
    const completados = [...camposConValor, ...metadataConValor];

    return res.json({
      source: 'complex',
      fetchedAt: new Date().toISOString(),
      partial: completados.length < (campos.length + 3),
      data,
      meta: {
        idCaso: caso._id,
        origenConsulta: idCaso,
        camposCompletados: completados
      }
    });
  } catch (error) {
    console.error('❌ Error en obtenerAutofillAjuste:', error);
    return res.status(500).json({ error: 'Error al obtener datos de autollenado' });
  }
};

// Actualizar un caso
export const actualizarComplex = async (req, res) => {
  try {
    console.log('🔄 ===== INICIANDO ACTUALIZACIÓN DE COMPLEX =====');
    console.log('📝 DATOS RECIBIDOS EN actualizarComplex:', JSON.stringify(req.body, null, 2));
    
    const { vlorResrva, vlorReclmo, montoIndmzar, total, totalGeneral, totalPagado } = req.body;
    console.log('📊 Valores numéricos recibidos:', {
      vlorResrva, vlorReclmo, montoIndmzar, total, totalGeneral, totalPagado,
      vlor_resrva: req.body.vlor_resrva,
      vlor_reclmo: req.body.vlor_reclmo,
      monto_indmzar: req.body.monto_indmzar
    });

    const numericFields = [
      'vlorResrva', 'vlorReclmo', 'montoIndmzar',
      'total', 'totalGeneral', 'totalPagado',
      'porcIva', 'porcReteiva', 'porcRetefuente', 'porcReteica',
      'vlor_servcios', 'vlor_gastos', 'vlorServcios', 'vlorGastos'
    ];
 
    console.log('📊 Campos numéricos antes de normalizar:', numericFields.reduce((acc, field) => {
      const camel = field;
      const snake = field.includes('_') ? field : field.replace(/([A-Z])/g, '_$1').toLowerCase();
      acc[camel] = req.body[camel];
      acc[snake] = req.body[snake];
      return acc;
    }, {}));

    numericFields.forEach((field) => {
      const cam = field;
      const snake = field.includes('_') ? field : field.replace(/([A-Z])/g, '_$1').toLowerCase();

      [cam, snake].forEach((key) => {
        if (req.body[key] !== undefined && req.body[key] !== null && req.body[key] !== '') {
          const parsed = Number(req.body[key]);
          if (!Number.isNaN(parsed)) {
            req.body[key] = parsed;
          }
        }
      });
    });
 
    console.log('📊 Campos numéricos después de normalizar:', numericFields.reduce((acc, field) => {
      const camel = field;
      const snake = field.includes('_') ? field : field.replace(/([A-Z])/g, '_$1').toLowerCase();
      acc[camel] = req.body[camel];
      acc[snake] = req.body[snake];
      return acc;
    }, {}));

    // Convertir todas las fechas a Date local para evitar problemas de zona horaria
    const datosParaActualizar = convertirFechasEnDatos(req.body);
    
    // Log específico para fcha_control_horas
    console.log('📅 [actualizarComplex] Verificando fcha_control_horas:', {
      en_req_body: req.body.fecha_control_horas || req.body.fchaControlHoras || req.body.fcha_control_horas,
      en_datosParaActualizar: datosParaActualizar.fcha_control_horas,
      todas_las_variantes: {
        fecha_control_horas: req.body.fecha_control_horas,
        fchaControlHoras: req.body.fchaControlHoras,
        fcha_control_horas: req.body.fcha_control_horas,
        fechaControlHoras: req.body.fechaControlHoras
      }
    });
    
    // Log específico para fcha_envio_control_horas
    console.log('📅 [actualizarComplex] Verificando fcha_envio_control_horas:', {
      en_req_body: req.body.fecha_envio_control_horas || req.body.fchaEnvioControlHoras || req.body.fcha_envio_control_horas,
      en_datosParaActualizar: datosParaActualizar.fcha_envio_control_horas,
      todas_las_variantes: {
        fecha_envio_control_horas: req.body.fecha_envio_control_horas,
        fchaEnvioControlHoras: req.body.fchaEnvioControlHoras,
        fcha_envio_control_horas: req.body.fcha_envio_control_horas,
        fechaEnvioControlHoras: req.body.fechaEnvioControlHoras
      }
    });
    
    // Asegurar que descripcionEstado, observacionesPendientes e historialDocs se incluyan
    console.log('🔍 [actualizarComplex] Verificando campos especiales:', {
      descripcionEstado_en_req: req.body.descripcionEstado,
      observacionesPendientes_en_req: req.body.observacionesPendientes,
      historialDocs_en_req: req.body.historialDocs ? `Array con ${req.body.historialDocs.length} elementos` : 'vacío o undefined'
    });
    
    if (req.body.descripcionEstado !== undefined) {
      datosParaActualizar.descripcionEstado = req.body.descripcionEstado;
      console.log('✅ [actualizarComplex] descripcionEstado agregado:', datosParaActualizar.descripcionEstado);
    } else {
      console.log('⚠️ [actualizarComplex] descripcionEstado no está en req.body');
    }
    
    if (req.body.observacionesPendientes !== undefined) {
      datosParaActualizar.observacionesPendientes = req.body.observacionesPendientes;
      console.log('✅ [actualizarComplex] observacionesPendientes agregado:', datosParaActualizar.observacionesPendientes);
    } else {
      console.log('⚠️ [actualizarComplex] observacionesPendientes no está en req.body');
    }
    
    if (req.body.historialDocs !== undefined) {
      // Preservar historialDocs tal cual viene, sin procesar fechas
      // Las fechas dentro de historialDocs deben mantenerse como están
      datosParaActualizar.historialDocs = Array.isArray(req.body.historialDocs) 
        ? req.body.historialDocs.map(doc => {
            // Preservar todos los campos del documento, especialmente las fechas
            // Prioridad: fechaCreacion (fecha original del documento) > fecha > fechaSubida
            return {
              ...doc, // Preservar todos los campos originales primero
              // Asegurar que las fechas se preserven con prioridad a fechaCreacion
              fechaCreacion: doc.fechaCreacion || undefined, // Fecha de creación del documento (no reemplazar si no existe)
              fecha: doc.fecha || doc.fechaCreacion || doc.fechaSubida || undefined, // Fecha principal
              fechaSubida: doc.fechaSubida || undefined, // Fecha de subida (no reemplazar si no existe)
            };
          })
        : req.body.historialDocs;
      console.log('✅ [actualizarComplex] historialDocs agregado:', datosParaActualizar.historialDocs ? `Array con ${datosParaActualizar.historialDocs.length} elementos` : 'vacío');
      console.log('📅 [actualizarComplex] Primer documento de historialDocs:', datosParaActualizar.historialDocs && datosParaActualizar.historialDocs[0] ? {
        tipo: datosParaActualizar.historialDocs[0].tipo,
        nombre: datosParaActualizar.historialDocs[0].nombre,
        fecha: datosParaActualizar.historialDocs[0].fecha,
        fechaSubida: datosParaActualizar.historialDocs[0].fechaSubida,
        fechaCreacion: datosParaActualizar.historialDocs[0].fechaCreacion
      } : 'sin documentos');
    } else {
      console.log('⚠️ [actualizarComplex] historialDocs no está en req.body');
    }
    
    // Log detallado de todas las fechas de trazabilidad
    const fechasTrazabilidadRecibidas = ['fchaContIni', 'fchaCoordInspeccion', 'fchaProgInspeccion', 'fchaInspccion', 'fchaSoliDocu', 'fchaInfoPrelm', 'fchaInfoFnal', 'fchaRepoActi'];
    console.log('📅 [actualizarComplex] Fechas de trazabilidad recibidas:', 
      fechasTrazabilidadRecibidas.reduce((acc, campo) => {
        acc[campo] = {
          enReqBody: req.body[campo],
          enDatosParaActualizar: datosParaActualizar[campo],
          tipo: typeof req.body[campo]
        };
        return acc;
      }, {})
    );
    
    console.log('📅 Fechas convertidas en actualizarComplex:', Object.keys(datosParaActualizar)
      .filter(key => key.startsWith('fcha'))
      .map(campo => ({
        campo,
        original: req.body[campo],
        convertida: datosParaActualizar[campo]
      }))
      .filter(f => f.original));

    // Obtener el caso ANTES de actualizarlo para comparar cambios
    const casoAnterior = await Complex.findById(req.params.id);
    if (!casoAnterior) return res.status(404).json({ error: 'Caso no encontrado' });
    
    // Manejar historialDocs: si viene en el payload, usarlo; si no, preservar el existente
    if (datosParaActualizar.historialDocs === undefined) {
      if (casoAnterior.historialDocs) {
      datosParaActualizar.historialDocs = casoAnterior.historialDocs;
      console.log('💾 [actualizarComplex] Preservando historialDocs existente:', casoAnterior.historialDocs.length, 'documentos');
      } else {
        datosParaActualizar.historialDocs = [];
        console.log('💾 [actualizarComplex] Inicializando historialDocs vacío');
      }
    } else {
      console.log('💾 [actualizarComplex] Usando historialDocs del payload:', Array.isArray(datosParaActualizar.historialDocs) ? datosParaActualizar.historialDocs.length : 'no es array', 'documentos');
    }
    
    // Log antes de guardar
    console.log('💾 [actualizarComplex] Guardando fcha_control_horas:', datosParaActualizar.fcha_control_horas);
    console.log('💾 [actualizarComplex] Todos los campos de fecha en datosParaActualizar:', 
      Object.keys(datosParaActualizar).filter(k => k.includes('fcha') || k.includes('fecha')).map(k => ({
        campo: k,
        valor: datosParaActualizar[k]
      }))
    );
    
    // Asegurar que fcha_control_horas se incluya explícitamente
    if (datosParaActualizar.fcha_control_horas !== undefined) {
      console.log('🔧 [actualizarComplex] Forzando fcha_control_horas en datosParaActualizar:', datosParaActualizar.fcha_control_horas);
    }
    
    // Log del objeto completo antes de guardar
    console.log('💾 [actualizarComplex] Objeto completo a guardar (primeros 20 campos):', 
      Object.keys(datosParaActualizar).slice(0, 20).reduce((acc, key) => {
        acc[key] = datosParaActualizar[key];
        return acc;
      }, {})
    );
    console.log('💾 [actualizarComplex] ¿fcha_control_horas en datosParaActualizar?', 'fcha_control_horas' in datosParaActualizar);
    console.log('💾 [actualizarComplex] Valor de fcha_control_horas:', datosParaActualizar.fcha_control_horas);
    
    // NORMALIZAR TODOS LOS CAMPOS DE FACTURACIÓN
    // El modelo Complex usa camelCase (vlorServcios, vlorGastos, fchaFactra, fchaUltRevi)
    // EXCEPTO fcha_control_horas que se mantiene en snake_case
    const updateData = { ...datosParaActualizar };
    
    // Mapeo de campos de facturación: variantes -> nombres del schema Complex (camelCase)
    const camposFacturacion = {
      // Fechas - fcha_control_horas se mantiene en snake_case
      'fchaControlHoras': 'fcha_control_horas',
      'fechaControlHoras': 'fcha_control_horas',
      'fecha_control_horas': 'fcha_control_horas',
      // Fecha de envío control de horas (Gerencia) - snake_case
      'fchaEnvioControlHoras': 'fcha_envio_control_horas',
      'fechaEnvioControlHoras': 'fcha_envio_control_horas',
      'fecha_envio_control_horas': 'fcha_envio_control_horas',
      // Fecha de recibido control de horas (Gerencia) - snake_case
      'fchaRecibidoControlHoras': 'fcha_recibido_control_horas',
      'fechaRecibidoControlHoras': 'fcha_recibido_control_horas',
      'fecha_recibido_control_horas': 'fcha_recibido_control_horas',
      // Fecha de seguimiento de envío control de horas - snake_case
      'fchaSeguimientoEnvioControlHoras': 'fcha_seguimiento_envio_control_horas',
      'fechaSeguimientoEnvioControlHoras': 'fcha_seguimiento_envio_control_horas',
      'fecha_seguimiento_envio_control_horas': 'fcha_seguimiento_envio_control_horas',
      // Observaciones de seguimiento de envío control de horas
      'obseSeguimientoEnvioControlHoras': 'obse_seguimiento_envio_control_horas',
      'observacionSeguimientoEnvioControlHoras': 'obse_seguimiento_envio_control_horas',
      'observacion_seguimiento_envio_control_horas': 'obse_seguimiento_envio_control_horas',
      // Adjunto de seguimiento de envío control de horas
      'anxoSeguimientoEnvioControlHoras': 'anxo_seguimiento_envio_control_horas',
      'adjuntoSeguimientoEnvioControlHoras': 'anxo_seguimiento_envio_control_horas',
      'adjunto_seguimiento_envio_control_horas': 'anxo_seguimiento_envio_control_horas',
      // Fechas que usan camelCase en el schema
      'fcha_factra': 'fchaFactra',
      'fechaFactura': 'fchaFactra',
      'fecha_factura': 'fchaFactra',
      'fcha_ult_revi': 'fchaUltRevi',
      'fechaUltimaRevision': 'fchaUltRevi',
      'fecha_ultima_revision': 'fchaUltRevi',
      // Adjunto de evidencia (Gerencia) - camelCase
      'anxoEvidencia': 'anxoEvidencia',
      'adjunto_evidencia': 'anxoEvidencia',
      // Valores numéricos - el schema usa camelCase
      'vlor_servcios': 'vlorServcios',
      'valorServicio': 'vlorServcios',
      'valor_servicio': 'vlorServcios',
      'vlor_gastos': 'vlorGastos',
      'valorGastos': 'vlorGastos',
      'valor_gastos': 'vlorGastos',
      // Número de factura
      'numeroFactura': 'nmroFactra',
      'numero_factura': 'nmroFactra'
    };
    
    // Normalizar todos los campos de facturación
    Object.keys(camposFacturacion).forEach(variante => {
      const campoSchema = camposFacturacion[variante];
      if (updateData[variante] !== undefined && updateData[variante] !== null && updateData[variante] !== '') {
        // Si el campo del schema no existe o está vacío, usar la variante
        if (updateData[campoSchema] === undefined || updateData[campoSchema] === null || updateData[campoSchema] === '') {
          updateData[campoSchema] = updateData[variante];
        }
        // Eliminar la variante si es diferente al campo del schema
        if (variante !== campoSchema) {
          delete updateData[variante];
        }
      }
    });
    
    // Asegurar que fcha_control_horas esté presente si viene en alguna variante
    if (updateData.fcha_control_horas === undefined) {
      if (updateData.fchaControlHoras !== undefined) {
        updateData.fcha_control_horas = updateData.fchaControlHoras;
        delete updateData.fchaControlHoras;
      } else if (updateData.fechaControlHoras !== undefined) {
        updateData.fcha_control_horas = updateData.fechaControlHoras;
        delete updateData.fechaControlHoras;
      }
    }
    
    // Asegurar que fcha_envio_control_horas esté presente si viene en alguna variante
    if (updateData.fcha_envio_control_horas === undefined) {
      if (updateData.fchaEnvioControlHoras !== undefined) {
        updateData.fcha_envio_control_horas = updateData.fchaEnvioControlHoras;
        delete updateData.fchaEnvioControlHoras;
      } else if (updateData.fechaEnvioControlHoras !== undefined) {
        updateData.fcha_envio_control_horas = updateData.fechaEnvioControlHoras;
        delete updateData.fechaEnvioControlHoras;
      } else if (updateData.fecha_envio_control_horas !== undefined) {
        // Ya está en el formato correcto, solo asegurar que se use
        updateData.fcha_envio_control_horas = updateData.fecha_envio_control_horas;
      }
    }
    
    // Asegurar que fcha_recibido_control_horas esté presente si viene en alguna variante
    if (updateData.fcha_recibido_control_horas === undefined) {
      if (updateData.fchaRecibidoControlHoras !== undefined) {
        updateData.fcha_recibido_control_horas = updateData.fchaRecibidoControlHoras;
        delete updateData.fchaRecibidoControlHoras;
      } else if (updateData.fechaRecibidoControlHoras !== undefined) {
        updateData.fcha_recibido_control_horas = updateData.fechaRecibidoControlHoras;
        delete updateData.fechaRecibidoControlHoras;
      } else if (updateData.fecha_recibido_control_horas !== undefined) {
        updateData.fcha_recibido_control_horas = updateData.fecha_recibido_control_horas;
      }
    }

    // Asegurar que fcha_seguimiento_envio_control_horas esté presente si viene en alguna variante
    if (updateData.fcha_seguimiento_envio_control_horas === undefined) {
      if (updateData.fchaSeguimientoEnvioControlHoras !== undefined) {
        updateData.fcha_seguimiento_envio_control_horas = updateData.fchaSeguimientoEnvioControlHoras;
        delete updateData.fchaSeguimientoEnvioControlHoras;
      } else if (updateData.fechaSeguimientoEnvioControlHoras !== undefined) {
        updateData.fcha_seguimiento_envio_control_horas = updateData.fechaSeguimientoEnvioControlHoras;
        delete updateData.fechaSeguimientoEnvioControlHoras;
      } else if (updateData.fecha_seguimiento_envio_control_horas !== undefined) {
        // Ya está en el formato correcto, solo asegurar que se use
        updateData.fcha_seguimiento_envio_control_horas = updateData.fecha_seguimiento_envio_control_horas;
      }
    }
    
    // Limpiar todas las variantes duplicadas
    delete updateData.fchaControlHoras;
    delete updateData.fechaControlHoras;
    delete updateData.fchaEnvioControlHoras;
    delete updateData.fechaEnvioControlHoras;
    delete updateData.fecha_envio_control_horas;
    delete updateData.fchaRecibidoControlHoras;
    delete updateData.fechaRecibidoControlHoras;
    delete updateData.fecha_recibido_control_horas;
    delete updateData.fchaSeguimientoEnvioControlHoras;
    delete updateData.fechaSeguimientoEnvioControlHoras;
    delete updateData.fechaFactura;
    delete updateData.fecha_ultima_revision;
    delete updateData.fechaUltimaRevision;
    delete updateData.valorServicio;
    delete updateData.valor_servicio;
    delete updateData.valorGastos;
    delete updateData.valor_gastos;
    
    console.log('🔧 [actualizarComplex] updateData final - fcha_control_horas:', updateData.fcha_control_horas);
    console.log('🔧 [actualizarComplex] updateData final - fcha_envio_control_horas:', updateData.fcha_envio_control_horas);
    console.log('🔧 [actualizarComplex] Campos de fecha en updateData:', 
      Object.keys(updateData).filter(k => k.includes('fcha') || k.includes('fecha')).map(k => `${k}: ${updateData[k]}`)
    );
    
    if (updateData.codiEstdo !== undefined) {
      if (!validarCodiEstdoObligatorio(updateData, res)) {
        return;
      }
      updateData.codiEstdo = extraerCodiEstdoDeBody(updateData);
    }

    // Asegurar que codiRespnsble no se borre si no viene en el updateData
    if (updateData.codiRespnsble === undefined || updateData.codiRespnsble === null || updateData.codiRespnsble === '') {
      // Si no viene codiRespnsble en el updateData, no incluirlo para preservar el valor existente
      delete updateData.codiRespnsble;
      console.log('🔧 [actualizarComplex] Preservando codiRespnsble existente (no viene en updateData)');
    } else {
      console.log('🔧 [actualizarComplex] Actualizando codiRespnsble:', updateData.codiRespnsble);
    }
    
    const anteriorObj = casoAnterior.toObject?.() ?? casoAnterior;
    const siguienteObj = { ...anteriorObj, ...updateData };
    await deleteOrphanedStoredFiles(
      collectPathsFromComplexRecord(anteriorObj),
      collectPathsFromComplexRecord(siguienteObj)
    ).catch((err) => {
      console.warn('⚠️ No se pudieron eliminar adjuntos huérfanos del caso Complex:', err.message);
    });

    const casoActualizado = await Complex.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: false }
    );
    
    if (!casoActualizado) return res.status(404).json({ error: 'Caso no encontrado' });
    
    // Verificar que se guardó
    console.log('✅ [actualizarComplex] Caso actualizado. fcha_control_horas guardado:', casoActualizado.fcha_control_horas);
    console.log('✅ [actualizarComplex] Caso actualizado. fcha_envio_control_horas guardado:', casoActualizado.fcha_envio_control_horas);
    console.log('✅ [actualizarComplex] Caso actualizado. fcha_recibido_control_horas guardado:', casoActualizado.fcha_recibido_control_horas);
    console.log('✅ [actualizarComplex] Caso actualizado. codiRespnsble guardado:', casoActualizado.codiRespnsble);
    
    // Verificar explícitamente que fcha_envio_control_horas se guardó
    if (casoActualizado.fcha_envio_control_horas) {
      console.log('✅✅✅ [actualizarComplex] CONFIRMADO: fcha_envio_control_horas está en la BD:', casoActualizado.fcha_envio_control_horas);
    } else {
      console.log('⚠️⚠️⚠️ [actualizarComplex] ADVERTENCIA: fcha_envio_control_horas NO está en la BD después de guardar');
    }
    if (casoActualizado.fcha_recibido_control_horas) {
      console.log('✅✅✅ [actualizarComplex] CONFIRMADO: fcha_recibido_control_horas está en la BD:', casoActualizado.fcha_recibido_control_horas);
    }
    
    // Verificar que historialDocs se haya guardado correctamente con sus fechas
    if (casoActualizado.historialDocs && Array.isArray(casoActualizado.historialDocs)) {
      console.log('📋 [actualizarComplex] historialDocs después de guardar:', {
        totalDocumentos: casoActualizado.historialDocs.length,
        primerDocumento: casoActualizado.historialDocs[0] ? {
          tipo: casoActualizado.historialDocs[0].tipo,
          nombre: casoActualizado.historialDocs[0].nombre,
          fecha: casoActualizado.historialDocs[0].fecha,
          fechaSubida: casoActualizado.historialDocs[0].fechaSubida,
          fechaCreacion: casoActualizado.historialDocs[0].fechaCreacion
        } : 'sin documentos'
      });
    }
    
    // Verificar que las fechas de trazabilidad se hayan guardado correctamente
    const fechasTrazabilidadGuardadas = ['fchaContIni', 'fchaCoordInspeccion', 'fchaProgInspeccion', 'fchaInspccion', 'fchaSoliDocu', 'fchaInfoPrelm', 'fchaInfoFnal', 'fchaRepoActi'];
    console.log('📅 [actualizarComplex] Fechas de trazabilidad guardadas en BD:', 
      fechasTrazabilidadGuardadas.reduce((acc, campo) => {
        acc[campo] = casoActualizado[campo];
        return acc;
      }, {})
    );
    
    console.log('✅ COMPLEX ACTUALIZADO EXITOSAMENTE:', JSON.stringify(casoActualizado, null, 2));
    console.log('📊 Valores guardados en BD:', {
      vlorResrva: casoActualizado.vlorResrva,
      vlorReclmo: casoActualizado.vlorReclmo,
      montoIndmzar: casoActualizado.montoIndmzar,
      total: casoActualizado.total,
      totalGeneral: casoActualizado.totalGeneral,
      totalPagado: casoActualizado.totalPagado
    });
    
         // 📧 ENVIAR NOTIFICACIONES POR EMAIL SI HAY CAMBIOS RELEVANTES
     try {
       console.log('📧 Verificando si se deben enviar notificaciones...');
       console.log('📧 Caso anterior - Responsable:', casoAnterior.codiRespnsble);
       console.log('📧 Caso actualizado - Responsable:', casoActualizado.codiRespnsble);
       
               // Solo enviar notificaciones si hay cambios en campos relevantes
                 const camposRelevantes = ['codiRespnsble', 'codiAsgrdra', 'codiEstdo', 'funcAsgrdra'];
         const hayCambiosRelevantes = camposRelevantes.some(campo => {
           const valorAnterior = casoAnterior[campo];
           const valorNuevo = casoActualizado[campo];
           const cambio = valorAnterior !== valorNuevo && valorNuevo !== undefined && valorNuevo !== null && valorNuevo !== '';
           if (cambio) {
             console.log(`📧 Cambio detectado en ${campo}: "${valorAnterior}" → "${valorNuevo}"`);
           }
           return cambio;
         });
         
         // Verificar específicamente si se está ASIGNANDO un caso (cambiando responsable)
         const seAsignoCaso = casoAnterior.codiRespnsble !== casoActualizado.codiRespnsble && 
                              casoActualizado.codiRespnsble && 
                              casoActualizado.codiRespnsble !== '';
         
         if (seAsignoCaso) {
           console.log('📧 ⚠️ ASIGNACIÓN DE CASO DETECTADA - Se enviará notificación de asignación');
         }
       
       if (hayCambiosRelevantes || seAsignoCaso) {
         console.log('📧 Cambios relevantes detectados, enviando notificaciones...');
         
         // Obtener email del responsable desde la base de datos
         let emailResponsable = '';
         let nombreResponsableCompleto = casoActualizado.codiRespnsble || 'Sin asignar';
         
         console.log('🔍 🔍 🔍 ===== INICIANDO BÚSQUEDA DE RESPONSABLE ===== 🔍 🔍 🔍');
         console.log('🔍 casoActualizado.codiRespnsble:', casoActualizado.codiRespnsble);
         console.log('🔍 Tipo de codiRespnsble:', typeof casoActualizado.codiRespnsble);
         console.log('🔍 casoActualizado completo (keys):', Object.keys(casoActualizado));
         console.log('🔍 casoActualizado completo (JSON):', JSON.stringify(casoActualizado, null, 2));
         
         if (casoActualizado.codiRespnsble) {
             try {
               const valorBuscado = String(casoActualizado.codiRespnsble).trim();
               console.log('🔍 Valor a buscar (normalizado):', valorBuscado);
               console.log('🔍 Longitud del valor:', valorBuscado.length);
               
               // Primero intentar búsqueda exacta por código (sin regex, más rápido)
               console.log('🔍 Intentando búsqueda exacta por codiRespnsble...');
               let responsableDB = await mongoose.model('Responsable').findOne({ 
                 codiRespnsble: valorBuscado
               });
               
               console.log('🔍 Búsqueda exacta por codiRespnsble:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
               if (responsableDB) {
                 console.log('🔍 Responsable encontrado (código):', {
                   codiRespnsble: responsableDB.codiRespnsble,
                   nmbrRespnsble: responsableDB.nmbrRespnsble,
                   email: responsableDB.email
                 });
               }
               
               // Si no se encuentra, buscar por nombre (por si se guardó el nombre en lugar del código)
               if (!responsableDB) {
                 console.log('🔍 Intentando búsqueda exacta por nombre (nmbrRespnsble)...');
                 responsableDB = await mongoose.model('Responsable').findOne({ 
                   nmbrRespnsble: valorBuscado
                 });
                 console.log('🔍 Búsqueda exacta por nmbrRespnsble:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
                 if (responsableDB) {
                   console.log('🔍 Responsable encontrado (nombre):', {
                     codiRespnsble: responsableDB.codiRespnsble,
                     nmbrRespnsble: responsableDB.nmbrRespnsble,
                     email: responsableDB.email
                   });
                 }
               }
               
               // Si aún no se encuentra, buscar con regex (case insensitive) por código
               if (!responsableDB) {
                 console.log('🔍 Intentando búsqueda con regex (case insensitive) por código...');
                 const valorEscapado = valorBuscado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                 responsableDB = await mongoose.model('Responsable').findOne({ 
                   codiRespnsble: { $regex: new RegExp(`^${valorEscapado}$`, 'i') }
                 });
                 console.log('🔍 Búsqueda regex por codiRespnsble:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
               }
               
               // Si aún no se encuentra, buscar con regex (case insensitive) por nombre
               if (!responsableDB) {
                 console.log('🔍 Intentando búsqueda con regex (case insensitive) por nombre...');
                 const valorEscapado = valorBuscado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                 responsableDB = await mongoose.model('Responsable').findOne({ 
                   nmbrRespnsble: { $regex: new RegExp(`^${valorEscapado}$`, 'i') }
                 });
                 console.log('🔍 Búsqueda regex por nmbrRespnsble:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
               }
               
               // Si aún no se encuentra, buscar parcialmente por código
               if (!responsableDB) {
                 console.log('🔍 Intentando búsqueda parcial por código...');
                 responsableDB = await mongoose.model('Responsable').findOne({ 
                   codiRespnsble: { $regex: valorBuscado, $options: 'i' }
                 });
                 console.log('🔍 Búsqueda parcial por codiRespnsble:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
               }
               
               // Si aún no se encuentra, buscar parcialmente por nombre
               if (!responsableDB) {
                 console.log('🔍 Intentando búsqueda parcial por nombre...');
                 responsableDB = await mongoose.model('Responsable').findOne({ 
                   nmbrRespnsble: { $regex: valorBuscado, $options: 'i' }
                 });
                 console.log('🔍 Búsqueda parcial por nmbrRespnsble:', responsableDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
               }
               
               // Debug: mostrar todos los responsables para verificar la estructura
               if (!responsableDB) {
                 console.log('🔍 🔍 🔍 DEBUG: Listando TODOS los responsables de la BD 🔍 🔍 🔍');
                 const todosResponsables = await mongoose.model('Responsable').find({});
                 console.log(`🔍 Total de responsables en BD: ${todosResponsables.length}`);
                 todosResponsables.forEach((r, idx) => {
                   const rObj = r.toObject();
                   console.log(`🔍 Responsable ${idx + 1}:`, {
                     codiRespnsble: rObj.codiRespnsble,
                     nmbrRespnsble: rObj.nmbrRespnsble,
                     email: rObj.email,
                     telefono: rObj.telefono,
                     coincideCodigo: rObj.codiRespnsble === valorBuscado,
                     coincideNombre: rObj.nmbrRespnsble === valorBuscado
                   });
                 });
               }
               
               if (responsableDB) {
                 const responsableObj = responsableDB.toObject();
                 console.log('✅ ✅ ✅ RESPONSABLE ENCONTRADO ✅ ✅ ✅');
                 console.log('🔍 Datos completos del responsable:', JSON.stringify(responsableObj, null, 2));
                 
                 if (responsableObj.email && responsableObj.email.trim() !== '') {
                   emailResponsable = responsableObj.email.trim();
                   nombreResponsableCompleto = responsableObj.nmbrRespnsble || responsableObj.codiRespnsble || valorBuscado;
                   console.log('✅ ✅ ✅ EMAIL DEL RESPONSABLE ENCONTRADO ✅ ✅ ✅');
                   console.log('📧 Email:', emailResponsable);
                   console.log('👤 Nombre:', nombreResponsableCompleto);
                 } else {
                   console.log('⚠️ ⚠️ ⚠️ RESPONSABLE ENCONTRADO PERO SIN EMAIL ⚠️ ⚠️ ⚠️');
                   console.log('⚠️ Email en BD:', responsableObj.email);
                   console.log('⚠️ Email es null/undefined:', responsableObj.email === null || responsableObj.email === undefined);
                   console.log('⚠️ Email es string vacío:', responsableObj.email === '');
                   console.log('⚠️ Todos los campos:', Object.keys(responsableObj));
                   console.log('⚠️ Valores completos:', responsableObj);
                 }
               } else {
                 console.log('❌ ❌ ❌ NO SE ENCONTRÓ EL RESPONSABLE EN LA BD ❌ ❌ ❌');
                 console.log('❌ Valor buscado:', valorBuscado);
                 console.log('❌ Tipo del valor:', typeof valorBuscado);
                 console.log('❌ Longitud del valor:', valorBuscado.length);
                 console.log('❌ Valor en bytes:', Buffer.from(valorBuscado).toString('hex'));
               }
           } catch (error) {
             console.log('❌ ❌ ❌ ERROR AL BUSCAR RESPONSABLE ❌ ❌ ❌');
             console.log('❌ Error:', error.message);
             console.log('❌ Stack trace:', error.stack);
           }
         } else {
           console.log('⚠️ ⚠️ ⚠️ NO HAY codiRespnsble EN EL CASO ⚠️ ⚠️ ⚠️');
           console.log('⚠️ casoActualizado keys:', Object.keys(casoActualizado));
           console.log('⚠️ casoActualizado completo:', JSON.stringify(casoActualizado, null, 2));
         }
         
         console.log('📧 📧 📧 RESUMEN DE BÚSQUEDA DE RESPONSABLE 📧 📧 📧');
         console.log('📧 Email encontrado:', emailResponsable || 'NO ENCONTRADO');
         console.log('📧 Nombre responsable:', nombreResponsableCompleto);
         
                   // Obtener email del funcionario de aseguradora desde la base de datos
          let emailFuncionarioAseguradora = '';
          if (casoActualizado.funcAsgrdra || casoActualizado.funcAsgrdraNombre || casoActualizado.funcionarioAseguradora) {
            try {
              console.log('🔍 🔍 🔍 ===== BÚSQUEDA FUNCIONARIO ASEGURADORA (ACTUALIZAR) ===== 🔍 🔍 🔍');
              const valorBuscado = String(casoActualizado.funcAsgrdra || casoActualizado.funcAsgrdraNombre || casoActualizado.funcionarioAseguradora || '').trim();
              console.log('🔍 Valor a buscar:', valorBuscado);
              
              if (valorBuscado) {
                // Buscar por nombre de contacto
                let funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
                  nmbrContcto: valorBuscado
                });
                
                console.log('🔍 Búsqueda exacta por nmbrContcto:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
                
                // Si no se encuentra, buscar con regex
                if (!funcionarioDB) {
                  console.log('🔍 Intentando búsqueda con regex...');
                  const valorEscapado = valorBuscado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
                    nmbrContcto: { $regex: new RegExp(`^${valorEscapado}$`, 'i') }
                  });
                  console.log('🔍 Búsqueda con regex:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
                }
                
                // Si aún no se encuentra, buscar parcialmente
                if (!funcionarioDB) {
                  console.log('🔍 Intentando búsqueda parcial...');
                  funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
                    nmbrContcto: { $regex: valorBuscado, $options: 'i' }
                  });
                  console.log('🔍 Búsqueda parcial:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
                }
                
                if (funcionarioDB) {
                  const funcionarioObj = funcionarioDB.toObject();
                  console.log('✅ ✅ ✅ FUNCIONARIO ENCONTRADO (ACTUALIZAR) ✅ ✅ ✅');
                  console.log('🔍 Datos completos:', JSON.stringify(funcionarioObj, null, 2));
                  
                  if (funcionarioObj.email && funcionarioObj.email.trim() !== '') {
                    emailFuncionarioAseguradora = funcionarioObj.email.trim();
                    console.log('✅ ✅ ✅ EMAIL DEL FUNCIONARIO ENCONTRADO (ACTUALIZAR) ✅ ✅ ✅');
                    console.log('📧 Email:', emailFuncionarioAseguradora);
                  } else {
                    console.log('⚠️ ⚠️ ⚠️ FUNCIONARIO ENCONTRADO PERO SIN EMAIL (ACTUALIZAR) ⚠️ ⚠️ ⚠️');
                    console.log('⚠️ Email en BD:', funcionarioObj.email);
                  }
                } else {
                  console.log('❌ ❌ ❌ NO SE ENCONTRÓ EL FUNCIONARIO EN LA BD (ACTUALIZAR) ❌ ❌ ❌');
                  console.log('❌ Valor buscado:', valorBuscado);
                }
              } else {
                console.log('⚠️ No hay valor para buscar funcionario (actualizar)');
              }
            } catch (error) {
              console.log('❌ ❌ ❌ ERROR AL BUSCAR FUNCIONARIO (ACTUALIZAR) ❌ ❌ ❌');
              console.log('❌ Error:', error.message);
              console.log('❌ Stack trace:', error.stack);
            }
          } else {
            console.log('⚠️ No hay funcionario asignado para buscar email (actualizar)');
          }
          
          console.log('📧 📧 📧 RESUMEN BÚSQUEDA FUNCIONARIO (ACTUALIZAR) 📧 📧 📧');
          console.log('📧 Email encontrado:', emailFuncionarioAseguradora || 'NO ENCONTRADO');
         
                              // Obtener email del usuario que asigna el caso
          let emailQuienAsignaActualizar = '';
          let nombreQuienAsignaActualizar = 'Sistema';
          
          if (req.usuario && req.usuario.id) {
            try {
              const usuarioAsignador = await SecurUser.findById(req.usuario.id);
              if (usuarioAsignador && usuarioAsignador.email) {
                emailQuienAsignaActualizar = usuarioAsignador.email.trim();
                nombreQuienAsignaActualizar = usuarioAsignador.name || usuarioAsignador.login || 'Usuario';
                console.log('✅ Email del usuario que asigna (actualizar) obtenido:', emailQuienAsignaActualizar);
              }
            } catch (error) {
              console.log('⚠️ Error obteniendo email del usuario que asigna (actualizar):', error.message);
            }
          } else if (req.usuario && req.usuario.login) {
            try {
              const usuarioAsignador = await SecurUser.findOne({ login: req.usuario.login });
              if (usuarioAsignador && usuarioAsignador.email) {
                emailQuienAsignaActualizar = usuarioAsignador.email.trim();
                nombreQuienAsignaActualizar = usuarioAsignador.name || usuarioAsignador.login || 'Usuario';
                console.log('✅ Email del usuario que asigna (actualizar) obtenido por login:', emailQuienAsignaActualizar);
              }
            } catch (error) {
              console.log('⚠️ Error obteniendo email del usuario que asigna (actualizar) por login:', error.message);
            }
          }
          
          if (!emailQuienAsignaActualizar) {
            console.log('⚠️ No se pudo obtener el email del usuario que asigna el caso (actualizar)');
          }
          
                              // Preparar datos para notificación de asignación
           const datosNotificacion = {
             numeroCaso: casoActualizado.nmroAjste,
             numeroSiniestro: casoActualizado.nmroSinstro || 'No especificado',
             codigoWorkflow: casoActualizado.codWorkflow || 'No especificado',
             nombreResponsable: nombreResponsableCompleto,
             aseguradora: casoActualizado.codiAsgrdra || 'No especificada',
             intermediario: casoActualizado.nombIntermediario || 'No especificado',
             asegurado: casoActualizado.nombIntermediario || 'No especificado', // Para compatibilidad
             aseguradoReal: casoActualizado.asgrBenfcro || 'No especificado',
             funcionarioAseguradora: casoActualizado.funcAsgrdraNombre || '',
             funcAsgrdra: casoActualizado.funcAsgrdra || '',
             funcAsgrdraNombre: casoActualizado.funcAsgrdraNombre || '',
             codiEstdo: casoActualizado.codiEstdo || '',
             estado: casoActualizado.codiEstdo || '',
             descripcionEstado: casoActualizado.descripcionEstado || '',
             fechaAsignacion: casoActualizado.fchaAsgncion || new Date(),
             quienAsigna: nombreQuienAsignaActualizar,
             emailResponsable: emailResponsable, // CRÍTICO: Este campo debe tener el email del responsable
             emailQuienAsigna: emailQuienAsignaActualizar,
             emailFuncionarioAseguradora: emailFuncionarioAseguradora,
             observaciones: casoActualizado.obseContIni || casoActualizado.descSinstro || '',
             numeroPoliza: casoActualizado.nmroPolza || 'No especificado',
             ciudadSiniestro: casoActualizado.ciudadSiniestro || 'No especificada',
             descripcionSiniestro: casoActualizado.descSinstro || 'No especificada'
           };
           
           console.log('📧 📧 📧 DATOS DE NOTIFICACIÓN PREPARADOS 📧 📧 📧');
           console.log('📧 emailResponsable en datosNotificacion:', datosNotificacion.emailResponsable);
           console.log('📧 nombreResponsable:', datosNotificacion.nombreResponsable);
           console.log('📧 emailQuienAsigna:', datosNotificacion.emailQuienAsigna);
         
         console.log('📧 Datos para notificación de actualización:', JSON.stringify(datosNotificacion, null, 2));
         
         // Enviar notificación de asignación
         console.log('📧 📧 📧 INTENTANDO ENVIAR NOTIFICACIÓN 📧 📧 📧');
         const resultadoEmail = await enviarNotificacionAsignacion(datosNotificacion);
         console.log('📧 📧 📧 RESULTADO DEL ENVÍO 📧 📧 📧');
         console.log('📧 Resultado completo:', JSON.stringify(resultadoEmail, null, 2));
         if (resultadoEmail.success) {
           console.log('✅ ✅ ✅ NOTIFICACIÓN ENVIADA EXITOSAMENTE ✅ ✅ ✅');
           console.log('📧 Emails enviados:', resultadoEmail.emailsEnviados);
         } else {
           console.log('❌ ❌ ❌ ERROR AL ENVIAR NOTIFICACIÓN ❌ ❌ ❌');
           console.log('❌ Error:', resultadoEmail.error);
         }
         
                   // Enviar notificación a aseguradora si hay funcionario asignado
          if (casoActualizado.funcAsgrdra && emailFuncionarioAseguradora) {
            try {
              const datosNotificacionAseguradora = {
                numeroCaso: casoActualizado.nmroAjste,
                numeroSiniestro: casoActualizado.nmroSinstro || 'No especificado',
                codigoWorkflow: casoActualizado.codWorkflow || 'No especificado',
                nombreResponsable: nombreResponsableCompleto,
                aseguradora: casoActualizado.codiAsgrdra || 'No especificada',
                asegurado: casoActualizado.nombIntermediario || 'No especificado',
                fechaAsignacion: casoActualizado.fchaAsgncion || new Date(),
                emailFuncionarioAseguradora: emailFuncionarioAseguradora,
                numeroPoliza: casoActualizado.nmroPolza || 'No especificado',
                ciudadSiniestro: casoActualizado.ciudadSiniestro || 'No especificada',
                descripcionSiniestro: casoActualizado.descSinstro || 'No especificada'
              };
             
             const resultadoEmailAseguradora = await enviarNotificacionAseguradora(datosNotificacionAseguradora);
             console.log('✅ Notificación de actualización a aseguradora enviada:', resultadoEmailAseguradora);
             
           } catch (emailAseguradoraError) {
             console.error('⚠️ Error enviando notificación de actualización a aseguradora:', emailAseguradoraError);
             // No fallar por error de email a aseguradora
           }
         }
       } else {
         console.log('📧 No hay cambios relevantes, no se envían notificaciones');
       }
       
     } catch (emailError) {
       console.error('⚠️ Error enviando notificaciones por email:', emailError);
       console.error('⚠️ El caso se actualizó correctamente, pero falló el envío de notificaciones');
       // NO fallar la actualización del caso por error de email
     }
    
    console.log('🔄 ===== COMPLEX ACTUALIZADO CON ÉXITO =====');
    res.json(enriquecerCasoComplexParaFrontend(casoActualizado));
  } catch (error) {
    console.error('❌ Error al actualizar el caso:', error);
    console.error('❌ Payload que causó el error:', JSON.stringify(req.body, null, 2));
    res.status(500).json({ error: 'Error al actualizar el caso' });
  }
};

// Eliminar un caso
export const eliminarComplex = async (req, res) => {
  try {
    const casoEliminado = await Complex.findByIdAndDelete(req.params.id);
    if (!casoEliminado) return res.status(404).json({ error: 'Caso no encontrado' });

    await deleteComplexRecordFiles(casoEliminado.toObject?.() ?? casoEliminado).catch((err) => {
      console.warn('⚠️ No se pudieron eliminar adjuntos del caso Complex en almacenamiento:', err.message);
    });

    res.json({ mensaje: 'Caso eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar el caso:', error);
    res.status(500).json({ error: 'Error al eliminar el caso' });
  }
};

// Obtener intermediarios únicos de la base de datos
export const obtenerIntermediarios = async (req, res) => {
  try {
    console.log('🔍 Obteniendo intermediarios únicos...');
    
    // Por ahora, solo obtener de casos complex hasta que resolvamos el problema de siniestros
    console.log('🔍 Buscando casos complex...');
    const casos = await Complex.find({}, 'intermediario');
    console.log('📊 Casos complex encontrados:', casos.length);
    
    const intermediariosCasos = [...new Set(
      casos
        .map(c => c.intermediario)
        .filter(intermediario => intermediario && intermediario.trim() !== '')
    )];
    console.log('📋 Intermediarios de casos complex:', intermediariosCasos);
    
    // Por ahora, devolver solo los de casos complex
    const todosIntermediarios = intermediariosCasos.sort();
    
    console.log('✅ Intermediarios encontrados:', todosIntermediarios.length);
    console.log('📋 Lista final de intermediarios:', todosIntermediarios);
    
    res.json(todosIntermediarios);
  } catch (error) {
    console.error('❌ Error obteniendo intermediarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/** Bandeja de casos enviados a jefes/gerencia para facturación */
export const obtenerBandejaFacturacion = async (req, res) => {
  try {
    const login = String(req.query.login || '').trim();
    const rol = String(req.query.rol || '').trim();

    if (!usuarioPuedeVerBandejaFacturacion({ login })) {
      return res.status(403).json({
        success: false,
        error: 'No tiene permiso para consultar la bandeja de facturación',
      });
    }

    let gerente = normalizarClaveGerente(req.query.gerente);
    const esSupervisor = puedeElegirGerenteEnBandeja(login);

    if (!gerente) {
      gerente = resolverGerenteDesdeLogin(login);
    }

    if (!gerente) {
      if (esSupervisor) {
        return res.status(400).json({
          success: false,
          error: 'Seleccione el gerente o jefe para ver su bandeja',
        });
      }
      return res.status(403).json({
        success: false,
        error: 'Su usuario no está asociado a un jefe de facturación',
      });
    }

    const gerentePropio = resolverGerenteDesdeLogin(login);
    if (!esSupervisor && gerentePropio && gerente !== gerentePropio) {
      return res.status(403).json({
        success: false,
        error: 'Solo puede consultar su propia bandeja',
      });
    }

    let responsables = [];
    let estados = [];
    let aseguradoras = [];
    try {
      [responsables, estados, aseguradoras] = await Promise.all([
        Responsable.find().select('codiRespnsble nmbrRespnsble').lean(),
        Estado.find().select('codiEstdo codiEstado descEstdo descEstado descripcion').lean(),
        Cliente.find().select('codiAsgrdra cod1Asgrdra rzonSocial').lean(),
      ]);
    } catch (errCat) {
      console.warn('⚠️ Bandeja facturación: catálogos parciales:', errCat.message);
    }

    const resultado = await listarBandejaFacturacion({
      gerente,
      tipo: req.query.tipo || 'todos',
      desde: req.query.desde,
      hasta: req.query.hasta,
      q: req.query.q,
      responsables,
      estados,
      aseguradoras,
    });

    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error obteniendo bandeja de facturación:', error);
    const esTimeout = error.name === 'MongoServerError' && error.code === 50;
    res.status(esTimeout ? 504 : 500).json({
      success: false,
      error: esTimeout
        ? 'La consulta tardó demasiado. Intente de nuevo o acote el rango de fechas.'
        : error.message,
    });
  }
};

/** Solo Oscar Atencio: corregir jefe destinatario de un envío registrado */
export const corregirEnvioBandejaFacturacion = async (req, res) => {
  try {
    const login = String(req.body?.login || req.query?.login || '').trim();
    if (!puedeAdministrarBandejaFacturacion(login)) {
      return res.status(403).json({
        success: false,
        error: 'Solo el supervisor autorizado puede corregir envíos de la bandeja',
      });
    }

    const { casoId, nuevoGerente, envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor } =
      req.body || {};

    const resultado = await corregirDestinatarioEnvioFacturacion({
      casoId,
      nuevoGerente,
      corregidoPor: login,
      selector: { envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor },
    });

    if (!resultado.ok) {
      const status =
        resultado.motivo === 'caso_no_encontrado' || resultado.motivo === 'envio_no_encontrado'
          ? 404
          : 400;
      const mensajes = {
        caso_no_encontrado: 'No se encontró el caso',
        envio_no_encontrado: 'No se encontró el registro de envío en ese caso',
        datos_invalidos: 'Datos incompletos para la corrección',
      };
      return res.status(status).json({
        success: false,
        error: mensajes[resultado.motivo] || resultado.motivo,
      });
    }

    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error corrigiendo envío bandeja:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/** Solo Oscar Atencio: quitar un registro de envío (no borra el caso) */
export const eliminarEnvioBandejaFacturacion = async (req, res) => {
  try {
    const login = String(req.body?.login || req.query?.login || '').trim();
    if (!puedeAdministrarBandejaFacturacion(login)) {
      return res.status(403).json({
        success: false,
        error: 'Solo el supervisor autorizado puede eliminar registros de la bandeja',
      });
    }

    const { casoId, envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor } =
      req.body || {};

    const resultado = await eliminarRegistroEnvioFacturacion({
      casoId,
      eliminadoPor: login,
      selector: { envioId, envioIndice, fechaEnvio, gerente, tipoEnvio, enviadoPor },
    });

    if (!resultado.ok) {
      const status =
        resultado.motivo === 'caso_no_encontrado' || resultado.motivo === 'envio_no_encontrado'
          ? 404
          : 400;
      const mensajes = {
        caso_no_encontrado: 'No se encontró el caso',
        envio_no_encontrado: 'No se encontró el registro de envío en ese caso',
        datos_invalidos: 'Datos incompletos',
      };
      return res.status(status).json({
        success: false,
        error: mensajes[resultado.motivo] || resultado.motivo,
      });
    }

    res.json({ success: true, ...resultado });
  } catch (error) {
    console.error('❌ Error eliminando envío bandeja:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const notificarHonorarios = async (req, res) => {
  try {
    const {
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos = [],
      usuario
    } = req.body || {};

    if (!archivos.length) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron archivos para notificar' });
    }

    const resultado = await enviarNotificacionHonorarios({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      usuario
    });

    res.json({ success: true, resultado });
  } catch (error) {
    console.error('❌ Error enviando notificación de honorarios:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const notificarControlHoras = async (req, res) => {
  try {
    const {
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos = [],
      archivosConRuta = [],
      controlHoras,
      resumenControlHoras,
      usuario,
      gerente,
      casoId
    } = req.body || {};

    const tieneArchivos = archivos.length > 0 || archivosConRuta.length > 0;
    const tieneControlHorasRegistrado = Boolean(controlHoras?.filas?.length);

    if (!tieneArchivos && !tieneControlHorasRegistrado) {
      return res.status(400).json({
        success: false,
        error: 'Debe registrar el control de horas en el sistema o adjuntar documentos para notificar',
      });
    }

    if (!gerente) {
      return res.status(400).json({ success: false, error: 'No se especificó el gerente destinatario' });
    }

    const gerenteNorm = normalizarClaveGerente(gerente);
    if (gerenteNorm === 'adriana') {
      return res.status(400).json({
        success: false,
        error:
          'Facturación no recibe el control de horas en esta fase. Envíe la evidencia en "Envío de Control de Horas" (fase 2) y seleccione a Adriana.',
      });
    }

    console.log('📧 [notificarControlHoras] Gerente seleccionado:', gerente);
    console.log('📧 [notificarControlHoras] ID del caso:', casoId);
    console.log('📧 [notificarControlHoras] Archivos con rutas:', archivosConRuta.length);
    console.log('📧 [notificarControlHoras] Control horas en sistema:', tieneControlHorasRegistrado);

    const resultado = await enviarNotificacionControlHoras({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      archivosConRuta,
      controlHoras: tieneControlHorasRegistrado ? controlHoras : null,
      resumenControlHoras,
      usuario,
      gerente,
      casoId,
    });

    let persistencia = null;
    if (resultado?.success !== false) {
      persistencia = await persistirEnvioFacturacionTrasCorreo({
        casoId,
        numeroCaso,
        tipo: 'control_horas',
        gerente,
        usuario,
        emailDestinatario: resultado.destinatarioPrincipal,
        copias: [],
      });
    }

    res.json({
      success: true,
      resultado,
      envioRegistrado: Boolean(persistencia?.ok),
      casoId: persistencia?.casoId || casoId || null,
      motivoNoRegistro: persistencia?.ok ? undefined : persistencia?.motivo,
    });
  } catch (error) {
    console.error('❌ Error enviando notificación de control de horas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Notificar gerencia
export const notificarGerencia = async (req, res) => {
  try {
    const {
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos = [],
      archivosConRuta = [],
      usuario,
      gerente,
      casoId
    } = req.body || {};

    if (!archivos.length && !archivosConRuta.length) {
      return res.status(400).json({ success: false, error: 'No se proporcionaron archivos para notificar' });
    }

    if (!gerente) {
      return res.status(400).json({ success: false, error: 'No se especificó el gerente destinatario' });
    }

    const gerenteNorm = String(gerente || '').trim().toLowerCase();
    const esFacturacion =
      gerenteNorm === 'adriana' ||
      gerenteNorm.includes('adriana') ||
      gerenteNorm.includes('facturacion');
    const emailFacturacion =
      process.env.EMAIL_FACTURACION_AJUSTES?.trim() ||
      'facturacion.ajustes@proserpuertos.com.co';

    console.log('📧 [notificarGerencia] Gerente seleccionado:', gerente);
    console.log('📧 [notificarGerencia] ID del caso:', casoId);
    console.log('📧 [notificarGerencia] Archivos con rutas:', archivosConRuta.length);
    if (esFacturacion) {
      console.log('📧 [notificarGerencia] Correo facturación:', emailFacturacion);
    }

    const resultado = await enviarNotificacionGerencia({
      numeroCaso,
      numeroSiniestro,
      responsable,
      archivos,
      archivosConRuta,
      usuario,
      gerente,
      casoId,
      ...(esFacturacion && {
        emailDestinatario: emailFacturacion,
        nombreDestinatario: 'Adriana Angulo Funes',
      }),
    });

    let persistencia = null;
    if (resultado?.success !== false) {
      persistencia = await persistirEnvioFacturacionTrasCorreo({
        casoId,
        numeroCaso,
        tipo: 'gerencia',
        gerente: esFacturacion ? 'adriana' : gerente,
        usuario,
        emailDestinatario:
          resultado?.destinatarios?.[0] || resultado?.destinatarioPrincipal || emailFacturacion,
        nombreDestinatario: esFacturacion ? 'Adriana Angulo Funes' : undefined,
      });
    }

    res.json({
      success: true,
      resultado,
      emailEnviado: resultado?.destinatarios?.[0] || resultado?.destinatarioPrincipal,
      envioRegistrado: Boolean(persistencia?.ok),
      casoId: persistencia?.casoId || casoId || null,
      motivoNoRegistro: persistencia?.ok ? undefined : persistencia?.motivo,
    });
  } catch (error) {
    console.error('❌ Error enviando notificación de gerencia:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Cambiar casos FINALIZADOS a FACTURADO
export const cambiarEstadosFinalizadosAFacturado = async (req, res) => {
  try {
    console.log('🔄 ===== INICIANDO CAMBIO DE ESTADOS (MANUAL) =====');
    console.log('📅 Fecha:', new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }));

    // Paso 1: Buscar el código del estado FINALIZADO
    console.log('🔍 Buscando código del estado FINALIZADO...');
    const estadoFinalizado = await Estado.findOne({
      $or: [
        { descEstdo: /FINALIZADO/i },
        { codiEstdo: 13 }
      ]
    });

    if (!estadoFinalizado) {
      console.log('⚠️ No se encontró el estado FINALIZADO, usando código 13 por defecto');
    }

    const codigoFinalizado = estadoFinalizado ? String(estadoFinalizado.codiEstdo) : '13';
    console.log(`✅ Código FINALIZADO: ${codigoFinalizado}`);

    // Paso 2: Buscar el código del estado FACTURADO
    console.log('🔍 Buscando código del estado FACTURADO...');
    const estadoFacturado = await Estado.findOne({
      descEstdo: /FACTURADO/i
    });

    if (!estadoFacturado) {
      console.error('❌ ERROR: No se encontró el estado FACTURADO en la base de datos');
      return res.status(404).json({
        success: false,
        error: 'Estado FACTURADO no encontrado',
        mensaje: 'Por favor, verificar que el estado FACTURADO existe en la colección de estados'
      });
    }

    const codigoFacturado = String(estadoFacturado.codiEstdo);
    console.log(`✅ Código FACTURADO: ${codigoFacturado} (${estadoFacturado.descEstdo})`);

    // Verificar que no sean el mismo código
    if (codigoFinalizado === codigoFacturado) {
      return res.status(400).json({
        success: false,
        error: 'Los códigos de FINALIZADO y FACTURADO son iguales',
        codigo: codigoFinalizado
      });
    }

    // Paso 3: Buscar todos los casos con estado FINALIZADO
    // IMPORTANTE: Los estados pueden estar guardados como string o número
    console.log(`🔍 Buscando casos con estado FINALIZADO (código: ${codigoFinalizado})...`);
    const casosFinalizados = await Siniestro.find({
      $or: [
        { codiEstdo: codigoFinalizado },
        { codiEstdo: Number(codigoFinalizado) },
        { codiEstdo: String(codigoFinalizado) }
      ]
    });

    console.log(`📊 Casos FINALIZADOS encontrados: ${casosFinalizados.length}`);

    // Paso 3b: Buscar todos los casos SIN estado (null, vacío, o no existe)
    console.log(`🔍 Buscando casos SIN estado (null, vacío, o no existe)...`);
    const casosSinEstado = await Siniestro.find({
      $or: [
        { codiEstdo: null },
        { codiEstdo: '' },
        { codiEstdo: { $exists: false } }
      ]
    });

    console.log(`📊 Casos SIN estado encontrados: ${casosSinEstado.length}`);

    const totalCasos = casosFinalizados.length + casosSinEstado.length;

    if (totalCasos === 0) {
      return res.json({
        success: true,
        casosEncontrados: 0,
        casosActualizados: 0,
        casosFinalizados: 0,
        casosSinEstado: 0,
        mensaje: 'No hay casos para actualizar (ni FINALIZADOS ni sin estado)'
      });
    }

    // Paso 4: Actualizar todos los casos FINALIZADOS a FACTURADO
    // IMPORTANTE: Buscar tanto como string como número
    console.log(`🔄 Actualizando ${casosFinalizados.length} casos FINALIZADOS a estado FACTURADO...`);
    
    const resultadoFinalizados = await Siniestro.updateMany(
      {
        $or: [
          { codiEstdo: codigoFinalizado },
          { codiEstdo: Number(codigoFinalizado) },
          { codiEstdo: String(codigoFinalizado) }
        ]
      },
      { 
        $set: { 
          codiEstdo: codigoFacturado,
          descripcionEstado: estadoFacturado.descEstdo
        } 
      }
    );

    // Paso 5: Actualizar todos los casos SIN estado a FACTURADO
    console.log(`🔄 Actualizando ${casosSinEstado.length} casos SIN estado a estado FACTURADO...`);
    
    const resultadoSinEstado = await Siniestro.updateMany(
      {
        $or: [
          { codiEstdo: null },
          { codiEstdo: '' },
          { codiEstdo: { $exists: false } }
        ]
      },
      { 
        $set: { 
          codiEstdo: codigoFacturado,
          descripcionEstado: estadoFacturado.descEstdo
        } 
      }
    );

    const totalActualizados = resultadoFinalizados.modifiedCount + resultadoSinEstado.modifiedCount;
    const totalEncontrados = resultadoFinalizados.matchedCount + resultadoSinEstado.matchedCount;

    console.log('✅ ===== CAMBIO DE ESTADOS COMPLETADO =====');
    console.log(`✅ Casos FINALIZADOS actualizados: ${resultadoFinalizados.modifiedCount} de ${resultadoFinalizados.matchedCount}`);
    console.log(`✅ Casos SIN estado actualizados: ${resultadoSinEstado.modifiedCount} de ${resultadoSinEstado.matchedCount}`);
    console.log(`✅ Total actualizados: ${totalActualizados} de ${totalEncontrados}`);

    res.json({
      success: true,
      casosEncontrados: totalEncontrados,
      casosActualizados: totalActualizados,
      casosFinalizados: {
        encontrados: resultadoFinalizados.matchedCount,
        actualizados: resultadoFinalizados.modifiedCount
      },
      casosSinEstado: {
        encontrados: resultadoSinEstado.matchedCount,
        actualizados: resultadoSinEstado.modifiedCount
      },
      codigoFinalizado,
      codigoFacturado,
      descripcionEstadoFinalizado: estadoFinalizado?.descEstdo || 'No encontrado',
      descripcionEstadoFacturado: estadoFacturado.descEstdo,
      fechaEjecucion: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })
    });

  } catch (error) {
    console.error('❌ Error ejecutando cambio de estados:', error);
    console.error('📋 Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message,
      casosActualizados: 0
    });
  }
};

// Contar casos por aseguradoras específicas (BBVA y Zurich)
export const contarCasosAseguradoras = async (req, res) => {
  try {
    const Cliente = (await import('../models/Cliente.js')).default;
    const Siniestro = (await import('../models/CasoComplex.js')).default;
    
    // Obtener todas las aseguradoras para mapeo
    const clientes = await Cliente.find({});

    // Crear mapa de códigos a nombres
    const mapaCodigoANombre = {};
    
    clientes.forEach(cliente => {
      const codigo = String(cliente.codiAsgrdra || '').trim();
      const nombre = String(cliente.rzonSocial || '').trim();
      
      if (codigo && nombre) {
        mapaCodigoANombre[codigo] = nombre;
      }
    });

    // Buscar códigos que coincidan con BBVA y Zurich
    const codigosBBVA = [];
    const codigosZurich = [];
    
    Object.entries(mapaCodigoANombre).forEach(([codigo, nombre]) => {
      const nombreUpper = nombre.toUpperCase();
      if (nombreUpper.includes('BBVA')) {
        codigosBBVA.push({ codigo, nombre });
      }
      if (nombreUpper.includes('ZURICH') || nombreUpper.includes('ZÚRICH')) {
        codigosZurich.push({ codigo, nombre });
      }
    });

    // Contar casos en Complex
    let totalBBVA = 0;
    let totalZurich = 0;

    if (codigosBBVA.length > 0) {
      const codigosBBVASolo = codigosBBVA.map(c => c.codigo);
      totalBBVA = await Complex.countDocuments({
        codiAsgrdra: { $in: codigosBBVASolo }
      });
    }

    if (codigosZurich.length > 0) {
      const codigosZurichSolo = codigosZurich.map(c => c.codigo);
      totalZurich = await Complex.countDocuments({
        codiAsgrdra: { $in: codigosZurichSolo }
      });
    }

    // Contar casos en Siniestro
    let totalBBVASiniestro = 0;
    let totalZurichSiniestro = 0;

    if (codigosBBVA.length > 0) {
      const codigosBBVASolo = codigosBBVA.map(c => c.codigo);
      totalBBVASiniestro = await Siniestro.countDocuments({
        codiAsgrdra: { $in: codigosBBVASolo }
      });
    }

    if (codigosZurich.length > 0) {
      const codigosZurichSolo = codigosZurich.map(c => c.codigo);
      totalZurichSiniestro = await Siniestro.countDocuments({
        codiAsgrdra: { $in: codigosZurichSolo }
      });
    }

    // Contar TODOS los códigos únicos en casos para diagnóstico
    const todosCodigosComplex = await Complex.distinct('codiAsgrdra');
    const todosCodigosSiniestro = await Siniestro.distinct('codiAsgrdra');
    const todosCodigosUnicos = [...new Set([...todosCodigosComplex, ...todosCodigosSiniestro])].filter(c => c);
    
    // Contar casos por cada código único
    const casosPorCodigo = {};
    for (const codigo of todosCodigosUnicos) {
      const countComplex = await Complex.countDocuments({ codiAsgrdra: codigo });
      const countSiniestro = await Siniestro.countDocuments({ codiAsgrdra: codigo });
      casosPorCodigo[codigo] = {
        nombre: mapaCodigoANombre[codigo] || 'Nombre no encontrado',
        complex: countComplex,
        siniestro: countSiniestro,
        total: countComplex + countSiniestro
      };
    }
    
    // Filtrar solo BBVA y Zurich para el resumen
    const casosBBVA = Object.entries(casosPorCodigo).filter(([cod, data]) => 
      codigosBBVA.some(bbva => bbva.codigo === cod)
    );
    const casosZurich = Object.entries(casosPorCodigo).filter(([cod, data]) => 
      codigosZurich.some(zur => zur.codigo === cod)
    );

    // Información adicional para diagnóstico
    const diagnostico = {
      totalClientes: clientes.length,
      totalCasosComplex: await Complex.countDocuments({}),
      totalCasosSiniestro: await Siniestro.countDocuments({}),
      totalCodigosUnicos: todosCodigosUnicos.length,
      mapaCodigoANombre: Object.keys(mapaCodigoANombre).length,
      casosPorCodigoBBVA: casosBBVA,
      casosPorCodigoZurich: casosZurich,
      muestraTodosCodigos: Object.entries(casosPorCodigo)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 20)
    };

    res.json({
      success: true,
      data: {
        bbva: {
          codigosEncontrados: codigosBBVA,
          complex: totalBBVA,
          siniestro: totalBBVASiniestro,
          total: totalBBVA + totalBBVASiniestro,
          detallePorCodigo: casosBBVA.map(([cod, data]) => ({
            codigo: cod,
            nombre: data.nombre,
            ...data
          }))
        },
        zurich: {
          codigosEncontrados: codigosZurich,
          complex: totalZurich,
          siniestro: totalZurichSiniestro,
          total: totalZurich + totalZurichSiniestro,
          detallePorCodigo: casosZurich.map(([cod, data]) => ({
            codigo: cod,
            nombre: data.nombre,
            ...data
          }))
        },
        diagnostico
      }
    });
  } catch (error) {
    console.error('❌ Error contando casos por aseguradoras:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
