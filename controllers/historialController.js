import HistorialFormulario from '../models/HistorialFormulario.js';
import SecurUser from '../models/SecurUser.js';
import Complex from '../models/Complex.js';
import ComplexSubtarea from '../models/ComplexSubtarea.js';
import CasoComplex from '../models/CasoComplex.js';
import Responsable from '../models/Responsable.js';
import { UPLOADS_ROOT } from '../config/uploadsRoot.js';
import { deleteReplacedStoredFile, deleteStoredFile } from '../services/fileStorageService.js';
import {
  collectPathsFromHistorialDatos,
  deleteHistorialFormularioFiles,
  deleteOrphanedStoredFiles,
} from '../utils/storedFileCleanup.js';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Obtener __dirname equivalente para módulos ES6
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const construirFiltroPorNumeroAjuste = (numeroAjuste) => ({
  eliminado: { $ne: true },
  $or: [
    { numeroCaso: numeroAjuste },
    { 'datos.numeroCaso': numeroAjuste },
    { 'datos.numeroAjuste': numeroAjuste },
    { 'trazabilidadSecuencia.numeroAjuste': numeroAjuste }
  ]
});

/** Extrae nombre de asegurado/tomador aunque venga como objeto. */
const textoAseguradoHistorial = (...candidatos) => {
  for (const raw of candidatos) {
    if (raw == null || raw === '') continue;
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (t && t !== 'N/A' && t !== '[object Object]') return t;
      continue;
    }
    if (typeof raw === 'object') {
      const t = String(raw.nombre || raw.name || raw.razonSocial || raw.asegurado || '').trim();
      if (t && t !== 'N/A') return t;
    }
  }
  return '';
};

const esTipoAjusteHistorial = (tipo) => String(tipo || '').toLowerCase().includes('ajuste');

const enriquecerTituloAjusteConAsegurado = (titulo, asegurado, tipo) => {
  const tituloBase = String(titulo || '').trim();
  const aseg = textoAseguradoHistorial(asegurado);
  if (!aseg || !esTipoAjusteHistorial(tipo)) return tituloBase;
  if (tituloBase.toLowerCase().includes(aseg.toLowerCase())) return tituloBase;
  return tituloBase ? `${tituloBase} - ${aseg}` : `Informe de Ajuste - ${aseg}`;
};

const adjuntarAseguradoEnListado = async (formularios = []) => {
  if (!Array.isArray(formularios) || formularios.length === 0) return formularios;
  const ids = formularios.map((f) => f._id).filter(Boolean);
  if (ids.length === 0) return formularios;

  const extras = await HistorialFormulario.find({ _id: { $in: ids } })
    .select('asegurado datos.asegurado datos.tomador tipo titulo')
    .lean();
  const porId = new Map(extras.map((e) => [String(e._id), e]));

  return formularios.map((f) => {
    const extra = porId.get(String(f._id));
    const asegurado = textoAseguradoHistorial(
      f.asegurado,
      extra?.asegurado,
      extra?.datos?.asegurado,
      extra?.datos?.tomador
    );
    const tipo = f.tipo || extra?.tipo;
    const titulo = enriquecerTituloAjusteConAsegurado(f.titulo || extra?.titulo, asegurado, tipo);
    return {
      ...f,
      asegurado,
      titulo: titulo || f.titulo
    };
  });
};

const normalizarClaveComparable = (valor) =>
  String(valor || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

const construirIdentidadesUsuario = (usuarioActual, usuarioBD = null) => {
  const identidades = new Set();
  const agregar = (valor) => {
    const raw = String(valor || '').trim();
    if (!raw) return;
    identidades.add(raw);
    identidades.add(normalizarClaveComparable(raw));
  };

  agregar(usuarioActual?.id);
  agregar(usuarioActual?.login);
  agregar(usuarioActual?.name);
  agregar(usuarioActual?.nombre);
  agregar(usuarioActual?.cedula);
  agregar(usuarioBD?._id);
  agregar(usuarioBD?.login);
  agregar(usuarioBD?.name);
  agregar(usuarioBD?.cedula);

  return identidades;
};

const valoresResponsableCaso = (caso) => {
  const valores = new Set();
  const agregar = (valor) => {
    const raw = String(valor || '').trim();
    if (!raw) return;
    valores.add(raw);
    valores.add(normalizarClaveComparable(raw));
  };

  agregar(caso?.codiRespnsble);
  agregar(caso?.codi_responble);
  agregar(caso?.responsable);
  agregar(caso?.nombreResponsable);
  return valores;
};

/**
 * Permite abrir el ajuste al responsable asignado del caso Complex,
 * aunque el formulario lo haya creado un admin/soporte.
 */
async function esResponsableAsignadoDelFormulario(usuarioActual, formulario, usuarioBD = null) {
  try {
    const numeroAjuste = String(
      formulario?.numeroCaso ||
      formulario?.datos?.numeroAjuste ||
      formulario?.datos?.numeroCaso ||
      formulario?.trazabilidadSecuencia?.numeroAjuste ||
      ''
    ).trim();

    if (!numeroAjuste) return false;

    const filtroNumero = {
      $or: [
        { nmroAjste: numeroAjuste },
        { nmroAjste: numeroAjuste.toUpperCase() },
        { nmroAjste: { $regex: new RegExp(`^${numeroAjuste.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ]
    };

    let caso =
      (await Complex.findOne(filtroNumero).select('nmroAjste codiRespnsble').lean()) ||
      (await CasoComplex.findOne(filtroNumero).select('nmroAjste codiRespnsble').lean());

    if (!caso?.codiRespnsble) return false;

    const identidadesUsuario = construirIdentidadesUsuario(usuarioActual, usuarioBD);
    const responsablesCaso = valoresResponsableCaso(caso);

    // Si coincide directo (login/cédula/nombre = codiRespnsble del caso)
    for (const valor of responsablesCaso) {
      if (identidadesUsuario.has(valor)) return true;
    }

    // Resolver catálogo de responsables por código o nombre
    const codigoResponsable = String(caso.codiRespnsble).trim();
    const responsableDB = await Responsable.findOne({
      $or: [
        { codiRespnsble: codigoResponsable },
        { nmbrRespnsble: codigoResponsable },
        { codiRespnsble: { $regex: new RegExp(`^${codigoResponsable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        { nmbrRespnsble: { $regex: new RegExp(`^${codigoResponsable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ]
    }).lean();

    if (!responsableDB) return false;

    const valoresCatalogo = new Set();
    for (const valor of [
      responsableDB.codiRespnsble,
      responsableDB.nmbrRespnsble,
      responsableDB.email
    ]) {
      const raw = String(valor || '').trim();
      if (!raw) continue;
      valoresCatalogo.add(raw);
      valoresCatalogo.add(normalizarClaveComparable(raw));
    }

    for (const valor of valoresCatalogo) {
      if (identidadesUsuario.has(valor)) return true;
    }

    // Cruzar por email del responsable contra el usuario logueado
    if (responsableDB.email) {
      const emailResp = String(responsableDB.email).trim().toLowerCase();
      const emailUsuario = String(
        usuarioBD?.email || usuarioActual?.email || ''
      ).trim().toLowerCase();
      if (emailResp && emailUsuario && emailResp === emailUsuario) return true;
    }

    return false;
  } catch (error) {
    console.error('⚠️ Error verificando responsable asignado del formulario:', error);
    return false;
  }
}

/** Misma raíz que `app.js` y multer (`UPLOADS_ROOT`) + fallbacks por cwd o repo raíz. */
function obtenerRaicesUploadsFisicas() {
  const set = new Set();
  const add = (p) => {
    if (!p) return;
    set.add(path.normalize(p));
  };
  add(UPLOADS_ROOT);
  add(path.join(__dirname, '..', 'uploads'));
  add(path.resolve(process.cwd(), 'uploads'));
  // Antes PM2 cwd = repo: archivos viejos podrían estar en <repo>/uploads
  add(path.join(UPLOADS_ROOT, '..', '..', 'uploads'));
  return [...set];
}

const MAX_DEPTH_BUSQUEDA_ARCHIVO = 16;

async function buscarArchivoPorNombreEnArbol(raiz, nombreArchivo, maxDepth = MAX_DEPTH_BUSQUEDA_ARCHIVO) {
  const objetivo = path.basename(String(nombreArchivo || '')).toLowerCase();
  if (!objetivo) return null;

  async function walk(dir, depth) {
    if (depth > maxDepth) return null;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = await walk(full, depth + 1);
        if (found) return found;
      } else if (e.name.toLowerCase() === objetivo) {
        return full;
      }
    }
    return null;
  }

  try {
    await fs.access(raiz);
  } catch {
    return null;
  }
  return walk(raiz, 0);
}

function construirRutasCandidatasArchivo(entorno, nombreArchivo, rutaRelativa, carpetaCaso) {
  const raices = obtenerRaicesUploadsFisicas();
  const candidatas = [];

  const pushUnique = (p) => {
    if (!p) return;
    const n = path.normalize(p);
    if (!candidatas.includes(n)) candidatas.push(n);
  };

  for (const raiz of raices) {
    if (rutaRelativa && rutaRelativa !== nombreArchivo) {
      pushUnique(path.join(raiz, rutaRelativa));
    }
    if (carpetaCaso && nombreArchivo) {
      pushUnique(path.join(raiz, carpetaCaso, nombreArchivo));
    }
    if (nombreArchivo) {
      pushUnique(path.join(raiz, nombreArchivo));
    }
  }

  if (entorno !== 'development') {
    const legacy = [
      rutaRelativa && rutaRelativa !== nombreArchivo
        ? path.join('/var/www/uploads', rutaRelativa)
        : null,
      carpetaCaso && nombreArchivo ? path.join('/var/www/uploads', carpetaCaso, nombreArchivo) : null,
      nombreArchivo ? path.join('/var/www/uploads', nombreArchivo) : null,
      rutaRelativa && rutaRelativa !== nombreArchivo
        ? path.join('/home/ubuntu/uploads', rutaRelativa)
        : null,
      carpetaCaso && nombreArchivo ? path.join('/home/ubuntu/uploads', carpetaCaso, nombreArchivo) : null,
      nombreArchivo ? path.join('/home/ubuntu/uploads', nombreArchivo) : null
    ].filter(Boolean);
    for (const p of legacy) pushUnique(p);
  }

  return candidatas;
}

class HistorialController {
  construirFiltroPorNumeroAjuste(numeroAjuste) {
    return construirFiltroPorNumeroAjuste(numeroAjuste);
  }

  // Obtener secuencia por número de ajuste (sin afectar trazabilidad antigua)
  async obtenerSecuenciaPorNumeroAjuste(req, res) {
    try {
      const numeroAjuste = String(req.params.numeroAjuste || '').trim();
      if (!numeroAjuste) {
        return res.status(400).json({
          success: false,
          error: 'numeroAjuste es requerido'
        });
      }

      const formulario = await HistorialFormulario.findOne(construirFiltroPorNumeroAjuste(numeroAjuste))
        .sort({ fechaModificacion: -1, createdAt: -1 })
        .select('numeroCaso casoId carpetaCaso tipo titulo trazabilidadSecuencia fechaModificacion')
        .lean();

      return res.json({
        success: true,
        existe: !!formulario,
        numeroAjuste,
        formularioId: formulario?._id || null,
        secuencia: formulario?.trazabilidadSecuencia || null
      });
    } catch (error) {
      console.error('Error obteniendo secuencia por número de ajuste:', error);
      return res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        detalles: process.env.NODE_ENV === 'development' ? error?.message : undefined
      });
    }
  }

  // Upsert de secuencia por número de ajuste (aditivo, no borra histórico)
  async upsertSecuenciaPorNumeroAjuste(req, res) {
    try {
      const numeroAjuste = String(req.params.numeroAjuste || '').trim();
      const { tipoVersion, paso = {} } = req.body || {};

      if (!numeroAjuste) {
        return res.status(400).json({
          success: false,
          error: 'numeroAjuste es requerido'
        });
      }

      const tipoVersionNormalizado = String(tipoVersion || '').trim().toLowerCase();
      const pasoMap = {
        inspeccion: 'inspeccion',
        preliminar: 'preliminar',
        actualizacion: 'actualizacion',
        final: 'final'
      };
      const pasoKey = pasoMap[tipoVersionNormalizado];

      if (!pasoKey) {
        return res.status(400).json({
          success: false,
          error: 'tipoVersion debe ser: inspeccion, preliminar, actualizacion o final'
        });
      }

      const formulario = await HistorialFormulario.findOne(construirFiltroPorNumeroAjuste(numeroAjuste))
        .sort({ fechaModificacion: -1, createdAt: -1 });

      if (!formulario) {
        return res.status(404).json({
          success: false,
          error: `No se encontró formulario asociado al número de ajuste ${numeroAjuste}`
        });
      }

      if (!formulario.trazabilidadSecuencia) {
        formulario.trazabilidadSecuencia = {
          numeroAjuste,
          pasos: {}
        };
      }

      if (!formulario.trazabilidadSecuencia.pasos) {
        formulario.trazabilidadSecuencia.pasos = {};
      }

      const pasoExistente = formulario.trazabilidadSecuencia.pasos[pasoKey] || {};
      formulario.trazabilidadSecuencia.numeroAjuste = numeroAjuste;
      formulario.trazabilidadSecuencia.pasos[pasoKey] = {
        ...pasoExistente,
        ...paso,
        orden:
          pasoKey === 'inspeccion'
            ? 0
            : pasoKey === 'preliminar'
              ? 1
              : pasoKey === 'actualizacion'
                ? 2
                : 3,
        tipoVersion: pasoKey,
        fecha: paso.fecha ? new Date(paso.fecha) : (pasoExistente.fecha || new Date()),
        usuario: paso.usuario || pasoExistente.usuario || req.user?.login || req.user?.id || 'sistema'
      };

      formulario.markModified('trazabilidadSecuencia');
      formulario.fechaModificacion = new Date();
      await formulario.save();

      return res.json({
        success: true,
        numeroAjuste,
        formularioId: formulario._id,
        secuencia: formulario.trazabilidadSecuencia
      });
    } catch (error) {
      console.error('Error actualizando secuencia por número de ajuste:', error);
      return res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        detalles: process.env.NODE_ENV === 'development' ? error?.message : undefined
      });
    }
  }

  // Obtener todos los formularios del historial con filtros
  async obtenerHistorial(req, res) {
    try {
      const {
        tipo,
        usuario,
        fechaDesde,
        fechaHasta,
        estado,
        pagina = 1,
        limite = 1000, // Aumentar límite por defecto para mostrar más casos
        ordenar = 'fechaCreacion',
        direccion = 'desc'
      } = req.query;

      // Obtener información del usuario del token
      const usuarioActual = req.user;
      const rolUsuario = usuarioActual?.role || usuarioActual?.rol || '';
      const userIdUsuario = usuarioActual?.id || usuarioActual?.login || '';

      console.log('🔍 Usuario actual:', {
        id: userIdUsuario,
        login: usuarioActual?.login,
        rol: rolUsuario
      });

      // Construir filtros
      const filtros = {
        eliminado: { $ne: true } // Excluir formularios eliminados explícitamente
      };
      
      // FILTRAR POR USUARIO: Solo admin y soporte ven todos los formularios
      // Los usuarios normales (incluyendo visualizador) solo ven sus propios formularios
      const esAdminOSoporte = rolUsuario === 'admin' || rolUsuario === 'soporte';
      
      if (!esAdminOSoporte && userIdUsuario) {
        // Usuario normal o visualizador: solo ver sus propios formularios
        // Mejorar la búsqueda: primero obtener el usuario completo de la BD para buscar todos sus formularios
        const condicionesUsuario = [];
        const userIdStr = String(userIdUsuario);
        
        console.log('👤 === FILTRO PARA USUARIO NORMAL ===');
        console.log('📋 userIdUsuario recibido:', userIdUsuario);
        console.log('📋 userIdStr:', userIdStr);
        
        try {
          // Buscar el usuario en la BD para obtener su _id y login
          let usuarioBD = null;
          
          // Primero intentar buscar por _id del token (más confiable)
          if (usuarioActual?.id) {
            const idToken = usuarioActual.id;
            // Si es ObjectId o string válido de ObjectId
            if (mongoose.Types.ObjectId.isValid(idToken)) {
              usuarioBD = await SecurUser.findById(idToken);
            }
          }
          
          // Si no se encontró, buscar por login
          if (!usuarioBD && usuarioActual?.login) {
            usuarioBD = await SecurUser.findOne({ login: usuarioActual.login });
          }
          
          // Si aún no se encontró, intentar con userIdUsuario directamente
          if (!usuarioBD && mongoose.Types.ObjectId.isValid(userIdStr) && userIdStr.length === 24) {
            usuarioBD = await SecurUser.findById(userIdStr);
          }
          
          // Si aún no se encontró, intentar buscar por login usando userIdUsuario
          if (!usuarioBD && userIdStr && userIdStr !== usuarioActual?.login) {
            usuarioBD = await SecurUser.findOne({ login: userIdStr });
          }
          
          if (usuarioBD) {
            const userIdObjectId = usuarioBD._id;
            const userIdString = userIdObjectId.toString();
            const userLogin = usuarioBD.login;
            
            console.log('✅ Usuario encontrado en BD:', {
              _id: userIdObjectId,
              _idString: userIdString,
              login: userLogin
            });
            
            // Crear lista de valores posibles para userId y usuario
            // IMPORTANTE: Incluir todos los formatos posibles para asegurar que se encuentren TODOS los formularios
            const valoresPosibles = new Set();
            
            // Agregar _id como string
            valoresPosibles.add(userIdString);
            
            // Agregar login si es diferente
            if (userLogin && userLogin.trim()) {
              valoresPosibles.add(userLogin.trim());
            }
            
            // También agregar el valor original del token si es diferente
            if (usuarioActual?.id && String(usuarioActual.id) !== userIdString) {
              valoresPosibles.add(String(usuarioActual.id));
            }
            if (usuarioActual?.login && usuarioActual.login.trim() !== userIdString) {
              valoresPosibles.add(usuarioActual.login.trim());
            }
            
            const valoresArray = Array.from(valoresPosibles);
            console.log('📋 Valores posibles para buscar:', valoresArray);
            
            // Buscar formularios donde userId o usuario estén en la lista de valores posibles
            condicionesUsuario.push(
              { userId: { $in: valoresArray } },
              { usuario: { $in: valoresArray } }
            );
          } else {
            // Si no se encuentra el usuario en BD, buscar directamente con todos los valores del token (fallback)
            console.log('⚠️ Usuario no encontrado en BD, usando búsqueda directa con valores del token');
            const valoresFallback = new Set();
            
            if (usuarioActual?.id) {
              valoresFallback.add(String(usuarioActual.id));
            }
            if (usuarioActual?.login) {
              valoresFallback.add(String(usuarioActual.login).trim());
            }
            if (userIdStr) {
              valoresFallback.add(userIdStr.trim());
            }
            
            const valoresFallbackArray = Array.from(valoresFallback);
            condicionesUsuario.push(
              { userId: { $in: valoresFallbackArray } },
              { usuario: { $in: valoresFallbackArray } }
            );
            
            // Si parece ser un ObjectId válido, también buscarlo como ObjectId (por si acaso MongoDB lo guardó así)
            if (usuarioActual?.id && mongoose.Types.ObjectId.isValid(usuarioActual.id)) {
              try {
                const objectId = new mongoose.Types.ObjectId(usuarioActual.id);
                condicionesUsuario.push(
                  { userId: objectId },
                  { usuario: objectId }
                );
              } catch (e) {
                // Ignorar error
              }
            }
          }
        } catch (error) {
          console.error('⚠️ Error buscando usuario en BD para filtro:', error);
          // Fallback: buscar directamente con todos los valores disponibles del token
          const valoresError = new Set();
          if (usuarioActual?.id) valoresError.add(String(usuarioActual.id));
          if (usuarioActual?.login) valoresError.add(String(usuarioActual.login).trim());
          if (userIdStr) valoresError.add(userIdStr.trim());
          
          condicionesUsuario.push(
            { userId: { $in: Array.from(valoresError) } },
            { usuario: { $in: Array.from(valoresError) } }
          );
        }
        
        // Usar $or para buscar en múltiples campos de usuario
        if (condicionesUsuario.length > 0) {
          filtros.$or = condicionesUsuario;
          console.log('✅ Filtro $or aplicado con', condicionesUsuario.length, 'condiciones para usuario normal');
        }
        
        // ADICIONAL: También buscar por nombreUsuario como fallback adicional
        // Esto ayuda a encontrar formularios incluso si el userId/usuario no coincide exactamente
        try {
          if (usuarioActual?.login) {
            // Obtener el nombre completo del usuario desde BD si está disponible
            let nombreUsuarioParaBuscar = null;
            try {
              const usuarioBDNombre = await SecurUser.findOne({ login: usuarioActual.login }).select('name').lean();
              if (usuarioBDNombre?.name) {
                nombreUsuarioParaBuscar = usuarioBDNombre.name.trim();
                console.log('🔍 Nombre de usuario para búsqueda adicional:', nombreUsuarioParaBuscar);
              }
            } catch (e) {
              // Ignorar error
            }
            
            // Si encontramos un nombre, agregar búsqueda por nombreUsuario también
            // PERO solo si no hay $or ya establecido (para evitar conflictos)
            // En realidad, vamos a agregarlo al $or existente
            if (nombreUsuarioParaBuscar && condicionesUsuario.length > 0) {
              // Agregar búsqueda por nombreUsuario al $or existente
              condicionesUsuario.push({ nombreUsuario: { $regex: nombreUsuarioParaBuscar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } });
              filtros.$or = condicionesUsuario;
              console.log('✅ Agregada búsqueda por nombreUsuario al filtro:', nombreUsuarioParaBuscar);
            }
          }
        } catch (error) {
          console.error('⚠️ Error en búsqueda adicional por nombreUsuario:', error);
          // No fallar si esto falla
        }
      } else if (esAdminOSoporte) {
        console.log('👑 Admin/Soporte: viendo todos los formularios');
      }
      
      if (tipo && tipo !== 'todos') {
        filtros.tipo = tipo;
      }
      
      if (usuario) {
        // Si es admin o soporte, buscar formularios del usuario seleccionado
        if (esAdminOSoporte) {
          const usuarioStr = String(usuario).trim();
          const condicionesUsuarioBusqueda = [];
          
          console.log('🔍 === FILTRO DE USUARIO ===');
          console.log('📋 Valor recibido para filtrar:', usuarioStr);
          
          // PRIMERO: Buscar el usuario en la BD para obtener su _id y login
          try {
            let usuarioBD = null;
            
            // Intentar buscar por login (más común cuando viene del select)
            usuarioBD = await SecurUser.findOne({ login: usuarioStr });
            
            // Si no se encontró y parece ser un ObjectId válido, buscar por _id
            if (!usuarioBD && mongoose.Types.ObjectId.isValid(usuarioStr) && usuarioStr.length === 24) {
              usuarioBD = await SecurUser.findById(usuarioStr);
            }
            
            if (usuarioBD) {
              const userIdObjectId = usuarioBD._id;
              const userIdString = userIdObjectId.toString();
              const userLogin = usuarioBD.login;
              const userName = usuarioBD.name || usuarioBD.email || 'Usuario';
              
              console.log('✅ Usuario encontrado para filtro:', {
                _id: userIdObjectId,
                _idString: userIdString,
                login: userLogin,
                name: userName
              });
              
              // IMPORTANTE: userId y usuario son campos String en el modelo, pero pueden contener:
              // - ObjectId convertido a string (ej: "507f1f77bcf86cd799439011")
              // - Login como string (ej: "72253708")
              // - ObjectId como ObjectId (si MongoDB lo guardó así a pesar del schema)
              // Por lo tanto, debemos buscar TODOS los formatos posibles
              
              // Crear lista de valores posibles para userId y usuario
              const valoresPosiblesString = [];
              const valoresPosiblesObjectId = [];
              
              // Agregar ObjectId como string (formato más común)
              valoresPosiblesString.push(userIdString);
              
              // Agregar login si es diferente (algunos formularios pueden tenerlo guardado así)
              if (userLogin && userLogin !== userIdString) {
                valoresPosiblesString.push(userLogin);
              }
              
              // También agregar ObjectId directo por si MongoDB lo guardó como ObjectId
              valoresPosiblesObjectId.push(userIdObjectId);
              
              console.log('📋 Valores posibles para buscar:');
              console.log('   - Como strings:', valoresPosiblesString);
              console.log('   - Como ObjectId:', valoresPosiblesObjectId.length > 0 ? 'Sí' : 'No');
              
              // Buscar formularios donde userId o usuario coincidan con cualquiera de los valores
              // Buscar como strings primero (más común)
              condicionesUsuarioBusqueda.push(
                { userId: { $in: valoresPosiblesString } },
                { usuario: { $in: valoresPosiblesString } }
              );
              
              // También buscar como ObjectId (por si MongoDB guardó algunos como ObjectId)
              if (valoresPosiblesObjectId.length > 0) {
                condicionesUsuarioBusqueda.push(
                  { userId: { $in: valoresPosiblesObjectId } },
                  { usuario: { $in: valoresPosiblesObjectId } }
                );
              }
              
              // También buscar por nombreUsuario para casos donde el nombre coincida
              // (esto es importante para encontrar formularios aunque el userId/usuario no coincida exactamente)
              if (userName) {
                const nombreEscapado = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                condicionesUsuarioBusqueda.push(
                  { nombreUsuario: { $regex: nombreEscapado, $options: 'i' } }
                );
              }
              
              console.log('📋 Condiciones de búsqueda creadas:', condicionesUsuarioBusqueda.length, 'condiciones');
            } else {
              // Si no se encuentra el usuario en BD, buscar directamente por el string (fallback)
              console.log('⚠️ Usuario no encontrado en BD, buscando directamente por string:', usuarioStr);
              condicionesUsuarioBusqueda.push(
                { userId: usuarioStr },
                { usuario: usuarioStr },
                { nombreUsuario: { $regex: usuarioStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
              );
              
              // Si parece ser un ObjectId válido, también buscarlo como ObjectId
              if (mongoose.Types.ObjectId.isValid(usuarioStr) && usuarioStr.length === 24) {
                try {
                  const objectId = new mongoose.Types.ObjectId(usuarioStr);
                  condicionesUsuarioBusqueda.push(
                    { userId: objectId },
                    { usuario: objectId }
                  );
                } catch (e) {
                  console.error('⚠️ Error creando ObjectId:', e);
                }
              }
            }
          } catch (error) {
            console.error('⚠️ Error buscando usuario para filtro:', error);
            // Fallback: buscar directamente por string
            condicionesUsuarioBusqueda.push(
              { userId: usuarioStr },
              { usuario: usuarioStr },
              { nombreUsuario: { $regex: usuarioStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
            );
          }
          
          // Para admin/soporte, el filtro de usuario de búsqueda se aplica con $or
          // (no hay conflicto porque admin/soporte no tiene $or de filtro por usuario actual)
          if (condicionesUsuarioBusqueda.length > 0) {
            // Si ya existe un $or (del filtro por usuario actual), combinarlo con $and
            // Pero como es admin/soporte, no debería haber $or previo
            filtros.$or = condicionesUsuarioBusqueda;
            console.log('✅ Filtro $or aplicado con', condicionesUsuarioBusqueda.length, 'condiciones');
          }
        } else {
          // Para usuarios normales, solo buscar por nombreUsuario (y ya está filtrado por su userId)
          filtros.nombreUsuario = { $regex: usuario, $options: 'i' };
        }
      }
      
      if (estado) {
        filtros.estado = estado;
      }
      
      if (fechaDesde || fechaHasta) {
        filtros.fechaCreacion = {};
        if (fechaDesde) {
          filtros.fechaCreacion.$gte = new Date(fechaDesde);
        }
        if (fechaHasta) {
          filtros.fechaCreacion.$lte = new Date(fechaHasta);
        }
      }

      // Configurar paginación
      const skip = (parseInt(pagina) - 1) * parseInt(limite);
      const orden = {};
      orden[ordenar] = direccion === 'desc' ? -1 : 1;

      // Log de los filtros antes de ejecutar la consulta
      console.log('🔍 Filtros finales para la consulta:', JSON.stringify(filtros, null, 2));
      
      // Ejecutar consulta - OPTIMIZADO: No incluir el campo 'datos' completo para mejor rendimiento
      let formularios = await HistorialFormulario.find(filtros)
        .sort(orden)
        .skip(skip)
        .limit(parseInt(limite))
        .select('-__v -eliminado -datos') // Excluir 'datos' que puede ser muy grande
        .lean(); // Usar lean() para mejor rendimiento
      
      console.log('✅ Formularios encontrados:', formularios.length);
      
      // Debug: mostrar algunos userIds de los formularios encontrados
      if (formularios.length > 0) {
        console.log('🔍 Sample de userIds en formularios encontrados (primeros 3):', 
          formularios.slice(0, 3).map(f => ({ 
            userId: f.userId, 
            usuario: f.usuario,
            nombreUsuario: f.nombreUsuario 
          }))
        );
      }
      
      // Para usuarios normales: hacer una búsqueda adicional por nombreUsuario si parece que faltan formularios
      if (!esAdminOSoporte && formularios.length > 0) {
        try {
          // Obtener información del usuario para búsqueda adicional
          let usuarioBD = null;
          if (usuarioActual?.id && mongoose.Types.ObjectId.isValid(usuarioActual.id)) {
            usuarioBD = await SecurUser.findById(usuarioActual.id);
          } else if (usuarioActual?.login) {
            usuarioBD = await SecurUser.findOne({ login: usuarioActual.login });
          }
          
          if (usuarioBD) {
            const nombreUsuarioCompleto = (usuarioBD.name || '').trim();
            
            if (nombreUsuarioCompleto) {
              // Buscar formularios adicionales por nombreUsuario que no se encontraron antes
              const idsEncontrados = new Set(formularios.map(f => String(f._id)));
              
              // Crear filtro adicional solo por nombreUsuario
              const filtrosAdicionales = {
                eliminado: { $ne: true },
                nombreUsuario: { $regex: nombreUsuarioCompleto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
              };
              
              // Aplicar otros filtros también si existen
              if (tipo && tipo !== 'todos') {
                filtrosAdicionales.tipo = tipo;
              }
              if (estado) {
                filtrosAdicionales.estado = estado;
              }
              
              const formulariosAdicionales = await HistorialFormulario.find(filtrosAdicionales)
                .select('_id userId usuario nombreUsuario titulo fechaCreacion')
                .lean();
              
              // Filtrar los que ya están en la lista
              const formulariosNuevos = formulariosAdicionales.filter(f => !idsEncontrados.has(String(f._id)));
              
              if (formulariosNuevos.length > 0) {
                console.log('✅ Encontrados', formulariosNuevos.length, 'formularios adicionales por nombreUsuario:', nombreUsuarioCompleto);
                console.log('🔍 Formularios adicionales:', formulariosNuevos.map(f => ({
                  _id: f._id,
                  userId: f.userId,
                  usuario: f.usuario,
                  nombreUsuario: f.nombreUsuario,
                  titulo: f.titulo
                })));
                
                // Obtener los formularios completos y agregarlos a la lista
                const idsNuevos = formulariosNuevos.map(f => f._id);
                const formulariosCompletos = await HistorialFormulario.find({ _id: { $in: idsNuevos } })
                  .select('-__v -eliminado -datos')
                  .lean();
                
                // Combinar y ordenar
                formularios = [...formularios, ...formulariosCompletos];
                formularios.sort((a, b) => {
                  const fechaA = new Date(a.fechaCreacion || a.createdAt || 0);
                  const fechaB = new Date(b.fechaCreacion || b.createdAt || 0);
                  return direccion === 'desc' ? fechaB - fechaA : fechaA - fechaB;
                });
                
                console.log('✅ Total de formularios después de búsqueda adicional:', formularios.length);
              }
            }
          }
        } catch (error) {
          console.error('⚠️ Error en búsqueda adicional por nombreUsuario:', error);
          // No fallar si esto falla
        }
      }
      
      // Si hay filtro por usuario y no se encontraron todos, hacer una búsqueda adicional más amplia
      if (usuario && esAdminOSoporte && formularios.length === 0) {
        console.log('⚠️ No se encontraron formularios con el filtro inicial, intentando búsqueda alternativa...');
        // Buscar solo por nombreUsuario como fallback
        const filtrosAlternativos = {
          eliminado: { $ne: true },
          nombreUsuario: { $regex: usuario, $options: 'i' }
        };
        const formulariosAlternativos = await HistorialFormulario.find(filtrosAlternativos)
          .sort(orden)
          .skip(skip)
          .limit(parseInt(limite))
          .select('-__v -eliminado -datos')
          .lean();
        
        if (formulariosAlternativos.length > 0) {
          console.log('✅ Formularios encontrados con búsqueda alternativa:', formulariosAlternativos.length);
          formularios = formulariosAlternativos;
        }
      }
      
      const total = await HistorialFormulario.countDocuments(filtros);
      console.log('📊 Total de formularios (con countDocuments):', total);

      // OPTIMIZACIÓN: Enriquecer nombres de usuario en batch (más eficiente)
      // 1. Identificar todos los userIds únicos que necesitan nombres
      const userIdsNecesarios = new Set();
      formularios.forEach(formulario => {
        if (!formulario.nombreUsuario || formulario.nombreUsuario === 'Usuario' || formulario.nombreUsuario === 'unknown') {
          const userId = formulario.userId || formulario.usuario;
          if (userId && userId !== 'unknown') {
            userIdsNecesarios.add(userId);
          }
        }
      });

      // 2. Buscar todos los usuarios de una vez (batch query)
      const usuariosMap = new Map();
      if (userIdsNecesarios.size > 0) {
        const userIdsArray = Array.from(userIdsNecesarios);
        try {
          // Separar ObjectIds válidos de logins
          const objectIds = [];
          const logins = [];
          
          userIdsArray.forEach(id => {
            const idStr = String(id);
            // Verificar si es un ObjectId válido (24 caracteres hexadecimales)
            if (mongoose.Types.ObjectId.isValid(idStr) && idStr.length === 24) {
              objectIds.push(idStr);
            } else {
              // Si no es ObjectId, asumir que es un login
              logins.push(idStr);
            }
          });

          // PRIMERO: Buscar por login (más común)
          if (logins.length > 0) {
            const usuariosPorLogin = await SecurUser.find({
              login: { $in: logins }
            }).select('_id name email login').lean();
            
            usuariosPorLogin.forEach(usuario => {
              const key = usuario.login || usuario._id?.toString();
              usuariosMap.set(key, usuario.name || usuario.email || 'Usuario');
            });
          }

          // SEGUNDO: Buscar por ObjectId solo si hay ObjectIds válidos
          if (objectIds.length > 0) {
            const usuariosPorId = await SecurUser.find({
              _id: { $in: objectIds }
            }).select('_id name email login').lean();
            
            usuariosPorId.forEach(usuario => {
              const key = usuario._id?.toString() || usuario.login;
              if (!usuariosMap.has(key)) {
                usuariosMap.set(key, usuario.name || usuario.email || 'Usuario');
              }
            });
          }
        } catch (error) {
          console.error('⚠️ Error obteniendo nombres de usuario en batch:', error);
        }
      }

      // 3. Aplicar nombres encontrados a los formularios
      let formulariosEnriquecidos = formularios.map(formulario => {
        if (!formulario.nombreUsuario || formulario.nombreUsuario === 'Usuario' || formulario.nombreUsuario === 'unknown') {
          const userId = formulario.userId || formulario.usuario;
          if (userId && userId !== 'unknown') {
            const nombreEncontrado = usuariosMap.get(userId) || usuariosMap.get(userId.toString());
            if (nombreEncontrado) {
              formulario.nombreUsuario = nombreEncontrado;
            }
          }

        }
        return formulario;
      });

      // 4. Adjuntar asegurado y enriquecer título de ajustes (sin cargar datos completos)
      formulariosEnriquecidos = await adjuntarAseguradoEnListado(formulariosEnriquecidos);

      res.json({
        success: true,
        formularios: formulariosEnriquecidos,
        paginacion: {
          pagina: parseInt(pagina),
          limite: parseInt(limite),
          total,
          paginas: Math.ceil(total / parseInt(limite))
        },
        usuarioActual: {
          id: userIdUsuario,
          rol: rolUsuario,
          esAdminOSoporte
        }
      });
    } catch (error) {
      console.error('Error obteniendo historial:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Obtener un formulario específico por ID
  async obtenerFormulario(req, res) {
    try {
      const { id } = req.params;
      
      // Obtener información del usuario del token
      const usuarioActual = req.user;
      const rolUsuario = usuarioActual?.role || usuarioActual?.rol || '';
      const userIdUsuario = usuarioActual?.id || usuarioActual?.login || '';
      const esAdminOSoporte = rolUsuario === 'admin' || rolUsuario === 'soporte';
      
      let formulario = await HistorialFormulario.findById(id)
        .select('-__v -eliminado')
        .lean(); // Usar lean() para mejor rendimiento
      
      if (!formulario) {
        return res.status(404).json({
          success: false,
          error: 'Formulario no encontrado'
        });
      }

      // Sesión externa (enlace de subtarea): solo formularios del caso asignado
      if (usuarioActual?.externo) {
        const norm = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
        const numCasoJwt = norm(usuarioActual.nmroAjste);
        const casoIdJwt = String(usuarioActual.casoId || '').trim();
        const subtareaIdJwt = String(usuarioActual.subtareaId || '').trim();
        const datos = formulario.datos || {};

        // El numeroCaso/casoId del registro pueden ser genéricos (RPT-..., CASO_...),
        // así que también se compara contra los datos del formulario y el dueño.
        const numerosFormulario = [
          formulario.numeroCaso,
          datos.numeroCaso,
          datos.numeroAjuste,
          datos.nmroAjste,
          datos.numeroSiniestro,
        ].map(norm).filter(Boolean);
        const casoIdsFormulario = [
          formulario.casoId,
          datos?.metadata?.complexId,
        ].map((v) => String(v || '').trim()).filter(Boolean);
        const propietarios = [formulario.userId, formulario.usuario]
          .map((v) => String(v || '').trim())
          .filter(Boolean);
        const esPropietarioExterno =
          subtareaIdJwt &&
          propietarios.some(
            (p) => p === `externo-subtarea-${subtareaIdJwt}` || p === `externo:${subtareaIdJwt}`
          );

        const esDeSuCaso =
          (numCasoJwt && numerosFormulario.includes(numCasoJwt)) ||
          (casoIdJwt && casoIdsFormulario.includes(casoIdJwt)) ||
          esPropietarioExterno;
        if (!esDeSuCaso) {
          return res.status(403).json({
            success: false,
            error: 'No tienes permisos para ver este formulario'
          });
        }
      } else
      // Verificar permisos:
      // 1) dueño del formulario
      // 2) admin/soporte
      // 3) responsable asignado del caso Complex (aunque el ajuste lo haya iniciado otro usuario)
      if (!esAdminOSoporte) {
        let tienePermiso = false;
        let usuarioBD = null;
        const userIdStr = String(userIdUsuario);
        const formularioUserId = String(formulario.userId || '');
        const formularioUsuario = String(formulario.usuario || '');
        
        // Comparación directa
        if (formularioUserId === userIdStr || formularioUsuario === userIdStr) {
          tienePermiso = true;
        } else {
          // Buscar el usuario en BD para obtener todos sus valores posibles
          try {
            // Primero intentar buscar por _id del token
            if (usuarioActual?.id && mongoose.Types.ObjectId.isValid(usuarioActual.id)) {
              usuarioBD = await SecurUser.findById(usuarioActual.id);
            }
            
            // Si no se encontró, buscar por login
            if (!usuarioBD && usuarioActual?.login) {
              usuarioBD = await SecurUser.findOne({ login: usuarioActual.login });
            }
            
            if (usuarioBD) {
              const userIdObjectId = usuarioBD._id;
              const userIdString = userIdObjectId.toString();
              const userLogin = usuarioBD.login;
              
              // Crear lista de valores posibles del usuario
              const valoresPosibles = new Set();
              valoresPosibles.add(userIdString);
              if (userLogin && userLogin.trim()) {
                valoresPosibles.add(userLogin.trim());
              }
              if (usuarioActual?.id && String(usuarioActual.id) !== userIdString) {
                valoresPosibles.add(String(usuarioActual.id));
              }
              if (usuarioActual?.login && usuarioActual.login.trim() !== userIdString) {
                valoresPosibles.add(usuarioActual.login.trim());
              }
              
              // Verificar si el formulario pertenece al usuario
              const valoresArray = Array.from(valoresPosibles);
              tienePermiso = valoresArray.some(valor => 
                formularioUserId === valor || formularioUsuario === valor
              );
              
              // También verificar por nombreUsuario como último recurso
              if (!tienePermiso && formulario.nombreUsuario) {
                const nombreUsuarioFormulario = (formulario.nombreUsuario || '').trim();
                const nombreUsuarioBD = (usuarioBD.name || '').trim();
                if (nombreUsuarioFormulario && nombreUsuarioBD && 
                    nombreUsuarioFormulario.toLowerCase() === nombreUsuarioBD.toLowerCase()) {
                  tienePermiso = true;
                }
              }
            } else {
              // Fallback: comparación directa con valores del token
              const valoresFallback = new Set();
              if (usuarioActual?.id) valoresFallback.add(String(usuarioActual.id));
              if (usuarioActual?.login) valoresFallback.add(String(usuarioActual.login).trim());
              if (userIdStr) valoresFallback.add(userIdStr.trim());
              
              const valoresFallbackArray = Array.from(valoresFallback);
              tienePermiso = valoresFallbackArray.some(valor => 
                formularioUserId === valor || formularioUsuario === valor
              );
            }
          } catch (error) {
            console.error('⚠️ Error verificando permisos:', error);
            // En caso de error, usar comparación directa simple
            tienePermiso = formularioUserId === userIdStr || formularioUsuario === userIdStr;
          }
        }

        // Si no es dueño, permitir acceso al responsable asignado del caso
        if (!tienePermiso) {
          tienePermiso = await esResponsableAsignadoDelFormulario(
            usuarioActual,
            formulario,
            usuarioBD
          );
          if (tienePermiso) {
            console.log('✅ Acceso concedido por responsable asignado del caso Complex', {
              formularioId: id,
              login: usuarioActual?.login,
              numeroCaso: formulario?.numeroCaso
            });
          }
        }
        
        if (!tienePermiso) {
          console.warn('⛔ Acceso denegado a formulario', {
            formularioId: id,
            login: usuarioActual?.login,
            role: rolUsuario,
            formularioUserId,
            numeroCaso: formulario?.numeroCaso
          });
          return res.status(403).json({
            success: false,
            error: 'No tienes permisos para ver este formulario'
          });
        }
      }

      // Enriquecer con nombre de usuario si no lo tiene
      if (!formulario.nombreUsuario || formulario.nombreUsuario === 'Usuario' || formulario.nombreUsuario === 'unknown') {
        try {
          const userId = formulario.userId || formulario.usuario;
          if (userId && userId !== 'unknown') {
            let usuarioDB = null;
            const userIdStr = String(userId);
            
            // PRIMERO: Intentar buscar por login (más común)
            usuarioDB = await SecurUser.findOne({ login: userIdStr });
            
            // SEGUNDO: Si no se encontró y parece ser un ObjectId válido, buscar por _id
            if (!usuarioDB && mongoose.Types.ObjectId.isValid(userIdStr) && userIdStr.length === 24) {
              usuarioDB = await SecurUser.findById(userIdStr);
            }
            
            if (usuarioDB) {
              formulario.nombreUsuario = usuarioDB.name || usuarioDB.email || 'Usuario';
              console.log(`✅ Nombre de usuario actualizado para formulario ${formulario._id}: ${formulario.nombreUsuario}`);
            }
          }
        } catch (error) {
          console.error(`⚠️ Error obteniendo nombre de usuario para formulario ${formulario._id}:`, error);
        }
      }

      let archivoExisteEnServidor = false;
      if (formulario.archivo?.ruta && formulario.archivo?.nombre) {
        const entornoFs = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
        const nombreArch = formulario.archivo.nombre;
        const carpetaFs = formulario.carpetaCaso || formulario.casoId || null;
        const rutaRelFs = String(formulario.archivo.ruta || '')
          .replace(/^\/uploads\/?/, '')
          .trim();
        const candidatas = construirRutasCandidatasArchivo(entornoFs, nombreArch, rutaRelFs, carpetaFs);
        for (const p of candidatas) {
          try {
            await fs.access(p);
            archivoExisteEnServidor = true;
            break;
          } catch {
            /* siguiente */
          }
        }
        if (!archivoExisteEnServidor) {
          for (const raiz of obtenerRaicesUploadsFisicas()) {
            const encontrado = await buscarArchivoPorNombreEnArbol(raiz, nombreArch);
            if (encontrado) {
              archivoExisteEnServidor = true;
              break;
            }
          }
        }
      }
      formulario.archivoExisteEnServidor = archivoExisteEnServidor;

      res.json({
        success: true,
        formulario
      });
    } catch (error) {
      console.error('Error obteniendo formulario:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Obtener formularios por carpeta (casoId)
  async obtenerFormulariosPorCarpeta(req, res) {
    try {
      const { casoId } = req.params;
      
      // Obtener información del usuario del token
      const usuarioActual = req.user;
      const rolUsuario = usuarioActual?.role || usuarioActual?.rol || '';
      const userIdUsuario = usuarioActual?.id || usuarioActual?.login || '';
      const esAdminOSoporte = rolUsuario === 'admin' || rolUsuario === 'soporte';
      
      // Construir filtros
      const filtros = {
        casoId: casoId,
        eliminado: { $ne: true }
      };
      
      // Filtrar por usuario si no es admin/soporte
      if (!esAdminOSoporte && userIdUsuario) {
        filtros.userId = userIdUsuario;
      }
      
      const formularios = await HistorialFormulario.find(filtros)
      .sort({ fechaCreacion: -1 })
      .select('-__v -eliminado');
      
      if (!formularios || formularios.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No se encontraron formularios para esta carpeta'
        });
      }

      res.json({
        success: true,
        formularios,
        carpeta: {
          casoId: formularios[0].casoId,
          numeroCaso: formularios[0].numeroCaso,
          carpetaCaso: formularios[0].carpetaCaso,
          totalFormularios: formularios.length
        }
      });
    } catch (error) {
      console.error('Error obteniendo formularios por carpeta:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Crear un nuevo formulario en el historial
  async crearFormulario(req, res) {
    try {
      console.log('📝 Iniciando creación de formulario en historial...');
      const {
        tipo,
        titulo,
        estado = 'completado',
        archivo,
        datos,
        metadata = {},
        estadoActual: estadoVersionAjuste
      } = req.body;

      // Validar campos requeridos
      if (!tipo || !titulo || !datos) {
        return res.status(400).json({
          success: false,
          error: 'Los campos tipo, titulo y datos son requeridos'
        });
      }

      // Log del tipo recibido para debugging
      console.log('🔍 Tipo de formulario recibido:', tipo);
      console.log('🔍 Tipos válidos:', ['complex', 'riesgos', 'pol', 'inspeccion', 'inspeccion-propiedades', 'inspeccion-puertos', 'acta_inspeccion', 'maquinaria', 'siniestros', 'ajuste', 'ajuste_inicial', 'ajuste_preeliminar', 'ajuste_actualizacion', 'ajuste_informeFinal', 'matriz_riesgo_inicial', 'matriz_riesgo_final']);

      // Calcular tamaño aproximado del documento (solo para logging)
      // Ya no rechazamos por tamaño porque las imágenes se guardan como archivos físicos
      const datosString = JSON.stringify(datos);
      const tamanoBytes = Buffer.byteLength(datosString, 'utf8');
      const tamanoMB = (tamanoBytes / (1024 * 1024)).toFixed(2);
      console.log(`📊 Tamaño estimado del documento (solo metadata): ${tamanoMB} MB`);

      // Verificar si ya existe un casoId para este formulario
      let casoId = datos.casoId;
      let numeroCaso = datos.numeroCaso;
      let carpetaCaso = datos.carpetaCaso;

      // Si no existe casoId, crear uno nuevo (formulario inicial)
      if (!casoId) {
        casoId = `CASO_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        numeroCaso = datos.reporteNo || `RPT-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
        carpetaCaso = `Caso_${numeroCaso}_${new Date().toISOString().split('T')[0]}`;
      }

      // Contar imágenes para logging
      const numImagenes = datos.imagenesRegistro?.length || 0;
      console.log(`📸 Número de imágenes en registro: ${numImagenes}`);

      // Obtener información completa del usuario desde la base de datos
      let nombreUsuarioCompleto = 'Usuario';
      const userId = req.user?.id || req.user?.login || 'unknown';
      const userLogin = req.user?.login || userId;
      
      console.log('🔍 === OBTENIENDO NOMBRE DE USUARIO ===');
      console.log('📋 Información del token:', {
        id: req.user?.id,
        login: req.user?.login,
        role: req.user?.role,
        todosLosCampos: Object.keys(req.user || {})
      });
      console.log('🔍 userId extraído:', userId);
      console.log('🔍 userLogin extraído:', userLogin);
      
      try {
        if (userId && userId !== 'unknown') {
          let usuarioDB = null;
          const userIdStr = String(userId);
          
          // PRIMERO: Buscar por login (más común)
          if (userLogin) {
            try {
              usuarioDB = await SecurUser.findOne({ login: userLogin });
              if (usuarioDB) {
                console.log('✅ Usuario encontrado por login:', {
                  id: usuarioDB._id,
                  login: usuarioDB.login,
                  name: usuarioDB.name,
                  email: usuarioDB.email
                });
              }
            } catch (loginError) {
              console.log('⚠️ Error buscando por login:', loginError.message);
            }
          }
          
          // SEGUNDO: Si no se encontró y parece ser un ObjectId válido, buscar por _id
          if (!usuarioDB && mongoose.Types.ObjectId.isValid(userIdStr) && userIdStr.length === 24) {
            try {
              usuarioDB = await SecurUser.findById(userIdStr);
              if (usuarioDB) {
                console.log('✅ Usuario encontrado por _id:', {
                  id: usuarioDB._id,
                  login: usuarioDB.login,
                  name: usuarioDB.name,
                  email: usuarioDB.email
                });
              }
            } catch (idError) {
              console.log('⚠️ Error buscando por _id:', idError.message);
            }
          }
          
          // TERCERO: Si aún no se encontró, intentar con userId como login
          if (!usuarioDB && userIdStr && userIdStr !== 'unknown' && userIdStr !== userLogin) {
            try {
              usuarioDB = await SecurUser.findOne({ login: userIdStr });
              if (usuarioDB) {
                console.log('✅ Usuario encontrado por userId como login:', {
                  id: usuarioDB._id,
                  login: usuarioDB.login,
                  name: usuarioDB.name,
                  email: usuarioDB.email
                });
              }
            } catch (multiError) {
              console.log('⚠️ Error buscando por userId como login:', multiError.message);
            }
          }
          
          if (usuarioDB) {
            nombreUsuarioCompleto = usuarioDB.name || usuarioDB.email || 'Usuario';
            console.log('✅ Nombre de usuario final:', nombreUsuarioCompleto);
          } else {
            console.error('❌ Usuario NO encontrado en BD con:', {
              userId,
              userLogin,
              intentos: ['login', '_id (si es ObjectId válido)', 'userId como login']
            });
            nombreUsuarioCompleto = 'Usuario';
          }
        } else {
          console.error('❌ userId es unknown o no válido:', userId);
          nombreUsuarioCompleto = 'Usuario';
        }
      } catch (error) {
        console.error('❌ Error obteniendo nombre de usuario:', error);
        console.error('   Stack:', error.stack);
        nombreUsuarioCompleto = 'Usuario';
      }
      
      // Sesión externa: usar el nombre del asignado externo que viaja en el JWT
      if (req.user?.externo && String(req.user?.nombre || '').trim()) {
        nombreUsuarioCompleto = String(req.user.nombre).trim();
      }

      console.log('📝 === FIN OBTENCIÓN DE NOMBRE ===');
      console.log('📝 Nombre final que se guardará:', nombreUsuarioCompleto);

      const aseguradoGuardado = textoAseguradoHistorial(
        req.body?.asegurado,
        datos?.asegurado,
        datos?.tomador
      );
      const tituloConAsegurado = enriquecerTituloAjusteConAsegurado(titulo, aseguradoGuardado, tipo);

      // Archivo por defecto: un solo timestamp y nombre coherente con la ruta (evita descargas 404 por nombre ≠ archivo en disco).
      const tsArchivo = Date.now();
      const nombreArchivoDefecto = archivo?.nombre || `${tipo}_${tsArchivo}.docx`;
      const rutaArchivoDefecto =
        archivo?.ruta && String(archivo.ruta).trim()
          ? archivo.ruta
          : `/uploads/${carpetaCaso}/${nombreArchivoDefecto}`;

      // Crear el formulario
      const nuevoFormulario = new HistorialFormulario({
        tipo,
        titulo: tituloConAsegurado || titulo,
        asegurado: aseguradoGuardado,
        estadoActual: estadoVersionAjuste || datos?.estadoActual || 'inicial',
        // Sistema de carpetas por caso
        casoId,
        numeroCaso,
        carpetaCaso,
        // Información del usuario (guardar de forma personal)
        usuario: userId,
        nombreUsuario: nombreUsuarioCompleto,
        userId: userId,
        estado,
        archivo: {
          nombre: nombreArchivoDefecto,
          ruta: rutaArchivoDefecto,
          tamaño: archivo?.tamaño,
          tipoMime: archivo?.tipoMime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        },
        datos,
        metadata: {
          version: metadata.version || '1.0',
          creadoPor: req.user?.id || 'unknown',
          modificadoPor: req.user?.id || 'unknown',
          tags: metadata.tags || [],
          categoria: metadata.categoria,
          prioridad: metadata.prioridad || 'media'
        },
        auditoria: {
          ipCreacion: req.ip,
          userAgentCreacion: req.get('User-Agent')
        }
      });

      console.log('💾 Intentando guardar formulario en MongoDB...');
      await nuevoFormulario.save();
      console.log('✅ Formulario guardado exitosamente');

      res.status(201).json({
        success: true,
        formulario: nuevoFormulario
      });
    } catch (error) {
      console.error('❌ Error creando formulario:');
      console.error('   Mensaje:', error.message);
      console.error('   Stack:', error.stack);
      console.error('   Code:', error.code);
      console.error('   Name:', error.name);
      
      // Si es error de validación de Mongoose, mostrar detalles
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: 'Error de validación',
          detalles: Object.keys(error.errors).map(key => ({
            campo: key,
            mensaje: error.errors[key].message
          }))
        });
      }
      
      // Si es error de tamaño de documento (diferentes formatos de MongoDB)
      if (error.message && (
        error.message.includes('document is too large') ||
        error.message.includes('BSONObj size') ||
        error.message.includes('Size must be between 0 and 16793600') ||
        error.code === 10334
      )) {
        // Intentar extraer el tamaño del error si está disponible
        const tamanoMatch = error.message.match(/BSONObj size: (\d+)/);
        const tamanoBytes = tamanoMatch ? parseInt(tamanoMatch[1]) : null;
        const tamanoMB = tamanoBytes ? (tamanoBytes / (1024 * 1024)).toFixed(2) : 'desconocido';
        
        console.error(`❌ Documento demasiado grande (crear): ${tamanoMB} MB (límite: 16MB)`);
        
        return res.status(413).json({
          success: false,
          error: `El formulario es demasiado grande (${tamanoMB} MB). El límite de MongoDB es 16 MB. Las imágenes deben guardarse como archivos en el servidor, no como base64.`,
          tamanoMB: tamanoMB,
          limiteMB: 16,
          detalles: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        detalles: process.env.NODE_ENV === 'development' ? error.message : undefined,
        errorCode: error.code,
        errorName: error.name
      });
    }
  }

  // Actualizar un formulario existente
  async actualizarFormulario(req, res) {
    try {
      console.log('🔄 Iniciando actualización de formulario...');
      const { id } = req.params;
      const datosActualizacion = req.body;

      console.log('🔍 ID del formulario:', id);
      console.log('🔍 Datos recibidos:', Object.keys(datosActualizacion));

      const formulario = await HistorialFormulario.findById(id);
      
      if (!formulario) {
        console.error('❌ Formulario no encontrado:', id);
        return res.status(404).json({
          success: false,
          error: 'Formulario no encontrado'
        });
      }

      console.log('✅ Formulario encontrado:', formulario.titulo);

      // Calcular tamaño aproximado del documento (solo para logging)
      if (datosActualizacion.datos) {
        const datosString = JSON.stringify(datosActualizacion.datos);
        const tamanoBytes = Buffer.byteLength(datosString, 'utf8');
        const tamanoMB = (tamanoBytes / (1024 * 1024)).toFixed(2);
        console.log(`📊 Tamaño estimado del documento (solo metadata): ${tamanoMB} MB`);
        
        // Contar imágenes si existen
        const numImagenes = datosActualizacion.datos.imagenesRegistro?.length || 0;
        console.log(`📸 Número de imágenes en registro: ${numImagenes}`);
        
        // Verificar si alguna imagen tiene base64 (no debería tener)
        const imagenesConBase64 = datosActualizacion.datos.imagenesRegistro?.filter(img => 
          img && (img.base64 || img.preview || (img.file && typeof img.file === 'string' && img.file.startsWith('data:')))
        ) || [];
        
        if (imagenesConBase64.length > 0) {
          console.warn(`⚠️ ADVERTENCIA: Se encontraron ${imagenesConBase64.length} imágenes con base64. Esto no debería pasar.`);
          console.warn('   Las imágenes deben tener solo rutas, no base64.');
        }
        
        // Validar tamaño antes de intentar guardar
        if (tamanoBytes > 15 * 1024 * 1024) { // 15MB para dejar margen
          console.error(`❌ Documento demasiado grande antes de guardar: ${tamanoMB} MB`);
          return res.status(413).json({
            success: false,
            error: `El formulario es demasiado grande (${tamanoMB} MB). Parece que aún hay imágenes en base64. Por favor, recarga la página e intenta de nuevo.`,
            tamanoMB: tamanoMB,
            limiteMB: 16
          });
        }
      }

      // Verificar si hay cambios significativos (pero NO crear versión todavía para evitar error de tamaño)
      const hayCambiosSignificativos = datosActualizacion.datos && 
                                      JSON.stringify(datosActualizacion.datos) !== JSON.stringify(formulario.datos);
      
      // Guardar datos antiguos para versión (solo metadata, no el contenido completo)
      let datosVersionAnterior = null;
      if (hayCambiosSignificativos) {
        console.log('📋 Se detectaron cambios significativos (versión se creará después de actualizar)');
        // Guardar solo metadata de los datos antiguos, no el contenido completo que puede tener base64
        datosVersionAnterior = {
          fecha: formulario.datos?.fechaCreacion || formulario.fechaCreacion,
          numImagenes: formulario.datos?.imagenesRegistro?.length || 0,
          tipo: formulario.tipo
          // NO guardar el contenido completo con base64
        };
      }

      if (datosActualizacion.datos) {
        const rutasAnteriores = collectPathsFromHistorialDatos(formulario.datos);
        const rutasNuevas = collectPathsFromHistorialDatos(datosActualizacion.datos);
        await deleteOrphanedStoredFiles(rutasAnteriores, rutasNuevas).catch((err) => {
          console.warn('⚠️ No se pudieron eliminar imágenes huérfanas del formulario:', err.message);
        });
      }

      // Actualizar campos de forma selectiva usando findByIdAndUpdate para evitar problemas de tamaño
      console.log('🔧 Actualizando campos del formulario usando actualización selectiva...');
      
      // Preparar objeto de actualización usando $set para actualizar solo campos específicos
      // Esto evita que MongoDB intente guardar el documento completo con base64 viejo
      const updateFields = {
        fechaModificacion: new Date(),
        'metadata.modificadoPor': req.user?.id || 'unknown',
        'auditoria.ipModificacion': req.ip,
        'auditoria.userAgentModificacion': req.get('User-Agent')
      };
      
      // Actualizar cada campo (excepto _id y fechaCreacion)
      Object.keys(datosActualizacion).forEach(campo => {
        if (campo !== '_id' && campo !== 'fechaCreacion') {
          if (campo === 'datos') {
            // Para datos, actualizar específicamente el campo
            updateFields.datos = datosActualizacion.datos;
            
            // Calcular tamaño de los nuevos datos
            const datosString = JSON.stringify(datosActualizacion.datos);
            const tamanoBytes = Buffer.byteLength(datosString, 'utf8');
            const tamanoMB = (tamanoBytes / (1024 * 1024)).toFixed(2);
            console.log(`📊 Tamaño de datos.datos a actualizar: ${tamanoMB} MB`);
          } else if (campo.includes('.')) {
            // Campos anidados con notación de punto
            updateFields[campo] = datosActualizacion[campo];
          } else {
            // Campos normales
            updateFields[campo] = datosActualizacion[campo];
          }
        }
      });

      const aseguradoActualizado = textoAseguradoHistorial(
        datosActualizacion.asegurado,
        datosActualizacion.datos?.asegurado,
        datosActualizacion.datos?.tomador,
        formulario.asegurado,
        formulario.datos?.asegurado,
        formulario.datos?.tomador
      );
      if (aseguradoActualizado) {
        updateFields.asegurado = aseguradoActualizado;
      }
      const tipoActual = datosActualizacion.tipo || formulario.tipo;
      const tituloBase = datosActualizacion.titulo || formulario.titulo;
      if (esTipoAjusteHistorial(tipoActual)) {
        updateFields.titulo = enriquecerTituloAjusteConAsegurado(
          tituloBase,
          aseguradoActualizado,
          tipoActual
        );
      }

      console.log('💾 Ejecutando actualización selectiva en MongoDB...');
      
      // Usar findByIdAndUpdate con $set para actualizar solo campos específicos
      // Esto es más eficiente y evita cargar/guardar el documento completo
      const formularioActualizado = await HistorialFormulario.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
      );
      
      if (!formularioActualizado) {
        return res.status(404).json({
          success: false,
          error: 'Formulario no encontrado después de actualizar'
        });
      }
      
      console.log('✅ Formulario actualizado exitosamente usando actualización selectiva');
      
      // Calcular tamaño del documento final
      try {
        const tamanoFinal = JSON.stringify(formularioActualizado.toObject()).length;
        const tamanoMBFinal = (tamanoFinal / (1024 * 1024)).toFixed(2);
        console.log(`📊 Tamaño final del formulario guardado: ${tamanoMBFinal} MB`);
      } catch (e) {
        console.log('⚠️ No se pudo calcular el tamaño final');
      }
      
      // Crear versión DESPUÉS de la actualización (solo si es necesario y con datos pequeños)
      if (hayCambiosSignificativos && datosVersionAnterior) {
        try {
          console.log('📋 Creando versión anterior (después de actualizar)...');
          // Usar actualización directa para agregar versión sin cargar el documento completo
          await HistorialFormulario.findByIdAndUpdate(
            id,
            {
              $push: {
                versiones: {
                  numero: (formularioActualizado.versiones?.length || 0) + 1,
                  usuario: req.user?.nombre || 'Usuario',
                  cambios: 'Actualización de datos',
                  datos: datosVersionAnterior, // Solo metadata, no contenido completo
                  fecha: new Date()
                }
              }
            }
          );
          console.log('✅ Versión anterior creada exitosamente');
        } catch (versionError) {
          console.warn('⚠️ Error creando versión anterior (no crítico):', versionError.message);
          // No fallar toda la operación por la versión
        }
      }

      res.json({
        success: true,
        formulario: formularioActualizado
      });
    } catch (error) {
      console.error('❌ Error actualizando formulario:');
      console.error('   Mensaje:', error.message);
      console.error('   Stack:', error.stack);
      console.error('   Code:', error.code);
      console.error('   Name:', error.name);
      
      // Si es error de validación de Mongoose, mostrar detalles
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: 'Error de validación',
          detalles: Object.keys(error.errors).map(key => ({
            campo: key,
            mensaje: error.errors[key].message
          }))
        });
      }
      
      // Si es error de tamaño de documento (diferentes formatos de MongoDB)
      if (error.message && (
        error.message.includes('document is too large') ||
        error.message.includes('BSONObj size') ||
        error.message.includes('Size must be between 0 and 16793600') ||
        error.code === 10334
      )) {
        // Intentar extraer el tamaño del error si está disponible
        const tamanoMatch = error.message.match(/BSONObj size: (\d+)/);
        const tamanoBytes = tamanoMatch ? parseInt(tamanoMatch[1]) : null;
        const tamanoMB = tamanoBytes ? (tamanoBytes / (1024 * 1024)).toFixed(2) : 'desconocido';
        
        console.error(`❌ Documento demasiado grande (actualizar): ${tamanoMB} MB (límite: 16MB)`);
        
        return res.status(413).json({
          success: false,
          error: `El formulario es demasiado grande (${tamanoMB} MB). El límite de MongoDB es 16 MB. Las imágenes deben guardarse como archivos en el servidor, no como base64.`,
          tamanoMB: tamanoMB,
          limiteMB: 16,
          detalles: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        detalles: process.env.NODE_ENV === 'development' ? error.message : undefined,
        errorCode: error.code,
        errorName: error.name
      });
    }
  }

  // Eliminar un formulario (soft delete)
  async eliminarFormulario(req, res) {
    try {
      const { id } = req.params;
      
      const formulario = await HistorialFormulario.findById(id);
      
      if (!formulario) {
        return res.status(404).json({
          success: false,
          error: 'Formulario no encontrado'
        });
      }

      await deleteHistorialFormularioFiles(formulario).catch((err) => {
        console.warn('⚠️ No se pudieron eliminar todos los archivos del formulario:', err.message);
      });

      await formulario.softDelete(req.user?.nombre || 'Usuario');

      res.json({
        success: true,
        mensaje: 'Formulario eliminado exitosamente'
      });
    } catch (error) {
      console.error('Error eliminando formulario:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Obtener casos organizados por carpeta
  async obtenerCasosOrganizados(req, res) {
    try {
      // Obtener información del usuario del token
      const usuarioActual = req.user;
      const rolUsuario = usuarioActual?.role || usuarioActual?.rol || '';
      const userIdUsuario = usuarioActual?.id || usuarioActual?.login || '';
      const esAdminOSoporte = rolUsuario === 'admin' || rolUsuario === 'soporte';
      
      // Si no es admin/soporte, filtrar por usuario
      let casos;
      if (esAdminOSoporte) {
        casos = await HistorialFormulario.obtenerCasosOrganizados();
      } else {
        // Para usuarios normales, obtener solo sus casos
        const formulariosUsuario = await HistorialFormulario.find({
          userId: userIdUsuario,
          eliminado: { $ne: true }
        });
        
        // Agrupar por caso manualmente
        const casosMap = {};
        formulariosUsuario.forEach(form => {
          const key = `${form.casoId}_${form.numeroCaso}`;
          if (!casosMap[key]) {
            casosMap[key] = {
              _id: {
                casoId: form.casoId,
                numeroCaso: form.numeroCaso,
                carpetaCaso: form.carpetaCaso
              },
              totalFormularios: 0,
              tipos: [],
              usuarios: [],
              fechaCreacion: form.fechaCreacion,
              fechaModificacion: form.fechaModificacion,
              formularios: []
            };
          }
          casosMap[key].totalFormularios++;
          if (!casosMap[key].tipos.includes(form.tipo)) {
            casosMap[key].tipos.push(form.tipo);
          }
          if (!casosMap[key].usuarios.includes(form.nombreUsuario)) {
            casosMap[key].usuarios.push(form.nombreUsuario);
          }
          casosMap[key].formularios.push({
            _id: form._id,
            tipo: form.tipo,
            titulo: form.titulo,
            estado: form.estado,
            nombreUsuario: form.nombreUsuario,
            fechaCreacion: form.fechaCreacion,
            fechaModificacion: form.fechaModificacion
          });
          if (form.fechaCreacion < casosMap[key].fechaCreacion) {
            casosMap[key].fechaCreacion = form.fechaCreacion;
          }
          if (form.fechaModificacion > casosMap[key].fechaModificacion) {
            casosMap[key].fechaModificacion = form.fechaModificacion;
          }
        });
        casos = Object.values(casosMap).sort((a, b) => 
          new Date(b.fechaModificacion) - new Date(a.fechaModificacion)
        );
      }
      
      res.json({
        success: true,
        casos
      });
    } catch (error) {
      console.error('Error obteniendo casos organizados:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Obtener formularios de un caso específico
  async obtenerFormulariosPorCaso(req, res) {
    try {
      const { casoId } = req.params;
      
      // Obtener información del usuario del token
      const usuarioActual = req.user;
      const rolUsuario = usuarioActual?.role || usuarioActual?.rol || '';
      const userIdUsuario = usuarioActual?.id || usuarioActual?.login || '';
      const esAdminOSoporte = rolUsuario === 'admin' || rolUsuario === 'soporte';
      
      // Construir filtros
      const filtros = {
        casoId: casoId,
        eliminado: { $ne: true }
      };
      
      // Filtrar por usuario si no es admin/soporte
      if (!esAdminOSoporte && userIdUsuario) {
        filtros.userId = userIdUsuario;
      }
      
      const formularios = await HistorialFormulario.find(filtros)
        .sort({ fechaCreacion: -1 });
      
      res.json({
        success: true,
        formularios
      });
    } catch (error) {
      console.error('Error obteniendo formularios del caso:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Buscar formularios por texto
  async buscarFormularios(req, res) {
    try {
      const { q: texto } = req.query;
      
      if (!texto || texto.trim().length < 2) {
        return res.status(400).json({
          success: false,
          error: 'El término de búsqueda debe tener al menos 2 caracteres'
        });
      }

      // Obtener información del usuario del token
      const usuarioActual = req.user;
      const rolUsuario = usuarioActual?.role || usuarioActual?.rol || '';
      const userIdUsuario = usuarioActual?.id || usuarioActual?.login || '';
      const esAdminOSoporte = rolUsuario === 'admin' || rolUsuario === 'soporte';

      // Buscar formularios
      let formularios = await HistorialFormulario.buscarPorTexto(texto.trim());
      
      // Filtrar por usuario si no es admin/soporte
      if (!esAdminOSoporte && userIdUsuario) {
        formularios = formularios.filter(form => form.userId === userIdUsuario);
      }

      formularios = await adjuntarAseguradoEnListado(
        formularios.map((f) => (typeof f.toObject === 'function' ? f.toObject() : f))
      );

      res.json({
        success: true,
        formularios,
        total: formularios.length
      });
    } catch (error) {
      console.error('Error buscando formularios:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Obtener estadísticas del historial
  async obtenerEstadisticas(req, res) {
    try {
      const estadisticas = await HistorialFormulario.obtenerEstadisticas();
      
      // Calcular totales generales
      const totales = estadisticas.reduce((acc, stat) => {
        acc.total += stat.total;
        acc.completados += stat.completados;
        acc.enProceso += stat.enProceso;
        acc.pendientes += stat.pendientes;
        return acc;
      }, { total: 0, completados: 0, enProceso: 0, pendientes: 0 });

      res.json({
        success: true,
        estadisticas: {
          porTipo: estadisticas,
          totales
        }
      });
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Descargar un formulario
  async descargarFormulario(req, res) {
    try {
      const { id } = req.params;
      const entorno = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
      console.log('📥 Descarga solicitada para formulario:', id);
      console.log(`🔧 Entorno actual: ${entorno}`);
      
      const formulario = await HistorialFormulario.findById(id);
      
      if (!formulario) {
        console.error('❌ Formulario no encontrado:', id);
        return res.status(404).json({
          success: false,
          error: 'Formulario no encontrado'
        });
      }

      console.log('🔍 Formulario encontrado:', {
        id: formulario._id,
        titulo: formulario.titulo,
        archivo: formulario.archivo
      });

      // Verificar que el formulario tenga archivo
      if (!formulario.archivo || !formulario.archivo.ruta) {
        console.error('❌ Formulario no tiene archivo:', formulario._id);
        return res.status(400).json({
          success: false,
          error: 'Este formulario no tiene archivo adjunto'
        });
      }

      // Construir ruta del archivo
      let rutaArchivo;
      
      try {
        const nombreArchivo = formulario.archivo.nombre;
        const carpetaCaso = formulario.carpetaCaso || formulario.casoId || null;
        const rutaRelativa = String(formulario.archivo.ruta || '')
          .replace(/^\/uploads\/?/, '')
          .trim();

        console.log('🔍 Resolución de archivo adjunto:', {
          entorno,
          nombreArchivo,
          carpetaCaso,
          rutaRelativa,
          raicesUploads: obtenerRaicesUploadsFisicas()
        });

        const rutasAlternativas = construirRutasCandidatasArchivo(
          entorno,
          nombreArchivo,
          rutaRelativa,
          carpetaCaso
        );

        console.log(`🔍 [${entorno}] Rutas candidatas (${rutasAlternativas.length}):`, rutasAlternativas);

        for (const rutaAlt of rutasAlternativas) {
          try {
            await fs.access(rutaAlt);
            console.log(`✅ [${entorno}] Archivo encontrado en:`, rutaAlt);
            rutaArchivo = rutaAlt;
            break;
          } catch (e) {
            console.log(`❌ [${entorno}] No encontrado en:`, rutaAlt);
          }
        }

        if (!rutaArchivo) {
          console.log('🔎 Búsqueda recursiva por nombre de archivo en raíces de uploads...');
          for (const raiz of obtenerRaicesUploadsFisicas()) {
            const encontrado = await buscarArchivoPorNombreEnArbol(raiz, nombreArchivo);
            if (encontrado) {
              rutaArchivo = encontrado;
              console.log('✅ Archivo encontrado por búsqueda recursiva:', encontrado);
              break;
            }
          }
        }

        if (!rutaArchivo) {
          // Si el archivo no existe pero el formulario es de tipo inspeccion-propiedades,
          // indicar que necesita ser regenerado
          if (formulario.tipo === 'inspeccion-propiedades') {
            console.log('⚠️ Archivo no encontrado para formulario inspeccion-propiedades. Se requiere regeneración.');
            return res.status(404).json({
              success: false,
              error: 'Archivo no encontrado en el servidor',
              necesitaRegeneracion: true,
              tipo: 'inspeccion-propiedades',
              mensaje: 'El archivo no existe. Por favor, edita el formulario y regenera el documento.',
              detalles: {
                rutaOriginal: formulario.archivo.ruta,
                nombreArchivo: nombreArchivo,
                rutasIntentadas: rutasAlternativas
              }
            });
          }
          
          return res.status(404).json({
            success: false,
            error: 'Archivo no encontrado en el servidor',
            detalles: {
              rutaOriginal: formulario.archivo.ruta,
              nombreArchivo: nombreArchivo,
              rutasIntentadas: rutasAlternativas
            }
          });
        }
        
        // Verificar que el archivo no esté vacío
        const stats = await fs.stat(rutaArchivo);
        console.log('📊 Tamaño del archivo:', stats.size, 'bytes');
        
        if (stats.size === 0) {
          console.error('❌ Archivo está vacío:', rutaArchivo);
          return res.status(400).json({
            success: false,
            error: 'El archivo está vacío'
          });
        }
        
      } catch (error) {
        console.error('❌ Error accediendo al archivo:', error);
        return res.status(500).json({
          success: false,
          error: 'Error interno del servidor',
          detalles: error.message
        });
      }

      // Configurar headers para descarga
      const contentType = formulario.archivo.tipoMime || 'application/octet-stream';
      const filename = formulario.archivo.nombre || 'formulario';
      
      console.log('📋 Headers configurados:', {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache');
      
      // Enviar archivo usando stream para mejor rendimiento
      const fileStream = fsSync.createReadStream(rutaArchivo);
      
      fileStream.on('error', (error) => {
        console.error('❌ Error leyendo archivo:', error);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Error leyendo el archivo'
          });
        }
      });
      
      fileStream.on('end', () => {
        console.log('✅ Archivo enviado exitosamente');
      });
      
      fileStream.pipe(res);
      
    } catch (error) {
      console.error('❌ Error descargando formulario:', error);
      console.error('❌ Stack trace:', error.stack);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Error interno del servidor',
          detalles: error.message
        });
      }
    }
  }

  // Agregar comentario a un formulario
  async agregarComentario(req, res) {
    try {
      const { id } = req.params;
      const { texto, tipo = 'general' } = req.body;
      
      if (!texto || texto.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'El texto del comentario es requerido'
        });
      }

      const formulario = await HistorialFormulario.findById(id);
      
      if (!formulario) {
        return res.status(404).json({
          success: false,
          error: 'Formulario no encontrado'
        });
      }

      await formulario.agregarComentario(
        req.user?.nombre || 'Usuario',
        texto.trim(),
        tipo
      );

      res.json({
        success: true,
        mensaje: 'Comentario agregado exitosamente',
        comentarios: formulario.comentarios
      });
    } catch (error) {
      console.error('Error agregando comentario:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Archivar un formulario
  async archivarFormulario(req, res) {
    try {
      const { id } = req.params;
      
      const formulario = await HistorialFormulario.findById(id);
      
      if (!formulario) {
        return res.status(404).json({
          success: false,
          error: 'Formulario no encontrado'
        });
      }

      if (formulario.archivado) {
        return res.status(400).json({
          success: false,
          error: 'El formulario ya está archivado'
        });
      }

      await formulario.archivar();

      res.json({
        success: true,
        mensaje: 'Formulario archivado exitosamente'
      });
    } catch (error) {
      console.error('Error archivando formulario:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }

  // Subir imágenes como archivos físicos
  async subirImagenes(req, res) {
    try {
      console.log('📸 Subiendo imágenes para historial...');
      
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No se recibieron imágenes'
        });
      }

      const casoId = req.query.casoId || 'general';
      const imagenesSubidas = req.files.map((file, index) => {
        const persisted = req.filesStorage?.__array?.[index];
        const rutaRelativa = persisted?.publicPath || `/uploads/historial/${casoId}/${file.filename}`;
        return {
          nombre: file.originalname,
          ruta: rutaRelativa,
          tamaño: persisted?.size ?? file.size,
          tipoMime: persisted?.mimetype ?? file.mimetype,
          filename: persisted?.filename ?? file.filename,
        };
      });

      console.log(`✅ ${imagenesSubidas.length} imágenes subidas exitosamente`);

      res.json({
        success: true,
        imagenes: imagenesSubidas,
        mensaje: `${imagenesSubidas.length} imagen(es) subida(s) exitosamente`
      });
    } catch (error) {
      console.error('❌ Error subiendo imágenes:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor al subir imágenes',
        detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Subir archivo Word del formulario
  async subirArchivoFormulario(req, res) {
    try {
      const { id } = req.params;
      console.log('📄 Subiendo archivo Word para formulario:', id);

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No se recibió archivo'
        });
      }

      const formulario = await HistorialFormulario.findById(id);
      if (!formulario) {
        if (req.fileStorage?.publicPath) {
          await deleteStoredFile(req.fileStorage.publicPath).catch(() => {});
        } else if (req.file?.path) {
          try {
            await fs.unlink(req.file.path);
          } catch (e) {
            console.error('Error eliminando archivo huérfano:', e);
          }
        }
        return res.status(404).json({
          success: false,
          error: 'Formulario no encontrado'
        });
      }

      const nombreArchivoOriginal = req.file.originalname || `inspeccion-propiedades_${Date.now()}.docx`;

      if (formulario.archivo?.ruta) {
        await deleteReplacedStoredFile(formulario.archivo.ruta, req.fileStorage?.publicPath).catch(
          (err) => {
            console.warn('⚠️ No se pudo eliminar el Word anterior del formulario:', err.message);
          }
        );
      }

      if (req.fileStorage?.driver === 's3') {
        formulario.archivo = {
          nombre: nombreArchivoOriginal,
          ruta: req.fileStorage.publicPath,
          tamaño: req.fileStorage.size,
          tipoMime: req.fileStorage.mimetype || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
      } else {
        const carpetaCaso = formulario.carpetaCaso || formulario.casoId || 'general';
        const uploadsDir = UPLOADS_ROOT;
        const carpetaCasoPath = path.join(uploadsDir, carpetaCaso);
        if (!fsSync.existsSync(carpetaCasoPath)) {
          await fs.mkdir(carpetaCasoPath, { recursive: true });
          console.log('✅ Carpeta del caso creada:', carpetaCasoPath);
        }

        const rutaFinal = path.join(carpetaCasoPath, nombreArchivoOriginal);

        if (req.file.path !== rutaFinal) {
          try {
            await fs.access(rutaFinal);
            await fs.unlink(rutaFinal);
            console.log('✅ Archivo anterior eliminado:', rutaFinal);
          } catch (e) {
            // El archivo no existe, está bien
          }

          try {
            await fs.rename(req.file.path, rutaFinal);
            console.log('✅ Archivo movido a:', rutaFinal);
          } catch (renameErr) {
            await fs.copyFile(req.file.path, rutaFinal);
            await fs.unlink(req.file.path);
            console.log('✅ Archivo copiado a (fallback rename):', rutaFinal, renameErr?.code || renameErr?.message);
          }
        }

        const rutaRelativa = `/uploads/${carpetaCaso}/${nombreArchivoOriginal}`;
        const stats = await fs.stat(rutaFinal);

        formulario.archivo = {
          nombre: nombreArchivoOriginal,
          ruta: rutaRelativa,
          tamaño: stats.size,
          tipoMime: req.file.mimetype || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
      }
      
      formulario.fechaModificacion = new Date();
      if (formulario.metadata) {
        formulario.metadata.modificadoPor = req.user?.id || 'unknown';
      }
      
      await formulario.save();

      console.log('✅ Archivo Word guardado exitosamente:', formulario.archivo);

      // Sesión externa (enlace de subtarea): el Word del ajuste queda adjunto
      // automáticamente a la subtarea como formato (entregable obligatorio).
      if (req.user?.externo && req.user?.subtareaId) {
        try {
          const subtarea = await ComplexSubtarea.findById(req.user.subtareaId);
          if (subtarea && !['cancelada'].includes(subtarea.estado)) {
            const marcador = `ajuste-formulario-${formulario._id}`;
            subtarea.archivos = (subtarea.archivos || []).filter(
              (a) => a.filename !== marcador
            );
            subtarea.archivos.push({
              nombre: formulario.archivo.nombre,
              url: formulario.archivo.ruta,
              filename: marcador,
              tipoArchivo: 'formato',
              subidoPor: req.user?.nombre || subtarea.nombreExterno || 'externo',
              subidoPorTipo: 'externo',
              fechaSubida: new Date(),
            });
            await subtarea.save();
            console.log('✅ Formato del ajuste adjuntado a la subtarea externa:', subtarea._id.toString());
          }
        } catch (subErr) {
          console.warn('⚠️ No se pudo adjuntar el formato a la subtarea externa:', subErr.message);
        }
      }

      res.json({
        success: true,
        mensaje: 'Archivo Word guardado exitosamente',
        archivo: formulario.archivo
      });
    } catch (error) {
      console.error('❌ Error subiendo archivo Word:', error);
      
      // Intentar eliminar archivo si hubo error
      if (req.file && req.file.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (e) {
          console.error('Error eliminando archivo después de error:', e);
        }
      }
      
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor al subir archivo',
        detalles: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
}

export default new HistorialController();

