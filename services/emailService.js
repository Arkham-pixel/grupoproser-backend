import SecurUser from '../models/SecurUser.js';
import { deliverMail } from './mailTransport.js';
import Cliente from '../models/Cliente.js';
import mongoose from 'mongoose';
import { resolverNombreEstado } from '../utils/resolverEstado.js';
import { resolveFrontendUrl } from '../config/platformUrls.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeEmailLocale,
  getEmailText,
  getEmailSubject,
  fillEmailTemplate,
  isMissingCaseNumber,
} from './emailI18n.js';
import {
  getDownloadUrl,
  resolveFileForRead,
} from './fileStorageService.js';

/** Tope razonable de adjuntos en alertas Alfa (~8 MB). */
export const TOPE_ADJUNTOS_ALERTAS_ALFA_BYTES = 8 * 1024 * 1024;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Prepara adjuntos nodemailer desde archivosConRuta (patrón control de horas/gerencia).
 * Si el tamaño acumulado supera el tope, el resto se lista como enlaces HTML.
 */
export async function prepararAdjuntosArchivosConRuta(
  archivosConRuta = [],
  { topeBytes = TOPE_ADJUNTOS_ALERTAS_ALFA_BYTES } = {}
) {
  const attachments = [];
  const enlaces = [];
  let bytesUsados = 0;
  const baseUrl = process.env.BASE_URL || process.env.BACKEND_URL || 'http://localhost:5000';

  for (const archivo of archivosConRuta || []) {
    const nombre = archivo.nombre || archivo.nombreOriginal || 'documento';
    const ruta = archivo.ruta || archivo.url || '';
    if (!ruta) continue;

    let urlDescarga = '';
    try {
      urlDescarga = await getDownloadUrl(ruta);
      if (urlDescarga && !urlDescarga.startsWith('http')) {
        const rel = urlDescarga.startsWith('/') ? urlDescarga : `/${urlDescarga}`;
        urlDescarga = `${baseUrl}${rel}`;
      }
    } catch {
      urlDescarga = ruta.startsWith('http')
        ? ruta
        : `${baseUrl}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
    }

    const enlaceHtml = urlDescarga
      ? `<li style="margin-bottom:8px;">
           <a href="${urlDescarga}" target="_blank"
              style="color:#2563eb; text-decoration:none; font-weight:500;">
             📎 ${nombre}
             <span style="font-size:11px; color:#6b7280;">(Descargar)</span>
           </a>
         </li>`
      : `<li style="margin-bottom:4px;">📎 ${nombre}</li>`;

    const tamañoEstimado = Number(archivo.tamaño) || 0;
    if (tamañoEstimado > 0 && bytesUsados + tamañoEstimado > topeBytes) {
      enlaces.push(enlaceHtml);
      continue;
    }

    try {
      const resolved = await resolveFileForRead(ruta);
      const tieneLocal = Boolean(resolved?.localPath && resolved.exists !== false);
      const tieneStream = Boolean(resolved?.stream);

      if (!tieneLocal && !tieneStream) {
        enlaces.push(enlaceHtml);
        continue;
      }

      if (tieneStream) {
        const content = await streamToBuffer(resolved.stream);
        const size = content.length || tamañoEstimado;
        if (bytesUsados + size > topeBytes) {
          enlaces.push(enlaceHtml);
          continue;
        }
        attachments.push({
          filename: nombre,
          content,
          contentType: resolved.contentType || archivo.tipoMime,
        });
        bytesUsados += size;
        continue;
      }

      const stat = await fs.stat(resolved.localPath).catch(() => null);
      const size = stat?.size ?? tamañoEstimado;
      if (!stat || bytesUsados + size > topeBytes) {
        enlaces.push(enlaceHtml);
        continue;
      }
      attachments.push({ filename: nombre, path: resolved.localPath });
      bytesUsados += size;
    } catch (error) {
      console.warn('⚠️ No se pudo adjuntar archivo Alfa:', nombre, error.message);
      enlaces.push(enlaceHtml);
    }
  }

  return {
    attachments,
    enlacesHtml: enlaces.join(''),
    bytesUsados,
    totalAdjuntos: attachments.length,
    totalSoloEnlace: enlaces.length,
  };
}

// Re-export i18n helpers so callers / tests can import from emailService if needed.
export { normalizeEmailLocale, getEmailText, getEmailSubject, isMissingCaseNumber };

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

/** URL y botón HTML para acceso directo al caso en correos */
function construirEnlaceCaso(datos = {}) {
  const text = getEmailText(datos);
  const frontendUrl = resolveFrontendUrl();
  if (datos.casoId) {
    return {
      url: `${frontendUrl}/editar-caso/${datos.casoId}`,
      texto: !isMissingCaseNumber(datos.numeroCaso)
        ? `${text.openCase} ${datos.numeroCaso}`
        : `${text.openCase} ARNALD`,
    };
  }
  if (!isMissingCaseNumber(datos.numeroCaso)) {
    return {
      url: `${frontendUrl}/complex/excel?buscar=${encodeURIComponent(datos.numeroCaso)}`,
      texto: `${text.searchCase} ${datos.numeroCaso}`,
    };
  }
  return {
    url: `${frontendUrl}/complex/mis-casos`,
    texto: text.viewCases,
  };
}

function htmlBotonAccesoCaso(datos = {}) {
  const { url, texto } = construirEnlaceCaso(datos);
  const translation = getEmailText(datos);
  const etiquetaBoton = !isMissingCaseNumber(datos.numeroCaso)
    ? `${translation.goToCase} ${datos.numeroCaso}`
    : translation.goToCase;
  return `
    <div style="background-color:#fef2f2; padding:22px; border-radius:8px; border-left:4px solid #dc2626; margin:25px 0; text-align:center;">
      <p style="margin:0 0 12px 0; color:#991b1b; font-weight:700; font-size:16px;">${translation.directAccess}</p>
      <a href="${url}"
         style="display:inline-block; background-color:#dc2626; color:#ffffff; padding:14px 28px; text-decoration:none; border-radius:8px; font-weight:700; font-size:15px;">
        ${etiquetaBoton}
      </a>
      <p style="margin:14px 0 0 0; color:#7f1d1d; font-size:12px; line-height:1.5;">
        ${translation.protocol}
      </p>
      <p style="margin:12px 0 0 0; color:#7f1d1d; font-size:12px; line-height:1.5; word-break:break-all;">
        ${translation.brokenButton} <a href="${url}" style="color:#b91c1c;">${url}</a>
      </p>
    </div>
  `;
}

function htmlSeccionDestinatarios(datos = {}) {
  const t = getEmailText(datos);
  const quienAsigna =
    datos.quienAsigna && datos.quienAsigna !== 'Sistema' && datos.quienAsigna !== t.system
      ? datos.quienAsigna
      : (datos.loginQuienAsigna || datos.quienAsigna || t.unidentified);
  return `
    <div style="background-color:#f0f9ff; padding:20px; border-radius:8px; margin-bottom:25px;">
      <h3 style="color:#0369a1; margin:0 0 15px 0; font-size:16px;">${t.recipientsTitle}</h3>
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0; font-weight:bold; color:#374151; width:42%;">${t.assignedResponsible}</td>
          <td style="padding:8px 0; color:#1f2937;">${datos.nombreResponsable || t.unassigned}</td>
        </tr>
        <tr>
          <td style="padding:8px 0; font-weight:bold; color:#374151;">${t.assignedByPerson}</td>
          <td style="padding:8px 0; color:#1f2937;">${quienAsigna}</td>
        </tr>
      </table>
    </div>
  `;
}

function formatearFechaCorreo(valor, datos = {}) {
  const t = getEmailText(datos);
  if (!valor) return t.notSpecifiedF;
  try {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return String(valor);
    const dia = String(fecha.getDate()).padStart(2, '0');
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const año = fecha.getFullYear();
    return `${dia}/${mes}/${año}`;
  } catch {
    return String(valor);
  }
}

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
    } else if (datosCaso.codiRespnsble) {
      try {
        const usuario = await SecurUser.findOne({
          $or: [
            { login: String(datosCaso.codiRespnsble).trim() },
            { cedula: String(datosCaso.codiRespnsble).trim() },
          ],
        });
        if (usuario?.email?.trim()) {
          emailsAdicionales.push(usuario.email.trim());
          console.log('✅ Email del responsable vía SecurUser:', usuario.email.trim());
        }
      } catch (error) {
        console.log('⚠️ No se pudo resolver email del responsable en SecurUser:', error.message);
      }
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
    
    // Callers deben pasar datosCaso.locale ('es'|'en') — preferencia destinatario/emisor.
    const t = getEmailText(datosCaso);

    // Obtener nombre de aseguradora (para todos los tipos de casos)
    let nombreAseguradora = datosCaso.aseguradora || t.notSpecifiedF;
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
    let nombreFuncionario = datosCaso.funcionarioAseguradora || datosCaso.funcAsgrdraNombre || t.notSpecified;
    if (!nombreFuncionario || nombreFuncionario === 'No especificado' || nombreFuncionario === t.notSpecified || nombreFuncionario === '') {
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
            nombreFuncionario = valorBuscado || t.notSpecified;
          }
        } catch (error) {
          console.log('❌ ❌ ❌ ERROR AL BUSCAR FUNCIONARIO ❌ ❌ ❌');
          console.log('❌ Error:', error.message);
          console.log('❌ Stack trace:', error.stack);
          nombreFuncionario = valorBuscado || t.notSpecified;
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
    const fechaFormateada = formatearFechaCorreo(datosCaso.fechaAsignacion, datosCaso);
    const fechaSiniestroFormateada = formatearFechaCorreo(datosCaso.fechaSiniestro, datosCaso);
    const htmlEnlaceCaso = htmlBotonAccesoCaso(datosCaso);
    
    // Generar HTML según el tipo de caso
    let htmlContent = '';
    if (datosCaso.tipoCaso === 'riesgo' || datosCaso.esCasoRiesgo) {
      // Template específico para casos de riesgo
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2563eb; margin: 0; font-size: 24px;">📋 ${t.riskCaseAssignedTitle}</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">${t.caseMgmtSubtitle}</p>
              ${datosCaso.quienAsigna && datosCaso.quienAsigna !== 'Sistema' && datosCaso.quienAsigna !== t.system ? `
              <div style="background-color: #d1fae5; padding: 15px; border-radius: 8px; margin-top: 15px; border-left: 4px solid #10b981;">
                <p style="color: #065f46; margin: 0; font-weight: bold; font-size: 16px;">
                  ✅ Has asignado exitosamente este caso de riesgo
                </p>
                <p style="color: #047857; margin: 5px 0 0 0; font-size: 14px;">
                  El caso ${datosCaso.numeroCaso || 'N/A'} ha sido asignado correctamente al inspector ${datosCaso.inspector || datosCaso.nombreResponsable || t.unassigned}
                </p>
              </div>
              ` : ''}
            </div>
            
            <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">📊 ${t.caseInfo}</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏢 ${t.client}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.aseguradora || nombreAseguradora || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👤 ${t.inspector}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.inspector || datosCaso.nombreResponsable || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📋 ${t.classification}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.clasificacion || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📞 ${t.requestedBy}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.quienSolicita || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏙️ ${t.inspectionCity}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.ciudadInspeccion || datosCaso.ciudadSucursal || datosCaso.codigoPoblado || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📍 ${t.address}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.direccion || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👥 ${t.insured}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.asegurado || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 ${t.assignmentDate}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.fechaAsignacion || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📝 ${t.observation}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.observaciones || datosCaso.descripcion || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📊 ${t.status}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${nombreEstado}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👨‍💼 ${t.assignedBy}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.quienAsigna || t.system}</td>
                </tr>
              </table>
            </div>
            
            ${datosCaso.observaciones ? `
            <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">📝 ${t.observations}</h3>
              <p style="color: #78350f; margin: 0; line-height: 1.5;">${datosCaso.observaciones}</p>
            </div>
            ` : ''}
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">👥 ${t.riskTeam}</h3>
              <ul style="margin: 0; padding-left: 20px; color: #0c4a6e;">
                <li>Mario Alberto Pinilla de la Torre</li>
                <li>Arnaldo Andrés Tapia Gutierrez</li>
              </ul>
            </div>
            
            <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #10b981;">
              <h3 style="color: #047857; margin: 0 0 10px 0; font-size: 16px;">📊 ${t.independentReport}</h3>
              <p style="color: #065f46; margin: 0; line-height: 1.5;">
                Este caso ha sido registrado en el sistema y está disponible para seguimiento y gestión independiente.
                Puede acceder al reporte completo desde el sistema de gestión de casos.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                ${t.footerAuto}<br>
                ${t.footerNoReply}
              </p>
            </div>
          </div>
        </div>
      `;
    } else {
      // Template COMPLEX — protocolo fase 1: recepción / asignación al ajustador
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #dc2626; margin: 0; font-size: 24px;">${t.newClaimAssigned}</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">${t.arnaldProtocolSubtitle}</p>
              <p style="color: #991b1b; margin: 12px 0 0 0; font-size: 14px; font-weight: 600;">
                ${t.phase1Banner}
              </p>
            </div>
            
            ${htmlEnlaceCaso}

            <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">${t.claimInfo}</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151; width: 42%;">${t.adjustmentNumber}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroCaso || '—'}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.claimNumberLabel}</td>
                  <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">${datosCaso.numeroSiniestro || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.claimDate}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${fechaSiniestroFormateada}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.policyBranch}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.tipoPoliza || datosCaso.ramo || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.workflowCode}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.codigoWorkflow || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.insurer}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${nombreAseguradora}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.insuredBeneficiary}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.aseguradoReal || datosCaso.asgrBenfcro || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.intermediary}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.intermediario || datosCaso.asegurado || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.insurerOfficer}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${nombreFuncionario}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.claimCity}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.ciudadSiniestro || datosCaso.descripcionCiudad || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.policyNumber}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroPoliza || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.caseStatus}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${nombreEstado}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.assignedAdjuster}</td>
                  <td style="padding: 8px 0; color: #1f2937; font-weight: 600;">${datosCaso.nombreResponsable || t.unassigned}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.assignmentDate}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${fechaFormateada}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.assignedBy}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.quienAsigna || t.system}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151; vertical-align: top;">${t.description}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.descripcionSiniestro || t.notSpecifiedF}</td>
                </tr>
              </table>
            </div>
            
            ${datosCaso.observaciones ? `
            <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">${t.observations}</h3>
              <p style="color: #78350f; margin: 0; line-height: 1.5;">${datosCaso.observaciones}</p>
            </div>
            ` : ''}
            
            <div style="background-color: #f0fdf4; padding: 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #16a34a;">
              <p style="margin:0; color:#166534; font-size:13px; line-height:1.6;">
                <strong>${t.nextStepProtocol}</strong> ${t.nextStepBody}
                <strong>${t.nextStepHours}</strong> ${t.nextStepSuffix}
              </p>
            </div>

            ${htmlSeccionDestinatarios(datosCaso)}
            ${htmlEnlaceCaso}
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                ${t.footerArnald}<br>
                ${t.footerNoReplyShort}
              </p>
            </div>
          </div>
        </div>
      `;
    };
    
    const asuntoComplex = getEmailSubject(datosCaso, 'subjectAsignacionComplex', {
      numero: datosCaso.numeroCaso || t.newCase,
      siniestro: datosCaso.numeroSiniestro || '—',
    });
    
    // Construir objeto mailOptions con todos los datos necesarios
    const mailOptions = {
      from: `"ARNALD DataFlow" <${process.env.EMAIL_USER}>`,
      to: todosLosEmails.join(', '),
      subject: datosCaso.tipoCaso === 'riesgo' || datosCaso.esCasoRiesgo 
        ? getEmailSubject(datosCaso, 'subjectAsignacionRiesgo', {
            numero: datosCaso.numeroCaso || (normalizeEmailLocale(datosCaso) === 'en' ? 'New' : 'Nuevo'),
          })
        : asuntoComplex,
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
    // Callers deben pasar datosAlertas.locale ('es'|'en').
    const t = getEmailText(datosAlertas);

    const modulo = String(datosAlertas.modulo || 'complex').toLowerCase();
    const esExpress = modulo === 'express';
    const tituloSistema = esExpress
      ? t.alertsSystemExpress
      : t.alertsSystemComplex;
    const enlacePanel = esExpress
      ? `${resolveFrontendUrl()}/express/protocolo`
      : `${resolveFrontendUrl()}/complex/alertas`;
    
    // Crear contenido HTML para las alertas
    const contenidoAlertas = (datosAlertas.alertas?.casos || []).map(caso => {
      const docsFaltantes = Array.isArray(caso.documentosFaltantes)
        ? caso.documentosFaltantes.length
        : 0;
      const alertasHTML = (caso.alertas || []).map(alerta => `
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
            <strong>${t.actionRequired}</strong> ${alerta.accion || t.reviewCaseArnald}
          </p>
          ${alerta.etiquetaLimite ? `<p style="margin: 6px 0 0 0; color: #9ca3af; font-size: 12px;">${t.ansDeadline} ${alerta.etiquetaLimite}</p>` : ''}
        </div>
      `).join('');
      
      return `
        <div style="margin: 20px 0; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
          <h3 style="margin: 0 0 15px 0; color: #1f2937; font-size: 18px;">
            🚨 ${t.caseLabel} ${caso.numeroAjuste || caso.consecutivo || 'N/A'}
          </h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; font-size: 14px;">
            <div>
              <strong>${t.claimLabel}</strong> ${caso.numeroSiniestro || 'N/A'}<br>
              <strong>${t.insurerLabel}</strong> ${caso.aseguradora || 'N/A'}<br>
              <strong>${t.insuredLabel}</strong> ${caso.asegurado || 'N/A'}
            </div>
            <div>
              <strong>${t.statusLabel}</strong> ${caso.estado || 'N/A'}<br>
              <strong>${t.totalAlerts}</strong> ${caso.totalAlertas}<br>
              ${esExpress ? '' : `<strong>${t.missingDocs}</strong> ${docsFaltantes}`}
            </div>
          </div>
          ${alertasHTML}
          ${caso.inactividad ? `
            <div style="margin-top: 15px; padding: 15px; background-color: #f3f4f6; border-radius: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: #6b7280;">⏰</span>
                <span style="font-size: 14px; color: #374151;">
                  <strong>${t.lastActivity}</strong> ${caso.inactividad.actividad}
                  ${caso.inactividad.dias !== null ? ` ${fillEmailTemplate(t.daysAgo, { dias: caso.inactividad.dias })}` : ''}
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
      subject: getEmailSubject(datosAlertas, 'subjectAlertas', {
        tipo: esExpress ? t.subjectAlertasExpress : t.subjectAlertasPendientes,
        count: datosAlertas.alertas.casosConAlertas,
      }),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #dc2626; margin: 0; font-size: 28px;">🚨 ${tituloSistema}</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">${t.autoNotifications}</p>
            </div>
            
            <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #dc2626;">
              <h2 style="color: #dc2626; margin: 0 0 15px 0; font-size: 20px;">⚠️ ${t.alertsSummary}</h2>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.totalCasos}</div>
                  <div style="font-size: 12px; color: #6b7280;">${t.totalCases}</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #ea580c;">${datosAlertas.alertas.casosConAlertas}</div>
                  <div style="font-size: 12px; color: #6b7280;">${t.withAlerts}</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.resumen?.documentosObligatorios ?? 0}</div>
                  <div style="font-size: 12px; color: #6b7280;">${esExpress ? t.ansAlerts : t.mandatoryDocs}</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.resumen?.casosCriticos ?? 0}</div>
                  <div style="font-size: 12px; color: #6b7280;">${t.criticalCases}</div>
                </div>
              </div>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">👤 ${t.recipientTitle}</h3>
              <p style="margin: 0; color: #0c4a6e;">
                <strong>${t.responsibleLabel}</strong> ${datosAlertas.nombreResponsable}<br>
                <strong>${t.notificationDate}</strong> ${datosAlertas.fechaAsignacion}
              </p>
            </div>
            
            <div style="margin-bottom: 25px;">
              <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">📋 ${t.alertsDetailByCase}</h3>
              ${contenidoAlertas}
            </div>

            <div style="background-color:#fef2f2; padding:18px; border-radius:8px; border-left:4px solid #dc2626; margin:25px 0; text-align:center;">
              <a href="${enlacePanel}"
                 style="display:inline-block; background-color:#dc2626; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:8px; font-weight:700; font-size:14px;">
                ${fillEmailTemplate(t.openAlertsPanel, { modulo: esExpress ? 'Express' : 'Complex' })}
              </a>
            </div>
            
            <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #059669; margin: 0 0 15px 0; font-size: 16px;">💡 ${t.recommendations}</h3>
              <ul style="margin: 0; padding-left: 20px; color: #065f46;">
                <li>${t.recHighFirst} <strong>${t.priorityHigh}</strong></li>
                <li>${esExpress ? t.recExpress : t.recComplex}</li>
                <li>${t.recInactive}</li>
                <li>${t.recSupport}</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                ${t.footerAlerts}<br>
                ${t.footerNoReply}
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

/**
 * Alertas Seguros Alfa: mismo layout que alertas Complex/Express,
 * más adjuntos del archivero del caso (tope ~8MB; resto como enlaces).
 */
export const enviarEmailAlertasAlfa = async (datosAlertas) => {
  try {
    console.log('📧 Iniciando envío de email de alertas Seguros Alfa...');

    if (!datosAlertas.emailResponsable) {
      console.log('⚠️ No hay email válido para notificar alertas Alfa');
      return {
        success: false,
        message: 'No hay email válido para notificar alertas',
      };
    }

    const t = getEmailText(datosAlertas);
    const moduloNorm = String(datosAlertas.modulo || 'alfa').toLowerCase().trim();
    const esAlfa = moduloNorm === 'alfa';
    const tituloSistema = esAlfa
      ? t.alertsSystemAlfa || 'Sistema de Alertas Seguros Alfa'
      : fillEmailTemplate(t.alertsSystemNamed || 'Sistema de Alertas {nombre}', {
          nombre: datosAlertas.aseguradora || datosAlertas.modulo || 'ARNALD',
        });
    const enlacePanel =
      datosAlertas.enlacePanelOverride || `${resolveFrontendUrl()}/seguros-alfa/reporte`;
    const subjectTipo = esAlfa
      ? t.subjectAlertasAlfa || 'SEGUROS ALFA'
      : String(datosAlertas.aseguradora || datosAlertas.modulo || 'ARNALD').toUpperCase();
    const etiquetaConteoAlertas = t.inactivityAlerts || t.ansAlerts || 'Alertas';
    const etiquetaPlazo = t.inactivityDeadline || t.ansDeadline || 'Plazo:';

    const { attachments, enlacesHtml, totalAdjuntos, totalSoloEnlace } =
      await prepararAdjuntosArchivosConRuta(datosAlertas.archivosConRuta || []);

    const contenidoAlertas = (datosAlertas.alertas?.casos || []).map((caso) => {
      const alertasHTML = (caso.alertas || [])
        .map(
          (alerta) => `
        <div style="margin: 10px 0; padding: 15px; border-left: 4px solid ${
          alerta.prioridad === 'ALTA' ? '#dc2626' : '#ea580c'
        }; background-color: ${
          alerta.prioridad === 'ALTA' ? '#fef2f2' : '#fff7ed'
        }; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: bold; color: ${
              alerta.prioridad === 'ALTA' ? '#dc2626' : '#ea580c'
            };">${alerta.mensaje}</span>
            <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background-color: ${
              alerta.prioridad === 'ALTA' ? '#fecaca' : '#fed7aa'
            }; color: ${alerta.prioridad === 'ALTA' ? '#dc2626' : '#ea580c'};">${alerta.prioridad}</span>
          </div>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">
            <strong>${t.actionRequired}</strong> ${alerta.accion || t.reviewCaseArnald}
          </p>
          ${alerta.etiquetaLimite ? `<p style="margin: 6px 0 0 0; color: #9ca3af; font-size: 12px;">${etiquetaPlazo} ${alerta.etiquetaLimite}</p>` : ''}
        </div>`
        )
        .join('');

      return `
        <div style="margin: 20px 0; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
          <h3 style="margin: 0 0 15px 0; color: #1f2937; font-size: 18px;">
            🚨 ${t.caseLabel} ${caso.numeroAjuste || caso.consecutivo || 'N/A'}
          </h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; font-size: 14px;">
            <div>
              <strong>${t.claimLabel}</strong> ${caso.numeroSiniestro || 'N/A'}<br>
              <strong>${t.insurerLabel}</strong> ${caso.aseguradora || 'Seguros Alfa'}<br>
              <strong>${t.insuredLabel}</strong> ${caso.asegurado || 'N/A'}${
                caso.identificacion
                  ? `<br><strong>${t.identificationLabel}</strong> ${caso.identificacion}`
                  : ''
              }${
                caso.tomador &&
                String(caso.tomador).trim() &&
                String(caso.tomador).trim() !== String(caso.asegurado || '').trim()
                  ? `<br><strong>${t.policyholderLabel}</strong> ${caso.tomador}`
                  : ''
              }
            </div>
            <div>
              <strong>${t.statusLabel}</strong> ${caso.estado || 'N/A'}<br>
              <strong>${t.totalAlerts}</strong> ${caso.totalAlertas}
            </div>
          </div>
          ${alertasHTML}
          ${
            caso.inactividad
              ? `
            <div style="margin-top: 15px; padding: 15px; background-color: #f3f4f6; border-radius: 8px;">
              <span style="font-size: 14px; color: #374151;">
                <strong>${t.lastActivity}</strong> ${caso.inactividad.actividad}
                ${caso.inactividad.dias != null ? ` ${fillEmailTemplate(t.daysAgo, { dias: caso.inactividad.dias })}` : ''}
              </span>
            </div>`
              : ''
          }
        </div>`;
    }).join('');

    const seccionArchivos =
      totalAdjuntos || totalSoloEnlace
        ? `
            <div style="background-color:#fef3c7; padding:15px; border-radius:8px; border-left:4px solid #f59e0b; margin:25px 0;">
              <h3 style="margin:0 0 10px 0; color:#92400e;">${t.uploadedFiles || 'Archivos del archivero'}</h3>
              ${
                totalAdjuntos
                  ? `<p style="margin:0 0 8px 0; color:#92400e; font-size:13px;">📎 ${totalAdjuntos} archivo(s) adjunto(s) a este correo.</p>`
                  : ''
              }
              ${
                totalSoloEnlace
                  ? `<p style="margin:0 0 8px 0; color:#78350f; font-size:13px;">Algunos archivos superan el tope de adjuntos; descárgalos aquí:</p>
                     <ul style="margin:0; padding-left:20px; color:#78350f;">${enlacesHtml}</ul>`
                  : ''
              }
            </div>`
        : '';

    const mailOptions = {
      from: `"Grupo Proser - Sistema de Alertas" <${process.env.EMAIL_USER}>`,
      to: datosAlertas.emailResponsable,
      subject: getEmailSubject(datosAlertas, 'subjectAlertas', {
        tipo: subjectTipo,
        count: datosAlertas.alertas.casosConAlertas,
      }),
      attachments,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #dc2626; margin: 0; font-size: 28px;">🚨 ${tituloSistema}</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">${t.autoNotifications}</p>
            </div>

            <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #dc2626;">
              <h2 style="color: #dc2626; margin: 0 0 15px 0; font-size: 20px;">⚠️ ${t.alertsSummary}</h2>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.totalCasos}</div>
                  <div style="font-size: 12px; color: #6b7280;">${t.totalCases}</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #ea580c;">${datosAlertas.alertas.casosConAlertas}</div>
                  <div style="font-size: 12px; color: #6b7280;">${t.withAlerts}</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.resumen?.documentosObligatorios ?? 0}</div>
                  <div style="font-size: 12px; color: #6b7280;">${etiquetaConteoAlertas}</div>
                </div>
                <div style="text-align: center;">
                  <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${datosAlertas.alertas.resumen?.casosCriticos ?? 0}</div>
                  <div style="font-size: 12px; color: #6b7280;">${t.criticalCases}</div>
                </div>
              </div>
            </div>

            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">👤 ${t.recipientTitle}</h3>
              <p style="margin: 0; color: #0c4a6e;">
                <strong>${t.responsibleLabel}</strong> ${datosAlertas.nombreResponsable}<br>
                <strong>${t.notificationDate}</strong> ${datosAlertas.fechaAsignacion}
              </p>
            </div>

            <div style="margin-bottom: 25px;">
              <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">📋 ${t.alertsDetailByCase}</h3>
              ${contenidoAlertas}
            </div>

            ${seccionArchivos}

            <div style="background-color:#fef2f2; padding:18px; border-radius:8px; border-left:4px solid #dc2626; margin:25px 0; text-align:center;">
              <a href="${enlacePanel}"
                 style="display:inline-block; background-color:#dc2626; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:8px; font-weight:700; font-size:14px;">
                ${fillEmailTemplate(t.openAlertsPanel, { modulo: 'Seguros Alfa' })}
              </a>
            </div>

            <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #059669; margin: 0 0 15px 0; font-size: 16px;">💡 ${t.recommendations}</h3>
              <ul style="margin: 0; padding-left: 20px; color: #065f46;">
                <li>${t.recHighFirst} <strong>${t.priorityHigh}</strong></li>
                <li>${t.recAlfa || 'Sube documentos pendientes y actualiza el estado del caso Alfa'}</li>
                <li>${t.recInactive}</li>
                <li>${t.recSupport}</li>
              </ul>
            </div>

            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                ${t.footerAlerts}<br>
                ${t.footerNoReply}
              </p>
            </div>
          </div>
        </div>
      `,
    };

    const info = await deliverMail(mailOptions, { tipo: 'emailService' });
    console.log('✅ Email de alertas Alfa enviado:', info.messageId);

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
      adjuntos: totalAdjuntos,
      enlaces: totalSoloEnlace,
    };
  } catch (error) {
    console.error('❌ Error enviando email de alertas Alfa:', error);
    throw new Error(`Error enviando email de alertas Alfa: ${error.message}`);
  }
};

/** Alertas Zurich: reutiliza el layout de Alfa con panel Zurich. */
export const enviarEmailAlertasZurich = async (datosAlertas) => {
  const adaptado = {
    ...datosAlertas,
    // El cuerpo Alfa usa textos/enlace de Alfa; forzamos branding Zurich vía locale keys si existen
  };
  try {
    console.log('📧 Iniciando envío de email de alertas Zurich...');
    if (!adaptado.emailResponsable) {
      return {
        success: false,
        message: 'No hay email válido para notificar alertas',
      };
    }
    // Reusa pipeline Alfa (adjuntos + HTML) cambiando el módulo en datos
    return await enviarEmailAlertasAlfa({
      ...adaptado,
      modulo: 'Zurich',
      aseguradora: adaptado.aseguradora || 'Zurich',
    });
  } catch (error) {
    console.error('❌ Error enviando email de alertas Zurich:', error);
    throw new Error(`Error enviando email de alertas Zurich: ${error.message}`);
  }
};

/** Alertas BBVA CAT: reutiliza el layout de Alfa con panel BBVA CAT. */
export const enviarEmailAlertasBbvaCat = async (datosAlertas) => {
  const adaptado = {
    ...datosAlertas,
  };
  try {
    console.log('📧 Iniciando envío de email de alertas BBVA CAT...');
    if (!adaptado.emailResponsable) {
      return {
        success: false,
        message: 'No hay email válido para notificar alertas',
      };
    }
    return await enviarEmailAlertasAlfa({
      ...adaptado,
      modulo: 'BBVA CAT',
      aseguradora: adaptado.aseguradora || 'BBVA CAT',
      enlacePanelOverride: `${resolveFrontendUrl()}/bbva-cat/reporte`,
    });
  } catch (error) {
    console.error('❌ Error enviando email de alertas BBVA CAT:', error);
    throw new Error(`Error enviando email de alertas BBVA CAT: ${error.message}`);
  }
};

/** Alertas Allianz: reutiliza el layout de Alfa con panel Allianz. */
export const enviarEmailAlertasAllianz = async (datosAlertas) => {
  const adaptado = {
    ...datosAlertas,
  };
  try {
    console.log('📧 Iniciando envío de email de alertas Allianz...');
    if (!adaptado.emailResponsable) {
      return {
        success: false,
        message: 'No hay email válido para notificar alertas',
      };
    }
    return await enviarEmailAlertasAlfa({
      ...adaptado,
      modulo: 'Allianz',
      aseguradora: adaptado.aseguradora || 'Allianz',
      enlacePanelOverride: `${resolveFrontendUrl()}/allianz/reporte`,
    });
  } catch (error) {
    console.error('❌ Error enviando email de alertas Allianz:', error);
    throw new Error(`Error enviando email de alertas Allianz: ${error.message}`);
  }
};

/** Alertas Previsora: reutiliza el layout de Alfa con panel Previsora. */
export const enviarEmailAlertasPrevisora = async (datosAlertas) => {
  const adaptado = {
    ...datosAlertas,
  };
  try {
    console.log('📧 Iniciando envío de email de alertas Previsora...');
    if (!adaptado.emailResponsable) {
      return {
        success: false,
        message: 'No hay email válido para notificar alertas',
      };
    }
    return await enviarEmailAlertasAlfa({
      ...adaptado,
      modulo: 'Previsora',
      aseguradora: adaptado.aseguradora || 'Previsora',
      enlacePanelOverride: `${resolveFrontendUrl()}/previsora/reporte`,
    });
  } catch (error) {
    console.error('❌ Error enviando email de alertas Previsora:', error);
    throw new Error(`Error enviando email de alertas Previsora: ${error.message}`);
  }
};

/** Alertas Sura: reutiliza el layout de Alfa con panel Sura. */
export const enviarEmailAlertasSura = async (datosAlertas) => {
  const adaptado = {
    ...datosAlertas,
  };
  try {
    console.log('📧 Iniciando envío de email de alertas Sura...');
    if (!adaptado.emailResponsable) {
      return {
        success: false,
        message: 'No hay email válido para notificar alertas',
      };
    }
    return await enviarEmailAlertasAlfa({
      ...adaptado,
      modulo: 'Sura',
      aseguradora: adaptado.aseguradora || 'Sura',
      enlacePanelOverride: `${resolveFrontendUrl()}/sura/reporte`,
    });
  } catch (error) {
    console.error('❌ Error enviando email de alertas Sura:', error);
    throw new Error(`Error enviando email de alertas Sura: ${error.message}`);
  }
};

// Función para enviar email al funcionario de la aseguradora
export const enviarNotificacionAseguradora = async (datosCaso) => {
  try {
    console.log('📧 Iniciando envío de notificación a aseguradora...');
    console.log('📧 Datos del caso:', JSON.stringify(datosCaso, null, 2));
    
    // Callers deben pasar datosCaso.locale ('es'|'en').
    const t = getEmailText(datosCaso);
    
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: datosCaso.emailFuncionarioAseguradora,
      subject: getEmailSubject(datosCaso, 'subjectCasosAsignados'),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2563eb; margin: 0; font-size: 24px;">📋 ${t.caseAssignedTitle}</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">${t.caseMgmtSubtitle}</p>
            </div>
            
            <div style="background-color: #dbeafe; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">📊 ${t.caseInfo}</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔢 ${t.adjustmentNumberEmoji}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroCaso}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📊 ${t.claimNumber}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroSiniestro || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔧 ${t.workflowCode}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.codigoWorkflow || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏢 ${t.insurer}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.aseguradora || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👥 ${t.insured}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.asegurado || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 ${t.assignmentDate}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.fechaAsignacion || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📋 ${t.policyNumber}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroPoliza || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏙️ ${t.claimCity}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.ciudadSiniestro || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📝 ${t.description}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.descripcionSiniestro || t.notSpecifiedF}</td>
                </tr>
              </table>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">👤 ${t.assignedResponsibleTitle}</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.name}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.nombreResponsable || t.unassigned}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.email}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.emailResponsable || t.notAvailable}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">${t.phone}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.telefonoResponsable || t.notAvailable}</td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                ${t.footerAuto}<br>
                ${t.footerNoReply}
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
    // Callers deben pasar datosCaso.locale ('es'|'en').
    const t = getEmailText(datosCaso);
    const dateLocale = normalizeEmailLocale(datosCaso) === 'en' ? 'en-US' : 'es-CO';
    
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: datosCaso.emailCreador,
      subject: getEmailSubject(datosCaso, 'subjectCasoCreado', { numero: datosCaso.numeroCaso }),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #059669; margin: 0; font-size: 24px;">✅ ${t.createdCaseTitle}</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">${t.caseMgmtSubtitle}</p>
            </div>
            
            <div style="background-color: #d1fae5; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #065f46; margin: 0 0 15px 0; font-size: 18px;">📊 ${t.createdCaseInfo}</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔢 ${datosCaso.tipoCaso === 'riesgo' ? t.riskNumber : t.adjustmentNumberEmoji}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroCaso}</td>
                </tr>
                ${datosCaso.numeroSiniestro ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📊 ${t.claimNumber}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroSiniestro}</td>
                </tr>
                ` : ''}
                ${datosCaso.codigoWorkflow ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🔧 ${t.workflowCode}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.codigoWorkflow}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👤 ${t.assignedResponsible}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.nombreResponsable || t.unassigned}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🏢 ${t.insurer}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.aseguradora || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👥 ${t.insured}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.asegurado || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 ${t.creationDate}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${new Date().toLocaleDateString(dateLocale)}</td>
                </tr>
                ${datosCaso.numeroPoliza ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📋 ${t.policyNumber}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosCaso.numeroPoliza}</td>
                </tr>
                ` : ''}
              </table>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #0369a1; margin: 0 0 15px 0; font-size: 16px;">📧 ${t.notificationsSent}</h3>
              <p style="color: #0c4a6e; margin: 0; line-height: 1.6;">
                ${t.notificationsSentBody}
              </p>
              <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #0c4a6e;">
                <li>✅ ${t.youCreator}</li>
                <li>✅ ${datosCaso.nombreResponsable || t.assignedResponsibleItem}</li>
                ${datosCaso.funcionarioAseguradora ? `<li>✅ ${t.insurerOfficerItem}</li>` : ''}
              </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                ${t.footerAuto}<br>
                ${t.footerNoReply}
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
    // Callers deben pasar datos.locale ('es'|'en').
    const t = getEmailText(datos);

    const htmlArchivos = tieneArchivos
      ? (archivosConEnlaces || archivos)
      : '';

    const htmlResumenControlHoras = resumen
      ? `
            <div style="background-color:#ecfdf5; padding:15px; border-radius:8px; border-left:4px solid #10b981; margin:20px 0;">
              <h3 style="margin:0 0 10px 0; color:#065f46;">${t.hoursRegisteredTitle}</h3>
              <table style="width:100%; border-collapse:collapse;">
                <tr><td style="padding:4px 0; font-weight:bold; color:#047857;">${t.totalHours}</td><td style="padding:4px 0; color:#064e3b;">${Number(resumen.total_horas || 0).toFixed(2)}</td></tr>
                ${resumen.valor_hora ? `<tr><td style="padding:4px 0; font-weight:bold; color:#047857;">${t.hourlyRate}</td><td style="padding:4px 0; color:#064e3b;">$${Number(resumen.valor_hora).toLocaleString('es-CO')}</td></tr>` : ''}
                ${resumen.subtotal_honorarios != null ? `<tr><td style="padding:4px 0; font-weight:bold; color:#047857;">${t.fees}</td><td style="padding:4px 0; color:#064e3b;">$${Number(resumen.subtotal_honorarios).toLocaleString('es-CO')}</td></tr>` : ''}
                ${resumen.total != null ? `<tr><td style="padding:4px 0; font-weight:bold; color:#047857;">${t.settlementTotal}</td><td style="padding:4px 0; color:#064e3b;">$${Number(resumen.total).toLocaleString('es-CO')}</td></tr>` : ''}
              </table>
              <p style="margin:10px 0 0 0; color:#065f46; font-size:13px;">${t.hoursDetailsInPlatform}</p>
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
              <h3 style="margin:0 0 10px 0; color:#92400e;">${t.uploadedFiles}</h3>
              <ul style="margin:0; padding-left:20px; color:#78350f;">
                ${htmlArchivos}
              </ul>
              ${attachments.length > 0 ? `<p style="margin:10px 0 0 0; color:#92400e; font-size:13px; font-weight:500;">📎 ${t.filesAlsoAttached}</p>` : ''}
            </div>`
      : '';

    // Construir URL del frontend para el enlace directo al caso
    // IMPORTANTE: Para correos, siempre usar URL accesible (producción o FRONTEND_URL configurado)
    // No usar localhost porque los usuarios no pueden acceder desde sus máquinas
    let frontendUrl = resolveFrontendUrl();
    
    console.log('🔗 [Enlace Caso] casoId recibido:', datos.casoId);
    console.log('🔗 [Enlace Caso] numeroCaso:', datos.numeroCaso);
    console.log('🔗 [Enlace Caso] frontendUrl:', frontendUrl);
    console.log('🔗 [Enlace Caso] NODE_ENV:', process.env.NODE_ENV);
    
    // Construir URL del caso - usar ID si está disponible, sino usar número de caso para búsqueda
    let urlCaso = null;
    let textoEnlace = t.viewCases;
    
    if (datos.casoId) {
      // Si tenemos el ID, usar ruta directa
      urlCaso = `${frontendUrl}/editar-caso/${datos.casoId}`;
      textoEnlace = !isMissingCaseNumber(datos.numeroCaso)
        ? fillEmailTemplate(t.viewCaseNum, { numero: datos.numeroCaso })
        : t.viewCase;
      console.log('✅ [Enlace Caso] URL construida con ID:', urlCaso);
    } else if (!isMissingCaseNumber(datos.numeroCaso)) {
      // Si no hay ID pero hay número de caso, usar ruta de búsqueda
      urlCaso = `${frontendUrl}/complex/excel?buscar=${encodeURIComponent(datos.numeroCaso)}`;
      textoEnlace = fillEmailTemplate(t.searchCaseNum, { numero: datos.numeroCaso });
      console.log('✅ [Enlace Caso] URL construida con número de caso:', urlCaso);
    } else {
      // Si no hay ID ni número de caso, mostrar enlace genérico a la lista de casos
      urlCaso = `${frontendUrl}/complex/excel`;
      textoEnlace = t.viewCasesComplex;
      console.log('✅ [Enlace Caso] URL construida genérica (sin ID ni número):', urlCaso);
    }
    
    // HTML del enlace directo - SIEMPRE mostrar el enlace
    const htmlEnlaceCaso = `
      <div style="background-color:#dbeafe; padding:20px; border-radius:8px; border-left:4px solid #2563eb; margin:25px 0; text-align:center;">
        <p style="margin:0 0 15px 0; color:#1e40af; font-weight:600; font-size:16px;">🔗 ${t.directAccess}</p>
        <a href="${urlCaso}" 
           style="display:inline-block; background-color:#2563eb; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:600; font-size:14px;">
          ${textoEnlace}
        </a>
        <p style="margin:15px 0 0 0; color:#1e3a8a; font-size:12px;">${datos.casoId ? t.clickToAccessDirect : t.clickToAccessPlatform}</p>
      </div>
    `;
    
    console.log('📧 [Enlace Caso] HTML generado: SÍ');
    console.log('📧 [Enlace Caso] URL final:', urlCaso);

    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: emails[0],
      subject: tieneArchivos
        ? getEmailSubject(datos, 'subjectControlHorasDoc', { numero: datos.numeroCaso || t.noNumberLower })
        : getEmailSubject(datos, 'subjectControlHorasReg', { numero: datos.numeroCaso || t.noNumberLower }),
      attachments: attachments.length > 0 ? attachments : undefined, // Adjuntar archivos si existen
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">
            <h2 style="color: #1f2937; margin-top: 0; text-align:center;">⏰ ${tieneArchivos ? t.hoursDocReceived : t.hoursRegisteredTitle}</h2>
            <p style="color: #4b5563;">${tieneArchivos
              ? t.hoursDocBody
              : t.hoursRegisteredBody}</p>
            <table style="width:100%; border-collapse:collapse; margin:20px 0;">
              <tr>
                <td style="padding:8px 0; font-weight:bold; color:#111827;">${t.caseNumber}</td>
                <td style="padding:8px 0; color:#1f2937;">${datos.numeroCaso || t.notSpecified}</td>
              </tr>
              ${datos.numeroSiniestro ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.claimNumber}</td><td style="padding:8px 0; color:#1f2937;">${datos.numeroSiniestro}</td></tr>` : ''}
              ${datos.responsable ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.responsibleLabel}</td><td style="padding:8px 0; color:#1f2937;">${datos.responsable}</td></tr>` : ''}
              ${datos.usuario ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.uploadedBy}</td><td style="padding:8px 0; color:#1f2937;">${datos.usuario}</td></tr>` : ''}
            </table>
            ${htmlResumenControlHoras}
            ${htmlSeccionArchivos}
            ${htmlEnlaceCaso}
            <p style="color:#6b7280; font-size:12px; margin-top:25px; text-align:center;">
              ${t.footerAuto}
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

/**
 * Avisa al ajustador (responsable del caso) que debe corregir el control de horas
 * desde ARNALD o reemplazar el archivo adjunto.
 */
export const enviarSolicitudCorreccionControlHoras = async (datos) => {
  try {
    const emailDestino = String(datos.emailDestino || '').trim();
    if (!emailDestino || !emailDestino.includes('@')) {
      return { success: false, message: 'No se encontró correo del ajustador' };
    }

    const numeroCaso = datos.numeroCaso || datos.nmroAjste || getEmailText(datos).noNumber;
    const numeroSiniestro = datos.numeroSiniestro || datos.nmroSinstro || 'N/A';
    const nombreAjustador = datos.nombreAjustador || datos.responsable || 'Ajustador';
    const mensaje =
      String(datos.mensaje || '').trim() ||
      'Se detectó un error en el control de horas. Por favor corríjalo.';
    const solicitadoPor = datos.solicitadoPorNombre || datos.solicitadoPor || 'Gerencia / Facturación';
    const frontendUrl = resolveFrontendUrl();
    const enlaceCaso = datos.casoId
      ? `${frontendUrl}/editar-caso/${datos.casoId}`
      : frontendUrl;
    // Callers deben pasar datos.locale ('es'|'en').
    const t = getEmailText(datos);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">
        <div style="background:#DC2626; color:#fff; padding:16px 20px; border-radius:8px 8px 0 0;">
          <h2 style="margin:0; font-size:18px;">${t.correctionHoursTitle}</h2>
        </div>
        <div style="border:1px solid #e5e7eb; border-top:none; padding:20px; border-radius:0 0 8px 8px;">
          <p>${t.hello} <strong>${nombreAjustador}</strong>,</p>
          <p>
            ${t.correctionHoursBody}
            <strong>${numeroCaso}</strong> ${t.claimParen} <strong>${numeroSiniestro}</strong>).
          </p>
          <div style="background:#fff7ed; border-left:4px solid #f59e0b; padding:12px 14px; margin:16px 0;">
            <p style="margin:0 0 6px; font-weight:bold;">${t.observationLabel}</p>
            <p style="margin:0; white-space:pre-wrap;">${mensaje.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </div>
          <p style="margin-bottom:8px;"><strong>${t.whatToDo}</strong></p>
          <ol style="margin-top:0; padding-left:20px;">
            <li>${t.correctionStep1}</li>
            <li>${t.correctionStep2}</li>
          </ol>
          <p style="margin:20px 0;">
            <a href="${enlaceCaso}"
               style="display:inline-block; background:#DC2626; color:#fff; text-decoration:none; padding:10px 16px; border-radius:6px; font-weight:600;">
              ${t.openCaseArnald}
            </a>
          </p>
          <p style="font-size:12px; color:#6b7280; margin-top:24px;">
            ${t.requestedBy} ${solicitadoPor}
          </p>
        </div>
      </div>
    `;

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: emailDestino,
      subject: getEmailSubject(datos, 'subjectCorreccionHoras', { numero: numeroCaso }),
      html,
    };

    const info = await deliverMail(mailOptions, {
      tipo: 'correccion_control_horas',
      casoId: datos.casoId,
    });

    return {
      success: true,
      messageId: info.messageId,
      destinatarioPrincipal: emailDestino,
    };
  } catch (error) {
    console.error('❌ Error enviando solicitud de corrección de control de horas:', error);
    throw new Error(`Error enviando solicitud de corrección: ${error.message}`);
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

    // Callers deben pasar datos.locale ('es'|'en').
    const t = getEmailText(datos);

    // Construir URL del frontend para el enlace directo al caso
    // IMPORTANTE: Para correos, siempre usar URL accesible (producción o FRONTEND_URL configurado)
    // No usar localhost porque los usuarios no pueden acceder desde sus máquinas
    let frontendUrl = resolveFrontendUrl();
    
    console.log('🔗 [Enlace Caso Gerencia] frontendUrl:', frontendUrl);
    console.log('🔗 [Enlace Caso Gerencia] NODE_ENV:', process.env.NODE_ENV);
    
    let urlCaso = null;
    let textoEnlace = t.viewCases;
    
    if (datos.casoId) {
      urlCaso = `${frontendUrl}/editar-caso/${datos.casoId}`;
      textoEnlace = !isMissingCaseNumber(datos.numeroCaso)
        ? fillEmailTemplate(t.viewCaseNum, { numero: datos.numeroCaso })
        : t.viewCase;
    } else if (!isMissingCaseNumber(datos.numeroCaso)) {
      urlCaso = `${frontendUrl}/complex/excel?buscar=${encodeURIComponent(datos.numeroCaso)}`;
      textoEnlace = fillEmailTemplate(t.searchCaseNum, { numero: datos.numeroCaso });
    } else {
      urlCaso = `${frontendUrl}/complex/excel`;
      textoEnlace = t.viewCasesComplex;
    }
    
    const htmlEnlaceCaso = `
      <div style="background-color:#dbeafe; padding:20px; border-radius:8px; border-left:4px solid #2563eb; margin:25px 0; text-align:center;">
        <p style="margin:0 0 15px 0; color:#1e40af; font-weight:600; font-size:16px;">🔗 ${t.directAccess}</p>
        <a href="${urlCaso}" 
           style="display:inline-block; background-color:#2563eb; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:600; font-size:14px;">
          ${textoEnlace}
        </a>
        <p style="margin:15px 0 0 0; color:#1e3a8a; font-size:12px;">${datos.casoId ? t.clickToAccessDirect : t.clickToAccessPlatform}</p>
      </div>
    `;

    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: emails[0],
      subject: getEmailSubject(datos, 'subjectGerencia', { numero: datos.numeroCaso || t.noNumberLower }),
      attachments: attachments.length > 0 ? attachments : undefined,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">
            <h2 style="color: #1f2937; margin-top: 0; text-align:center;">👔 ${t.gerenciaReceived}</h2>
            <p style="color: #4b5563;">${t.gerenciaBody}</p>
            <table style="width:100%; border-collapse:collapse; margin:20px 0;">
              <tr>
                <td style="padding:8px 0; font-weight:bold; color:#111827;">${t.caseNumber}</td>
                <td style="padding:8px 0; color:#1f2937;">${datos.numeroCaso || t.notSpecified}</td>
              </tr>
              ${datos.numeroSiniestro ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.claimNumber}</td><td style="padding:8px 0; color:#1f2937;">${datos.numeroSiniestro}</td></tr>` : ''}
              ${datos.responsable ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.responsibleLabel}</td><td style="padding:8px 0; color:#1f2937;">${datos.responsable}</td></tr>` : ''}
              ${datos.usuario ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.uploadedBy}</td><td style="padding:8px 0; color:#1f2937;">${datos.usuario}</td></tr>` : ''}
            </table>
            <div style="background-color:#fef3c7; padding:15px; border-radius:8px; border-left:4px solid #f59e0b;">
              <h3 style="margin:0 0 10px 0; color:#92400e;">${t.uploadedFiles}</h3>
              <ul style="margin:0; padding-left:20px; color:#78350f;">
                ${htmlArchivos}
              </ul>
              ${attachments.length > 0 ? `<p style="margin:10px 0 0 0; color:#92400e; font-size:13px; font-weight:500;">📎 ${t.filesAlsoAttached}</p>` : ''}
            </div>
            ${htmlEnlaceCaso}
            <p style="color:#6b7280; font-size:12px; margin-top:25px; text-align:center;">
              ${t.footerAuto}
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

    // Callers deben pasar datos.locale ('es'|'en').
    const t = getEmailText(datos);
    const archivos = (datos.archivos || []).map(nombre => `<li style="margin-bottom:4px;">📎 ${nombre}</li>`).join('');
    const htmlArchivos = archivos || `<li>${t.noFileNames}</li>`;

    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: emails.join(', '),
      subject: getEmailSubject(datos, 'subjectHonorarios', { numero: datos.numeroCaso || t.noNumberLower }),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">
            <h2 style="color: #1f2937; margin-top: 0; text-align:center;">📎 ${t.honorariosReceived}</h2>
            <p style="color: #4b5563;">${t.honorariosBody}</p>
            <table style="width:100%; border-collapse:collapse; margin:20px 0;">
              <tr>
                <td style="padding:8px 0; font-weight:bold; color:#111827;">${t.caseNumber}</td>
                <td style="padding:8px 0; color:#1f2937;">${datos.numeroCaso || t.notSpecified}</td>
              </tr>
              ${datos.numeroSiniestro ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.claimNumber}</td><td style="padding:8px 0; color:#1f2937;">${datos.numeroSiniestro}</td></tr>` : ''}
              ${datos.responsable ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.responsibleLabel}</td><td style="padding:8px 0; color:#1f2937;">${datos.responsable}</td></tr>` : ''}
              ${datos.usuario ? `<tr><td style="padding:8px 0; font-weight:bold; color:#111827;">${t.uploadedBy}</td><td style="padding:8px 0; color:#1f2937;">${datos.usuario}</td></tr>` : ''}
            </table>
            <div style="background-color:#f0f9ff; padding:15px; border-radius:8px;">
              <h3 style="margin:0 0 10px 0; color:#0c4a6e;">${t.uploadedFiles}</h3>
              <ul style="margin:0; padding-left:20px; color:#0f172a;">
                ${htmlArchivos}
              </ul>
            </div>
            <p style="color:#6b7280; font-size:12px; margin-top:25px; text-align:center;">
              ${t.footerAuto}
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
    
    
    const t = getEmailText({});
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Casos" <${process.env.EMAIL_USER}>`,
      to: emailDestino || 'danalyst@proserpuertos.com.co',
      subject: getEmailSubject({}, 'subjectEmailPrueba'),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">🧪 ${t.testEmailTitle}</h2>
          <p>${t.testEmailBody}</p>
          <p><strong>${t.dateLabel}</strong> ${new Date().toLocaleString()}</p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
            ${t.footerTest}
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

    // Callers deben pasar datosTarea.locale ('es'|'en').
    const t = getEmailText(datosTarea);
    
           // Determinar el tipo de alerta y el color
           const tiposAlerta = {
             'NUEVA_TAREA': {
               titulo: `📋 ${t.taskNueva}`,
               color: '#2563eb',
               icono: '📋'
             },
             'TAREA_ACTUALIZADA': {
               titulo: `✏️ ${t.taskActualizada}`,
               color: '#ea580c',
               icono: '✏️'
             },
             'TAREA_COMPLETADA': {
               titulo: `✅ ${t.taskCompletada}`,
               color: '#059669',
               icono: '✅'
             },
             'TAREA_REABIERTA': {
               titulo: `🔄 ${t.taskReabierta}`,
               color: '#dc2626',
               icono: '🔄'
             },
             'TAREA_ELIMINADA': {
               titulo: `🗑️ ${t.taskEliminada}`,
               color: '#6b7280',
               icono: '🗑️'
             },
             'ALERTA_DIARIA': {
               titulo: `⏰ ${t.taskAlertaDiaria}`,
               color: '#f59e0b',
               icono: '⏰'
             },
             'ALERTA_FINAL': {
               titulo: `⚠️ ${t.taskAlertaFinal}`,
               color: '#dc2626',
               icono: '⚠️'
             }
           };
    
    const tipoInfo = tiposAlerta[datosTarea.tipoAlerta] || tiposAlerta['NUEVA_TAREA'];
    
    const mailOptions = {
      from: `"Grupo Proser - Sistema de Tareas" <${process.env.EMAIL_USER}>`,
      to: datosTarea.emailResponsable,
      subject: getEmailSubject(datosTarea, 'subjectAlertaTarea', {
        icono: tipoInfo.icono,
        titulo: tipoInfo.titulo.replace(/^[^\s]+\s/, ''),
        texto: datosTarea.tarea?.texto?.substring(0, 50) || t.taskFallback,
      }),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: ${tipoInfo.color}; margin: 0; font-size: 24px;">${tipoInfo.icono} ${tipoInfo.titulo.replace(/^[^\s]+\s/, '')}</h1>
              <p style="color: #6b7280; margin: 10px 0 0 0;">${t.taskSystemSubtitle}</p>
            </div>
            
            <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #0369a1; margin: 0 0 15px 0; font-size: 18px;">📋 ${t.taskInfo}</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📝 ${t.taskDescription}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosTarea.tarea?.texto || t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📅 ${t.deadline}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosTarea.tarea?.fecha ? new Date(datosTarea.tarea.fecha).toLocaleDateString() : t.notSpecifiedF}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">⚡ ${t.priority}</td>
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
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">✅ ${t.status}</td>
                  <td style="padding: 8px 0; color: #1f2937;">
                    <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background-color: ${
                      datosTarea.tarea?.cumplida ? '#d1fae5' : '#fef2f2'
                    }; color: ${
                      datosTarea.tarea?.cumplida ? '#059669' : '#dc2626'
                    };">${datosTarea.tarea?.cumplida ? t.completed : t.pending}</span>
                  </td>
                </tr>
                ${datosTarea.tarea?.fechaCumplimiento ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">🎯 ${t.completedDate}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${new Date(datosTarea.tarea.fechaCumplimiento).toLocaleString()}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">👤 ${t.assignedTo}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosTarea.nombreResponsable || t.notSpecified}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">📧 ${t.email}</td>
                  <td style="padding: 8px 0; color: #1f2937;">${datosTarea.emailResponsable}</td>
                </tr>
                ${datosTarea.tarea?.diasRestantes !== undefined ? `
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #374151;">⏰ ${t.daysRemaining}</td>
                  <td style="padding: 8px 0; color: #1f2937;">
                    <span style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; background-color: ${
                      datosTarea.tarea.diasRestantes <= 0 ? '#fecaca' : 
                      datosTarea.tarea.diasRestantes <= 1 ? '#fef3c7' : '#d1fae5'
                    }; color: ${
                      datosTarea.tarea.diasRestantes <= 0 ? '#dc2626' : 
                      datosTarea.tarea.diasRestantes <= 1 ? '#ca8a04' : '#059669'
                    };">${datosTarea.tarea.diasRestantes <= 0 ? t.overdue : `${datosTarea.tarea.diasRestantes} ${t.daysUnit}`}</span>
                  </td>
                </tr>
                ` : ''}
              </table>
            </div>
            
            ${datosTarea.tarea?.observaciones ? `
            <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">📝 ${t.observations}</h3>
              <p style="color: #78350f; margin: 0; line-height: 1.5;">${datosTarea.tarea.observaciones}</p>
            </div>
            ` : ''}
            
            <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
              <h3 style="color: #059669; margin: 0 0 15px 0; font-size: 16px;">💡 ${t.recommendedActions}</h3>
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
                ${t.footerTasks}<br>
                ${t.footerNoReply}
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

function formatearFechaCortaCorreo(fecha, datos = {}) {
  const t = getEmailText(datos);
  if (!fecha) return t.noDeadline;
  try {
    const locale = normalizeEmailLocale(datos) === 'en' ? 'en-US' : 'es-CO';
    return new Date(fecha).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return String(fecha);
  }
}

/**
 * URL del front para correos de subtareas: usa el origen desde el que se hizo la
 * acción (localhost en desarrollo, Arnald en producción); si no viene, resuelve
 * por configuración del servidor.
 */
function frontendUrlSubtareas(datos = {}) {
  const directo = String(datos.frontendUrl || '').trim().replace(/\/+$/, '');
  if (directo && /^https?:\/\//i.test(directo)) return directo;
  return resolveFrontendUrl();
}

/** Notifica a un ajustador interno que le asignaron una subtarea de un caso Complex. */
export const enviarNotificacionSubtareaInterna = async (datos = {}) => {
  const email = String(datos.emailDestino || '').trim();
  if (!email) {
    return { success: false, message: 'Sin email de destino' };
  }

  // Callers deben pasar datos.locale ('es'|'en').
  const t = getEmailText(datos);
  const frontendUrl = frontendUrlSubtareas(datos);
  const urlSubtarea = datos.subtareaId
    ? `${frontendUrl}/complex/mis-subtareas?abrir=${datos.subtareaId}`
    : `${frontendUrl}/complex/mis-subtareas`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: getEmailSubject(datos, 'subjectSubtareaInterna', {
      caso: datos.nmroAjste || t.caseFallback,
    }),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background:#f8f9fa; padding:20px;">
        <div style="background:#fff; padding:28px; border-radius:10px;">
          <h1 style="color:#1f2937; font-size:22px; margin:0 0 8px;">${t.subtaskInternalTitle}</h1>
          <p style="color:#6b7280; margin:0 0 20px;">${t.subtaskInternalIntro}</p>
          <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
            <tr><td style="padding:6px 0; color:#6b7280;">${t.caseCol}</td><td style="padding:6px 0; font-weight:bold;">${datos.nmroAjste || '—'}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.subtaskLabel}</td><td style="padding:6px 0; font-weight:bold;">${datos.titulo || '—'}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.assignedByCol}</td><td style="padding:6px 0;">${datos.creadoPorNombre || datos.creadoPorLogin || '—'}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.deadlineCol}</td><td style="padding:6px 0;">${formatearFechaCortaCorreo(datos.fechaLimite, datos)}</td></tr>
          </table>
          ${datos.descripcion ? `<p style="color:#374151;"><strong>${t.descriptionStrong}</strong><br>${datos.descripcion}</p>` : ''}
          ${datos.instrucciones ? `<p style="color:#374151;"><strong>${t.instructionsStrong}</strong><br>${datos.instrucciones}</p>` : ''}
          <div style="text-align:center; margin-top:28px;">
            <a href="${urlSubtarea}" style="display:inline-block; background:#c8102e; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:bold;">
              ${t.goToMySubtask}
            </a>
          </div>
        </div>
      </div>
    `,
  };

  const info = await deliverMail(mailOptions, { tipo: 'subtareaInterna' });
  return { success: true, messageId: info.messageId };
};

/** Envía enlace mágico a un ajustador externo para diligenciar una subtarea. */
export const enviarNotificacionSubtareaExterna = async (datos = {}) => {
  const email = String(datos.emailDestino || '').trim();
  const token = String(datos.token || '').trim();
  if (!email || !token) {
    return { success: false, message: 'Email o token faltante' };
  }

  // Callers deben pasar datos.locale ('es'|'en').
  const t = getEmailText(datos);
  const frontendUrl = frontendUrlSubtareas(datos);
  const urlPublica = `${frontendUrl}/complex/subtarea/${token}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: getEmailSubject(datos, 'subjectSubtareaExterna', {
      caso: datos.nmroAjste || 'Complex',
    }),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background:#f8f9fa; padding:20px;">
        <div style="background:#fff; padding:28px; border-radius:10px;">
          <h1 style="color:#1f2937; font-size:22px; margin:0 0 8px;">${t.supportTitle}</h1>
          <p style="color:#6b7280; margin:0 0 20px;">
            ${fillEmailTemplate(t.supportIntro, { nombre: datos.nombreDestino || t.adjusterFallback })}
          </p>
          <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
            <tr><td style="padding:6px 0; color:#6b7280;">${t.caseCol}</td><td style="padding:6px 0; font-weight:bold;">${datos.nmroAjste || '—'}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.taskLabel}</td><td style="padding:6px 0; font-weight:bold;">${datos.titulo || '—'}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.requestsCol}</td><td style="padding:6px 0;">${datos.creadoPorNombre || t.defaultRequester}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.deadlineCol}</td><td style="padding:6px 0;">${formatearFechaCortaCorreo(datos.fechaLimite, datos)}</td></tr>
          </table>
          ${datos.descripcion ? `<p style="color:#374151;"><strong>${t.descriptionStrong}</strong><br>${datos.descripcion}</p>` : ''}
          ${datos.instrucciones ? `<p style="color:#374151;"><strong>${t.whatToFill}</strong><br>${datos.instrucciones}</p>` : ''}
          <div style="text-align:center; margin-top:28px;">
            <a href="${urlPublica}" style="display:inline-block; background:#c8102e; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:bold;">
              ${t.openForm}
            </a>
          </div>
          <p style="color:#9ca3af; font-size:12px; margin-top:24px; text-align:center;">
            ${t.magicLinkNote}
          </p>
        </div>
      </div>
    `,
  };

  const info = await deliverMail(mailOptions, { tipo: 'subtareaExterna' });
  return { success: true, messageId: info.messageId, urlPublica };
};

/** Avisa al creador/responsable cuando el externo o interno completa la subtarea. */
export const enviarNotificacionSubtareaCompletada = async (datos = {}) => {
  const email = String(datos.emailDestino || '').trim();
  if (!email) {
    return { success: false, message: 'Sin email de destino' };
  }

  // Callers deben pasar datos.locale ('es'|'en').
  const t = getEmailText(datos);
  const frontendUrl = resolveFrontendUrl();
  const urlCaso = datos.casoId
    ? `${frontendUrl}/complex/excel`
    : frontendUrl;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: getEmailSubject(datos, 'subjectSubtareaCompletada', {
      caso: datos.nmroAjste || t.caseComplexFallback,
    }),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background:#f8f9fa; padding:20px;">
        <div style="background:#fff; padding:28px; border-radius:10px;">
          <h1 style="color:#059669; font-size:22px; margin:0 0 8px;">${t.subtaskCompletedTitle}</h1>
          <p style="color:#374151;">
            ${fillEmailTemplate(t.subtaskCompletedBody, {
              nombre: datos.nombreCompletoPor || t.assigneeFallback,
              titulo: datos.titulo || '',
              caso: datos.nmroAjste || '—',
            })}
          </p>
          ${datos.observacionesAsignado ? `<p style="color:#6b7280;"><strong>${t.observations}:</strong><br>${datos.observacionesAsignado}</p>` : ''}
          <div style="text-align:center; margin-top:24px;">
            <a href="${urlCaso}" style="display:inline-block; background:#111827; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:bold;">
              ${t.viewInCase}
            </a>
          </div>
        </div>
      </div>
    `,
  };

  const info = await deliverMail(mailOptions, { tipo: 'subtareaCompletada' });
  return { success: true, messageId: info.messageId };
};

/** Avisa al asignado que su subtarea fue reabierta, con el motivo del gestor. */
export const enviarNotificacionSubtareaReabierta = async (datos = {}) => {
  const email = String(datos.emailDestino || '').trim();
  if (!email) {
    return { success: false, message: 'Sin email de destino' };
  }

  // Callers deben pasar datos.locale ('es'|'en').
  const t = getEmailText(datos);
  const frontendUrl = frontendUrlSubtareas(datos);
  const urlSubtarea = datos.subtareaId
    ? `${frontendUrl}/complex/mis-subtareas?abrir=${datos.subtareaId}`
    : `${frontendUrl}/complex/mis-subtareas`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: getEmailSubject(datos, 'subjectSubtareaReabierta', {
      caso: datos.nmroAjste || t.caseComplexFallback,
    }),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background:#f8f9fa; padding:20px;">
        <div style="background:#fff; padding:28px; border-radius:10px;">
          <h1 style="color:#b45309; font-size:22px; margin:0 0 8px;">${t.subtaskReopenedTitle}</h1>
          <p style="color:#374151;">
            ${fillEmailTemplate(t.subtaskReopenedBody, {
              nombre: datos.reabiertaPorNombre || t.caseOwnerFallback,
              titulo: datos.titulo || '',
              caso: datos.nmroAjste || '—',
            })}
          </p>
          <div style="background:#fef3c7; border:1px solid #fcd34d; border-radius:8px; padding:14px 16px; margin:18px 0;">
            <p style="color:#92400e; margin:0; font-size:13px; font-weight:bold; text-transform:uppercase;">${t.reopenReason}</p>
            <p style="color:#78350f; margin:6px 0 0; white-space:pre-wrap;">${datos.motivo || '—'}</p>
          </div>
          <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
            <tr><td style="padding:6px 0; color:#6b7280;">${t.caseCol}</td><td style="padding:6px 0; font-weight:bold;">${datos.nmroAjste || '—'}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.subtaskLabel}</td><td style="padding:6px 0; font-weight:bold;">${datos.titulo || '—'}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.reopenedByCol}</td><td style="padding:6px 0; font-weight:bold;">${datos.reabiertaPorNombre || '—'}</td></tr>
            <tr><td style="padding:6px 0; color:#6b7280;">${t.deadlineCol}</td><td style="padding:6px 0;">${formatearFechaCortaCorreo(datos.fechaLimite, datos)}</td></tr>
          </table>
          <div style="text-align:center; margin-top:28px;">
            <a href="${urlSubtarea}" style="display:inline-block; background:#c8102e; color:#fff; text-decoration:none; padding:12px 22px; border-radius:8px; font-weight:bold;">
              ${t.goToMySubtask}
            </a>
          </div>
        </div>
      </div>
    `,
  };

  const info = await deliverMail(mailOptions, { tipo: 'subtareaReabierta' });
  return { success: true, messageId: info.messageId };
};