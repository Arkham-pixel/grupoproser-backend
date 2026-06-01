import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ Defina MONGO_URI en backend/.env (ver .env.example).');
  process.exit(1);
}

// Conectar a la base de datos principal
const mainDB = mongoose.createConnection(MONGO_URI);

// Modelo de Usuario
const UsuarioSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  correo: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  rol: { type: String, enum: ["admin","soporte","usuario","visualizador"], default: "usuario" },
  celular: { type: String, trim: true },
  cedula: { type: String, trim: true },
  fechaNacimiento: { type: Date },
  foto: { type: String },
  twoFACode: { type: String },
  twoFACodeExpires: { type: Date }
}, {
  timestamps: true
});

const Usuario = mainDB.model("Usuario", UsuarioSchema);

async function crearUsuarios() {
  try {
    console.log('🔧 Creando usuarios de prueba...\n');

    const pwAdmin = process.env.SEED_PASSWORD_ADMIN;
    const pwSoporte = process.env.SEED_PASSWORD_SOPORTE;
    const pwUsuario = process.env.SEED_PASSWORD_USUARIO;
    if (!pwAdmin || !pwSoporte || !pwUsuario) {
      console.error(
        '❌ Defina en backend/.env las contraseñas de seed (solo para este script local):\n' +
          '   SEED_PASSWORD_ADMIN, SEED_PASSWORD_SOPORTE, SEED_PASSWORD_USUARIO'
      );
      process.exit(1);
    }

    // Lista de usuarios a crear (contraseñas nunca en el repo)
    const usuarios = [
      {
        nombre: "Administrador",
        correo: "admin@proser.com",
        password: pwAdmin,
        rol: "admin"
      },
      {
        nombre: "Soporte Técnico",
        correo: "soporte@proser.com",
        password: pwSoporte,
        rol: "soporte"
      },
      {
        nombre: "Usuario Prueba",
        correo: "usuario@proser.com",
        password: pwUsuario,
        rol: "usuario"
      }
    ];
    
    for (const userData of usuarios) {
      // Verificar si el usuario ya existe
      const existe = await Usuario.findOne({ correo: userData.correo });
      if (existe) {
        console.log(`⚠️ Usuario ${userData.correo} ya existe`);
        continue;
      }
      
      // Encriptar contraseña
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(userData.password, saltRounds);
      
      // Crear usuario
      const nuevoUsuario = new Usuario({
        ...userData,
        password: hashedPassword
      });
      
      await nuevoUsuario.save();
      console.log(`✅ Usuario creado: ${userData.nombre} (${userData.correo})`);
    }
    
    console.log('\n📊 Usuarios en la base de datos:');
    const todosUsuarios = await Usuario.find({}, { password: 0, twoFACode: 0, twoFACodeExpires: 0 });
    todosUsuarios.forEach(user => {
      console.log(`- ${user.nombre} (${user.correo}) - Rol: ${user.rol}`);
    });
    
    console.log('\n✅ Proceso completado');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mainDB.close();
    process.exit(0);
  }
}

crearUsuarios(); 