import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Configurar dotenv
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

import Complex from '../models/Complex.js';
import Siniestro from '../models/CasoComplex.js';
import Cliente from '../models/Cliente.js';

// Conectar a MongoDB
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
      console.error('❌ Error: MONGO_URI no está definido en las variables de entorno');
      console.error('   Por favor, configura MONGO_URI en el archivo .env');
      process.exit(1);
    }
    await mongoose.connect(mongoURI);
    console.log('✅ MongoDB conectado');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error.message);
    process.exit(1);
  }
};

const contarCasosAseguradoras = async () => {
  try {
    await connectDB();

    // Obtener todas las aseguradoras para mapeo
    const clientes = await Cliente.find({});
    console.log(`\n📋 Total de clientes/aseguradoras en BD: ${clientes.length}\n`);

    // Crear mapas de códigos a nombres
    const mapaCodigoANombre = {};
    const mapaNombreACodigo = {};
    
    clientes.forEach(cliente => {
      const codigo = String(cliente.codiAsgrdra || '').trim();
      const nombre = String(cliente.rzonSocial || '').trim();
      
      if (codigo && nombre) {
        mapaCodigoANombre[codigo] = nombre;
        mapaNombreACodigo[nombre.toUpperCase()] = codigo;
      }
    });

    // Buscar posibles variantes de los nombres que buscamos
    const nombresBuscados = {
      bbva: ['BBVA', 'BBVA SEGUROS', 'BBVA SEGUROS COLOMBIA'],
      zurich: ['ZURICH', 'ZÚRICH', 'ZURICH COLOMBIA', 'ZURICH COLOMBIA SEGUROS']
    };

    // Buscar códigos que coincidan
    const codigosBBVA = [];
    const codigosZurich = [];
    
    Object.entries(mapaCodigoANombre).forEach(([codigo, nombre]) => {
      const nombreUpper = nombre.toUpperCase();
      if (nombresBuscados.bbva.some(b => nombreUpper.includes(b))) {
        codigosBBVA.push({ codigo, nombre });
      }
      if (nombresBuscados.zurich.some(z => nombreUpper.includes(z.replace('Ú', 'U')) || nombreUpper.includes(z))) {
        codigosZurich.push({ codigo, nombre });
      }
    });

    console.log('🔍 ASEGURADORAS ENCONTRADAS:\n');
    console.log('BBVA SEGUROS COLOMBIA:');
    if (codigosBBVA.length > 0) {
      codigosBBVA.forEach(item => {
        console.log(`  - Código: ${item.codigo} | Nombre: ${item.nombre}`);
      });
    } else {
      console.log('  ⚠️ No se encontró en la base de datos');
    }

    console.log('\nZÚRICH COLOMBIA SEGUROS:');
    if (codigosZurich.length > 0) {
      codigosZurich.forEach(item => {
        console.log(`  - Código: ${item.codigo} | Nombre: ${item.nombre}`);
      });
    } else {
      console.log('  ⚠️ No se encontró en la base de datos');
    }

    // Contar casos en Complex
    console.log('\n📊 CONTEO DE CASOS EN COMPLEX:\n');
    
    let totalBBVA = 0;
    let totalZurich = 0;
    const casosBBVA = [];
    const casosZurich = [];

    if (codigosBBVA.length > 0 || codigosZurich.length > 0) {
      const todosCodigos = [...codigosBBVA.map(c => c.codigo), ...codigosZurich.map(c => c.codigo)];
      const casos = await Complex.find({
        codiAsgrdra: { $in: todosCodigos }
      });

      console.log(`Total casos encontrados con esos códigos: ${casos.length}\n`);

      casos.forEach(caso => {
        const codigo = String(caso.codiAsgrdra || '').trim();
        const esBBVA = codigosBBVA.some(c => c.codigo === codigo);
        const esZurich = codigosZurich.some(c => c.codigo === codigo);

        if (esBBVA) {
          totalBBVA++;
          casosBBVA.push({
            numeroAjuste: caso.nmroAjste || 'Sin número',
            numeroSiniestro: caso.nmroSinstro || 'Sin número',
            estado: caso.codiEstdo || 'Sin estado'
          });
        }
        if (esZurich) {
          totalZurich++;
          casosZurich.push({
            numeroAjuste: caso.nmroAjste || 'Sin número',
            numeroSiniestro: caso.nmroSinstro || 'Sin número',
            estado: caso.codiEstdo || 'Sin estado'
          });
        }
      });
    }

    // Contar casos en Siniestro
    console.log('📊 CONTEO DE CASOS EN SINIESTRO:\n');
    
    let totalBBVASiniestro = 0;
    let totalZurichSiniestro = 0;

    if (codigosBBVA.length > 0 || codigosZurich.length > 0) {
      const todosCodigos = [...codigosBBVA.map(c => c.codigo), ...codigosZurich.map(c => c.codigo)];
      const casos = await Siniestro.find({
        codiAsgrdra: { $in: todosCodigos }
      });

      casos.forEach(caso => {
        const codigo = String(caso.codiAsgrdra || '').trim();
        if (codigosBBVA.some(c => c.codigo === codigo)) {
          totalBBVASiniestro++;
        }
        if (codigosZurich.some(c => c.codigo === codigo)) {
          totalZurichSiniestro++;
        }
      });
    }

    // Mostrar resultados
    console.log('═══════════════════════════════════════════════════════');
    console.log('📈 RESUMEN TOTAL DE CASOS:');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log(`🏦 BBVA SEGUROS COLOMBIA S.A:`);
    console.log(`   Complex: ${totalBBVA} casos`);
    console.log(`   Siniestro: ${totalBBVASiniestro} casos`);
    console.log(`   TOTAL: ${totalBBVA + totalBBVASiniestro} casos\n`);

    console.log(`🏦 ZÚRICH COLOMBIA SEGUROS S.A:`);
    console.log(`   Complex: ${totalZurich} casos`);
    console.log(`   Siniestro: ${totalZurichSiniestro} casos`);
    console.log(`   TOTAL: ${totalZurich + totalZurichSiniestro} casos\n`);

    // Mostrar detalles de casos BBVA (primeros 10)
    if (casosBBVA.length > 0) {
      console.log(`\n📋 Primeros 10 casos de BBVA:`);
      casosBBVA.slice(0, 10).forEach((caso, idx) => {
        console.log(`   ${idx + 1}. ${caso.numeroAjuste} - ${caso.numeroSiniestro} (Estado: ${caso.estado})`);
      });
      if (casosBBVA.length > 10) {
        console.log(`   ... y ${casosBBVA.length - 10} casos más`);
      }
    }

    // Mostrar detalles de casos Zurich (primeros 10)
    if (casosZurich.length > 0) {
      console.log(`\n📋 Primeros 10 casos de ZÚRICH:`);
      casosZurich.slice(0, 10).forEach((caso, idx) => {
        console.log(`   ${idx + 1}. ${caso.numeroAjuste} - ${caso.numeroSiniestro} (Estado: ${caso.estado})`);
      });
      if (casosZurich.length > 10) {
        console.log(`   ... y ${casosZurich.length - 10} casos más`);
      }
    }

    console.log('\n✅ Conteo completado\n');

    mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    mongoose.connection.close();
    process.exit(1);
  }
};

contarCasosAseguradoras();
