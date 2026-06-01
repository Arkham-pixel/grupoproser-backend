import cerrarSesionesInactivas from './cerrarSesionesInactivas.js';

/**
 * Servicio de cron para cerrar sesiones inactivas automáticamente
 * Se ejecuta cada 10 minutos para limpiar sesiones abandonadas
 */
let intervalo = null;

export function iniciarCronSesiones() {
  // Limpiar intervalo anterior si existe
  if (intervalo) {
    clearInterval(intervalo);
  }
  
  console.log('🕐 Iniciando cron de cierre de sesiones inactivas...');
  
  // Ejecutar inmediatamente al iniciar
  cerrarSesionesInactivas().catch(err => {
    console.error('❌ Error en primera ejecución de cierre de sesiones:', err);
  });
  
  // Ejecutar cada 5 minutos para verificar sesiones que cumplen 7h 50m
  intervalo = setInterval(() => {
    console.log('🕐 Ejecutando cierre automático de sesiones (7h 50m)...');
    cerrarSesionesInactivas().catch(err => {
      console.error('❌ Error cerrando sesiones:', err);
    });
  }, 5 * 60 * 1000); // 5 minutos
  
  console.log('✅ Cron de cierre automático de sesiones iniciado (cada 5 minutos, cierra después de 7h 50m)');
  
  return {
    detener: () => {
      if (intervalo) {
        clearInterval(intervalo);
        intervalo = null;
        console.log('🛑 Cron de sesiones inactivas detenido');
      }
    }
  };
}

export function detenerCronSesiones() {
  if (intervalo) {
    clearInterval(intervalo);
    intervalo = null;
    console.log('🛑 Cron de sesiones inactivas detenido');
  }
}

