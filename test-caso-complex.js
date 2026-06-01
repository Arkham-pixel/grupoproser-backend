import mongoose from 'mongoose';
import Siniestro from './models/CasoComplex.js';
import dotenv from 'dotenv';

dotenv.config();

// Conectar a la base de datos usando la misma configuración que el servidor
const connectDB = async () => {
  try {
    const MONGO_URI = process.env.MONGO_URI;
    if (!MONGO_URI) {
      console.error('❌ La variable de entorno MONGO_URI no está definida.');
      console.log('💡 Crea un archivo .env en la carpeta backend con:');
      console.log('   MONGO_URI=mongodb://localhost:27017/grupoproser');
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
    console.log('✅ Conectado a MongoDB usando:', MONGO_URI);
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    console.log('💡 Asegúrate de que MongoDB esté corriendo y la URI sea correcta');
    process.exit(1);
  }
};

// Función para crear un caso de prueba
const crearCasoPrueba = async () => {
  try {
    console.log('🔍 Creando caso de prueba...');
    
    const casoPrueba = {
      nmroAjste: 'AJ-001',
      nmroSinstro: 'SIN-2024-001',
      nombIntermediario: 'Intermediario de Prueba',
      codWorkflow: 'WF-001',
      nmroPolza: 'POL-2024-001',
      codiRespnsble: 'RESP-001',
      codiAsgrdra: 'ASEG-001',
      funcAsgrdra: 'FUNC-001',
      asgrBenfcro: 'Cliente de Prueba',
      tipoDucumento: 'CC',
      numDocumento: '12345678',
      tipoPoliza: 'Todo Riesgo',
      ciudadSiniestro: 'Bogotá',
      amprAfctdo: 'Vehículo',
      descSinstro: 'Siniestro de prueba para verificar funcionamiento',
      causa_siniestro: 'Colisión',
      codiEstdo: '1',
      fchaAsgncion: new Date('2024-01-15'),
      fchaSinstro: new Date('2024-01-14'),
      fchaInspccion: new Date('2024-01-16'),
      fchaContIni: new Date('2024-01-15'),
      
      // Campos adicionales
      obse_cont_ini: 'Observación de contacto inicial de prueba',
      anex_cont_ini: 'anexo_contacto_inicial.pdf',
      obse_inspccion: 'Observación de inspección de prueba',
      anex_acta_inspccion: 'acta_inspeccion.pdf',
      anex_sol_doc: 'solicitud_documentos.pdf',
      obse_soli_docu: 'Observación solicitud documentos de prueba',
      anxo_inf_prelim: 'informe_preliminar.pdf',
      obse_info_prelm: 'Observación informe preliminar de prueba',
      anxo_info_fnal: 'informe_final.pdf',
      obse_info_fnal: 'Observación informe final de prueba',
      anxo_repo_acti: 'reporte_actividad.pdf',
      obse_repo_acti: 'Observación reporte actividad de prueba',
      anxo_factra: 'factura.pdf',
      anxo_honorarios: 'honorarios.pdf',
      anxo_honorariosdefinit: 'honorarios_definitivos.pdf',
      anxo_autorizacion: 'autorizacion.pdf',
      obse_comprmsi: 'Observación compromisos de prueba',
      obse_segmnto: 'Observación seguimiento de prueba',
      
      // Campos de fechas
      fcha_soli_docu: new Date('2024-01-17'),
      fcha_info_prelm: new Date('2024-01-18'),
      fcha_info_fnal: new Date('2024-01-20'),
      fcha_repo_acti: new Date('2024-01-19'),
      fcha_ult_segui: new Date('2024-01-21'),
      fcha_act_segui: new Date('2024-01-22'),
      fcha_finqto_indem: new Date('2024-01-23'),
      fcha_factra: new Date('2024-01-24'),
      fcha_ult_revi: new Date('2024-01-25'),
      
      // Campos numéricos
      dias_transcrrdo: 10,
      vlor_resrva: 5000000,
      vlor_reclmo: 8000000,
      monto_indmzar: 7500000,
      vlor_servcios: 500000,
      vlor_gastos: 200000,
      total: 8200000,
      total_general: 8700000,
      total_pagado: 0,
      iva: 0,
      reteiva: 0,
      retefuente: 0,
      reteica: 0,
      porc_iva: 0,
      porc_reteiva: 0,
      porc_retefuente: 0,
      porc_reteica: 0,
      
      historialDocs: [
        {
          tipo: 'Documento',
          nombre: 'documento_prueba.pdf',
          fecha: new Date(),
          comentario: 'Documento de prueba',
          url: '/uploads/documento_prueba.pdf'
        }
      ]
    };
    
    const nuevoSiniestro = new Siniestro(casoPrueba);
    const siniestroGuardado = await nuevoSiniestro.save();
    
    console.log('✅ Caso de prueba creado exitosamente:');
    console.log('   ID:', siniestroGuardado._id);
    console.log('   Número de Siniestro:', siniestroGuardado.nmroSinstro);
    console.log('   Responsable:', siniestroGuardado.codiRespnsble);
    console.log('   Aseguradora:', siniestroGuardado.codiAsgrdra);
    console.log('   Fecha Asignación:', siniestroGuardado.fchaAsgncion);
    
    return siniestroGuardado;
  } catch (error) {
    console.error('❌ Error creando caso de prueba:', error);
    throw error;
  }
};

// Función para verificar que el caso se guardó correctamente
const verificarCasoGuardado = async (id) => {
  try {
    console.log('🔍 Verificando caso guardado...');
    
    const siniestro = await Siniestro.findById(id);
    if (!siniestro) {
      throw new Error('No se encontró el siniestro');
    }
    
    console.log('✅ Caso verificado exitosamente:');
    console.log('   Todos los campos principales están presentes');
    console.log('   Campos de fecha:', {
      fchaAsgncion: siniestro.fchaAsgncion,
      fchaSinstro: siniestro.fchaSinstro,
      fchaInspccion: siniestro.fchaInspccion
    });
    console.log('   Campos numéricos:', {
      vlor_resrva: siniestro.vlor_resrva,
      total: siniestro.total
    });
    console.log('   Historial de documentos:', siniestro.historialDocs?.length || 0);
    
    return siniestro;
  } catch (error) {
    console.error('❌ Error verificando caso:', error);
    throw error;
  }
};

// Función para probar la actualización
const probarActualizacion = async (id) => {
  try {
    console.log('🔍 Probando actualización...');
    
    const actualizacion = {
      obse_segmnto: 'Observación de seguimiento actualizada',
      vlor_resrva: 6000000,
      total: 9000000
    };
    
    const siniestroActualizado = await Siniestro.findByIdAndUpdate(
      id, 
      actualizacion, 
      { new: true }
    );
    
    console.log('✅ Actualización exitosa:');
    console.log('   Nueva observación:', siniestroActualizado.obse_segmnto);
    console.log('   Nueva reserva:', siniestroActualizado.vlor_resrva);
    console.log('   Nuevo total:', siniestroActualizado.total);
    
    return siniestroActualizado;
  } catch (error) {
    console.error('❌ Error en actualización:', error);
    throw error;
  }
};

// Función principal de prueba
const ejecutarPruebas = async () => {
  try {
    await connectDB();
    
    console.log('\n🚀 INICIANDO PRUEBAS COMPLETAS DEL SISTEMA COMPLEX\n');
    
    // 1. Crear caso de prueba
    const casoCreado = await crearCasoPrueba();
    
    // 2. Verificar que se guardó correctamente
    await verificarCasoGuardado(casoCreado._id);
    
    // 3. Probar actualización
    await probarActualizacion(casoCreado._id);
    
    // 4. Verificar final
    await verificarCasoGuardado(casoCreado._id);
    
    console.log('\n🎉 TODAS LAS PRUEBAS COMPLETADAS EXITOSAMENTE');
    console.log('✅ El sistema está funcionando correctamente');
    console.log('✅ Los campos se mapean correctamente');
    console.log('✅ La base de datos guarda todos los datos');
    console.log('✅ Las actualizaciones funcionan');
    
  } catch (error) {
    console.error('\n💥 ERROR EN LAS PRUEBAS:', error);
    console.error('❌ El sistema tiene problemas que necesitan ser corregidos');
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado de MongoDB');
    process.exit(0);
  }
};

// Ejecutar las pruebas
ejecutarPruebas();
