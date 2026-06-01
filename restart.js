import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔄 Reiniciando backend...');

// Detener el proceso actual si está corriendo
process.on('SIGINT', () => {
  console.log('\n🛑 Deteniendo servidor...');
  process.exit(0);
});

// Iniciar el servidor
const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: 'inherit'
});

server.on('error', (error) => {
  console.error('❌ Error iniciando servidor:', error);
});

server.on('exit', (code) => {
  console.log(`🔄 Servidor terminado con código: ${code}`);
});

console.log('✅ Backend reiniciado. Verifica los logs para confirmar CORS.');
console.log('📝 Deberías ver: "🚀 CORS configurado para orígenes:"');
console.log('📝 Y: "🔧 Headers CORS aplicados automáticamente"'); 