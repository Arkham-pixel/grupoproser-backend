import Riesgo from '../models/CasoRiesgo.js';
import SecurUser from '../models/SecurUser.js';
import Responsable from '../models/Responsable.js';
import FuncionarioAseguradora from '../models/FuncionarioAseguradora.js';
import Cliente from '../models/Cliente.js';
import Estado from '../models/Estado.js';
import ClasificacionRiesgo from '../models/ClasificacionRiesgo.js';
import Ciudad from '../models/Ciudad.js';
import { enviarNotificacionAsignacion, enviarNotificacionAseguradora, enviarNotificacionCreador } from '../services/emailService.js';

const RUTA_RELATIVA_RIESGOS = '/uploads/riesgos/';
const camposArchivoRiesgo = ['adjuntoAsignacion', 'adjuntoInspeccion', 'adjuntoContIni', 'anxoInfoFnal', 'anxoFactra'];

const esValorVacio = (valor) => valor === undefined || valor === null || valor === '' || valor === 'null' || valor === 'undefined';

const obtenerNumero = (valor, fallback = 0) => {
  if (esValorVacio(valor)) return fallback;
  const numero = Number(valor);
  return Number.isNaN(numero) ? fallback : numero;
};

const obtenerFecha = (valor, fallback = null) => {
  if (esValorVacio(valor)) return fallback ?? null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? fallback ?? null : fecha;
};

const obtenerCadena = (valor, fallback = '') => {
  if (esValorVacio(valor)) return fallback ?? '';
  return String(valor);
};

const procesarArchivosEnRequest = (req) => {
  camposArchivoRiesgo.forEach((campo) => {
    const persisted = req.filesStorage?.[campo]?.[0];
    if (persisted?.publicPath) {
      req.body[campo] = persisted.publicPath;
      return;
    }
    const archivo = req.files?.[campo]?.[0];
    if (archivo) {
      req.body[campo] = `${RUTA_RELATIVA_RIESGOS}${archivo.filename}`;
    }
  });
};

const mapearDatosRiesgo = (datosEntrada = {}, base = {}) => {
  const resultado = {
    // Solo incluir nmroRiesgo si hay un base válido con nmroRiesgo (para actualizaciones)
    // Para nuevos casos, no incluir nmroRiesgo aquí, se asignará después
    ...(base.nmroRiesgo ? { nmroRiesgo: base.nmroRiesgo } : {}),
    codiIspector: obtenerCadena(datosEntrada.responsable ?? datosEntrada.codiIspector, base.codiIspector ?? ''),
    codiAsgrdra: obtenerCadena(datosEntrada.aseguradora ?? datosEntrada.codiAsgrdra, base.codiAsgrdra ?? ''),
    asgrBenfcro: obtenerCadena(datosEntrada.asegurado ?? datosEntrada.asgrBenfcro, base.asgrBenfcro ?? ''),
    nmroConsecutivo: obtenerCadena(datosEntrada.nmroConsecutivo, base.nmroConsecutivo ?? ''),
    fchaAsgncion: obtenerFecha(datosEntrada.fechaAsignacion ?? datosEntrada.fchaAsgncion, base.fchaAsgncion ?? null),
    observAsignacion: obtenerCadena(
      datosEntrada.observAsignacion ?? datosEntrada.observaciones,
      base.observAsignacion ?? ''
    ),
    adjuntoAsignacion: obtenerCadena(datosEntrada.adjuntoAsignacion, base.adjuntoAsignacion ?? ''),
    fchaContIni: obtenerFecha(datosEntrada.fchaContIni ?? datosEntrada.fechaContactoInicial, base.fchaContIni ?? null),
    observContIni: obtenerCadena(datosEntrada.observContIni ?? datosEntrada.observContactoInicial, base.observContIni ?? ''),
    adjuntoContIni: obtenerCadena(datosEntrada.adjuntoContIni ?? datosEntrada.adjuntoContactoInicial, base.adjuntoContIni ?? ''),
    fchaInspccion: obtenerFecha(datosEntrada.fechaInspeccion ?? datosEntrada.fchaInspccion, base.fchaInspccion ?? null),
    observInspeccion: obtenerCadena(
      datosEntrada.observInspeccion ?? datosEntrada.observaciones,
      base.observInspeccion ?? ''
    ),
    adjuntoInspeccion: obtenerCadena(datosEntrada.adjuntoInspeccion, base.adjuntoInspeccion ?? ''),
    codiClasificacion: obtenerCadena(
      datosEntrada.codiClasificacion ?? datosEntrada.clasificacion,
      base.codiClasificacion ?? ''
    ),
    fchaInforme: obtenerFecha(datosEntrada.fechaInforme ?? datosEntrada.fchaInforme, base.fchaInforme ?? null),
    anxoInfoFnal: obtenerCadena(datosEntrada.anxoInfoFnal, base.anxoInfoFnal ?? ''),
    observInforme: obtenerCadena(datosEntrada.observInforme, base.observInforme ?? ''),
    codDireccion: obtenerCadena(datosEntrada.direccion ?? datosEntrada.codDireccion, base.codDireccion ?? ''),
    funcSolicita: obtenerCadena(datosEntrada.funcSolicita ?? datosEntrada.quienSolicita, base.funcSolicita ?? ''),
    codigoPoblado: obtenerCadena(
      datosEntrada.codigoPoblado ?? datosEntrada.ciudad ?? datosEntrada.ciudadSucursal,
      base.codigoPoblado ?? ''
    ),
    ciudadSucursal: obtenerCadena(datosEntrada.ciudadSucursal ?? datosEntrada.ciudad, base.ciudadSucursal ?? ''),
    codiEstdo: obtenerNumero(datosEntrada.estado ?? datosEntrada.codiEstdo, base.codiEstdo ?? 1),
    vlorTarifaAseguradora: obtenerNumero(
      datosEntrada.vlorTarifaAseguradora,
      base.vlorTarifaAseguradora ?? 0
    ),
    vlorHonorarios: obtenerNumero(datosEntrada.vlorHonorarios, base.vlorHonorarios ?? 0),
    vlorGastos: obtenerNumero(datosEntrada.vlorGastos, base.vlorGastos ?? 0),
    nmroFactra: obtenerNumero(datosEntrada.nmroFactra, base.nmroFactra ?? 0),
    fchaFactra: obtenerFecha(datosEntrada.fechaFactra ?? datosEntrada.fchaFactra, base.fchaFactra ?? null),
    totalPagado: obtenerNumero(datosEntrada.totalPagado, base.totalPagado ?? 0),
    anxoFactra: obtenerCadena(datosEntrada.anxoFactra, base.anxoFactra ?? ''),
  };

  camposArchivoRiesgo.forEach((campo) => {
    const valor = resultado[campo];
    if (!valor) {
      delete resultado[campo];
    }
  });

  return resultado;
};

export const crearRiesgo = async (req, res) => {
  try {
    console.log('🎯 ===== INICIANDO CREACIÓN DE RIESGO =====');
    console.log('📝 DATOS RECIBIDOS EN crearRiesgo:', JSON.stringify(req.body, null, 2));
    
    procesarArchivosEnRequest(req);

    // Generar número de riesgo con formato YYYY-MM-NNN (año-mes-consecutivo)
    console.log('🔢 ===== GENERANDO NUEVO NÚMERO DE RIESGO =====');
    
    // Obtener año y mes actual
    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0'); // Mes con 2 dígitos (01-12)
    console.log('📅 Año:', año, 'Mes:', mes);
    
    // Buscar todos los casos de riesgo para encontrar el número más alto
    const patronFormatoNuevo = /^(\d{4})-(\d{2})-(\d+)$/;
    const todosLosRiesgos = await Riesgo.find({ nmroRiesgo: { $exists: true, $ne: null, $ne: '' } });
    console.log('📊 Total de casos de riesgo encontrados:', todosLosRiesgos.length);
    
    let nuevoNumero = 1;
    let numeroMaximoEncontrado = 0;
    
    // Buscar el número más alto entre todos los casos
    todosLosRiesgos.forEach((riesgo, index) => {
      if (riesgo.nmroRiesgo) {
        const numeroRiesgo = String(riesgo.nmroRiesgo);
        const match = numeroRiesgo.match(patronFormatoNuevo);
        
        if (match && match[3]) {
          // Es formato nuevo YYYY-MM-NNN, extraer el número secuencial
          const numeroSecuencial = parseInt(match[3]);
          console.log(`   Riesgo ${index + 1}: ${numeroRiesgo} -> número secuencial: ${numeroSecuencial}`);
          if (numeroSecuencial > numeroMaximoEncontrado) {
            numeroMaximoEncontrado = numeroSecuencial;
          }
        } else {
          // Es formato antiguo (solo número)
          const esFormatoAntiguo = /^\d+$/.test(numeroRiesgo);
          if (esFormatoAntiguo) {
            const numeroAntiguo = parseInt(numeroRiesgo);
            console.log(`   Riesgo ${index + 1}: ${numeroRiesgo} -> formato antiguo, número: ${numeroAntiguo}`);
            if (numeroAntiguo > numeroMaximoEncontrado) {
              numeroMaximoEncontrado = numeroAntiguo;
            }
          } else {
            console.log(`   Riesgo ${index + 1}: ${numeroRiesgo} -> formato desconocido, ignorado`);
          }
        }
      }
    });
    
    // El nuevo número será el máximo encontrado + 1, o 1 si no hay casos
    nuevoNumero = numeroMaximoEncontrado > 0 ? numeroMaximoEncontrado + 1 : 1;
    console.log('🔢 Número máximo encontrado:', numeroMaximoEncontrado);
    console.log('🔢 Nuevo número secuencial:', nuevoNumero);
    
    // Formatear como YYYY-MM-NNN (sin padding adicional, solo el número natural)
    const nuevoNumeroRiesgo = `${año}-${mes}-${nuevoNumero}`;
    console.log('✅ NUEVO NÚMERO DE RIESGO GENERADO:', nuevoNumeroRiesgo);
    console.log('🔢 ===== FIN GENERACIÓN NÚMERO DE RIESGO =====');
    
    // Mapear campos del frontend al modelo de MongoDB
    const datosMapeados = {
      ...mapearDatosRiesgo(req.body),
      nmroRiesgo: nuevoNumeroRiesgo, // Asegurar que el consecutivo siempre se asigne al final
    };
    
    console.log('🗺️ DATOS MAPEADOS:', JSON.stringify(datosMapeados, null, 2));
    
    // Crear el nuevo riesgo con el número generado
    const nuevoRiesgo = new Riesgo(datosMapeados);
    
    console.log('💾 OBJETO A GUARDAR:', JSON.stringify(nuevoRiesgo, null, 2));
    
    await nuevoRiesgo.save();
    
    console.log('✅ RIESGO GUARDADO EXITOSAMENTE:', JSON.stringify(nuevoRiesgo, null, 2));
    console.log('🎯 ===== RIESGO CREADO CON ÉXITO =====');
    
    // Solo enviar notificación si hay un responsable asignado
    if (nuevoRiesgo.codiIspector || nuevoRiesgo.codiRespnsble) {
      console.log('📧 ===== ENVIANDO NOTIFICACIÓN DE ASIGNACIÓN =====');
      
      try {
        // Obtener información del responsable
        let responsableInfo = null;
        if (nuevoRiesgo.codiIspector) {
          responsableInfo = await Responsable.findOne({ codiRespnsble: nuevoRiesgo.codiIspector });
        } else if (nuevoRiesgo.codiRespnsble) {
          responsableInfo = await Responsable.findOne({ codiRespnsble: nuevoRiesgo.codiRespnsble });
        }
        
        console.log('👤 INFORMACIÓN DEL RESPONSABLE:', responsableInfo);
        
        // Obtener información del usuario que está asignando el caso
        // Si hay un usuario, mostrar su nombre; si no, mostrar "Sistema"
        let nombreQuienAsigna = 'Sistema';
        if (req.usuario && req.usuario.id) {
          try {
            const usuarioAsignador = await SecurUser.findById(req.usuario.id);
            if (usuarioAsignador && usuarioAsignador.name) {
              nombreQuienAsigna = usuarioAsignador.name;
              console.log('✅ Nombre del asignador obtenido:', nombreQuienAsigna);
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo nombre del asignador:', error.message);
          }
        } else if (req.usuario && req.usuario.login) {
          try {
            const usuarioAsignador = await SecurUser.findOne({ login: req.usuario.login });
            if (usuarioAsignador && usuarioAsignador.name) {
              nombreQuienAsigna = usuarioAsignador.name;
              console.log('✅ Nombre del asignador obtenido por login:', nombreQuienAsigna);
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo nombre del asignador por login:', error.message);
          }
        }
        
        // Obtener información adicional para la notificación
        // Inspector (ya tenemos responsableInfo)
        const nombreInspector = responsableInfo?.nmbrRespnsble || 'No especificado';
        
        // Cliente (Aseguradora)
        let nombreCliente = 'No especificada';
        if (nuevoRiesgo.codiAsgrdra) {
          try {
            const cliente = await Cliente.findOne({ codiAsgrdra: nuevoRiesgo.codiAsgrdra });
            if (cliente && cliente.rzonSocial) {
              nombreCliente = cliente.rzonSocial;
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo nombre de cliente:', error.message);
          }
        }
        
        // Clasificación
        let nombreClasificacion = 'No especificada';
        if (nuevoRiesgo.codiClasificacion) {
          try {
            const clasificacion = await ClasificacionRiesgo.findOne({ 
              codIdentificador: Number(nuevoRiesgo.codiClasificacion) 
            });
            if (clasificacion && clasificacion.rzonDescripcion) {
              nombreClasificacion = clasificacion.rzonDescripcion;
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo clasificación:', error.message);
          }
        }
        
        // Estado
        let nombreEstado = 'No especificado';
        if (nuevoRiesgo.codiEstdo) {
          try {
            const estado = await Estado.findOne({ codiEstado: nuevoRiesgo.codiEstdo });
            if (estado && estado.descEstado) {
              nombreEstado = estado.descEstado;
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo estado:', error.message);
          }
        }
        
        // Quien solicita
        const quienSolicita = nuevoRiesgo.funcSolicita || 'No especificado';
        
        // Ciudad de inspección
        const ciudadInspeccion = nuevoRiesgo.ciudadSucursal || nuevoRiesgo.codigoPoblado || 'No especificada';
        
        // Dirección
        const direccion = nuevoRiesgo.codDireccion || 'No especificada';
        
        // Asegurado
        const asegurado = nuevoRiesgo.asgrBenfcro || 'No especificado';
        
        // Fecha de asignación
        const fechaAsignacion = nuevoRiesgo.fchaAsgncion 
          ? nuevoRiesgo.fchaAsgncion.toLocaleDateString('es-CO', { 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric' 
            })
          : 'No especificada';
        
        // Observación
        const observacion = nuevoRiesgo.observInspeccion || nuevoRiesgo.observAsignacion || 'No especificada';
        
        // Preparar datos para la notificación
        // IMPORTANTE: Incluir email del usuario que asigna para que reciba notificación
        const datosNotificacion = {
          tipoCaso: 'riesgo',
          esCasoRiesgo: true,
          numeroCaso: nuevoRiesgo.nmroRiesgo || `Riesgo-${nuevoRiesgo._id}`,
          nombreResponsable: responsableInfo?.nmbrRespnsble || 'Sin asignar',
          emailResponsable: responsableInfo?.email || null,
          codigoAseguradora: nuevoRiesgo.codiAsgrdra || null,
          aseguradora: nombreCliente, // Nombre completo de la aseguradora
          asegurado: asegurado,
          fechaAsignacion: fechaAsignacion,
          quienAsigna: nombreQuienAsigna, // Nombre del usuario o "Sistema"
          emailQuienAsigna: emailQuienAsigna, // Email del usuario que asigna (null si es "Sistema")
          workflow: null, // Los casos de riesgo no tienen workflow
          ciudadInspeccion: ciudadInspeccion,
          ciudadSucursal: nuevoRiesgo.ciudadSucursal || null,
          codigoPoblado: nuevoRiesgo.codigoPoblado || null,
          descripcion: observacion,
          observaciones: observacion,
          // Campos adicionales de "Iniciar Inspección"
          inspector: nombreInspector,
          clasificacion: nombreClasificacion,
          quienSolicita: quienSolicita,
          direccion: direccion,
          estado: nombreEstado
        };
        
        console.log('📧 DATOS PARA NOTIFICACIÓN:', datosNotificacion);
        
        // Enviar notificación principal
        const resultadoEmail = await enviarNotificacionAsignacion(datosNotificacion);
        
        console.log('✅ NOTIFICACIÓN PRINCIPAL ENVIADA:', resultadoEmail);
        
        // Buscar y enviar notificación al funcionario de la aseguradora
        let resultadoEmailAseguradora = null;
        if (nuevoRiesgo.codiAsgrdra) {
          try {
            const funcionarioAseguradora = await FuncionarioAseguradora.findOne({ 
              codiAsgrdra: nuevoRiesgo.codiAsgrdra 
            });
            
            if (funcionarioAseguradora && funcionarioAseguradora.email) {
              console.log('👤 FUNCIONARIO ASEGURADORA ENCONTRADO:', funcionarioAseguradora);
              
              const datosNotificacionAseguradora = {
                numeroCaso: nuevoRiesgo.nmroRiesgo || `Riesgo-${nuevoRiesgo._id}`,
                nombreResponsable: responsableInfo?.nmbrRespnsble || 'Sin asignar',
                emailResponsable: responsableInfo?.email || null,
                telefonoResponsable: responsableInfo?.telefono || null,
                aseguradora: nuevoRiesgo.codiAsgrdra || 'No especificada',
                asegurado: nuevoRiesgo.asgrBenfcro || 'No especificado',
                fechaAsignacion: nuevoRiesgo.fchaAsgncion ? nuevoRiesgo.fchaAsgncion.toLocaleDateString() : 'No especificada',
                emailFuncionarioAseguradora: funcionarioAseguradora.email
              };
              
              console.log('📧 ENVIANDO NOTIFICACIÓN A ASEGURADORA:', datosNotificacionAseguradora);
              
              resultadoEmailAseguradora = await enviarNotificacionAseguradora(datosNotificacionAseguradora);
              
              console.log('✅ NOTIFICACIÓN A ASEGURADORA ENVIADA:', resultadoEmailAseguradora);
            } else {
              console.log('⚠️ No se encontró funcionario de aseguradora o no tiene email');
            }
          } catch (emailAseguradoraError) {
            console.error('❌ ERROR ENVIANDO NOTIFICACIÓN A ASEGURADORA:', emailAseguradoraError);
            resultadoEmailAseguradora = { error: emailAseguradoraError.message };
          }
        }
        
        // Enviar notificación al creador del caso
        let resultadoEmailCreador = null;
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
              tipoCaso: 'riesgo',
              numeroCaso: nuevoRiesgo.nmroRiesgo || `Riesgo-${nuevoRiesgo._id}`,
              nombreResponsable: responsableInfo?.nmbrRespnsble || 'Sin asignar',
              aseguradora: nuevoRiesgo.codiAsgrdra || 'No especificada',
              asegurado: nuevoRiesgo.asgrBenfcro || 'No especificado',
              emailCreador: emailCreador,
              funcionarioAseguradora: nuevoRiesgo.codiAsgrdra || null
            };
            
            resultadoEmailCreador = await enviarNotificacionCreador(datosNotificacionCreador);
            console.log('✅ Notificación al creador enviada:', resultadoEmailCreador);
          } else {
            console.log('⚠️ No se pudo obtener email del creador, saltando notificación');
          }
        } catch (emailCreadorError) {
          console.error('⚠️ Error enviando notificación al creador:', emailCreadorError);
          // No fallar por error de email al creador
        }
        
        // Devolver respuesta con información de todos los emails
        res.status(201).json({
          success: true,
          message: `Caso de riesgo #${nuevoNumero} creado exitosamente`,
          riesgo: nuevoRiesgo,
          notificacionEnviada: true,
          emailInfo: resultadoEmail,
          emailAseguradora: resultadoEmailAseguradora,
          emailCreador: resultadoEmailCreador
        });
        
      } catch (emailError) {
        console.error('❌ ERROR ENVIANDO NOTIFICACIÓN:', emailError);
        
        // Aún devolver el caso creado aunque falle el email
        res.status(201).json({
          success: true,
          message: `Caso de riesgo #${nuevoNumero} creado exitosamente`,
          riesgo: nuevoRiesgo,
          notificacionEnviada: false,
          emailError: emailError.message
        });
      }
    } else {
      // No hay responsable asignado, devolver respuesta normal sin email
      res.status(201).json({
        success: true,
        message: `Caso de riesgo #${nuevoNumero} creado exitosamente`,
        riesgo: nuevoRiesgo,
        notificacionEnviada: false,
        mensaje: 'Caso creado sin responsable asignado. No se envió notificación por email.'
      });
    }
  } catch (err) {
    console.error('❌ ERROR AL GUARDAR RIESGO:', err);
    console.error('❌ DETALLES DEL ERROR:', err.message);
    res.status(500).json({ 
      success: false,
      error: 'Error al guardar el riesgo', 
      details: err.message 
    });
  }
};

export const obtenerRiesgos = async (req, res) => {
  try {
    console.log('📊 Obteniendo casos de riesgo...');
    const inicio = Date.now();
    
    // Obtener parámetros de paginación (opcional)
    const limit = parseInt(req.query.limit) || 1000; // Reducir a 1000 por defecto
    const skip = parseInt(req.query.skip) || 0;
    
    // Optimizar la consulta: limitar registros y ordenar por fecha más reciente
    // Seleccionar solo campos necesarios para reducir el tamaño de la respuesta
    const riesgos = await Riesgo.find()
      .select('nmroRiesgo codiIspector codiAsgrdra asgrBenfcro nmroConsecutivo fchaAsgncion observAsignacion adjuntoAsignacion fchaInspccion observInspeccion adjuntoInspeccion codiClasificacion fchaInforme anxoInfoFnal observInforme codDireccion funcSolicita codigoPoblado ciudadSucursal codiEstdo vlorTarifaAseguradora vlorHonorarios vlorGastos nmroFactra fchaFactra totalPagado anxoFactra createdAt updatedAt _id fchaContIni observContIni adjuntoContIni')
      .sort({ 
        // Mostrar primero los más recientes por fecha de asignación.
        // (Si fchaAsgncion es null, quedará hacia el final en orden descendente)
        fchaAsgncion: -1,
        _id: -1
      })
      .skip(skip)
      .limit(Math.min(limit, 2000)) // Máximo 2000 registros
      .lean(); // Usar lean() para mejor rendimiento
    
    // Obtener todas las ciudades para enriquecer los datos
    const ciudades = await Ciudad.find().lean();
    
    // Crear mapa de códigos de ciudad a nombres
    const mapaCiudades = {};
    ciudades.forEach(c => {
      // Mapear por todos los posibles códigos
      if (c.codiPoblado) {
        const codigo = String(c.codiPoblado).trim();
        mapaCiudades[codigo] = {
          nombre: c.descCpoblado || c.descPoblado || c.descMunicipio || codigo,
          municipio: c.descMunicipio || '',
          departamento: c.descDepto || ''
        };
      }
      if (c.codiCpoblado) {
        const codigo = String(c.codiCpoblado).trim();
        mapaCiudades[codigo] = {
          nombre: c.descCpoblado || c.descPoblado || c.descMunicipio || codigo,
          municipio: c.descMunicipio || '',
          departamento: c.descDepto || ''
        };
      }
      if (c.codiMunicipio) {
        const codigo = String(c.codiMunicipio).trim();
        mapaCiudades[codigo] = {
          nombre: c.descCpoblado || c.descPoblado || c.descMunicipio || codigo,
          municipio: c.descMunicipio || '',
          departamento: c.descDepto || ''
        };
      }
    });
    
    // Enriquecer los riesgos con datos de ciudad
    const riesgosEnriquecidos = riesgos.map(r => {
      const codigoCiudad = r.codigoPoblado || r.ciudadSucursal;
      let nombreCiudad = null;
      let municipioCiudad = null;
      let departamentoCiudad = null;
      
      if (codigoCiudad) {
        const codigo = String(codigoCiudad).trim();
        const datosCiudad = mapaCiudades[codigo];
        if (datosCiudad) {
          nombreCiudad = datosCiudad.nombre;
          municipioCiudad = datosCiudad.municipio;
          departamentoCiudad = datosCiudad.departamento;
        }
      }
      
      return {
        ...r,
        nombreCiudad,
        municipioCiudad,
        departamentoCiudad
      };
    });
    
    const tiempoTranscurrido = Date.now() - inicio;
    console.log(`✅ Casos de riesgo obtenidos y enriquecidos: ${riesgosEnriquecidos.length} en ${tiempoTranscurrido}ms`);
    
    // Si la consulta tardó mucho, advertir
    if (tiempoTranscurrido > 10000) {
      console.warn(`⚠️ La consulta tardó ${tiempoTranscurrido}ms. Considera reducir el límite o usar paginación.`);
    }
    
    res.json(riesgosEnriquecidos);
  } catch (err) {
    console.error('❌ Error al obtener los riesgos:', err);
    res.status(500).json({ error: 'Error al obtener los riesgos', details: err.message });
  }
};

export const obtenerRiesgoPorId = async (req, res) => {
  try {
    const riesgo = await Riesgo.findById(req.params.id);
    if (!riesgo) return res.status(404).json({ error: 'Riesgo no encontrado' });
    res.json(riesgo);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el riesgo' });
  }
};

export const actualizarRiesgo = async (req, res) => {
  try {
    console.log('🔄 ===== ACTUALIZANDO RIESGO =====');
    console.log('📝 DATOS RECIBIDOS EN actualizarRiesgo:', JSON.stringify(req.body, null, 2));
    
    procesarArchivosEnRequest(req);

    // Obtener el caso actual antes de actualizarlo
    const casoActual = await Riesgo.findById(req.params.id);
    if (!casoActual) {
      return res.status(404).json({ error: 'Riesgo no encontrado' });
    }
    
    console.log('📊 CASO ACTUAL:', {
      responsable: casoActual.codiIspector,
      fechaAsignacion: casoActual.fchaAsgncion
    });
    
    const datosActualizados = {
      ...mapearDatosRiesgo(req.body, casoActual.toObject()),
      nmroRiesgo: casoActual.nmroRiesgo,
    };
    
    // Actualizar el caso
    const riesgo = await Riesgo.findByIdAndUpdate(req.params.id, datosActualizados, { new: true });
    if (!riesgo) return res.status(404).json({ error: 'Riesgo no encontrado' });
    
    console.log('✅ CASO ACTUALIZADO:', {
      responsable: riesgo.codiIspector,
      fechaAsignacion: riesgo.fchaAsgncion
    });
    
    // Verificar si se asignó un nuevo responsable
    const responsableCambio = 
      (casoActual.codiIspector !== riesgo.codiIspector) ||
      (casoActual.codiRespnsble !== riesgo.codiRespnsble);
    
    const fechaAsignacionCambio = 
      casoActual.fchaAsgncion?.toISOString() !== riesgo.fchaAsgncion?.toISOString();
    
    console.log('🔍 DETECCIÓN DE CAMBIOS:', {
      responsableCambio,
      fechaAsignacionCambio,
      responsableAnterior: casoActual.codiIspector,
      responsableNuevo: riesgo.codiIspector,
      fechaAnterior: casoActual.fchaAsgncion,
      fechaNueva: riesgo.fchaAsgncion
    });
    
    // Si se asignó un nuevo responsable o se cambió la fecha de asignación, enviar notificación
    if (responsableCambio || fechaAsignacionCambio) {
      console.log('📧 ===== ENVIANDO NOTIFICACIÓN DE ASIGNACIÓN =====');
      
      try {
        // Obtener información del responsable
        let responsableInfo = null;
        if (riesgo.codiIspector) {
          responsableInfo = await Responsable.findOne({ codiRespnsble: riesgo.codiIspector });
        } else if (riesgo.codiRespnsble) {
          responsableInfo = await Responsable.findOne({ codiRespnsble: riesgo.codiRespnsble });
        }
        
        console.log('👤 INFORMACIÓN DEL RESPONSABLE:', responsableInfo);
        
        // Obtener información del usuario que está asignando el caso
        // Si hay un usuario, mostrar su nombre y email; si no, mostrar "Sistema"
        let nombreQuienAsigna = 'Sistema';
        let emailQuienAsigna = null;
        if (req.usuario && req.usuario.id) {
          try {
            const usuarioAsignador = await SecurUser.findById(req.usuario.id);
            if (usuarioAsignador) {
              if (usuarioAsignador.name) {
                nombreQuienAsigna = usuarioAsignador.name;
              }
              if (usuarioAsignador.email) {
                emailQuienAsigna = usuarioAsignador.email;
              }
              console.log('✅ Información del asignador obtenida:', { nombre: nombreQuienAsigna, email: emailQuienAsigna });
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo información del asignador:', error.message);
          }
        } else if (req.usuario && req.usuario.login) {
          try {
            const usuarioAsignador = await SecurUser.findOne({ login: req.usuario.login });
            if (usuarioAsignador) {
              if (usuarioAsignador.name) {
                nombreQuienAsigna = usuarioAsignador.name;
              }
              if (usuarioAsignador.email) {
                emailQuienAsigna = usuarioAsignador.email;
              }
              console.log('✅ Información del asignador obtenida por login:', { nombre: nombreQuienAsigna, email: emailQuienAsigna });
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo información del asignador por login:', error.message);
          }
        }
        
        // Obtener información adicional para la notificación
        // Inspector (ya tenemos responsableInfo)
        const nombreInspector = responsableInfo?.nmbrRespnsble || 'No especificado';
        
        // Cliente (Aseguradora)
        let nombreCliente = 'No especificada';
        if (riesgo.codiAsgrdra) {
          try {
            const cliente = await Cliente.findOne({ codiAsgrdra: riesgo.codiAsgrdra });
            if (cliente && cliente.rzonSocial) {
              nombreCliente = cliente.rzonSocial;
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo nombre de cliente:', error.message);
          }
        }
        
        // Clasificación
        let nombreClasificacion = 'No especificada';
        if (riesgo.codiClasificacion) {
          try {
            const clasificacion = await ClasificacionRiesgo.findOne({ 
              codIdentificador: Number(riesgo.codiClasificacion) 
            });
            if (clasificacion && clasificacion.rzonDescripcion) {
              nombreClasificacion = clasificacion.rzonDescripcion;
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo clasificación:', error.message);
          }
        }
        
        // Estado
        let nombreEstado = 'No especificado';
        if (riesgo.codiEstdo) {
          try {
            const estado = await Estado.findOne({ codiEstado: riesgo.codiEstdo });
            if (estado && estado.descEstado) {
              nombreEstado = estado.descEstado;
            }
          } catch (error) {
            console.log('⚠️ Error obteniendo estado:', error.message);
          }
        }
        
        // Quien solicita
        const quienSolicita = riesgo.funcSolicita || 'No especificado';
        
        // Ciudad de inspección
        const ciudadInspeccion = riesgo.ciudadSucursal || riesgo.codigoPoblado || 'No especificada';
        
        // Dirección
        const direccion = riesgo.codDireccion || 'No especificada';
        
        // Asegurado
        const asegurado = riesgo.asgrBenfcro || 'No especificado';
        
        // Fecha de asignación
        const fechaAsignacion = riesgo.fchaAsgncion 
          ? riesgo.fchaAsgncion.toLocaleDateString('es-CO', { 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric' 
            })
          : 'No especificada';
        
        // Observación
        const observacion = riesgo.observInspeccion || riesgo.observAsignacion || 'No especificada';
        
        // Preparar datos para la notificación
        // IMPORTANTE: Incluir email del usuario que asigna para que reciba notificación
        const datosNotificacion = {
          tipoCaso: 'riesgo',
          esCasoRiesgo: true,
          numeroCaso: riesgo.nmroRiesgo || `Riesgo-${riesgo._id}`,
          nombreResponsable: responsableInfo?.nmbrRespnsble || 'Sin asignar',
          emailResponsable: responsableInfo?.email || null,
          codigoAseguradora: riesgo.codiAsgrdra || null,
          aseguradora: nombreCliente, // Nombre completo de la aseguradora
          asegurado: asegurado,
          fechaAsignacion: fechaAsignacion,
          quienAsigna: nombreQuienAsigna, // Nombre del usuario o "Sistema"
          emailQuienAsigna: emailQuienAsigna, // Email del usuario que asigna (null si es "Sistema")
          workflow: null, // Los casos de riesgo no tienen workflow
          ciudadInspeccion: ciudadInspeccion,
          ciudadSucursal: riesgo.ciudadSucursal || null,
          codigoPoblado: riesgo.codigoPoblado || null,
          descripcion: observacion,
          observaciones: observacion,
          // Campos adicionales de "Iniciar Inspección"
          inspector: nombreInspector,
          clasificacion: nombreClasificacion,
          quienSolicita: quienSolicita,
          direccion: direccion,
          estado: nombreEstado
        };
        
        console.log('📧 DATOS PARA NOTIFICACIÓN:', datosNotificacion);
        
        // Enviar notificación principal
        const resultadoEmail = await enviarNotificacionAsignacion(datosNotificacion);
        
        console.log('✅ NOTIFICACIÓN PRINCIPAL ENVIADA:', resultadoEmail);
        
        // Buscar y enviar notificación al funcionario de la aseguradora
        let resultadoEmailAseguradora = null;
        if (riesgo.codiAsgrdra) {
          try {
            const funcionarioAseguradora = await FuncionarioAseguradora.findOne({ 
              codiAsgrdra: riesgo.codiAsgrdra 
            });
            
            if (funcionarioAseguradora && funcionarioAseguradora.email) {
              console.log('👤 FUNCIONARIO ASEGURADORA ENCONTRADO:', funcionarioAseguradora);
              
              const datosNotificacionAseguradora = {
                numeroCaso: riesgo.nmroRiesgo || `Riesgo-${riesgo._id}`,
                nombreResponsable: responsableInfo?.nmbrRespnsble || 'Sin asignar',
                emailResponsable: responsableInfo?.email || null,
                telefonoResponsable: responsableInfo?.telefono || null,
                aseguradora: riesgo.codiAsgrdra || 'No especificada',
                asegurado: riesgo.asgrBenfcro || 'No especificado',
                fechaAsignacion: riesgo.fchaAsgncion ? riesgo.fchaAsgncion.toLocaleDateString() : 'No especificada',
                emailFuncionarioAseguradora: funcionarioAseguradora.email
              };
              
              console.log('📧 ENVIANDO NOTIFICACIÓN A ASEGURADORA:', datosNotificacionAseguradora);
              
              resultadoEmailAseguradora = await enviarNotificacionAseguradora(datosNotificacionAseguradora);
              
              console.log('✅ NOTIFICACIÓN A ASEGURADORA ENVIADA:', resultadoEmailAseguradora);
            } else {
              console.log('⚠️ No se encontró funcionario de aseguradora o no tiene email');
            }
          } catch (emailAseguradoraError) {
            console.error('❌ ERROR ENVIANDO NOTIFICACIÓN A ASEGURADORA:', emailAseguradoraError);
            resultadoEmailAseguradora = { error: emailAseguradoraError.message };
          }
        }
        
        // Devolver respuesta con información de ambos emails
        res.json({
          ...riesgo.toObject(),
          notificacionEnviada: true,
          emailInfo: resultadoEmail,
          emailAseguradora: resultadoEmailAseguradora
        });
        
      } catch (emailError) {
        console.error('❌ ERROR ENVIANDO NOTIFICACIÓN:', emailError);
        
        // Aún devolver el caso actualizado aunque falle el email
        res.json({
          ...riesgo.toObject(),
          notificacionEnviada: false,
          emailError: emailError.message
        });
      }
    } else {
      // No hubo cambios en la asignación, devolver respuesta normal
      res.json(riesgo);
    }
    
  } catch (err) {
    console.error('❌ ERROR ACTUALIZANDO RIESGO:', err);
    res.status(500).json({ error: 'Error al actualizar el riesgo' });
  }
};

export const eliminarRiesgo = async (req, res) => {
  try {
    const riesgo = await Riesgo.findByIdAndDelete(req.params.id);
    if (!riesgo) return res.status(404).json({ error: 'Riesgo no encontrado' });
    res.json({ mensaje: 'Riesgo eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar el riesgo' });
  }
};

export const buscarRiesgos = async (req, res) => {
  try {
    const filtros = {};
    Object.keys(req.query).forEach(key => {
      if (req.query[key]) filtros[key] = { $regex: req.query[key], $options: 'i' };
    });
    const riesgos = await Riesgo.find(filtros);
    res.json(riesgos);
  } catch (err) {
    res.status(500).json({ error: 'Error al buscar riesgos' });
  }
}; 