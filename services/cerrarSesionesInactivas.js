import mongoose from 'mongoose';
import SesionUsuario from '../models/SesionUsuario.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script para cerrar sesiones inactivas automáticamente
 * Ejecutar periódicamente (cada 5-10 minutos) para limpiar sesiones abandonadas
 */
async function cerrarSesionesInactivas() {
  try {
    // Conectar a MongoDB si no está conectado
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/grupoproser');
      console.log('✅ Conectado a MongoDB');
    }
    
    // Tiempo máximo de sesión: 7 horas 50 minutos (470 minutos)
    const tiempoMaximoSesion = 7 * 60 * 60 * 1000 + 50 * 60 * 1000; // 7 horas 50 minutos en milisegundos
    const tiempoLimiteInicio = new Date(Date.now() - tiempoMaximoSesion);
    
    console.log(`🔍 Buscando sesiones que iniciaron antes de: ${tiempoLimiteInicio.toISOString()}`);
    console.log(`⏰ Tiempo máximo de sesión: 7 horas 50 minutos`);
    
    // Buscar sesiones activas que iniciaron hace más de 7 horas 50 minutos
    const sesionesInactivas = await SesionUsuario.find({
      activa: true,
      inicioSesion: { $lt: tiempoLimiteInicio }
    });
    
    console.log(`📊 Sesiones que exceden 7h 50m encontradas: ${sesionesInactivas.length}`);
    
    let cerradas = 0;
    for (const sesion of sesionesInactivas) {
      const finSesion = new Date();
      const duracionMs = finSesion - sesion.inicioSesion;
      const duracionMinutos = Math.floor(duracionMs / (1000 * 60));
      const duracionSegundos = Math.floor((duracionMs % (1000 * 60)) / 1000);
      const horas = Math.floor(duracionMinutos / 60);
      const minutosRestantes = duracionMinutos % 60;
      
      sesion.finSesion = finSesion;
      sesion.duracionMinutos = duracionMinutos;
      sesion.duracionSegundos = duracionSegundos;
      sesion.activa = false;
      
      await sesion.save();
      cerradas++;
      
      console.log(`✅ Sesión cerrada automáticamente (7h 50m cumplidas): ${sesion.login} (${sesion.nombre}) - Duración total: ${horas}h ${minutosRestantes}m ${duracionSegundos}s`);
    }
    
    console.log(`✅ Total de sesiones cerradas automáticamente (por tiempo máximo): ${cerradas}`);
    
    // Si hay conexión abierta y no fue creada aquí, no cerrarla
    if (mongoose.connection.readyState === 1 && process.env.NODE_ENV !== 'production') {
      // En desarrollo, mantener la conexión abierta
    }
    
    return { cerradas, total: sesionesInactivas.length };
  } catch (error) {
    console.error('❌ Error cerrando sesiones inactivas:', error);
    throw error;
  }
}

// Si se ejecuta directamente, ejecutar la función
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('cerrarSesionesInactivas')) {
  cerrarSesionesInactivas()
    .then(result => {
      console.log('✅ Proceso completado:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Error:', error);
      process.exit(1);
    });
}

export default cerrarSesionesInactivas;

