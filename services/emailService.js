import SecurUser from '../models/SecurUser.js';
import { deliverMail } from './mailTransport.js';
import Cliente from '../models/Cliente.js';
import mongoose from 'mongoose';
import { resolverNombreEstado } from '../utils/resolverEstado.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Correo de notificaciones de facturación (Adriana / área de ajustes) */
export const EMAIL_FACTURACION_AJUSTES =
  process.env.EMAIL_FACTURACION_AJUSTES?.trim() ||
  'facturacion.ajustes@proserpuertos.com.co';

const GERENTES_FACTURACION = new Set(['adriana', 'facturacion', 'facturacion_ajustes']);

function esGerenteFacturacion(gerente) {
  const g = String(gerente || '').trim().toLowerCase();
  return GERENTES_FACTURACION.has(g) || g.includes('adriana') || g.includes('facturacion');
}

// Función auxiliar para obtener emails de encargados de riesgos
const obtenerEmailsEncargadosRiesgos = async () => {
  // Emails directos de los encargados que deben recibir notificaciones de casos de riesgo
  // Arnaldo Andrés Tapia Gutierrez (Login: 1140829957)
  // Mario Alberto Pinilla de la Torre (Login: 72288319)
  const emailsEncargados = [
    'aatapia@proserpuertos.com.co',
    'mario.pinilla@proserpuertos.com.co'
  ];
  
  console.log('✅ Emails de encargados de riesgos:', emailsEncargados);
  
  return emailsEncargados;
};

// Función para enviar email de notificación de asignación de caso
export const enviarNotificacionAsignacion = async (datosCaso) => {
  try {
    console.log('📧 Iniciando envío de notificación de asignación...');
    console.log('📧 Datos del caso:', JSON.stringify(datosCaso, null, 2));
    
    
    // Emails fijos que siempre deben recibir notificación
    // COMENTADOS PARA PRUEBAS - SOLO RESPONSABLE Y FUNCIONARIO
    const emailsFijos = [
      // 'etapia@proserpuertos.com.co',
      // 'aatapia@proserpuertos.com.co', 
      // 'itapia9@proserpuertos.com.co'
    ];
    
    // Emails adicionales (responsable y quien asigna)
    // IMPORTANTE: Para casos de riesgo, incluir email de quien asigna si existe (no es "Sistema")
    const emailsAdicionales = [];
    console.log('📧 📧 📧 PROCESANDO EMAILS ADICIONALES 📧 📧 📧');
    console.log('📧 datosCaso.emailResponsable:', datosCaso.emailResponsable);
    console.log('📧 datosCaso.emailQuienAsigna:', datosCaso.emailQuienAsigna);
    console.log('📧 Es caso de riesgo:', datosCaso.tipoCaso === 'riesgo' || datosCaso.esCasoRiesgo);
    
    if (datosCaso.emailResponsable && datosCaso.emailResponsable.trim() !== '') {
      const emailLimpio = datosCaso.emailResponsable.trim();
      emailsAdicionales.push(emailLimpio);
      console.log('✅ Email del responsable agregado a la lista:', emailLimpio);
    } else {
      console.log('⚠️ ⚠️ ⚠️ NO HAY EMAIL DEL RESPONSABLE ⚠️ ⚠️ ⚠️');
      console.log('⚠️ Valor recibido:', datosCaso.emailResponsable);
    }
    
    // IMPORTANTE: Agregar email de quien asigna SIEMPRE si existe
    // Debe incluirse en TODAS las notificaciones de asignación
    if (datosCaso.emailQuienAsigna && datosCaso.emailQuienAsigna.trim() !== '') {
      const emailLimpio = datosCaso.emailQuienAsigna.trim();
      emailsAdicionales.push(emailLimpio);
      console.log('✅ Email de quien asigna agregado a la lista:', emailLimpio);
    } else {
      console.log('⚠️ IMPORTANTE: No hay email de quien asigna - se debe enviar notificación de todas formas');
    }
    
    // IMPORTANTE: Agregar email del funcionario de aseguradora si existe
    if (datosCaso.emailFuncionarioAseguradora && datosCaso.emailFuncionarioAseguradora.trim() !== '') {
      const emailLimpio = datosCaso.emailFuncionarioAseguradora.trim();
      emailsAdicionales.push(emailLimpio);
      console.log('✅ Email del funcionario de aseguradora agregado a la lista:', emailLimpio);
    } else {
      console.log('⚠️ No hay email del funcionario de aseguradora');
    }
    
    console.log('📧 Emails adicionales después de procesar:', emailsAdicionales);
    
    // Si es un caso de riesgo, agregar emails de los encargados
    let emailsEncargados = [];
    if (datosCaso.tipoCaso === 'riesgo' || datosCaso.esCasoRiesgo) {
      console.log('📧 Es un caso de riesgo, obteniendo emails de encargados...');
      emailsEncargados = await obtenerEmailsEncargadosRiesgos();
      console.log('📧 Emails de encargados obtenidos:', emailsEncargados);
    }
    
         // Combinar todos los emails únicos (incluyendo encargados si es caso de riesgo)
     const todosLosEmails = [...new Set([...emailsFijos, ...emailsAdicionales, ...emailsEncargados])];
     
     // Validar que haya al menos un email válido
     if (todosLosEmails.length === 0) {
       console.log('⚠️ ⚠️ ⚠️ NO HAY EMAILS VÁLIDOS PARA NOTIFICAR ⚠️ ⚠️ ⚠️');
       console.log('📧 Email responsable:', datosCaso.emailResponsable);
       console.log('📧 Email quien asigna:', datosCaso.emailQuienAsigna);
       console.log('📧 Emails fijos:', emailsFijos);
       console.log('📧 Emails adicionales:', emailsAdicionales);
       console.log('📧 Emails encargados:', emailsEncargados);
       return {
         success: false,
         message: 'No hay emails válidos para notificar',
         emailsEnviados: [],
         error: 'No se encontraron destinatarios válidos'
       };
     }
     
     console.log('📧 ✅ Emails a notificar:', todosLosEmails);
    
    // Obtener nombre de aseguradora (para todos los tipos de casos)
    let nombreAseguradora = datosCaso.aseguradora || 'No especificada';
    if (datosCaso.aseguradora) {
      try {
        const cliente = await Cliente.findOne({ codiAsgrdra: datosCaso.aseguradora });
        if (cliente && cliente.rzonSocial) {
          nombreAseguradora = cliente.rzonSocial;
          console.log('✅ Nombre de aseguradora obtenido:', nombreAseguradora);
        } else {
          console.log('⚠️ Aseguradora no encontrada en BD, usando código:', datosCaso.aseguradora);
        }
      } catch (error) {
        console.log('⚠️ Error obteniendo nombre de aseguradora:', error.message);
      }
    }
    
    const nombreEstado = await resolverNombreEstado({
      codiEstdo: datosCaso.codiEstdo,
      estado: datosCaso.estado,
      descripcionEstado: datosCaso.descripcionEstado,
    });
    console.log('📧 Estado para correo:', nombreEstado, '(código:', datosCaso.codiEstdo || datosCaso.estado, ')');
    
    // Obtener nombre del funcionario de aseguradora
    let nombreFuncionario = datosCaso.funcionarioAseguradora || datosCaso.funcAsgrdraNombre || 'No especificado';
    if (!nombreFuncionario || nombreFuncionario === 'No especificado' || nombreFuncionario === '') {
      // Si no tenemos el nombre, intentar buscarlo por código o nombre
      const valorBuscado = datosCaso.funcAsgrdra || datosCaso.funcionarioAseguradora || '';
      if (valorBuscado) {
        try {
          console.log('🔍 🔍 🔍 BÚSQUEDA DE FUNCIONARIO EN EMAIL SERVICE 🔍 🔍 🔍');
          console.log('🔍 Valor a buscar:', valorBuscado);
          console.log('🔍 Tipo:', typeof valorBuscado);
          
          let funcionarioDB = null;
          
          // Si el valor es numérico o puede ser un ID, buscar por campo 'id'
          const valorNumerico = Number(valorBuscado);
          if (!isNaN(valorNumerico) && valorNumerico > 0) {
            console.log('🔍 Buscando funcionario por ID numérico:', valorNumerico);
            funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
              id: valorNumerico
            });
            console.log('🔍 Búsqueda por ID:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
          }
          
          // Si no se encuentra por ID, buscar por nombre
          if (!funcionarioDB) {
            console.log('🔍 Buscando funcionario por nombre (nmbrContcto):', valorBuscado);
            funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
              nmbrContcto: valorBuscado
            });
            console.log('🔍 Búsqueda por nombre exacto:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
          }
          
          // Si aún no se encuentra, buscar con regex por nombre
          if (!funcionarioDB) {
            console.log('🔍 Buscando funcionario con regex por nombre...');
            const valorEscapado = valorBuscado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
              nmbrContcto: { $regex: new RegExp(`^${valorEscapado}$`, 'i') }
            });
            console.log('🔍 Búsqueda con regex:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
          }
          
          // Si aún no se encuentra, buscar parcialmente por nombre
          if (!funcionarioDB) {
            console.log('🔍 Buscando funcionario parcialmente por nombre...');
            funcionarioDB = await mongoose.model('FuncionarioAseguradora').findOne({ 
              nmbrContcto: { $regex: valorBuscado, $options: 'i' }
            });
            console.log('🔍 Búsqueda parcial:', funcionarioDB ? '✅ ENCONTRADO' : '❌ NO ENCONTRADO');
          }
          
          if (funcionarioDB) {
            const funcionarioObj = funcionarioDB.toObject();
            console.log('✅ ✅ ✅ FUNCIONARIO ENCONTRADO ✅ ✅ ✅');
            console.log('🔍 Datos completos:', JSON.stringify(funcionarioObj, null, 2));
            
            if (funcionarioObj.nmbrContcto) {
              nombreFuncionario = funcionarioObj.nmbrContcto;
              console.log('✅ Nombre de funcionario obtenido de BD:', nombreFuncionario);
            } else {
              console.log('⚠️ Funcionario encontrado pero sin nombre, usando ID:', funcionarioObj.id);
              nombreFuncionario = String(funcionarioObj.id || valorBuscado);
            }
          } else {
            console.log('❌ ❌ ❌ FUNCIONARIO NO ENCONTRADO EN BD ❌ ❌ ❌');
            console.log('❌ Valor buscado:', valorBuscado);
            nombreFuncionario = valorBuscado || 'No especificado';
          }
        } catch (error) {
          console.log('❌ ❌ ❌ ERROR AL BUSCAR FUNCIONARIO ❌ ❌ ❌');
          console.log('❌ Error:', error.message);
          console.log('❌ Stack trace:', error.stack);
          nombreFuncionario = valorBuscado || 'No especificado';
        }
      } else {
        console.log('⚠️ No hay valor para buscar funcionario');
      }
    } else {
      console.log('✅ Nombre de funcionario ya disponible:', nombreFuncionario);
    }
    
    console.log('📧 📧 📧 RESUMEN BÚSQUEDA FUNCIONARIO (EMAIL SERVICE) 📧 📧 📧');
    console.log('📧 Nombre final del funcionario:', nombreFuncionario);
    
    // Formatear fecha de asignación (formato: 20/11/2025)
    let fechaFormateada = 'No especificada';
    if (datosCaso.fechaAsignacion) {
      try {
        const fecha = new Date(datosCaso.fechaAsignacion);
        if (!isNaN(fecha.getTime())) {
          const dia = String(fecha.getDate()).padStart(2, '0');
          const mes = String(fecha.getMonth() + 1).padStart(2, '0');
          const año = fecha.getFullYear();
          fechaFormateada = `${dia}/${mes}/${año}`;
          console.log('✅ Fecha formateada:', fechaFormateada);
        }
      } catch (error) {
        console.log('⚠️ Error formateando fecha:', error.message);
        fechaFormateada = datosCaso.fechaAsignacion;
      }
    }
    
    // Generar HTML según el tipo de caso
    let htmlContent = '';
    if (datosCaso.tipoCaso === 'riesgo' || datosCaso.esCasoRiesgo) {
      // Template específico para casos de riesgo
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2563eb; margin: 0; font-size: 24px;">📋 Caso de Riesgo Asignado</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">Sistema de Gestión de Casos - Grupo Proser</p>
              ${datosCaso.quienAsigna && datosCaso.quienAsigna !== 'Sistema' ? `
              <div style="background-color: #d1fae5; padding: 15px; border-radius: 8px; margin-top: 15px; border-left: 4px solid #10b981;">
                <p style="color: #065f46; margin: 0; font-weight: bold; font-size: 16px;">
                  ✅ Has asignado exitosamente este caso de riesgo
                </p>
                <p style="color: #047857; margin: 5px 0 0 0; font-size: 14px;">
                  El caso ${datosCaso.numeroCaso || 'N/A'} ha sido asignado correctamente al inspector ${datosCaso.inspector || datosCaso.nombreResponsable || 'Sin asignar'}
                </p>
              </div>
              ` : ''}
            </div>
            
            <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">📊 Información del Caso</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏢 Cliente:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.aseguradora || nombreAseguradora || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👤 Inspector:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.inspector || datosCaso.nombreResponsable || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📋 Clasificación:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.clasificacion || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📞 Quien Solicita:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.quienSolicita || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏙️ Ciudad de Inspección:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.ciudadInspeccion || datosCaso.ciudadSucursal || datosCaso.codigoPoblado || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📍 Dirección:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.direccion || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👥 Asegurado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.asegurado || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 Fecha de Asignación:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.fechaAsignacion || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📝 Observación:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.observaciones || datosCaso.descripcion || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📊 Estado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${nombreEstado}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👨‍💼 Asignado por:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.quienAsigna || 'Sistema'}</td>
                </tr>
              </table>
            </div>
            
            ${datosCaso.observaciones ? `
            <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">📝 Observaciones</h3>
              <p style="color: #78350f; margin: 0; line-height: 1.5;">${datosCaso.observaciones}</p>
            </div>
            ` : ''}
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">👥 Equipo de Gestión de Riesgo</h3>
              <ul style="margin: 0; padding-left: 20px; color: #0c4a6e;">
                <li>Mario Alberto Pinilla de la Torre</li>
                <li>Arnaldo Andrés Tapia Gutierrez</li>
              </ul>
            </div>
            
            <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #10b981;">
              <h3 style="color: #047857; margin: 0 0 10px 0; font-size: 16px;">📊 Reporte Independiente</h3>
              <p style="color: #065f46; margin: 0; line-height: 1.5;">
                Este caso ha sido registrado en el sistema y está disponible para seguimiento y gestión independiente.
                Puede acceder al reporte completo desde el sistema de gestión de casos.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Este es un mensaje automático del Sistema de Gestión de Casos de Grupo Proser.<br>
                No responda a este correo. Para consultas, contacte al administrador del sistema.
              </p>
            </div>
          </div>
        </div>
      `;
    } else {
      // Template original para casos Complex
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2563eb; margin: 0; font-size: 24px;">📋 Caso Asignado</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">Sistema de Gestión de Casos - Grupo Proser</p>
            </div>
            
            <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">📊 Información del Caso</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔢 Número de Ajuste:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroCaso}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📊 Número de Siniestro:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroSiniestro || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔧 Código Workflow:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.codigoWorkflow || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👤 Responsable:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.nombreResponsable || 'Sin asignar'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏢 Aseguradora:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${nombreAseguradora}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👤 Funcionario de Aseguradora:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${nombreFuncionario}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏢 Intermediario:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.intermediario || datosCaso.asegurado || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👥 Asegurado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.aseguradoReal || datosCaso.asgrBenfcro || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📊 Estado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${nombreEstado}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 Fecha de Asignación:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${fechaFormateada}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👨‍💼 Asignado por:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.quienAsigna || 'Sistema'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📋 Número de Póliza:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroPoliza || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏙️ Ciudad del Siniestro:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.ciudadSiniestro || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📝 Descripción:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.descripcionSiniestro || 'No especificada'}</td>
                </tr>
              </table>
            </div>
            
            ${datosCaso.observaciones ? `
            <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">📝 Observaciones</h3>
              <p style="color: #78350f; margin: 0; line-height: 1.5;">${datosCaso.observaciones}</p>
            </div>
            ` : ''}
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">👥 Destinatarios de esta notificación:</h3>
              <ul style="margin: 0; padding-left: 20px; color: #0c4a6e;">
                <li>Responsable asignado: ${datosCaso.nombreResponsable || 'Sin asignar'}</li>
                <li>Persona que asignó: ${datosCaso.quienAsigna || 'Sistema'}</li>
                ${(datosCaso.tipoCaso === 'riesgo' || datosCaso.esCasoRiesgo) ? '<li>Encargados de riesgos: Arnaldo Andrés Tapia Gutierrez, Mario Alberto Pinilla de la Torre</li>' : ''}
              </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Este es un mensaje automático del Sistema de Gestión de Casos de Grupo Proser.<br>
                No responda a este correo. Para consultas, contacte al administrador del sistema.
              </p>
            </div>
          </div>
        </div>
      `
    };
    
    // Construir objeto mailOptions con todos los datos necesarios
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: todosLosEmails.join(', '),
      subject: datosCaso.tipoCaso === 'riesgo' || datosCaso.esCasoRiesgo 
        ? `📋 Caso de Riesgo Asignado - ${datosCaso.numeroCaso || 'Nuevo'}`
        : `📋 Caso Asignado - ${datosCaso.numeroCaso || 'Nuevo'}`,
      html: htmlContent
    };
    
    console.log('📧 Preparando envío de notificación...');
    console.log('📧 Destinatarios finales:', todosLosEmails);
    console.log('📧 Asunto del correo:', mailOptions.subject);
    console.log('📧 Remitente:', mailOptions.from);
    console.log('📧 Campo "to" del correo:', mailOptions.to);
    
    try {
      const info = await deliverMail(mailOptions, { tipo: 'emailService' });
      console.log('✅ ✅ ✅ NOTIFICACIÓN ENVIADA EXITOSAMENTE ✅ ✅ ✅');
      console.log('📧 Message ID:', info.messageId);
      console.log('📧 Response:', info.response);
      console.log('📧 Accepted:', info.accepted);
      console.log('📧 Rejected:', info.rejected);
      
      return {
        success: true,
        messageId: info.messageId,
        emailsEnviados: todosLosEmails,
        accepted: info.accepted,
        rejected: info.rejected
      };
    } catch (sendError) {
      console.error('❌ ❌ ❌ ERROR AL ENVIAR CORREO ❌ ❌ ❌');
      console.error('❌ Error completo:', sendError);
      console.error('❌ Stack trace:', sendError.stack);
      console.error('❌ Código de error:', sendError.code);
      console.error('❌ Comando:', sendError.command);
      throw sendError;
    }
    
  } catch (error) {
    console.error('❌ ❌ ❌ ERROR GENERAL EN ENVÍO DE NOTIFICACIÓN ❌ ❌ ❌');
    console.error('❌ Error:', error);
    console.error('❌ Mensaje:', error.message);
    console.error('❌ Stack:', error.stack);
    return {
      success: false,
      error: error.message,
      emailsEnviados: [],
      detalles: error
    };
  }
};

// Función para enviar email de alertas del sistema
export const enviarEmailAlertas = async (datosAlertas) => {
  try {
    console.log('📧 Iniciando envío de email de alertas...');
    console.log('📧 Datos de alertas:', JSON.stringify(datosAlertas, null, 2));
    
    
    // Validar que haya un email válido
    if (!datosAlertas.emailResponsable) {
      console.log('⚠️ No hay email válido para notificar alertas');
      return {
        success: false,
        message: 'No hay email válido para notificar alertas'
      };
    }
    
    console.log('📧 Enviando alertas a:', datosAlertas.emailResponsable);
    
    // IMPORTANTE: Los recordatorios de casos pendientes SOLO se envían al responsable asignado
    // NO se envían a quien asigna ni al funcionario de la aseguradora
    
    // Crear contenido HTML para las alertas
    const contenidoAlertas = datosAlertas.alertas.casos.map(caso => {
      const alertasHTML = caso.alertas.map(alerta => `
        <div style="margin: 10px 0; padding: 15px; border-left: 4px solid ${
          alerta.prioridad === 'ALTA' ? '#dc2626' : 
          alerta.prioridad === 'MEDIA' ? '#ea580c' : '#ca8a04'
        }; background-color: ${
          alerta.prioridad === 'ALTA' ? '#fef2f2' : 
          alerta.prioridad === 'MEDIA' ? '#fff7ed' : '#fefce8'
        }; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: bold; color: ${
              alerta.prioridad === 'ALTA' ? '#dc2626' : 
              alerta.prioridad === 'MEDIA' ? '#ea580c' : '#ca8a04'
            };">${alerta.mensaje}</span>
            <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background-color: ${
              alerta.prioridad === 'ALTA' ? '#fecaca' : 
              alerta.prioridad === 'MEDIA' ? '#fed7aa' : '#fef3c7'
            }; color: ${
              alerta.prioridad === 'ALTA' ? '#dc2626' : 
              alerta.prioridad === 'MEDIA' ? '#ea580c' : '#ca8a04'
            };">${alerta.prioridad}</span>
          </div>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">
            <strong>Acción requerida:</strong> ${alerta.accion}
          </p>
        </div>
      `).join('');
      
      return `
        <div style="margin: 20px 0; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
          <h3 style="margin: 0 0 15px 0; color: #1f2937; font-size: 18px;">
            🚨 Caso ${caso.numeroAjuste}
          </h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; font-size: 14px;">
            <div>
              <strong>Siniestro:</strong> ${caso.numeroSiniestro || 'N/A'}<br>
              <strong>Aseguradora:</strong> ${caso.aseguradora || 'N/A'}<br>
              <strong>Asegurado:</strong> ${caso.asegurado || 'N/A'}
            </div>
            <div>
              <strong>Estado:</strong> ${caso.estado || 'N/A'}<br>
              <strong>Total Alertas:</strong> ${caso.totalAlertas}<br>
              <strong>Documentos Faltantes:</strong> ${caso.documentosFaltantes.length}
            </div>
          </div>
          ${alertasHTML}
          ${caso.inactividad ? `
            <div style="margin-top: 15px; padding: 15px; background-color: #f3f4f6; border-radius: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: #6b7280;">⏰</span>
                <span style="font-size: 14px; color: #374151;">
                  <strong>Última actividad:</strong> ${caso.inactividad.actividad}
                  ${caso.inactividad.dias !== null ? ` (hace ${caso.inactividad.dias} días)` : ''}
                </span>
                <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background-color: ${
                  caso.inactividad.estado === 'CRÍTICO' ? '#fecaca' : 
                  caso.inactividad.estado === 'ALTO' ? '#fed7aa' : 
                  caso.inactividad.estado === 'MEDIO' ? '#fef3c7' : '#d1fae5'
                }; color: ${
                  caso.inactividad.estado === 'CRÍTICO' ? '#dc2626' : 
                  caso.inactividad.estado === 'ALTO' ? '#ea580c' : 
                  caso.inactividad.estado === 'MEDIO' ? '#ca8a04' : '#059669'
                };">${caso.inactividad.estado}</span>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
    
    // IMPORTANTE: Solo enviar al responsable - NO incluir cc, bcc ni otros destinatarios
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Alertas" <${process.env.EMAIL_USER}>`,
      to: datosAlertas.emailResponsable, // SOLO al responsable asignado
      subject: `🚨 ALERTAS PENDIENTES - ${datosAlertas.alertas.casosConAlertas} Casos Requieren Atención`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #dc2626; margin: 0; font-size: 28px;">🚨 Sistema de Alertas Complex</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">Grupo Proser - Notificaciones Automáticas</p>
            </div>
            
            <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #dc2626;">
              <h2 style="color: #dc2626; margin: 0 0 15px 0; font-size: 20px;">⚠️ Resumen de Alertas</h2>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.totalCasos}</div>
                  <div style="font-size: 12px; color: #6b7280;">Total Casos</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #ea580c;">${datosAlertas.alertas.casosConAlertas}</div>
                  <div style="font-size: 12px; color: #6b7280;">Con Alertas</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.resumen.documentosObligatorios}</div>
                  <div style="font-size: 12px; color: #6b7280;">Docs Obligatorios</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.resumen.casosCriticos}</div>
                  <div style="font-size: 12px; color: #6b7280;">Casos Críticos</div>
                </div>
              </div>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">👤 Destinatario</h3>
              <p style="margin: 0; color: #0c4a6e;">
                <strong>Ajustador:</strong> ${datosAlertas.nombreResponsable}<br>
                <strong>Fecha de notificación:</strong> ${datosAlertas.fechaAsignacion}
              </p>
            </div>
            
            <div style="margin-bottom: 25px;">
              <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">📋 Detalle de Alertas por Caso</h3>
              ${contenidoAlertas}
            </div>
            
            <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #059669; margin: 0 0 15px 0; font-size: 16px;">💡 Recomendaciones</h3>
              <ul style="margin: 0; padding-left: 20px; color: #065f46;">
                <li>Revisa primero los casos marcados como <strong>CRÍTICOS</strong></li>
                <li>Sube los documentos obligatorios faltantes</li>
                <li>Actualiza el estado de los casos inactivos</li>
                <li>Contacta al equipo si necesitas apoyo</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Este es un mensaje automático del Sistema de Alertas de Grupo Proser.<br>
                No responda a este correo. Para consultas, contacte al administrador del sistema.
              </p>
            </div>
          </div>
        </div>
      `
    };
    
    // Enviar email
    const info = await deliverMail(mailOptions, { tipo: 'emailService' });
    
    console.log('✅ Email de alertas enviado exitosamente');
    console.log('📧 Message ID:', info.messageId);
    console.log('📧 Response:', info.response);
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };
    
  } catch (error) {
    console.error('❌ Error enviando email de alertas:', error);
    throw new Error(`Error enviando email de alertas: ${error.message}`);
  }
};

// Función para enviar email al funcionario de la aseguradora
export const enviarNotificacionAseguradora = async (datosCaso) => {
  try {
    console.log('📧 Iniciando envío de notificación a aseguradora...');
    console.log('📧 Datos del caso:', JSON.stringify(datosCaso, null, 2));
    
    
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: datosCaso.emailFuncionarioAseguradora,
      subject: 'Casos Asignados',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2563eb; margin: 0; font-size: 24px;">📋 Caso Asignado</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">Sistema de Gestión de Casos - Grupo Proser</p>
            </div>
            
            <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">📊 Información del Caso</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔢 Número de Ajuste:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroCaso}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📊 Número de Siniestro:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroSiniestro || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔧 Código Workflow:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.codigoWorkflow || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏢 Aseguradora:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.aseguradora || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👥 Asegurado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.asegurado || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 Fecha de Asignación:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.fechaAsignacion || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📋 Número de Póliza:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroPoliza || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏙️ Ciudad del Siniestro:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.ciudadSiniestro || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📝 Descripción:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.descripcionSiniestro || 'No especificada'}</td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">👤 Responsable Asignado</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">Nombre:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.nombreResponsable || 'Sin asignar'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">Email:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.emailResponsable || 'No disponible'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">Teléfono:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.telefonoResponsable || 'No disponible'}</td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Este es un mensaje automático del Sistema de Gestión de Casos de Grupo Proser.<br>
                No responda a este correo. Para consultas, contacte al administrador del sistema.
              </p>
            </div>
          </div>
        </div>
      `
    };
    
    console.log('📧 Enviando notificación a aseguradora...');
    const info = await deliverMail(mailOptions, { tipo: 'emailService' });
    console.log('✅ Notificación a aseguradora enviada exitosamente');
    console.log('📧 Message ID:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId,
      emailEnviado: datosCaso.emailFuncionarioAseguradora
    };
    
  } catch (error) {
    console.error('❌ Error enviando notificación a aseguradora:', error);
    throw new Error(`Error enviando notificación a aseguradora: ${error.message}`);
  }
};

// Función para enviar email al creador del caso
export const enviarNotificacionCreador = async (datosCaso) => {
  try {
    console.log('📧 Iniciando envío de notificación al creador del caso...');
    console.log('📧 Datos del caso:', JSON.stringify(datosCaso, null, 2));
    
    if (!datosCaso.emailCreador) {
      console.log('⚠️ No hay email del creador, saltando envío');
      return {
        success: false,
        message: 'No hay email del creador para notificar'
      };
    }
    
    
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: datosCaso.emailCreador,
      subject: `✅ Caso Creado Exitosamente - ${datosCaso.numeroCaso}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #059669; margin: 0; font-size: 24px;">✅ Caso Creado Exitosamente</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">Sistema de Gestión de Casos - Grupo Proser</p>
            </div>
            
            <div style="background-color: #d1fae5; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #065f46; margin: 0 0 15px 0; font-size: 18px;">📊 Información del Caso Creado</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔢 Número de ${datosCaso.tipoCaso === 'riesgo' ? 'Riesgo' : 'Ajuste'}:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroCaso}</td>
                </tr>
                ${datosCaso.numeroSiniestro ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📊 Número de Siniestro:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroSiniestro}</td>
                </tr>
                ` : ''}
                ${datosCaso.codigoWorkflow ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔧 Código Workflow:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.codigoWorkflow}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👤 Responsable Asignado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.nombreResponsable || 'Sin asignar'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏢 Aseguradora:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.aseguradora || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👥 Asegurado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.asegurado || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 Fecha de Creación:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${new Date().toLocaleDateString('es-CO')}</td>
                </tr>
                ${datosCaso.numeroPoliza ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📋 Número de Póliza:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroPoliza}</td>
                </tr>
                ` : ''}
              </table>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">📧 Notificaciones Enviadas</h3>
              <p style="color: #0c4a6e; margin: 0; line-height: 1.6;">
                Se han enviado notificaciones por correo electrónico a:
              </p>
              <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #0c4a6e;">
                <li>✅ Tú (creador del caso)</li>
                <li>✅ ${datosCaso.nombreResponsable || 'Responsable asignado'}</li>
                ${datosCaso.funcionarioAseguradora ? `<li>✅ Funcionario de aseguradora</li>` : ''}
              </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Este es un mensaje automático del Sistema de Gestión de Casos de Grupo Proser.<br>
                No responda a este correo. Para consultas, contacte al administrador del sistema.
              </p>
            </div>
          </div>
        </div>
      `
    };
    
    console.log('📧 Enviando notificación al creador...');
    const info = await deliverMail(mailOptions, { tipo: 'emailService' });
    console.log('✅ Notificación al creador enviada exitosamente');
    console.log('📧 Message ID:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId,
      emailEnviado: datosCaso.emailCreador
    };
    
  } catch (error) {
    console.error('❌ Error enviando notificación al creador:', error);
    throw new Error(`Error enviando notificación al creador: ${error.message}`);
  }
};

export const enviarNotificacionControlHoras = async (datos) => {
  try {
    console.log('📧 ===== INICIANDO ENVÍO DE NOTIFICACIÓN DE CONTROL DE HORAS =====');
    console.log('📧 Datos recibidos:', JSON.stringify(datos, null, 2));

    // Fase 1: solo Elkin o Iskharly (facturación recibe en fase 2 — evidencia/gerencia)
    const gerenteSeleccionado = datos.gerente || null;
    
    if (!gerenteSeleccionado) {
      console.error('❌ ERROR: No se especificó el gerente para enviar la notificación');
      console.error('❌ Datos recibidos sin gerente:', datos);
      return { success: false, message: 'No se especificó el gerente' };
    }

    console.log('✅ Gerente seleccionado:', gerenteSeleccionado);

    // Buscar email SOLO del gerente seleccionado (no buscar ambos)
    let emailDestinatario = null;
    let nombreDestinatario = '';

    if (gerenteSeleccionado === 'elkin') {
    try {
      const usuarioElkin = await SecurUser.findOne({ login: '72287602' });
      if (usuarioElkin && usuarioElkin.email) {
          emailDestinatario = usuarioElkin.email;
          console.log('✅ Email de Elkin encontrado:', emailDestinatario);
      } else {
          console.log('⚠️ Usuario Elkin (72287602) no encontrado o sin email, usando email por defecto');
          emailDestinatario = 'etapia@proserpuertos.com.co';
      }
    } catch (error) {
      console.error('❌ Error buscando usuario Elkin:', error);
        emailDestinatario = 'etapia@proserpuertos.com.co'; // Email por defecto
    }
      nombreDestinatario = 'Elkin Tapia Gutiérrez';
    } else if (gerenteSeleccionado === 'iskharly') {
    try {
      const usuarioIskharly = await SecurUser.findOne({ login: '72007205' });
      if (usuarioIskharly && usuarioIskharly.email) {
          emailDestinatario = usuarioIskharly.email;
          console.log('✅ Email de Iskharly encontrado:', emailDestinatario);
      } else {
          console.log('⚠️ Usuario Iskharly (72007205) no encontrado o sin email, usando email por defecto');
          emailDestinatario = 'itapia9@proserpuertos.com.co';
      }
    } catch (error) {
      console.error('❌ Error buscando usuario Iskharly:', error);
        emailDestinatario = 'itapia9@proserpuertos.com.co'; // Email por defecto
      }
      nombreDestinatario = 'Iskharly José Tapia Gutierrez';
    } else if (gerenteSeleccionado === 'test') {
      emailDestinatario = 'danalyst@proserpuertos.com.co';
      nombreDestinatario = 'Prueba - Analista';
      console.log('🧪 Enviando notificación de prueba a danalyst@proserpuertos.com.co');
    } else {
      console.error('❌ Gerente seleccionado no válido:', gerenteSeleccionado);
      return { success: false, message: 'Gerente seleccionado no válido' };
    }

    if (!emailDestinatario) {
      console.error('❌ No se pudo obtener el email del destinatario');
      return { success: false, message: 'No se pudo obtener el email del destinatario' };
    }

    const emails = [emailDestinatario];

    console.log('📧 Enviando notificación SOLO a:', emailDestinatario);
    console.log('📧 Nombre destinatario:', nombreDestinatario);

    const archivos = (datos.archivos || []).map(nombre => `<li style="margin-bottom:4px;">📎 ${nombre}</li>`).join('');
    
    // Construir enlaces de descarga para los archivos
    const baseUrl = process.env.BASE_URL || process.env.BACKEND_URL || 'http://localhost:5000';
    const archivosConEnlaces = (datos.archivosConRuta || []).map(archivo => {
      const nombreArchivo = archivo.nombre || 'documento';
      let rutaArchivo = archivo.ruta || archivo.url || '';
      
      // Normalizar la ruta: asegurar que empiece con /uploads
      if (rutaArchivo && !rutaArchivo.startsWith('http')) {
        // Si no empieza con /, agregarlo
        if (!rutaArchivo.startsWith('/')) {
          rutaArchivo = `/${rutaArchivo}`;
        }
        // Si no contiene uploads, agregarlo
        if (!rutaArchivo.includes('uploads')) {
          // Extraer solo el nombre del archivo si hay una ruta compleja
          const nombreArchivoRuta = rutaArchivo.split('/').pop();
          rutaArchivo = `/uploads/${nombreArchivoRuta}`;
        }
      }
      
      // Construir URL de descarga
      const urlDescarga = rutaArchivo 
        ? (rutaArchivo.startsWith('http') ? rutaArchivo : `${baseUrl}${rutaArchivo}`)
        : '';
      
      console.log('🔗 [Enlace Descarga] Archivo:', nombreArchivo, 'Ruta:', rutaArchivo, 'URL:', urlDescarga);
      
      return urlDescarga 
        ? `<li style="margin-bottom:8px;">
             <a href="${urlDescarga}" 
                target="_blank"
                style="color:#2563eb; text-decoration:none; font-weight:500; display:inline-flex; align-items:center; gap:6px;">
               📎 ${nombreArchivo}
               <span style="font-size:11px; color:#6b7280;">(Descargar)</span>
             </a>
           </li>`
        : `<li style="margin-bottom:4px;">📎 ${nombreArchivo}</li>`;
    }).join('');
    
    const tieneArchivos = (datos.archivosConRuta?.length > 0) || (datos.archivos?.length > 0);
    const resumen = datos.resumenControlHoras || null;

    const htmlArchivos = tieneArchivos
      ? (archivosConEnlaces || archivos)
      : '';

    const htmlResumenControlHoras = resumen
      ? `
            <div style="background-color:#ecfdf5; padding:15px; border-radius:8px; border-left:4px solid #10b981; margin:20px 0;">
              <h3 style="margin:0 0 10px 0; color:#065f46;">Control de horas registrado en el sistema</h3>
              <table style="width:100%; border-collapse:collapse;">
                <tr><td style="padding:4px 0; font-weight:bold; color:#047857;">Total horas:</td><td style="padding:4px 0; color:#064e3b;">${Number(resumen.total_horas || 0).toFixed(2)}</td></tr>
                ${resumen.valor_hora ? `<tr><td style="padding:4px 0; font-weight:bold; color:#047857;">Valor hora:</td><td style="padding:4px 0; color:#064e3b;">$${Number(resumen.valor_hora).toLocaleString('es-CO')}</td></tr>` : ''}
                ${resumen.subtotal_honorarios != null ? `<tr><td style="padding:4px 0; font-weight:bold; color:#047857;">Honorarios:</td><td style="padding:4px 0; color:#064e3b;">$${Number(resumen.subtotal_honorarios).toLocaleString('es-CO')}</td></tr>` : ''}
                ${resumen.total != null ? `<tr><td style="padding:4px 0; font-weight:bold; color:#047857;">Total liquidación:</td><td style="padding:4px 0; color:#064e3b;">$${Number(resumen.total).toLocaleString('es-CO')}</td></tr>` : ''}
              </table>
              <p style="margin:10px 0 0 0; color:#065f46; font-size:13px;">Los detalles completos están disponibles en el caso en la plataforma.</p>
            </div>`
      : '';

    // Preparar adjuntos para el correo
    const attachments = [];
    if (datos.archivosConRuta && Array.isArray(datos.archivosConRuta)) {
      for (const archivo of datos.archivosConRuta) {
        if (archivo.ruta) {
          try {
            // Construir ruta completa del archivo
            let rutaCompleta = '';
            const rutaRelativa = archivo.ruta.startsWith('/') ? archivo.ruta.substring(1) : archivo.ruta;
            
            // Intentar diferentes ubicaciones posibles
            const rutasPosibles = [
              path.join(process.cwd(), 'uploads', rutaRelativa),
              path.join(__dirname, '..', 'uploads', rutaRelativa),
              path.join('/var/www/uploads', rutaRelativa),
              path.join('/home/ubuntu/uploads', rutaRelativa),
              archivo.ruta // Ruta absoluta si ya lo es
            ];
            
            for (const ruta of rutasPosibles) {
              try {
                await fs.access(ruta);
                rutaCompleta = ruta;
                console.log('✅ Archivo encontrado en:', rutaCompleta);
                break;
              } catch (e) {
                // Continuar buscando
              }
            }
            
            if (rutaCompleta) {
              attachments.push({
                filename: archivo.nombre || 'documento',
                path: rutaCompleta
              });
              console.log('✅ Archivo agregado como adjunto:', archivo.nombre);
            } else {
              console.warn('⚠️ No se pudo encontrar el archivo:', archivo.ruta);
            }
          } catch (error) {
            console.error('❌ Error procesando archivo para adjuntar:', archivo.nombre, error);
          }
        }
      }
    }
    
    console.log('📎 Total archivos a adjuntar:', attachments.length);

    const htmlSeccionArchivos = tieneArchivos
      ? `
            <div style="background-color:#fef3c7; padding:15px; border-radius:8px; border-left:4px solid #f59e0b;">
              <h3 style="margin:0 0 10px 0; color:#92400e;">Archivos cargados:</h3>
              <ul style="margin:0; padding-left:20px; color:#78350f;">
                ${htmlArchivos}
              </ul>
              ${attachments.length > 0 ? `<p style="margin:10px 0 0 0; color:#92400e; font-size:13px; font-weight:500;">📎 Los archivos también están adjuntos a este correo para su descarga directa.</p>` : ''}
            </div>`
      : '';

    // Construir URL del frontend para el enlace directo al caso
    // IMPORTANTE: Para correos, siempre usar URL accesible (producción o FRONTEND_URL configurado)
    // No usar localhost porque los usuarios no pueden acceder desde sus máquinas
    let frontendUrl = process.env.FRONTEND_URL;
    
    if (!frontendUrl) {
      // Si no está configurado FRONTEND_URL, usar URL de producción por defecto
      // Esto asegura que los enlaces en los correos funcionen para todos los usuarios
      frontendUrl = 'https://aplicacion.grupoproser.com.co';
    }
    
    console.log('🔗 [Enlace Caso] casoId recibido:', datos.casoId);
    console.log('🔗 [Enlace Caso] numeroCaso:', datos.numeroCaso);
    console.log('🔗 [Enlace Caso] frontendUrl:', frontendUrl);
    console.log('🔗 [Enlace Caso] NODE_ENV:', process.env.NODE_ENV);
    
    // Construir URL del caso - usar ID si está disponible, sino usar número de caso para búsqueda
    let urlCaso = null;
    let textoEnlace = 'Ver Casos';
    
    if (datos.casoId) {
      // Si tenemos el ID, usar ruta directa
      urlCaso = `${frontendUrl}/editar-caso/${datos.casoId}`;
      textoEnlace = datos.numeroCaso && datos.numeroCaso !== 'Sin número' 
        ? `Ver Caso #${datos.numeroCaso}` 
        : 'Ver Caso';
      console.log('✅ [Enlace Caso] URL construida con ID:', urlCaso);
    } else if (datos.numeroCaso && datos.numeroCaso !== 'Sin número') {
      // Si no hay ID pero hay número de caso, usar ruta de búsqueda
      urlCaso = `${frontendUrl}/complex/excel?buscar=${encodeURIComponent(datos.numeroCaso)}`;
      textoEnlace = `Buscar Caso #${datos.numeroCaso}`;
      console.log('✅ [Enlace Caso] URL construida con número de caso:', urlCaso);
    } else {
      // Si no hay ID ni número de caso, mostrar enlace genérico a la lista de casos
      urlCaso = `${frontendUrl}/complex/excel`;
      textoEnlace = 'Ver Casos Complex';
      console.log('✅ [Enlace Caso] URL construida genérica (sin ID ni número):', urlCaso);
    }
    
    // HTML del enlace directo - SIEMPRE mostrar el enlace
    const htmlEnlaceCaso = `
      <div style="background-color:#dbeafe; padding:20px; border-radius:8px; border-left:4px solid #2563eb; margin:25px 0; text-align:center;">
        <p style="margin:0 0 15px 0; color:#1e40af; font-weight:600; font-size:16px;">🔗 Acceso Directo al Caso</p>
        <a href="${urlCaso}" 
           style="display:inline-block; background-color:#2563eb; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:600; font-size:14px;">
          ${textoEnlace}
        </a>
        <p style="margin:15px 0 0 0; color:#1e3a8a; font-size:12px;">Haz clic en el botón para acceder ${datos.casoId ? 'directamente al caso' : 'a la plataforma de casos'}</p>
      </div>
    `;
    
    console.log('📧 [Enlace Caso] HTML generado: SÍ');
    console.log('📧 [Enlace Caso] URL final:', urlCaso);

    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: emails[0],
      subject: tieneArchivos
        ? `⏰ Nuevo documento de control de horas - Caso ${datos.numeroCaso || 'sin número'}`
        : `⏰ Control de horas registrado - Caso ${datos.numeroCaso || 'sin número'}`,
      attachments: attachments.length > 0 ? attachments : undefined, // Adjuntar archivos si existen
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">
            <h2 style="color: #1f2937; margin-top: 0; text-align:center;">⏰ ${tieneArchivos ? 'Nuevo documento de control de horas recibido' : 'Control de horas registrado en el sistema'}</h2>
            <p style="color: #4b5563;">${tieneArchivos
              ? 'Se ha cargado un nuevo documento de control de horas en la sección de facturación.'
              : 'Se ha registrado un control de horas en el sistema para este caso. Revise los detalles en la plataforma.'}</p>
            <table style="width:100%; border-collapse:collapse; margin:20px 0;">
              <tr>
                <td style="padding:8px 0; font-weight:bold; color:#111827;">Número de Caso:</td>
                <td style="padding:8px 0; color:#1f2937;">${datos.numeroCaso || 'Sin especificar'}</td>
              </tr>
              ${datos.numeroSiniestro ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Número de Siniestro:</td><td style="padding:8px 0; color:#1f2937;">${datos.numeroSiniestro}</td></tr>` : ''}
              ${datos.responsable ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Responsable:</td><td style="padding:8px 0; color:#1f2937;">${datos.responsable}</td></tr>` : ''}
              ${datos.usuario ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Usuario que cargó:</td><td style="padding:8px 0; color:#1f2937;">${datos.usuario}</td></tr>` : ''}
            </table>
            ${htmlResumenControlHoras}
            ${htmlSeccionArchivos}
            ${htmlEnlaceCaso}
            <p style="color:#6b7280; font-size:12px; margin-top:25px; text-align:center;">
              Este es un mensaje automático del Sistema de Gestión de Casos de Grupo Proser.
            </p>
          </div>
        </div>
      `
    };

    const info = await deliverMail(mailOptions, { tipo: 'control_horas', gerente: datos.gerente });
    console.log('✅ Notificación de control de horas enviada. Message ID:', info.messageId);
    console.log('✅ Enviado a:', emailDestinatario);

    return {
      success: true,
      messageId: info.messageId,
      destinatarios: emails,
      destinatarioPrincipal: emails[0],
    };
  } catch (error) {
    console.error('❌ Error enviando notificación de control de horas:', error);
    throw new Error(`Error enviando notificación de control de horas: ${error.message}`);
  }
};

export const enviarNotificacionGerencia = async (datos) => {
  try {
    console.log('📧 ===== INICIANDO ENVÍO DE NOTIFICACIÓN DE GERENCIA =====');
    console.log('📧 Datos recibidos:', JSON.stringify(datos, null, 2));

    const gerenteSeleccionado = datos.gerente || null;

    if (!gerenteSeleccionado) {
      console.error('❌ ERROR: No se especificó el gerente para enviar la notificación');
      return { success: false, message: 'No se especificó el gerente' };
    }

    console.log('✅ Gerente seleccionado:', gerenteSeleccionado);

    let emailDestinatario = datos.emailDestinatario?.trim() || null;
    let nombreDestinatario = datos.nombreDestinatario?.trim() || '';

    if (esGerenteFacturacion(gerenteSeleccionado)) {
      emailDestinatario = EMAIL_FACTURACION_AJUSTES;
      nombreDestinatario = nombreDestinatario || 'Adriana Angulo Funes';
      console.log('✅ Destinatario facturación (forzado):', emailDestinatario);
    } else if (gerenteSeleccionado === 'elkin') {
      try {
        const usuarioElkin = await SecurUser.findOne({ login: '72287602' });
        if (usuarioElkin && usuarioElkin.email) {
          emailDestinatario = usuarioElkin.email;
          console.log('✅ Email de Elkin encontrado:', emailDestinatario);
        } else {
          console.log('⚠️ Usuario Elkin (72287602) no encontrado o sin email, usando email por defecto');
          emailDestinatario = 'etapia@proserpuertos.com.co';
        }
      } catch (error) {
        console.error('❌ Error buscando usuario Elkin:', error);
        emailDestinatario = 'etapia@proserpuertos.com.co'; // Email por defecto
      }
      nombreDestinatario = 'Elkin Tapia Gutiérrez';
    } else if (gerenteSeleccionado === 'iskharly') {
      try {
        const usuarioIskharly = await SecurUser.findOne({ login: '72007205' });
        if (usuarioIskharly && usuarioIskharly.email) {
          emailDestinatario = usuarioIskharly.email;
          console.log('✅ Email de Iskharly encontrado:', emailDestinatario);
        } else {
          console.log('⚠️ Usuario Iskharly (72007205) no encontrado o sin email, usando email por defecto');
          emailDestinatario = 'itapia9@proserpuertos.com.co';
        }
      } catch (error) {
        console.error('❌ Error buscando usuario Iskharly:', error);
        emailDestinatario = 'itapia9@proserpuertos.com.co'; // Email por defecto
      }
      nombreDestinatario = 'Iskharly José Tapia Gutierrez';
    } else if (gerenteSeleccionado === 'test') {
      emailDestinatario = 'danalyst@proserpuertos.com.co';
      nombreDestinatario = 'Prueba - Analista';
      console.log('🧪 Enviando notificación de prueba a danalyst@proserpuertos.com.co');
    } else {
      console.error('❌ Gerente seleccionado no válido:', gerenteSeleccionado);
      return { success: false, message: 'Gerente seleccionado no válido' };
    }

    if (!emailDestinatario) {
      console.error('❌ No se pudo obtener el email del destinatario');
      return { success: false, message: 'No se pudo obtener el email del destinatario' };
    }

    const emails = [emailDestinatario];
    console.log('📧 Enviando notificación SOLO a:', emailDestinatario);

    // Construir enlaces de descarga para los archivos
    const baseUrl = process.env.BASE_URL || process.env.BACKEND_URL || 'http://localhost:5000';
    const archivosConEnlaces = (datos.archivosConRuta || []).map(archivo => {
      const nombreArchivo = archivo.nombre || 'documento';
      let rutaArchivo = archivo.ruta || archivo.url || '';
      
      if (rutaArchivo && !rutaArchivo.startsWith('http')) {
        if (!rutaArchivo.startsWith('/')) {
          rutaArchivo = `/${rutaArchivo}`;
        }
        if (!rutaArchivo.includes('uploads')) {
          const nombreArchivoRuta = rutaArchivo.split('/').pop();
          rutaArchivo = `/uploads/${nombreArchivoRuta}`;
        }
      }
      
      const urlDescarga = rutaArchivo 
        ? (rutaArchivo.startsWith('http') ? rutaArchivo : `${baseUrl}${rutaArchivo}`)
        : '';
      
      return urlDescarga 
        ? `<li style="margin-bottom:8px;">
             <a href="${urlDescarga}" 
                target="_blank"
                style="color:#2563eb; text-decoration:none; font-weight:500; display:inline-flex; align-items:center; gap:6px;">
               📎 ${nombreArchivo}
               <span style="font-size:11px; color:#6b7280;">(Descargar)</span>
             </a>
           </li>`
        : `<li style="margin-bottom:4px;">📎 ${nombreArchivo}</li>`;
    }).join('');
    
    const htmlArchivos = archivosConEnlaces || '<li>No se adjuntaron nombres de archivos</li>';

    // Preparar adjuntos para el correo
    const attachments = [];
    if (datos.archivosConRuta && Array.isArray(datos.archivosConRuta)) {
      for (const archivo of datos.archivosConRuta) {
        if (archivo.ruta) {
          try {
            let rutaCompleta = '';
            const rutaRelativa = archivo.ruta.startsWith('/') ? archivo.ruta.substring(1) : archivo.ruta;
            
            const rutasPosibles = [
              path.join(process.cwd(), 'uploads', rutaRelativa),
              path.join(__dirname, '..', 'uploads', rutaRelativa),
              path.join('/var/www/uploads', rutaRelativa),
              path.join('/home/ubuntu/uploads', rutaRelativa),
              archivo.ruta
            ];
            
            for (const ruta of rutasPosibles) {
              try {
                await fs.access(ruta);
                rutaCompleta = ruta;
                console.log('✅ Archivo encontrado en:', rutaCompleta);
                break;
              } catch (e) {
                // Continuar buscando
              }
            }
            
            if (rutaCompleta) {
              attachments.push({
                filename: archivo.nombre || 'documento',
                path: rutaCompleta
              });
              console.log('✅ Archivo agregado como adjunto:', archivo.nombre);
            } else {
              console.warn('⚠️ No se pudo encontrar el archivo:', archivo.ruta);
            }
          } catch (error) {
            console.error('❌ Error procesando archivo para adjuntar:', archivo.nombre, error);
          }
        }
      }
    }
    
    console.log('📎 Total archivos a adjuntar:', attachments.length);

    // Construir URL del frontend para el enlace directo al caso
    // IMPORTANTE: Para correos, siempre usar URL accesible (producción o FRONTEND_URL configurado)
    // No usar localhost porque los usuarios no pueden acceder desde sus máquinas
    let frontendUrl = process.env.FRONTEND_URL;
    
    if (!frontendUrl) {
      // Si no está configurado FRONTEND_URL, usar URL de producción por defecto
      // Esto asegura que los enlaces en los correos funcionen para todos los usuarios
      frontendUrl = 'https://aplicacion.grupoproser.com.co';
    }
    
    console.log('🔗 [Enlace Caso Gerencia] frontendUrl:', frontendUrl);
    console.log('🔗 [Enlace Caso Gerencia] NODE_ENV:', process.env.NODE_ENV);
    
    let urlCaso = null;
    let textoEnlace = 'Ver Casos';
    
    if (datos.casoId) {
      urlCaso = `${frontendUrl}/editar-caso/${datos.casoId}`;
      textoEnlace = datos.numeroCaso && datos.numeroCaso !== 'Sin número' 
        ? `Ver Caso #${datos.numeroCaso}` 
        : 'Ver Caso';
    } else if (datos.numeroCaso && datos.numeroCaso !== 'Sin número') {
      urlCaso = `${frontendUrl}/complex/excel?buscar=${encodeURIComponent(datos.numeroCaso)}`;
      textoEnlace = `Buscar Caso #${datos.numeroCaso}`;
    } else {
      urlCaso = `${frontendUrl}/complex/excel`;
      textoEnlace = 'Ver Casos Complex';
    }
    
    const htmlEnlaceCaso = `
      <div style="background-color:#dbeafe; padding:20px; border-radius:8px; border-left:4px solid #2563eb; margin:25px 0; text-align:center;">
        <p style="margin:0 0 15px 0; color:#1e40af; font-weight:600; font-size:16px;">🔗 Acceso Directo al Caso</p>
        <a href="${urlCaso}" 
           style="display:inline-block; background-color:#2563eb; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:600; font-size:14px;">
          ${textoEnlace}
        </a>
        <p style="margin:15px 0 0 0; color:#1e3a8a; font-size:12px;">Haz clic en el botón para acceder ${datos.casoId ? 'directamente al caso' : 'a la plataforma de casos'}</p>
      </div>
    `;

    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: emails[0],
      subject: `👔 Nueva evidencia de gerencia - Caso ${datos.numeroCaso || 'sin número'}`,
      attachments: attachments.length > 0 ? attachments : undefined,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">
            <h2 style="color: #1f2937; margin-top: 0; text-align:center;">👔 Nueva evidencia de gerencia recibida</h2>
            <p style="color: #4b5563;">Se ha cargado una nueva evidencia en la sección de gerencia.</p>
            <table style="width:100%; border-collapse:collapse; margin:20px 0;">
              <tr>
                <td style="padding:8px 0; font-weight:bold; color:#111827;">Número de Caso:</td>
                <td style="padding:8px 0; color:#1f2937;">${datos.numeroCaso || 'Sin especificar'}</td>
              </tr>
              ${datos.numeroSiniestro ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Número de Siniestro:</td><td style="padding:8px 0; color:#1f2937;">${datos.numeroSiniestro}</td></tr>` : ''}
              ${datos.responsable ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Responsable:</td><td style="padding:8px 0; color:#1f2937;">${datos.responsable}</td></tr>` : ''}
              ${datos.usuario ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Usuario que cargó:</td><td style="padding:8px 0; color:#1f2937;">${datos.usuario}</td></tr>` : ''}
            </table>
            <div style="background-color:#fef3c7; padding:15px; border-radius:8px; border-left:4px solid #f59e0b;">
              <h3 style="margin:0 0 10px 0; color:#92400e;">Archivos cargados:</h3>
              <ul style="margin:0; padding-left:20px; color:#78350f;">
                ${htmlArchivos}
              </ul>
              ${attachments.length > 0 ? `<p style="margin:10px 0 0 0; color:#92400e; font-size:13px; font-weight:500;">📎 Los archivos también están adjuntos a este correo para su descarga directa.</p>` : ''}
            </div>
            ${htmlEnlaceCaso}
            <p style="color:#6b7280; font-size:12px; margin-top:25px; text-align:center;">
              Este es un mensaje automático del Sistema de Gestión de Casos de Grupo Proser.
            </p>
          </div>
        </div>
      `
    };

    const info = await deliverMail(mailOptions, { tipo: 'emailService' });
    console.log('✅ Notificación de gerencia enviada. Message ID:', info.messageId);

    return {
      success: true,
      messageId: info.messageId,
      destinatarios: emails
    };
  } catch (error) {
    console.error('❌ Error enviando notificación de gerencia:', error);
    throw new Error(`Error enviando notificación de gerencia: ${error.message}`);
  }
};

export const enviarNotificacionHonorarios = async (datos) => {
  try {
    console.log('📧 Preparando notificación de honorarios...');
    console.log('📧 Datos recibidos:', JSON.stringify(datos, null, 2));

    const destinatarios = [
      { nombre: 'Adriana Angulo Funes', email: EMAIL_FACTURACION_AJUSTES },
      { nombre: 'Elkin Tapia Gutiérrez', email: 'etapia@proserpuertos.com.co' },
      { nombre: 'Iskharly José Tapia Gutierrez', email: 'itapia9@proserpuertos.com.co' },
      { nombre: 'Arnaldo Andrés Tapia Gutierrez', email: 'aatapia@proserpuertos.com.co' }
    ];

    const emails = destinatarios.map(dest => dest.email);
    if (emails.length === 0) {
      console.log('⚠️ No hay destinatarios configurados para honorarios');
      return { success: false, message: 'No hay destinatarios configurados' };
    }

    const archivos = (datos.archivos || []).map(nombre => `<li style="margin-bottom:4px;">📎 ${nombre}</li>`).join('');
    const htmlArchivos = archivos || '<li>No se adjuntaron nombres de archivos</li>';

    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: emails.join(', '),
      subject: `📎 Nuevo documento de honorarios - Caso ${datos.numeroCaso || 'sin número'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">
            <h2 style="color: #1f2937; margin-top: 0; text-align:center;">📎 Nuevo documento de honorarios recibido</h2>
            <p style="color: #4b5563;">Se ha cargado un nuevo documento en la sección de honorarios.</p>
            <table style="width:100%; border-collapse:collapse; margin:20px 0;">
              <tr>
                <td style="padding:8px 0; font-weight:bold; color:#111827;">Número de Caso:</td>
                <td style="padding:8px 0; color:#1f2937;">${datos.numeroCaso || 'Sin especificar'}</td>
              </tr>
              ${datos.numeroSiniestro ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Número de Siniestro:</td><td style="padding:8px 0; color:#1f2937;">${datos.numeroSiniestro}</td></tr>` : ''}
              ${datos.responsable ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Responsable:</td><td style="padding:8px 0; color:#1f2937;">${datos.responsable}</td></tr>` : ''}
              ${datos.usuario ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">Usuario que cargó:</td><td style="padding:8px 0; color:#1f2937;">${datos.usuario}</td></tr>` : ''}
            </table>
            <div style="background-color:#f0f9ff; padding:15px; border-radius:8px;">
              <h3 style="margin:0 0 10px 0; color:#0c4a6e;">Archivos cargados:</h3>
              <ul style="margin:0; padding-left:20px; color:#0f172a;">
                ${htmlArchivos}
              </ul>
            </div>
            <p style="color:#6b7280; font-size:12px; margin-top:25px; text-align:center;">
              Este es un mensaje automático del Sistema de Gestión de Casos de Grupo Proser.
            </p>
          </div>
        </div>
      `
    };

    const info = await deliverMail(mailOptions, { tipo: 'emailService' });
    console.log('✅ Notificación de honorarios enviada. Message ID:', info.messageId);

    return {
      success: true,
      messageId: info.messageId,
      destinatarios: emails
    };
  } catch (error) {
    console.error('❌ Error enviando notificación de honorarios:', error);
    throw new Error(`Error enviando notificación de honorarios: ${error.message}`);
  }
};

// Función para enviar email de prueba
export const enviarEmailPrueba = async (emailDestino) => {
  try {
    console.log('🧪 Iniciando prueba de email...');
    
    // Verificar si las credenciales están configuradas
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('⚠️ Credenciales de email no configuradas, simulando envío...');
      return {
        success: true,
        message: "Email simulado enviado correctamente (credenciales no configuradas)",
        messageId: "simulated-" + Date.now(),
        simulated: true
      };
    }
    
    
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: emailDestino || 'danalyst@proserpuertos.com.co',
      subject: '🧪 Prueba de Email - Sistema de Casos',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">🧪 Prueba de Email</h2>
          <p>Este es un email de prueba para verificar que el sistema de notificaciones funciona correctamente.</p>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString()}</p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
            Este es un mensaje de prueba automático del Sistema de Gestión de Casos.
          </p>
        </div>
      `
    };
    
    console.log('📧 Enviando email de prueba...');
    const info = await deliverMail(mailOptions, { tipo: 'emailService' });
    console.log('✅ Email de prueba enviado exitosamente');
    console.log('📧 Message ID:', info.messageId);
    
    return {
      success: true,
      message: "Email de prueba enviado correctamente",
      messageId: info.messageId
    };
    
  } catch (error) {
    console.error('❌ Error en prueba de email:', error);
    
    throw new Error(`Error enviando email de prueba: ${error.message}`);
  }
};

// Función para enviar alertas de tareas por correo
export const enviarAlertaTarea = async (datosTarea) => {
  try {
    console.log('📧 Iniciando envío de alerta de tarea...');
    console.log('📧 Datos de tarea:', JSON.stringify(datosTarea, null, 2));
    
    // Validar que haya un email válido
    if (!datosTarea.emailResponsable) {
      console.log('⚠️ No hay email válido para notificar tarea');
      return {
        success: false,
        message: 'No hay email válido para notificar tarea'
      };
    }
    
    // Verificar si las credenciales están configuradas
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('⚠️ Credenciales de email no configuradas, simulando envío de alerta...');
      return {
        success: true,
        message: "Alerta de tarea simulada enviada correctamente (credenciales no configuradas)",
        messageId: "simulated-" + Date.now(),
        simulated: true
      };
    }
    
    
    console.log('📧 Enviando alerta de tarea a:', datosTarea.emailResponsable);
    
           // Determinar el tipo de alerta y el color
           const tiposAlerta = {
             'NUEVA_TAREA': {
               titulo: '📋 Nueva Tarea Asignada',
               color: '#2563eb',
               icono: '📋'
             },
             'TAREA_ACTUALIZADA': {
               titulo: '✏️ Tarea Actualizada',
               color: '#ea580c',
               icono: '✏️'
             },
             'TAREA_COMPLETADA': {
               titulo: '✅ Tarea Completada',
               color: '#059669',
               icono: '✅'
             },
             'TAREA_REABIERTA': {
               titulo: '🔄 Tarea Reabierta',
               color: '#dc2626',
               icono: '🔄'
             },
             'TAREA_ELIMINADA': {
               titulo: '🗑️ Tarea Eliminada',
               color: '#6b7280',
               icono: '🗑️'
             },
             'ALERTA_DIARIA': {
               titulo: '⏰ Recordatorio de Tarea Pendiente',
               color: '#f59e0b',
               icono: '⏰'
             },
             'ALERTA_FINAL': {
               titulo: '⚠️ TAREA VENCIDA - Acción Requerida',
               color: '#dc2626',
               icono: '⚠️'
             }
           };
    
    const tipoInfo = tiposAlerta[datosTarea.tipoAlerta] || tiposAlerta['NUEVA_TAREA'];
    
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Tareas" <${process.env.EMAIL_USER}>`,
      to: datosTarea.emailResponsable,
      subject: `${tipoInfo.icono} ${tipoInfo.titulo} - ${datosTarea.tarea?.texto?.substring(0, 50) || 'Tarea'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: ${tipoInfo.color}; margin: 0; font-size: 24px;">${tipoInfo.icono} ${tipoInfo.titulo}</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">Sistema de Gestión de Tareas - Grupo Proser</p>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #0369a1; margin: 0 0 15px 0; font-size: 18px;">📋 Información de la Tarea</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📝 Descripción:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosTarea.tarea?.texto || 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 Fecha Límite:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosTarea.tarea?.fecha ? new Date(datosTarea.tarea.fecha).toLocaleDateString() : 'No especificada'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">⚡ Prioridad:</td>
                  <td style="padding: 8px 0; color: #1f2937;">
                    <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background-color: ${
                      datosTarea.tarea?.prioridad === 'ALTA' ? '#fecaca' : 
                      datosTarea.tarea?.prioridad === 'MEDIA' ? '#fef3c7' : '#d1fae5'
                    }; color: ${
                      datosTarea.tarea?.prioridad === 'ALTA' ? '#dc2626' : 
                      datosTarea.tarea?.prioridad === 'MEDIA' ? '#ca8a04' : '#059669'
                    };">${datosTarea.tarea?.prioridad || 'MEDIA'}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">✅ Estado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">
                    <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background-color: ${
                      datosTarea.tarea?.cumplida ? '#d1fae5' : '#fef2f2'
                    }; color: ${
                      datosTarea.tarea?.cumplida ? '#059669' : '#dc2626'
                    };">${datosTarea.tarea?.cumplida ? 'COMPLETADA' : 'PENDIENTE'}</span>
                  </td>
                </tr>
                ${datosTarea.tarea?.fechaCumplimiento ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🎯 Fecha de Completado:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${new Date(datosTarea.tarea.fechaCumplimiento).toLocaleString()}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👤 Asignado a:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosTarea.nombreResponsable || 'No especificado'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📧 Email:</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosTarea.emailResponsable}</td>
                </tr>
                ${datosTarea.tarea?.diasRestantes !== undefined ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">⏰ Días Restantes:</td>
                  <td style="padding: 8px 0; color: #1f2937;">
                    <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background-color: ${
                      datosTarea.tarea.diasRestantes <= 0 ? '#fecaca' : 
                      datosTarea.tarea.diasRestantes <= 1 ? '#fef3c7' : '#d1fae5'
                    }; color: ${
                      datosTarea.tarea.diasRestantes <= 0 ? '#dc2626' : 
                      datosTarea.tarea.diasRestantes <= 1 ? '#ca8a04' : '#059669'
                    };">${datosTarea.tarea.diasRestantes <= 0 ? 'VENCIDA' : `${datosTarea.tarea.diasRestantes} días`}</span>
                  </td>
                </tr>
                ` : ''}
              </table>
            </div>
            
            ${datosTarea.tarea?.observaciones ? `
            <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">📝 Observaciones</h3>
              <p style="color: #78350f; margin: 0; line-height: 1.5;">${datosTarea.tarea.observaciones}</p>
            </div>
            ` : ''}
            
            <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #059669; margin: 0 0 15px 0; font-size: 16px;">💡 Acciones Recomendadas</h3>
              <ul style="margin: 0; padding-left: 20px; color: #065f46;">
                ${datosTarea.tipoAlerta === 'NUEVA_TAREA' ? '<li>Revisa los detalles de la tarea asignada</li><li>Planifica el tiempo necesario para completarla</li><li>Marca como completada cuando termines</li>' : ''}
                ${datosTarea.tipoAlerta === 'TAREA_ACTUALIZADA' ? '<li>Revisa los cambios realizados en la tarea</li><li>Actualiza tu plan de trabajo si es necesario</li>' : ''}
                ${datosTarea.tipoAlerta === 'TAREA_COMPLETADA' ? '<li>¡Excelente trabajo! La tarea ha sido completada</li><li>Revisa si hay tareas relacionadas pendientes</li>' : ''}
                ${datosTarea.tipoAlerta === 'TAREA_REABIERTA' ? '<li>La tarea ha sido reabierta y requiere atención</li><li>Revisa los nuevos requisitos o cambios</li>' : ''}
                ${datosTarea.tipoAlerta === 'TAREA_ELIMINADA' ? '<li>Esta tarea ya no es necesaria</li><li>Si crees que es un error, contacta al administrador</li>' : ''}
                ${datosTarea.tipoAlerta === 'ALERTA_DIARIA' ? '<li>Esta es una alerta automática de recordatorio</li><li>Completa la tarea antes de la fecha límite</li><li>Si ya la completaste, márcala como cumplida en el sistema</li>' : ''}
                ${datosTarea.tipoAlerta === 'ALERTA_FINAL' ? '<li><strong>⚠️ ATENCIÓN: Esta tarea ha llegado a su fecha límite</strong></li><li>Si ya la completaste, márcala como cumplida inmediatamente</li><li>Si no la has completado, contacta al administrador</li><li>Después de marcar como cumplida, puedes eliminar esta tarea</li>' : ''}
              </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                Este es un mensaje automático del Sistema de Gestión de Tareas de Grupo Proser.<br>
                No responda a este correo. Para consultas, contacte al administrador del sistema.
              </p>
            </div>
          </div>
        </div>
      `
    };
    
    // Enviar email
    const info = await deliverMail(mailOptions, { tipo: 'emailService' });
    
    console.log('✅ Alerta de tarea enviada exitosamente');
    console.log('📧 Message ID:', info.messageId);
    console.log('📧 Response:', info.response);
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };
    
  } catch (error) {
    console.error('❌ Error enviando alerta de tarea:', error);
    throw new Error(`Error enviando alerta de tarea: ${error.message}`);
  }
}; 