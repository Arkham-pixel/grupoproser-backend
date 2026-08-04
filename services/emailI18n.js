/**
 * Textos de UI de correo bilingües (ES/EN).
 *
 * Callers deben pasar `datos.locale` (`es`|`en`): preferencia del destinatario
 * o, en su defecto, la del emisor. Español es el fallback seguro.
 */

/** @returns {'es'|'en'} */
export function normalizeEmailLocale(datos = {}) {
  const raw =
    typeof datos === 'string'
      ? datos
      : (datos?.locale ?? datos?.lang ?? '');
  const v = String(raw).trim().toLowerCase();
  if (v === 'en' || v.startsWith('en-') || v.startsWith('en_')) return 'en';
  return 'es';
}

/**
 * Interpola `{clave}` en una plantilla.
 * @param {string} template
 * @param {Record<string, string|number|undefined|null>} [vars]
 */
export function fillEmailTemplate(template, vars = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null && vars[key] !== '' ? String(vars[key]) : ''
  );
}

/** Sentinel / valores vacíos usados por callers (ES histórico + EN). */
export function isMissingCaseNumber(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  return (
    lower === 'sin número' ||
    lower === 'sin numero' ||
    lower === 'no number' ||
    lower === 'sin especificar' ||
    lower === 'not specified' ||
    lower === 'n/a' ||
    lower === '—'
  );
}

const es = {
  // CTAs / acceso al caso
  openCase: 'Abrir caso',
  searchCase: 'Buscar caso',
  viewCases: 'Ver mis casos',
  goToCase: 'Ir al caso',
  directAccess: 'Acceso directo al caso',
  protocol:
    'Ingrese a ARNALD DataFlow para iniciar la gestión según el protocolo (contacto inicial en 12 horas).',
  brokenButton: 'Si el botón no funciona, copie este enlace:',
  viewCase: 'Ver Caso',
  viewCaseNum: 'Ver Caso #{numero}',
  searchCaseNum: 'Buscar Caso #{numero}',
  viewCasesComplex: 'Ver Casos Complex',
  clickToAccessDirect: 'Haz clic en el botón para acceder directamente al caso',
  clickToAccessPlatform: 'Haz clic en el botón para acceder a la plataforma de casos',
  openCaseArnald: 'Abrir caso en ARNALD',
  download: 'Descargar',
  openAlertsPanel: 'Abrir panel de alertas {modulo}',

  // Destinatarios
  recipientsTitle: 'Destinatarios de esta notificación',
  assignedResponsible: 'Responsable asignado:',
  assignedByPerson: 'Persona que asignó:',
  recipientTitle: 'Destinatario',
  responsibleLabel: 'Responsable:',
  notificationDate: 'Fecha de notificación:',

  // Frases comunes
  unassigned: 'Sin asignar',
  unidentified: 'No identificado',
  noNumber: 'Sin número',
  notSpecified: 'No especificado',
  notSpecifiedF: 'No especificada',
  notAvailable: 'No disponible',
  system: 'Sistema',
  newCase: 'nuevo',
  noNumberLower: 'sin número',
  caseFallback: 'Caso',
  caseComplexFallback: 'Caso Complex',
  taskFallback: 'Tarea',
  noDeadline: 'Sin fecha límite',

  // Labels de tabla frecuentes
  caseNumber: 'Número de Caso:',
  claimNumber: 'Número de Siniestro:',
  adjustmentNumber: 'Número de ajuste:',
  claimNumberLabel: 'Número de siniestro:',
  claimDate: 'Fecha del siniestro:',
  policyBranch: 'Ramo / tipo póliza:',
  workflowCode: 'Código workflow:',
  insurer: 'Aseguradora:',
  insuredBeneficiary: 'Asegurado / beneficiario:',
  intermediary: 'Intermediario:',
  insurerOfficer: 'Funcionario aseguradora:',
  claimCity: 'Ciudad del siniestro:',
  policyNumber: 'Número de póliza:',
  caseStatus: 'Estado del caso:',
  assignedAdjuster: 'Ajustador asignado:',
  assignmentDate: 'Fecha de asignación:',
  assignedBy: 'Asignado por:',
  description: 'Descripción:',
  observations: 'Observaciones',
  uploadedBy: 'Usuario que cargó:',
  uploadedFiles: 'Archivos cargados:',
  filesAlsoAttached:
    'Los archivos también están adjuntos a este correo para su descarga directa.',
  caseInfo: 'Información del Caso',
  claimInfo: 'Información del siniestro',
  assignedResponsibleTitle: 'Responsable Asignado',
  name: 'Nombre:',
  email: 'Email:',
  phone: 'Teléfono:',
  client: 'Cliente:',
  inspector: 'Inspector:',
  classification: 'Clasificación:',
  requestedBy: 'Quien Solicita:',
  inspectionCity: 'Ciudad de Inspección:',
  address: 'Dirección:',
  insured: 'Asegurado:',
  observation: 'Observación:',
  status: 'Estado:',
  riskTeam: 'Equipo de Gestión de Riesgo',
  independentReport: 'Reporte Independiente',
  nextStepProtocol: 'Próximo paso (protocolo):',
  nextStepBody:
    'contacto con el intermediario y cargue de evidencia en ARNALD dentro de las',
  nextStepHours: '12 horas',
  nextStepSuffix: 'siguientes a esta asignación.',
  newClaimAssigned: 'Nuevo siniestro asignado',
  phase1Banner: 'Fase 1 — Recepción de asignación · Inicie contacto inicial en 12 horas',
  arnaldProtocolSubtitle: 'ARNALD DataFlow · Protocolo de atención de siniestros',
  riskCaseAssignedTitle: 'Caso de Riesgo Asignado',
  caseMgmtSubtitle: 'Sistema de Gestión de Casos - Grupo Proser',
  caseAssignedTitle: 'Caso Asignado',
  casesAssignedSubject: 'Casos Asignados',
  createdCaseTitle: 'Caso Creado Exitosamente',
  createdCaseInfo: 'Información del Caso Creado',
  riskNumber: 'Número de Riesgo:',
  adjustmentNumberEmoji: 'Número de Ajuste:',
  creationDate: 'Fecha de Creación:',
  notificationsSent: 'Notificaciones Enviadas',
  notificationsSentBody: 'Se han enviado notificaciones por correo electrónico a:',
  youCreator: 'Tú (creador del caso)',
  insurerOfficerItem: 'Funcionario de aseguradora',
  assignedResponsibleItem: 'Responsable asignado',

  // Footers
  footerAuto:
    'Este es un mensaje automático del Sistema de Gestión de Casos de Grupo Proser.',
  footerNoReply:
    'No responda a este correo. Para consultas, contacte al administrador del sistema.',
  footerArnald: 'Mensaje automático de ARNALD DataFlow · Grupo Proser',
  footerNoReplyShort: 'No responda a este correo.',
  footerAlerts:
    'Este es un mensaje automático del Sistema de Alertas de Grupo Proser.',
  footerTasks:
    'Este es un mensaje automático del Sistema de Gestión de Tareas de Grupo Proser.',
  footerTest: 'Este es un mensaje de prueba automático del Sistema de Gestión de Casos.',

  // Alertas
  alertsSystemExpress: 'Sistema de Alertas ANS Express',
  alertsSystemComplex: 'Sistema de Alertas Complex',
  alertsSummary: 'Resumen de Alertas',
  totalCases: 'Total Casos',
  withAlerts: 'Con Alertas',
  ansAlerts: 'Alertas ANS',
  mandatoryDocs: 'Docs Obligatorios',
  criticalCases: 'Casos Críticos',
  alertsDetailByCase: 'Detalle de Alertas por Caso',
  caseLabel: 'Caso',
  claimLabel: 'Siniestro:',
  insurerLabel: 'Aseguradora:',
  insuredLabel: 'Asegurado:',
  statusLabel: 'Estado:',
  totalAlerts: 'Total Alertas:',
  missingDocs: 'Documentos Faltantes:',
  actionRequired: 'Acción requerida:',
  reviewCaseArnald: 'Revisar el caso en ARNALD',
  ansDeadline: 'Plazo ANS:',
  lastActivity: 'Última actividad:',
  daysAgo: '(hace {dias} días)',
  recommendations: 'Recomendaciones',
  recHighFirst: 'Revisa primero los casos con prioridad',
  priorityHigh: 'ALTA',
  recExpress: 'Registra las fechas ANS vencidas en el caso Express',
  recComplex: 'Sube los documentos obligatorios faltantes',
  recInactive: 'Actualiza el estado de los casos inactivos',
  recSupport: 'Contacta al equipo si necesitas apoyo',
  autoNotifications: 'Grupo Proser - Notificaciones Automáticas',

  // Control de horas / gerencia / honorarios
  hoursRegisteredTitle: 'Control de horas registrado en el sistema',
  hoursDocReceived: 'Nuevo documento de control de horas recibido',
  hoursDocBody: 'Se ha cargado un nuevo documento de control de horas en la sección de facturación.',
  hoursRegisteredBody:
    'Se ha registrado un control de horas en el sistema para este caso. Revise los detalles en la plataforma.',
  totalHours: 'Total horas:',
  hourlyRate: 'Valor hora:',
  fees: 'Honorarios:',
  settlementTotal: 'Total liquidación:',
  hoursDetailsInPlatform: 'Los detalles completos están disponibles en el caso en la plataforma.',
  gerenciaReceived: 'Nueva evidencia de gerencia recibida',
  gerenciaBody: 'Se ha cargado una nueva evidencia en la sección de gerencia.',
  honorariosReceived: 'Nuevo documento de honorarios recibido',
  honorariosBody: 'Se ha cargado un nuevo documento en la sección de honorarios.',
  noFileNames: 'No se adjuntaron nombres de archivos',
  correctionHoursTitle: 'Solicitud de corrección — Control de horas',
  hello: 'Hola',
  correctionHoursBody:
    'Se encontró un problema en el <strong>control de horas</strong> del caso',
  claimParen: '(siniestro',
  observationLabel: 'Observación:',
  whatToDo: 'Qué debe hacer:',
  correctionStep1:
    'Abrir el caso en ARNALD y corregir el control de horas desde Facturación, <em>o</em>',
  correctionStep2:
    'Reemplazar el archivo Excel/adjunto del control de horas y volver a notificar.',
  requestedBy: 'Solicitado por:',

  // Email prueba
  testEmailTitle: 'Prueba de Email',
  testEmailBody:
    'Este es un email de prueba para verificar que el sistema de notificaciones funciona correctamente.',
  dateLabel: 'Fecha:',

  // Tareas
  taskInfo: 'Información de la Tarea',
  taskDescription: 'Descripción:',
  deadline: 'Fecha Límite:',
  priority: 'Prioridad:',
  completedDate: 'Fecha de Completado:',
  assignedTo: 'Asignado a:',
  daysRemaining: 'Días Restantes:',
  completed: 'COMPLETADA',
  pending: 'PENDIENTE',
  overdue: 'VENCIDA',
  daysUnit: 'días',
  recommendedActions: 'Acciones Recomendadas',
  taskSystemSubtitle: 'Sistema de Gestión de Tareas - Grupo Proser',
  taskNueva: 'Nueva Tarea Asignada',
  taskActualizada: 'Tarea Actualizada',
  taskCompletada: 'Tarea Completada',
  taskReabierta: 'Tarea Reabierta',
  taskEliminada: 'Tarea Eliminada',
  taskAlertaDiaria: 'Recordatorio de Tarea Pendiente',
  taskAlertaFinal: 'TAREA VENCIDA - Acción Requerida',

  // Subtareas
  subtaskInternalTitle: 'Nueva subtarea Complex',
  subtaskInternalIntro: 'Te asignaron una subtarea en un caso conjunto.',
  subtaskLabel: 'Subtarea',
  taskLabel: 'Tarea',
  caseCol: 'Caso',
  assignedByCol: 'Asignado por',
  deadlineCol: 'Fecha límite',
  descriptionStrong: 'Descripción:',
  instructionsStrong: 'Instrucciones:',
  goToMySubtask: 'Ir a mi subtarea',
  supportTitle: 'Grupo Proser — Apoyo en inspección',
  supportIntro:
    'Hola {nombre}, te solicitaron diligenciar información de un caso.',
  adjusterFallback: 'ajustador',
  requestsCol: 'Solicita',
  defaultRequester: 'Ajustador Grupo Proser',
  whatToFill: 'Qué debe diligenciar:',
  openForm: 'Abrir formulario',
  magicLinkNote:
    'Este enlace es personal y puede vencer. No requiere usuario de la plataforma.',
  subtaskCompletedTitle: 'Subtarea completada',
  subtaskCompletedBody:
    '<strong>{nombre}</strong> marcó como completada la subtarea <strong>{titulo}</strong> del caso <strong>{caso}</strong>.',
  assigneeFallback: 'El asignado',
  viewInCase: 'Ver en el caso',
  subtaskReopenedTitle: 'Subtarea reabierta',
  subtaskReopenedBody:
    '<strong>{nombre}</strong> reabrió la subtarea <strong>{titulo}</strong> del caso <strong>{caso}</strong>. Vuelve a estar pendiente en tu bandeja.',
  caseOwnerFallback: 'El responsable del caso',
  reopenReason: 'Motivo de la reapertura',
  reopenedByCol: 'Reabierta por',

  // Subjects (plantillas con {vars})
  subjectAsignacionRiesgo: '📋 Caso de Riesgo Asignado - {numero}',
  subjectAsignacionComplex:
    '🆕 Siniestro asignado — Caso {numero} | Siniestro {siniestro}',
  subjectAlertas:
    '🚨 ALERTAS {tipo} - {count} Casos Requieren Atención',
  subjectAlertasPendientes: 'PENDIENTES',
  subjectAlertasExpress: 'ANS EXPRESS',
  subjectCasosAsignados: 'Casos Asignados',
  subjectCasoCreado: '✅ Caso Creado Exitosamente - {numero}',
  subjectControlHorasDoc: '⏰ Nuevo documento de control de horas - Caso {numero}',
  subjectControlHorasReg: '⏰ Control de horas registrado - Caso {numero}',
  subjectCorreccionHoras: 'Corregir control de horas — Caso {numero}',
  subjectGerencia: '👔 Nueva evidencia de gerencia - Caso {numero}',
  subjectHonorarios: '📎 Nuevo documento de honorarios - Caso {numero}',
  subjectEmailPrueba: '🧪 Prueba de Email - Sistema de Casos',
  subjectAlertaTarea: '{icono} {titulo} - {texto}',
  subjectSubtareaInterna: 'Subtarea Complex asignada — {caso}',
  subjectSubtareaExterna: 'Solicitud de apoyo — Caso {caso}',
  subjectSubtareaCompletada: 'Subtarea completada — {caso}',
  subjectSubtareaReabierta: 'Subtarea reabierta — {caso}',
};

const en = {
  openCase: 'Open case',
  searchCase: 'Find case',
  viewCases: 'View my cases',
  goToCase: 'Go to case',
  directAccess: 'Direct case access',
  protocol:
    'Sign in to ARNALD DataFlow to begin handling this case under the protocol (initial contact within 12 hours).',
  brokenButton: 'If the button does not work, copy this link:',
  viewCase: 'View Case',
  viewCaseNum: 'View Case #{numero}',
  searchCaseNum: 'Find Case #{numero}',
  viewCasesComplex: 'View Complex Cases',
  clickToAccessDirect: 'Click the button to open the case directly',
  clickToAccessPlatform: 'Click the button to open the cases platform',
  openCaseArnald: 'Open case in ARNALD',
  download: 'Download',
  openAlertsPanel: 'Open {modulo} alerts panel',

  recipientsTitle: 'Recipients of this notification',
  assignedResponsible: 'Assigned responsible:',
  assignedByPerson: 'Assigned by:',
  recipientTitle: 'Recipient',
  responsibleLabel: 'Responsible:',
  notificationDate: 'Notification date:',

  unassigned: 'Unassigned',
  unidentified: 'Unidentified',
  noNumber: 'No number',
  notSpecified: 'Not specified',
  notSpecifiedF: 'Not specified',
  notAvailable: 'Not available',
  system: 'System',
  newCase: 'new',
  noNumberLower: 'no number',
  caseFallback: 'Case',
  caseComplexFallback: 'Complex Case',
  taskFallback: 'Task',
  noDeadline: 'No deadline',

  caseNumber: 'Case number:',
  claimNumber: 'Claim number:',
  adjustmentNumber: 'Adjustment number:',
  claimNumberLabel: 'Claim number:',
  claimDate: 'Claim date:',
  policyBranch: 'Line / policy type:',
  workflowCode: 'Workflow code:',
  insurer: 'Insurer:',
  insuredBeneficiary: 'Insured / beneficiary:',
  intermediary: 'Intermediary:',
  insurerOfficer: 'Insurer officer:',
  claimCity: 'Claim city:',
  policyNumber: 'Policy number:',
  caseStatus: 'Case status:',
  assignedAdjuster: 'Assigned adjuster:',
  assignmentDate: 'Assignment date:',
  assignedBy: 'Assigned by:',
  description: 'Description:',
  observations: 'Notes',
  uploadedBy: 'Uploaded by:',
  uploadedFiles: 'Uploaded files:',
  filesAlsoAttached:
    'The files are also attached to this email for direct download.',
  caseInfo: 'Case information',
  claimInfo: 'Claim information',
  assignedResponsibleTitle: 'Assigned responsible',
  name: 'Name:',
  email: 'Email:',
  phone: 'Phone:',
  client: 'Client:',
  inspector: 'Inspector:',
  classification: 'Classification:',
  requestedBy: 'Requested by:',
  inspectionCity: 'Inspection city:',
  address: 'Address:',
  insured: 'Insured:',
  observation: 'Note:',
  status: 'Status:',
  riskTeam: 'Risk management team',
  independentReport: 'Independent report',
  nextStepProtocol: 'Next step (protocol):',
  nextStepBody:
    'contact the intermediary and upload evidence in ARNALD within the next',
  nextStepHours: '12 hours',
  nextStepSuffix: 'after this assignment.',
  newClaimAssigned: 'New claim assigned',
  phase1Banner: 'Phase 1 — Assignment received · Start initial contact within 12 hours',
  arnaldProtocolSubtitle: 'ARNALD DataFlow · Claims handling protocol',
  riskCaseAssignedTitle: 'Risk case assigned',
  caseMgmtSubtitle: 'Case Management System - Grupo Proser',
  caseAssignedTitle: 'Case assigned',
  casesAssignedSubject: 'Assigned cases',
  createdCaseTitle: 'Case created successfully',
  createdCaseInfo: 'Created case information',
  riskNumber: 'Risk number:',
  adjustmentNumberEmoji: 'Adjustment number:',
  creationDate: 'Creation date:',
  notificationsSent: 'Notifications sent',
  notificationsSentBody: 'Email notifications were sent to:',
  youCreator: 'You (case creator)',
  insurerOfficerItem: 'Insurer officer',
  assignedResponsibleItem: 'Assigned responsible',

  footerAuto:
    'This is an automated message from the Grupo Proser Case Management System.',
  footerNoReply:
    'Please do not reply to this email. For questions, contact the system administrator.',
  footerArnald: 'Automated message from ARNALD DataFlow · Grupo Proser',
  footerNoReplyShort: 'Please do not reply to this email.',
  footerAlerts:
    'This is an automated message from the Grupo Proser Alerts System.',
  footerTasks:
    'This is an automated message from the Grupo Proser Task Management System.',
  footerTest: 'This is an automated test message from the Case Management System.',

  alertsSystemExpress: 'ANS Express Alerts System',
  alertsSystemComplex: 'Complex Alerts System',
  alertsSummary: 'Alerts summary',
  totalCases: 'Total cases',
  withAlerts: 'With alerts',
  ansAlerts: 'ANS alerts',
  mandatoryDocs: 'Mandatory docs',
  criticalCases: 'Critical cases',
  alertsDetailByCase: 'Alerts detail by case',
  caseLabel: 'Case',
  claimLabel: 'Claim:',
  insurerLabel: 'Insurer:',
  insuredLabel: 'Insured:',
  statusLabel: 'Status:',
  totalAlerts: 'Total alerts:',
  missingDocs: 'Missing documents:',
  actionRequired: 'Required action:',
  reviewCaseArnald: 'Review the case in ARNALD',
  ansDeadline: 'ANS deadline:',
  lastActivity: 'Last activity:',
  daysAgo: '({dias} days ago)',
  recommendations: 'Recommendations',
  recHighFirst: 'Review cases with',
  priorityHigh: 'HIGH',
  recExpress: 'Record overdue ANS dates on the Express case',
  recComplex: 'Upload the missing mandatory documents',
  recInactive: 'Update the status of inactive cases',
  recSupport: 'Contact the team if you need support',
  autoNotifications: 'Grupo Proser - Automatic notifications',

  hoursRegisteredTitle: 'Time control recorded in the system',
  hoursDocReceived: 'New time-control document received',
  hoursDocBody: 'A new time-control document was uploaded in the billing section.',
  hoursRegisteredBody:
    'A time control was recorded in the system for this case. Review the details in the platform.',
  totalHours: 'Total hours:',
  hourlyRate: 'Hourly rate:',
  fees: 'Fees:',
  settlementTotal: 'Settlement total:',
  hoursDetailsInPlatform: 'Full details are available on the case in the platform.',
  gerenciaReceived: 'New management evidence received',
  gerenciaBody: 'New evidence was uploaded in the management section.',
  honorariosReceived: 'New fees document received',
  honorariosBody: 'A new document was uploaded in the fees section.',
  noFileNames: 'No file names were attached',
  correctionHoursTitle: 'Correction request — Time control',
  hello: 'Hello',
  correctionHoursBody:
    'A problem was found in the <strong>time control</strong> of case',
  claimParen: '(claim',
  observationLabel: 'Note:',
  whatToDo: 'What you should do:',
  correctionStep1:
    'Open the case in ARNALD and correct the time control under Billing, <em>or</em>',
  correctionStep2:
    'Replace the Excel/attachment for the time control and notify again.',
  requestedBy: 'Requested by:',

  testEmailTitle: 'Email test',
  testEmailBody:
    'This is a test email to verify that the notification system works correctly.',
  dateLabel: 'Date:',

  taskInfo: 'Task information',
  taskDescription: 'Description:',
  deadline: 'Deadline:',
  priority: 'Priority:',
  completedDate: 'Completed on:',
  assignedTo: 'Assigned to:',
  daysRemaining: 'Days remaining:',
  completed: 'COMPLETED',
  pending: 'PENDING',
  overdue: 'OVERDUE',
  daysUnit: 'days',
  recommendedActions: 'Recommended actions',
  taskSystemSubtitle: 'Task Management System - Grupo Proser',
  taskNueva: 'New task assigned',
  taskActualizada: 'Task updated',
  taskCompletada: 'Task completed',
  taskReabierta: 'Task reopened',
  taskEliminada: 'Task deleted',
  taskAlertaDiaria: 'Pending task reminder',
  taskAlertaFinal: 'TASK OVERDUE - Action required',

  subtaskInternalTitle: 'New Complex subtask',
  subtaskInternalIntro: 'You were assigned a subtask on a shared case.',
  subtaskLabel: 'Subtask',
  taskLabel: 'Task',
  caseCol: 'Case',
  assignedByCol: 'Assigned by',
  deadlineCol: 'Deadline',
  descriptionStrong: 'Description:',
  instructionsStrong: 'Instructions:',
  goToMySubtask: 'Go to my subtask',
  supportTitle: 'Grupo Proser — Inspection support',
  supportIntro:
    'Hello {nombre}, you were asked to complete information for a case.',
  adjusterFallback: 'adjuster',
  requestsCol: 'Requested by',
  defaultRequester: 'Grupo Proser adjuster',
  whatToFill: 'What to complete:',
  openForm: 'Open form',
  magicLinkNote:
    'This link is personal and may expire. No platform account is required.',
  subtaskCompletedTitle: 'Subtask completed',
  subtaskCompletedBody:
    '<strong>{nombre}</strong> marked the subtask <strong>{titulo}</strong> on case <strong>{caso}</strong> as completed.',
  assigneeFallback: 'The assignee',
  viewInCase: 'View on case',
  subtaskReopenedTitle: 'Subtask reopened',
  subtaskReopenedBody:
    '<strong>{nombre}</strong> reopened the subtask <strong>{titulo}</strong> on case <strong>{caso}</strong>. It is pending again in your inbox.',
  caseOwnerFallback: 'The case owner',
  reopenReason: 'Reopen reason',
  reopenedByCol: 'Reopened by',

  subjectAsignacionRiesgo: '📋 Risk case assigned - {numero}',
  subjectAsignacionComplex:
    '🆕 Claim assigned — Case {numero} | Claim {siniestro}',
  subjectAlertas: '🚨 {tipo} ALERTS - {count} Cases Need Attention',
  subjectAlertasPendientes: 'PENDING',
  subjectAlertasExpress: 'ANS EXPRESS',
  subjectCasosAsignados: 'Assigned cases',
  subjectCasoCreado: '✅ Case created successfully - {numero}',
  subjectControlHorasDoc: '⏰ New time-control document - Case {numero}',
  subjectControlHorasReg: '⏰ Time control recorded - Case {numero}',
  subjectCorreccionHoras: 'Correct time control — Case {numero}',
  subjectGerencia: '👔 New management evidence - Case {numero}',
  subjectHonorarios: '📎 New fees document - Case {numero}',
  subjectEmailPrueba: '🧪 Email test - Case system',
  subjectAlertaTarea: '{icono} {titulo} — {texto}',
  subjectSubtareaInterna: 'Complex subtask assigned — {caso}',
  subjectSubtareaExterna: 'Support request — Case {caso}',
  subjectSubtareaCompletada: 'Subtask completed — {caso}',
  subjectSubtareaReabierta: 'Subtask reopened — {caso}',
};

export const emailText = { es, en };

/**
 * Diccionario de textos según `datos.locale` (fallback: es).
 * @param {object|string} [datos]
 */
export function getEmailText(datos = {}) {
  return emailText[normalizeEmailLocale(datos)];
}

/**
 * Asunto interpolado desde una clave del diccionario.
 * @param {object|string} datos
 * @param {string} subjectKey
 * @param {Record<string, string|number|undefined|null>} [vars]
 */
export function getEmailSubject(datos, subjectKey, vars = {}) {
  const t = getEmailText(datos);
  const template = t[subjectKey] ?? emailText.es[subjectKey] ?? subjectKey;
  return fillEmailTemplate(template, vars);
}
