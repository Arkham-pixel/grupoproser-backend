// Script para generar sesiones históricas aproximadas basadas en la actividad de usuarios
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SecurUser from './models/SecurUser.js';
import SesionUsuario from './models/SesionUsuario.js';
import HistorialFormulario from './models/HistorialFormulario.js';
import Complex from './models/Complex.js';
import CasoRiesgo from './models/CasoRiesgo.js';
import Tarea from './models/Tarea.js';

dotenv.config();

// Función para conectar a MongoDB
const connectDB = async () => {
  try {
    const MONGO_URI = process.env.MONGO_URI;
    if (!MONGO_URI) {
      console.error('❌ La variable de entorno MONGO_URI no está definida.');
      process.exit(1);
    }
    
    const mongoOptions = {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 1,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      w: "majority"
    };
    
    await mongoose.connect(MONGO_URI, mongoOptions);
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    process.exit(1);
  }
};

// Función para obtener la fecha de inicio del día
const inicioDelDia = (fecha) => {
  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
};

// Función para obtener la fecha de fin del día
const finDelDia = (fecha) => {
  const fin = new Date(fecha);
  fin.setHours(23, 59, 59, 999);
  return fin;
};

// Función para estimar duración de sesión basada en actividad
const estimarDuracionSesion = (actividades) => {
  // Base: 30 minutos mínimos por sesión
  let minutosBase = 30;
  
  // Agregar tiempo según la cantidad de actividades
  // Cada formulario/caso: ~15-20 minutos
  // Cada tarea: ~5 minutos
  const tiempoPorActividad = {
    formulario: 20,
    caso: 25,
    tarea: 5,
    modificacion: 10
  };
  
  let tiempoAdicional = 0;
  
  actividades.forEach(act => {
    if (act.tipo === 'formulario') {
      tiempoAdicional += tiempoPorActividad.formulario;
    } else if (act.tipo === 'caso') {
      tiempoAdicional += tiempoPorActividad.caso;
    } else if (act.tipo === 'tarea') {
      tiempoAdicional += tiempoPorActividad.tarea;
    } else if (act.tipo === 'modificacion') {
      tiempoAdicional += tiempoPorActividad.modificacion;
    }
  });
  
  // Tiempo total estimado (máximo 8 horas por sesión)
  const tiempoTotal = Math.min(minutosBase + tiempoAdicional, 8 * 60);
  
  return {
    minutos: Math.floor(tiempoTotal),
    segundos: Math.floor((tiempoTotal % 1) * 60)
  };
};

// Función principal para generar sesiones históricas
const generarSesionesHistoricas = async () => {
  try {
    console.log('🔄 Iniciando generación de sesiones históricas...\n');
    
    // Obtener todos los usuarios activos
    const usuarios = await SecurUser.find({ active: 'Y' });
    console.log(`📊 Usuarios activos encontrados: ${usuarios.length}\n`);
    
    // Crear un mapa de usuarios por login y userId
    const usuariosMap = new Map();
    usuarios.forEach(user => {
      usuariosMap.set(user.login.toLowerCase(), {
        id: user._id,
        login: user.login,
        nombre: user.name,
        email: user.email
      });
    });
    
    // Calcular fecha de inicio (hace 15 días)
    const fechaFin = new Date();
    const fechaInicio = new Date();
    fechaInicio.setDate(fechaInicio.getDate() - 15);
    
    console.log(`📅 Período analizado: ${fechaInicio.toLocaleDateString('es-CO')} - ${fechaFin.toLocaleDateString('es-CO')}\n`);
    
    // 1. Analizar HistorialFormulario
    console.log('📝 Analizando HistorialFormulario...');
    const formularios = await HistorialFormulario.find({
      fechaCreacion: { $gte: fechaInicio, $lte: fechaFin }
    }).sort({ fechaCreacion: 1 });
    
    console.log(`   ✅ ${formularios.length} formularios encontrados`);
    
    // 2. Analizar Complex (casos)
    console.log('📋 Analizando casos Complex...');
    const casosComplex = await Complex.find({
      $or: [
        { createdAt: { $gte: fechaInicio, $lte: fechaFin } },
        { fchaAsgncion: { $gte: fechaInicio, $lte: fechaFin } },
        { updatedAt: { $gte: fechaInicio, $lte: fechaFin } }
      ]
    }).sort({ createdAt: 1, fchaAsgncion: 1 });
    
    console.log(`   ✅ ${casosComplex.length} casos Complex encontrados`);
    
    // 3. Analizar CasoRiesgo
    console.log('⚠️ Analizando casos de Riesgo...');
    const casosRiesgo = await CasoRiesgo.find({
      $or: [
        { fchaAsgncion: { $gte: fechaInicio, $lte: fechaFin } },
        { fchaInspccion: { $gte: fechaInicio, $lte: fechaFin } },
        { fchaInforme: { $gte: fechaInicio, $lte: fechaFin } }
      ]
    }).sort({ fchaAsgncion: 1 });
    
    console.log(`   ✅ ${casosRiesgo.length} casos de Riesgo encontrados`);
    
    // 4. Analizar Tareas
    console.log('✅ Analizando tareas...');
    const tareas = await Tarea.find({
      fecha: { $gte: fechaInicio, $lte: fechaFin }
    }).sort({ fecha: 1 });
    
    console.log(`   ✅ ${tareas.length} tareas encontradas\n`);
    
    // Agrupar actividad por usuario y día
    const actividadPorUsuarioDia = new Map();
    
    // Procesar formularios
    formularios.forEach(form => {
      const login = form.usuario?.toLowerCase();
      if (!login || !usuariosMap.has(login)) return;
      
      const usuario = usuariosMap.get(login);
      const fecha = inicioDelDia(form.fechaCreacion);
      const clave = `${usuario.id}_${fecha.getTime()}`;
      
      if (!actividadPorUsuarioDia.has(clave)) {
        actividadPorUsuarioDia.set(clave, {
          usuarioId: usuario.id,
          login: usuario.login,
          nombre: usuario.nombre,
          fecha: fecha,
          actividades: []
        });
      }
      
      actividadPorUsuarioDia.get(clave).actividades.push({
        tipo: 'formulario',
        fecha: form.fechaCreacion,
        descripcion: `${form.tipo} - ${form.titulo}`
      });
    });
    
    // Procesar casos Complex
    casosComplex.forEach(caso => {
      // Intentar encontrar el usuario por historialDocs
      if (caso.historialDocs && caso.historialDocs.length > 0) {
        const primerDoc = caso.historialDocs[0];
        if (primerDoc.usuario) {
          const login = primerDoc.usuario.toLowerCase();
          if (usuariosMap.has(login)) {
            const usuario = usuariosMap.get(login);
            const fechaCaso = caso.createdAt || caso.fchaAsgncion || caso.updatedAt || new Date();
            const fecha = inicioDelDia(fechaCaso);
            const clave = `${usuario.id}_${fecha.getTime()}`;
            
            if (!actividadPorUsuarioDia.has(clave)) {
              actividadPorUsuarioDia.set(clave, {
                usuarioId: usuario.id,
                login: usuario.login,
                nombre: usuario.nombre,
                fecha: fecha,
                actividades: []
              });
            }
            
            actividadPorUsuarioDia.get(clave).actividades.push({
              tipo: 'caso',
              fecha: fechaCaso,
              descripcion: `Caso Complex - ${caso.nmroAjste || 'N/A'}`
            });
          }
        }
      }
    });
    
    // Procesar casos de Riesgo
    casosRiesgo.forEach(caso => {
      // Los casos de riesgo no tienen campo de usuario directo
      // Podríamos intentar usar codiIspector si coincide con algún login
      // Por ahora los omitimos o los procesamos de otra manera
      // Si tienes información de usuario en estos casos, agrega la lógica aquí
    });
    
    // Procesar tareas
    tareas.forEach(tarea => {
      const login = tarea.login?.toLowerCase();
      if (!login || !usuariosMap.has(login)) return;
      
      const usuario = usuariosMap.get(login);
      const fecha = inicioDelDia(tarea.fecha);
      const clave = `${usuario.id}_${fecha.getTime()}`;
      
      if (!actividadPorUsuarioDia.has(clave)) {
        actividadPorUsuarioDia.set(clave, {
          usuarioId: usuario.id,
          login: usuario.login,
          nombre: usuario.nombre,
          fecha: fecha,
          actividades: []
        });
      }
      
      actividadPorUsuarioDia.get(clave).actividades.push({
        tipo: 'tarea',
        fecha: tarea.fecha,
        descripcion: tarea.texto
      });
    });
    
    console.log(`📊 Días con actividad encontrados: ${actividadPorUsuarioDia.size}\n`);
    
    // Generar sesiones históricas
    const sesionesGeneradas = [];
    let sesionesCreadas = 0;
    let sesionesOmitidas = 0;
    
    for (const [clave, datos] of actividadPorUsuarioDia) {
      // Ordenar actividades por fecha
      datos.actividades.sort((a, b) => a.fecha - b.fecha);
      
      // Estimar hora de inicio (primera actividad del día)
      const primeraActividad = datos.actividades[0];
      const horaInicio = new Date(primeraActividad.fecha);
      // Ajustar a una hora razonable (entre 8 AM y 9 AM, o usar la hora real si es después de 8 AM)
      if (horaInicio.getHours() < 8) {
        horaInicio.setHours(8, 0, 0, 0);
      } else {
        horaInicio.setMinutes(0, 0, 0);
      }
      
      // Estimar duración
      const duracion = estimarDuracionSesion(datos.actividades);
      
      // Calcular hora de fin
      const horaFin = new Date(horaInicio);
      horaFin.setMinutes(horaFin.getMinutes() + duracion.minutos);
      
      // Verificar si ya existe una sesión para este usuario y día
      const sesionExistente = await SesionUsuario.findOne({
        usuarioId: datos.usuarioId,
        inicioSesion: {
          $gte: inicioDelDia(datos.fecha),
          $lte: finDelDia(datos.fecha)
        }
      });
      
      if (sesionExistente) {
        sesionesOmitidas++;
        continue;
      }
      
      // Crear sesión histórica
      const sesion = new SesionUsuario({
        usuarioId: datos.usuarioId,
        login: datos.login,
        nombre: datos.nombre,
        inicioSesion: horaInicio,
        finSesion: horaFin,
        duracionMinutos: duracion.minutos,
        duracionSegundos: duracion.segundos,
        activa: false,
        ip: 'historical',
        userAgent: 'historical-data-generation'
      });
      
      await sesion.save();
      sesionesCreadas++;
      sesionesGeneradas.push({
        usuario: datos.nombre,
        fecha: datos.fecha.toLocaleDateString('es-CO'),
        duracion: `${duracion.minutos}m`,
        actividades: datos.actividades.length
      });
      
      if (sesionesCreadas % 10 === 0) {
        console.log(`   ✅ ${sesionesCreadas} sesiones creadas...`);
      }
    }
    
    console.log('\n📊 Resumen de generación:');
    console.log(`   ✅ Sesiones creadas: ${sesionesCreadas}`);
    console.log(`   ⏭️  Sesiones omitidas (ya existían): ${sesionesOmitidas}`);
    console.log(`   📅 Total de días con actividad: ${actividadPorUsuarioDia.size}\n`);
    
    // Mostrar algunas sesiones generadas como ejemplo
    if (sesionesGeneradas.length > 0) {
      console.log('📋 Ejemplos de sesiones generadas:');
      sesionesGeneradas.slice(0, 10).forEach(sesion => {
        console.log(`   • ${sesion.usuario} - ${sesion.fecha} - ${sesion.duracion} (${sesion.actividades} actividades)`);
      });
      if (sesionesGeneradas.length > 10) {
        console.log(`   ... y ${sesionesGeneradas.length - 10} más`);
      }
    }
    
    console.log('\n✅ Proceso completado exitosamente!');
    
  } catch (error) {
    console.error('❌ Error generando sesiones históricas:', error);
    throw error;
  }
};

// Ejecutar el script
const main = async () => {
  try {
    await connectDB();
    await generarSesionesHistoricas();
    await mongoose.connection.close();
    console.log('\n👋 Conexión cerrada. ¡Hasta luego!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
};

main();

