import { ROLES_VALIDOS } from '../config/roles.js';

export const SUPPORTED_LOCALES = ['es', 'en'];

const ROLES_PERMITIDOS = ROLES_VALIDOS.join(', ');

export const messages = {
  es: {
    // Auth / tokens
    tokenRequired: 'Token requerido',
    tokenNotProvided: 'Token no proporcionado',
    invalidToken: 'Token inválido',
    invalidTokenMissingUserInfo: 'Token inválido: falta información del usuario',
    invalidOrExpiredToken: 'Token inválido o expirado',
    tokenCannotBeRenewed: 'Token inválido o no puede ser renovado',
    invalidCredentials: 'Usuario o contraseña incorrectos',
    inactiveUser: 'Usuario inactivo',
    incorrectPassword: 'Contraseña incorrecta',
    currentPasswordIncorrect: 'Contraseña actual incorrecta',
    incorrectPasswordChangesNotSaved: 'Contraseña incorrecta. No se guardaron los cambios.',
    loginSuccess: 'Inicio de sesión exitoso',
    serverError: 'Error en el servidor',
    userNotFound: 'Usuario no encontrado',
    userNotFoundOrInactive: 'Usuario no encontrado o inactivo',
    invalidLocale: 'Locale inválido',

    // Permisos
    insufficientPermissions: 'No tienes permisos para acceder a este recurso',
    noPermissions: 'No tienes permisos',
    noPermissionForAction: 'No tienes permisos para realizar esta acción',
    noPermissionChangePasswords: 'No tienes permisos para cambiar contraseñas',
    noPermissionDeleteUsers: 'No tienes permisos para eliminar usuarios',
    noPermissionCreateUsers:
      'No tienes permisos para crear usuarios. Solo administradores y soporte pueden crear usuarios.',
    noPermissionViewStats: 'No tienes permisos para ver estas estadísticas',
    noPermissionViewInfo: 'No tienes permisos para ver esta información',
    noPermissionManageVacations:
      'No tienes permisos para gestionar el estado de vacaciones. Solo usuarios autorizados pueden realizar esta acción.',

    // Admin / usuarios
    allFieldsRequired: 'Todos los campos son requeridos',
    adminNotFound: 'Administrador no encontrado',
    inactiveAdmin: 'Administrador inactivo',
    incorrectAdminPassword: 'Contraseña de administrador incorrecta',
    passwordUpdatedForUser: 'Contraseña actualizada para {{name}}',
    errorFetchingUsers: 'Error al obtener usuarios',
    loginOrEmailRequired: 'Login o email requerido',
    userToDeleteNotFound: 'Usuario a eliminar no encontrado',
    cannotDeleteOwnAccount: 'No puedes eliminar tu propia cuenta',
    userDeletedSuccess: 'Usuario eliminado correctamente',
    nameEmailCedulaPasswordRequired: 'Nombre, correo, cédula y contraseña son obligatorios',
    invalidRole: `Rol inválido. Valores permitidos: ${ROLES_PERMITIDOS}`,
    cedulaRequired: 'La cédula es obligatoria',
    userAlreadyExists: 'El usuario ya existe (correo o cédula ya registrados)',
    userCreatedSuccess: 'Usuario creado correctamente',
    userUpdatedSuccess: 'Usuario {{name}} actualizado exitosamente',
    userToModifyNotFound: 'Usuario a modificar no encontrado',
    enVacacionesMustBeBoolean: 'El campo enVacaciones debe ser un booleano',

    // DB / sesión
    dbConnectionSuccess: 'Conexión a la base de datos exitosa',
    dbConnectionError: 'Error en la conexión a la base de datos',
    sessionActive: 'Sesión activa',
    externalSessionActive: 'Sesión externa activa',
    sessionCheckError: 'Error al verificar sesión',
    sessionClosed: 'Sesión cerrada',
    sessionClosedSuccess: 'Sesión cerrada correctamente',
    inactiveSessionsClosed: '{{count}} sesiones inactivas cerradas',
    closeInactiveSessionsError: 'Error al cerrar sesiones inactivas',
    usageStatsError: 'Error al obtener estadísticas de tiempo de uso',
    debugInfoError: 'Error al obtener información de debug',
    usageTimeError: 'Error al obtener tiempo de uso',

    // 2FA
    enterAuthenticatorCode: 'Ingresa el código de tu app de autenticación',
    verificationCodeSent: 'Código de verificación enviado al correo corporativo',
    verificationSessionExpired: 'Sesión de verificación expirada. Inicia sesión de nuevo.',
    invalidVerificationToken: 'Token de verificación inválido',
    twoFactorNotEnabled: 'La verificación en dos pasos no está activada',
    twoFactorAlreadyEnabled: 'La verificación en dos pasos ya está activada',
    incorrectAuthenticatorCode: 'Código incorrecto. Verifica tu app de autenticación.',
    incorrectAuthenticatorCodeRetry:
      'Código incorrecto. Verifica tu app de autenticación e intenta de nuevo.',
    incorrectCodeTwoFactorNotDisabled:
      'Código incorrecto. No se desactivó la verificación en dos pasos.',
    codeNotRequestedOrExpired: 'Código no solicitado o expirado',
    incorrectCode: 'Código incorrecto',
    codeExpired: 'Código expirado',
    scanQrThenConfirm:
      'Escanea el código QR con Google Authenticator o Microsoft Authenticator. Luego confirma con el código de 6 dígitos.',
    generateQrFirst: 'Primero debes generar el código QR',
    twoFactorEnabledSuccess: 'Verificación en dos pasos activada correctamente',
    twoFactorDisabled: 'Verificación en dos pasos desactivada',

    // Password reset / change
    emailRequired: 'Correo electrónico es requerido',
    passwordResetLinkSent: 'Si el correo está registrado, recibirás un enlace de recuperación.',
    requestProcessingError: 'Error al procesar la solicitud. Intenta nuevamente.',
    tokenAndNewPasswordRequired: 'Token y nueva contraseña son requeridos',
    passwordMinLength: 'La contraseña debe tener al menos 6 caracteres',
    resetLinkInvalidOrExpired:
      'El enlace de recuperación es inválido, ha expirado o ya fue utilizado. Por seguridad, cada enlace solo funciona una vez y expira en 30 minutos. Solicita un nuevo enlace si aún necesitas cambiar tu contraseña.',
    passwordUpdatedLoginReady: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.',
    passwordResetError: 'Error al restablecer la contraseña. Intenta nuevamente.',
    passwordChangedSuccess: 'Contraseña cambiada correctamente',

    // Perfil
    profileUpdated: 'Perfil actualizado exitosamente',
    profileUpdatedOk: 'Perfil actualizado correctamente',
    noFileReceived: 'No se recibió ningún archivo',
    photoUpdateError: 'Error interno al actualizar foto',

    // Email prueba
    testEmailSent: 'Email de prueba enviado correctamente',
    testEmailError: 'Error enviando email de prueba',

    // ChatGPT / translate
    messageRequired: 'El mensaje es requerido',
    openaiNotConfigured:
      'OpenAI API Key no configurada. Configure OPENAI_API_KEY en el archivo .env',
    openaiQuotaExceeded: 'Cuota de OpenAI excedida',
    openaiQuotaExceededDetail:
      'Has excedido tu cuota actual de OpenAI. Por favor, verifica tu plan y detalles de facturación.',
    openaiQuotaSolution:
      'Agrega créditos en https://platform.openai.com/account/billing o actualiza tu plan',
    chatgptCommunicationError: 'Error al comunicarse con ChatGPT',
    serverErrorProcessing: 'Error interno del servidor al procesar la solicitud',
    unsupportedTranslationLanguage: 'Idioma de traducción no soportado',
    textTooLong: 'El texto excede el límite de 10.000 caracteres',
    translationNotConfigured: 'El servicio de traducción no está configurado',
    translationFailed: 'Servicio de traducción no disponible',
    chatgptConfigured: 'ChatGPT está configurado y listo para usar',
    chatgptNotConfigured:
      'OpenAI API Key no configurada. Configure OPENAI_API_KEY en el archivo .env',
  },
  en: {
    // Auth / tokens
    tokenRequired: 'Token is required',
    tokenNotProvided: 'Token not provided',
    invalidToken: 'Invalid token',
    invalidTokenMissingUserInfo: 'Invalid token: missing user information',
    invalidOrExpiredToken: 'Invalid or expired token',
    tokenCannotBeRenewed: 'Token is invalid or cannot be renewed',
    invalidCredentials: 'Incorrect username or password',
    inactiveUser: 'User is inactive',
    incorrectPassword: 'Incorrect password',
    currentPasswordIncorrect: 'Current password is incorrect',
    incorrectPasswordChangesNotSaved: 'Incorrect password. Changes were not saved.',
    loginSuccess: 'Sign-in successful',
    serverError: 'Server error',
    userNotFound: 'User not found',
    userNotFoundOrInactive: 'User not found or inactive',
    invalidLocale: 'Invalid locale',

    // Permissions
    insufficientPermissions: 'You do not have permission to access this resource',
    noPermissions: 'You do not have permission',
    noPermissionForAction: 'You do not have permission to perform this action',
    noPermissionChangePasswords: 'You do not have permission to change passwords',
    noPermissionDeleteUsers: 'You do not have permission to delete users',
    noPermissionCreateUsers:
      'You do not have permission to create users. Only administrators and support can create users.',
    noPermissionViewStats: 'You do not have permission to view these statistics',
    noPermissionViewInfo: 'You do not have permission to view this information',
    noPermissionManageVacations:
      'You do not have permission to manage vacation status. Only authorized users can perform this action.',

    // Admin / users
    allFieldsRequired: 'All fields are required',
    adminNotFound: 'Administrator not found',
    inactiveAdmin: 'Administrator is inactive',
    incorrectAdminPassword: 'Incorrect administrator password',
    passwordUpdatedForUser: 'Password updated for {{name}}',
    errorFetchingUsers: 'Error fetching users',
    loginOrEmailRequired: 'Login or email is required',
    userToDeleteNotFound: 'User to delete not found',
    cannotDeleteOwnAccount: 'You cannot delete your own account',
    userDeletedSuccess: 'User deleted successfully',
    nameEmailCedulaPasswordRequired: 'Name, email, ID number and password are required',
    invalidRole: `Invalid role. Allowed values: ${ROLES_PERMITIDOS}`,
    cedulaRequired: 'ID number is required',
    userAlreadyExists: 'User already exists (email or ID number already registered)',
    userCreatedSuccess: 'User created successfully',
    userUpdatedSuccess: 'User {{name}} updated successfully',
    userToModifyNotFound: 'User to modify not found',
    enVacacionesMustBeBoolean: 'The enVacaciones field must be a boolean',

    // DB / session
    dbConnectionSuccess: 'Database connection successful',
    dbConnectionError: 'Database connection error',
    sessionActive: 'Active session',
    externalSessionActive: 'Active external session',
    sessionCheckError: 'Error verifying session',
    sessionClosed: 'Session closed',
    sessionClosedSuccess: 'Session closed successfully',
    inactiveSessionsClosed: '{{count}} inactive sessions closed',
    closeInactiveSessionsError: 'Error closing inactive sessions',
    usageStatsError: 'Error fetching usage time statistics',
    debugInfoError: 'Error fetching debug information',
    usageTimeError: 'Error fetching usage time',

    // 2FA
    enterAuthenticatorCode: 'Enter the code from your authenticator app',
    verificationCodeSent: 'Verification code sent to corporate email',
    verificationSessionExpired: 'Verification session expired. Please sign in again.',
    invalidVerificationToken: 'Invalid verification token',
    twoFactorNotEnabled: 'Two-factor authentication is not enabled',
    twoFactorAlreadyEnabled: 'Two-factor authentication is already enabled',
    incorrectAuthenticatorCode: 'Incorrect code. Check your authenticator app.',
    incorrectAuthenticatorCodeRetry:
      'Incorrect code. Check your authenticator app and try again.',
    incorrectCodeTwoFactorNotDisabled:
      'Incorrect code. Two-factor authentication was not disabled.',
    codeNotRequestedOrExpired: 'Code not requested or expired',
    incorrectCode: 'Incorrect code',
    codeExpired: 'Code expired',
    scanQrThenConfirm:
      'Scan the QR code with Google Authenticator or Microsoft Authenticator. Then confirm with the 6-digit code.',
    generateQrFirst: 'You must generate the QR code first',
    twoFactorEnabledSuccess: 'Two-factor authentication enabled successfully',
    twoFactorDisabled: 'Two-factor authentication disabled',

    // Password reset / change
    emailRequired: 'Email is required',
    passwordResetLinkSent: 'If the email is registered, you will receive a recovery link.',
    requestProcessingError: 'Error processing the request. Please try again.',
    tokenAndNewPasswordRequired: 'Token and new password are required',
    passwordMinLength: 'Password must be at least 6 characters',
    resetLinkInvalidOrExpired:
      'The recovery link is invalid, has expired, or was already used. For security, each link works only once and expires in 30 minutes. Request a new link if you still need to change your password.',
    passwordUpdatedLoginReady: 'Password updated successfully. You can now sign in.',
    passwordResetError: 'Error resetting password. Please try again.',
    passwordChangedSuccess: 'Password changed successfully',

    // Profile
    profileUpdated: 'Profile updated successfully',
    profileUpdatedOk: 'Profile updated successfully',
    noFileReceived: 'No file was received',
    photoUpdateError: 'Internal error updating photo',

    // Test email
    testEmailSent: 'Test email sent successfully',
    testEmailError: 'Error sending test email',

    // ChatGPT / translate
    messageRequired: 'Message is required',
    openaiNotConfigured:
      'OpenAI API Key is not configured. Set OPENAI_API_KEY in the .env file',
    openaiQuotaExceeded: 'OpenAI quota exceeded',
    openaiQuotaExceededDetail:
      'You have exceeded your current OpenAI quota. Please check your plan and billing details.',
    openaiQuotaSolution:
      'Add credits at https://platform.openai.com/account/billing or upgrade your plan',
    chatgptCommunicationError: 'Error communicating with ChatGPT',
    serverErrorProcessing: 'Internal server error while processing the request',
    unsupportedTranslationLanguage: 'Unsupported translation language',
    textTooLong: 'Text exceeds the 10,000 character limit',
    translationNotConfigured: 'Translation service is not configured',
    translationFailed: 'Translation service unavailable',
    chatgptConfigured: 'ChatGPT is configured and ready to use',
    chatgptNotConfigured:
      'OpenAI API Key is not configured. Set OPENAI_API_KEY in the .env file',
  },
};

function applyVars(template, vars) {
  if (!vars || typeof template !== 'string') return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    vars[name] != null ? String(vars[name]) : `{{${name}}}`
  );
}

export function translate(locale, key, vars) {
  const lang = SUPPORTED_LOCALES.includes(locale) ? locale : 'es';
  const text = messages[lang]?.[key] || messages.es[key] || key;
  return applyVars(text, vars);
}

export function resolveLocale(req) {
  const fromBody = req.body?.locale;
  const fromQuery = req.query?.locale;
  // Preferencia de pantalla (Accept-Language) antes del JWT: el usuario puede
  // cambiar idioma sin renovar token; api.js envía appLocale en cada request.
  const fromHeader = req.headers?.['accept-language'];
  const fromUser = req.user?.locale ?? req.usuario?.locale;

  const raw = String(fromBody || fromQuery || fromHeader || fromUser || 'es')
    .toLowerCase()
    .split(',')[0]
    .trim()
    .slice(0, 2);

  return raw === 'en' ? 'en' : 'es';
}

export function bindTranslator(req, res) {
  req.locale = resolveLocale(req);
  req.t = (key, vars) => translate(req.locale, key, vars);
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('Content-Language', req.locale);
  }
}

export function localeMiddleware(req, res, next) {
  bindTranslator(req, res);
  next();
}
