import 'dotenv/config';
import mongoose from 'mongoose';
import SecurUser from './models/SecurUser.js';

const MONGO_URI = process.env.MONGO_URI;

async function verificarYActualizarUsuario() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    const login = '1065012991'; // Usuario de Oscar Atencia
    
    // Buscar usuario
    const usuario = await SecurUser.findOne({ login });
    
    if (!usuario) {
      console.log('❌ Usuario no encontrado con login:', login);
      process.exit(1);
    }

    console.log('\n📋 Información del usuario:');
    console.log('  Login:', usuario.login);
    console.log('  Nombre:', usuario.name);
    console.log('  Email:', usuario.email);
    console.log('  Rol actual:', usuario.role);
    console.log('  Activo:', usuario.active);

    // Verificar si el rol es soporte o admin
    if (usuario.role !== 'soporte' && usuario.role !== 'admin') {
      console.log('\n⚠️ El usuario NO tiene rol de soporte o admin');
      console.log('   Rol actual:', usuario.role);
      console.log('\n💡 ¿Deseas actualizar el rol a "soporte"? (S/N)');
      console.log('   Para actualizar manualmente, ejecuta en MongoDB:');
      console.log(`   db.securUsers.updateOne({ login: "${login}" }, { $set: { role: "soporte" } })`);
    } else {
      console.log('\n✅ El usuario tiene rol correcto:', usuario.role);
    }

    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verificarYActualizarUsuario();

