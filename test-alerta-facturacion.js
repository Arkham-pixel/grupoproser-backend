/**
 * Script de prueba para verificar la funcionalidad de alerta de facturación
 * Este script prueba el envío de alertas a Iskharly y Elkin cuando se suben documentos de control de horas
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { enviarNotificacionControlHoras } from './services/emailService.js';

// Datos de prueba
const datosPrueba = {
  numeroCaso: 'TEST-2026-001',
  numeroSiniestro: 'SIN-2026-001',
  responsable: 'Responsable de Prueba',
  archivos: ['documento_prueba_1.pdf', 'documento_prueba_2.xlsx'],
  usuario: 'usuario_prueba'
};

async function probarAlertaFacturacion() {
  try {
    console.log('🧪 ===== INICIANDO PRUEBA DE ALERTA DE FACTURACIÓN =====\n');
    console.log('📅 Fecha:', new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }));
    console.log('📋 Datos de prueba:', JSON.stringify(datosPrueba, null, 2));
    console.log('\n');

    // Verificar variables de entorno
    console.log('🔍 Verificando configuración...');
    if (!process.env.MONGO_URI) {
      console.error('❌ ERROR: MONGO_URI no está definida en las variables de entorno');
      process.exit(1);
    }
    if (!process.env.EMAIL_USER) {
      console.error('❌ ERROR: EMAIL_USER no está definida en las variables de entorno');
      process.exit(1);
    }
    if (!process.env.EMAIL_PASS) {
      console.error('❌ ERROR: EMAIL_PASS no está definida en las variables de entorno');
      process.exit(1);
    }
    console.log('✅ Variables de entorno configuradas correctamente');
    console.log('📧 EMAIL_USER:', process.env.EMAIL_USER);
    console.log('📧 EMAIL_PASS:', process.env.EMAIL_PASS ? '***' : 'NO DEFINIDO');
    console.log('\n');

    // Conectar a MongoDB
    console.log('🔌 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Conectado a MongoDB\n');

    // Ejecutar la prueba
    console.log('📧 Enviando notificación de control de horas...');
    console.log('📧 Destinatarios esperados: Iskharly y Elkin\n');
    
    const resultado = await enviarNotificacionControlHoras(datosPrueba);

    console.log('\n✅ ===== RESULTADO DE LA PRUEBA =====');
    console.log('📊 Resultado:', JSON.stringify(resultado, null, 2));
    
    if (resultado.success) {
      console.log('\n✅ ¡PRUEBA EXITOSA!');
      console.log('📧 Email enviado correctamente');
      console.log('📬 Message ID:', resultado.messageId);
      console.log('👥 Destinatarios:', resultado.destinatarios?.join(', ') || 'No especificados');
      console.log('\n💡 Verifica los correos de:');
      console.log('   - Iskharly (itapia9@proserpuertos.com.co o email de BD)');
      console.log('   - Elkin (etapia@proserpuertos.com.co o email de BD)');
    } else {
      console.log('\n❌ PRUEBA FALLIDA');
      console.log('⚠️ Mensaje:', resultado.message || 'Error desconocido');
    }

  } catch (error) {
    console.error('\n❌ ===== ERROR EN LA PRUEBA =====');
    console.error('❌ Error:', error.message);
    console.error('📋 Stack:', error.stack);
    process.exit(1);
  } finally {
    // Cerrar conexión a MongoDB
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('\n🔌 Desconectado de MongoDB');
    }
    console.log('\n🏁 Prueba finalizada');
    process.exit(0);
  }
}

// Ejecutar la prueba
probarAlertaFacturacion();
