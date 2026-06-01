import 'dotenv/config';
import mongoose from 'mongoose';
import SecurUser from './models/SecurUser.js';

const MONGO_URI = process.env.MONGO_URI;

async function actualizarRolUsuario() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    const login = '1065012991'; // Usuario de Oscar Atencia
    
    // Buscar usuario
    const usuario = await SecurUser.findOne({ login });
    
    if (!usuario) {
      console.log('❌ Usuario no encontrado con login:', login);
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log('\n📋 Información del usuario ANTES:');
    console.log('  Login:', usuario.login);
    console.log('  Nombre:', usuario.name);
    console.log('  Rol actual:', usuario.role);

    // Actualizar rol a soporte
    usuario.role = 'soporte';
    await usuario.save();

    console.log('\n✅ Rol actualizado exitosamente');
    console.log('\n📋 Información del usuario DESPUÉS:');
    console.log('  Login:', usuario.login);
    console.log('  Nombre:', usuario.name);
    console.log('  Rol nuevo:', usuario.role);

    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
    console.log('\n💡 IMPORTANTE: Debes cerrar sesión y volver a iniciar sesión para que el cambio surta efecto.');
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

actualizarRolUsuario();

