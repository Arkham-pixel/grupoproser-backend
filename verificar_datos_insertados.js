import 'dotenv/config';
import mongoose from 'mongoose';
import Complex from './models/Complex.js';

async function verificar() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB\n');
    
    // Obtener un caso recién insertado
    const caso = await Complex.findOne({}).sort({ _id: -1 }).lean();
    
    if (!caso) {
      console.log('❌ No se encontraron casos en la BD');
      await mongoose.disconnect();
      return;
    }
    
    console.log('📋 CASO EJEMPLO INSERTADO:');
    console.log('='.repeat(60));
    console.log(`Número Ajuste: ${caso.nmroAjste}`);
    console.log(`Ciudad Siniestro: ${caso.ciudadSiniestro || 'NO TIENE'}`);
    console.log(`Asegurado: ${caso.asgrBenfcro || 'NO TIENE'}`);
    console.log(`Intermediario: ${caso.nombIntermediario || 'NO TIENE'}`);
    console.log(`\n📅 FECHAS:`);
    console.log(`  - Asignación: ${caso.fchaAsgncion || 'NO TIENE'}`);
    console.log(`  - Siniestro: ${caso.fchaSinstro || 'NO TIENE'}`);
    console.log(`  - Inspección: ${caso.fchaInspccion || 'NO TIENE'}`);
    console.log(`  - Contacto Inicial: ${caso.fchaContIni || 'NO TIENE'}`);
    console.log(`  - Solicitud Documentos: ${caso.fchaSoliDocu || 'NO TIENE'}`);
    console.log(`  - Informe Preliminar: ${caso.fchaInfoPrelm || 'NO TIENE'}`);
    console.log(`  - Informe Final: ${caso.fchaInfoFnal || 'NO TIENE'}`);
    console.log(`  - Último Seguimiento: ${caso.fchaUltSegui || 'NO TIENE'}`);
    console.log(`\n💰 VALORES:`);
    console.log(`  - Reserva: ${caso.vlorResrva || 0}`);
    console.log(`  - Reclamo: ${caso.vlorReclmo || 0}`);
    console.log(`  - Indemnizar: ${caso.montoIndmzar || 0}`);
    console.log(`\n📊 ESTADO:`);
    console.log(`  - Código Estado: ${caso.codiEstdo || 'NO TIENE'}`);
    console.log(`  - Responsable: ${caso.codiRespnsble || 'NO TIENE'}`);
    console.log(`  - Aseguradora: ${caso.codiAsgrdra || 'NO TIENE'}`);
    
    // Contar casos con ciudad
    const conCiudad = await Complex.countDocuments({ 
      ciudadSiniestro: { $exists: true, $ne: null, $ne: '' } 
    });
    const total = await Complex.countDocuments({});
    
    console.log(`\n📊 ESTADÍSTICAS:`);
    console.log(`  - Total casos: ${total}`);
    console.log(`  - Casos con ciudad: ${conCiudad}`);
    console.log(`  - Casos sin ciudad: ${total - conCiudad}`);
    
    await mongoose.disconnect();
    console.log('\n✅ Verificación completada');
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

verificar();


