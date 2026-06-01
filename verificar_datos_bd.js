import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

const MONGO_URI = process.env.MONGO_URI;

async function verificarDatos() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Obtener un caso de ejemplo
    const caso = await Complex.findOne();
    
    if (!caso) {
      console.log('⚠️ No hay casos en la base de datos');
      await mongoose.disconnect();
      return;
    }

    console.log('📊 CASO DE EJEMPLO:');
    console.log('='.repeat(60));
    console.log('ID:', caso._id);
    console.log('No. Ajuste:', caso.nmroAjste);
    console.log('\n📋 CAMPOS PRINCIPALES:');
    console.log('  - tipoDucumento:', caso.tipoDucumento || '(vacío)');
    console.log('  - numDocumento:', caso.numDocumento || '(vacío)');
    console.log('  - tipoPoliza:', caso.tipoPoliza || '(vacío)');
    console.log('  - amprAfctdo:', caso.amprAfctdo || '(vacío)');
    console.log('  - descSinstro:', caso.descSinstro || '(vacío)');
    console.log('  - ciudadSiniestro:', caso.ciudadSiniestro || '(vacío)');
    
    console.log('\n💰 VALORES:');
    console.log('  - vlorResrva:', caso.vlorResrva || '(vacío)');
    console.log('  - vlorReclmo:', caso.vlorReclmo || '(vacío)');
    console.log('  - montoIndmzar:', caso.montoIndmzar || '(vacío)');
    console.log('  - total:', caso.total || '(vacío)');
    console.log('  - totalGeneral:', caso.totalGeneral || '(vacío)');
    
    console.log('\n📅 FECHAS:');
    console.log('  - fchaAsgncion:', caso.fchaAsgncion || '(vacío)');
    console.log('  - fchaInspccion:', caso.fchaInspccion || '(vacío)');
    console.log('  - fchaContIni:', caso.fchaContIni || '(vacío)');
    console.log('  - fchaSinstro:', caso.fchaSinstro || '(vacío)');
    console.log('  - fchaUltRevi:', caso.fchaUltRevi || '(vacío)');
    console.log('  - fchaInfoFnal:', caso.fchaInfoFnal || '(vacío)');
    
    console.log('\n📝 TODOS LOS CAMPOS DEL CASO:');
    const todosLosCampos = Object.keys(caso.toObject());
    todosLosCampos.forEach(campo => {
      const valor = caso[campo];
      if (valor !== null && valor !== undefined && valor !== '') {
        console.log(`  - ${campo}:`, typeof valor === 'object' ? JSON.stringify(valor).substring(0, 50) : String(valor).substring(0, 50));
      }
    });
    
    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

verificarDatos();



