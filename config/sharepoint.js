/**
 * Configuración Microsoft SharePoint / Graph (réplica documental).
 *
 * Arquitectura ARNALD:
 *   S3 = fuente de verdad de archivos
 *   MongoDB = metadatos
 *   SharePoint = réplica organizada (sincronización asíncrona)
 *
 * Fase 1: solo autenticación + resolución de site/drive + health.
 * No modifica uploads ni S3.
 *
 * ---------------------------------------------------------------------------
 * Procedimiento Sites.Selected (recomendado frente a Sites.ReadWrite.All)
 * ---------------------------------------------------------------------------
 * 1. Entra ID → App registrations → New registration (ej. "ARNALD-SharePoint").
 * 2. Certificates & secrets → New client secret → copiar valor a MS_CLIENT_SECRET.
 * 3. API permissions → Microsoft Graph → Application permissions → Sites.Selected
 *    → Grant admin consent.
 * 4. Conceder acceso SOLO al sitio Documental Proser (una de estas vías):
 *    a) Graph (con un principal que ya tenga Sites.FullControl.All temporalmente):
 *       POST https://graph.microsoft.com/v1.0/sites/{siteId}/permissions
 *       Body:
 *       {
 *         "roles": ["write"],
 *         "grantedToIdentities": [{
 *           "application": {
 *             "id": "<MS_CLIENT_ID>",
 *             "displayName": "ARNALD-SharePoint"
 *           }
 *         }]
 *       }
 *    b) PnP PowerShell:
 *       Grant-PnPAzureADAppSitePermission -AppId <MS_CLIENT_ID> \
 *         -DisplayName "ARNALD-SharePoint" -Permissions Write \
 *         -Site "https://grupoproser.sharepoint.com/sites/DocumentalProser"
 * 5. Rellenar MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET en .env.
 * 6. Opcional: fijar MS_SHAREPOINT_SITE_ID y MS_SHAREPOINT_DRIVE_ID tras el primer health
 *    exitoso (el servicio también los resuelve por hostname + path + nombre de biblioteca).
 */

function trimEnv(name, fallback = '') {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  // Coolify / paneles a veces pegan comillas o BOM
  return String(v)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function envFlag(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  return v === 'true' || v === '1';
}

const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Valida forma de MS_TENANT_ID / MS_CLIENT_ID (GUID 36 chars).
 * Un dígito truncado produce AADSTS700016 en producción.
 */
export function validateSharePointCredentialShapes(config = getSharePointConfig()) {
  const issues = [];
  if (!config.tenantId) {
    issues.push({ field: 'MS_TENANT_ID', code: 'MISSING', message: 'vacío' });
  } else if (!GUID_RE.test(config.tenantId)) {
    issues.push({
      field: 'MS_TENANT_ID',
      code: 'INVALID_GUID',
      message: `formato inválido (len=${config.tenantId.length}, esperado GUID 36)`,
    });
  }
  if (!config.clientId) {
    issues.push({ field: 'MS_CLIENT_ID', code: 'MISSING', message: 'vacío' });
  } else if (!GUID_RE.test(config.clientId)) {
    issues.push({
      field: 'MS_CLIENT_ID',
      code: 'INVALID_GUID',
      message: `formato inválido (len=${config.clientId.length}, termina …${config.clientId.slice(-4)}). Revise truncado en Coolify.`,
    });
  }
  if (!config.clientSecret) {
    issues.push({ field: 'MS_CLIENT_SECRET', code: 'MISSING', message: 'vacío' });
  } else if (String(config.clientSecret).length < 10) {
    issues.push({
      field: 'MS_CLIENT_SECRET',
      code: 'TOO_SHORT',
      message: 'secret demasiado corto',
    });
  }
  return {
    ok: issues.length === 0,
    issues,
    fingerprint: {
      tenantLen: (config.tenantId || '').length,
      clientLen: (config.clientId || '').length,
      clientEnd: (config.clientId || '').slice(-4),
      secretLen: String(config.clientSecret || '').length,
    },
  };
}

export function getSharePointConfig() {
  const hostname = trimEnv('MS_SHAREPOINT_HOSTNAME', 'grupoproser.sharepoint.com');
  let sitePath = trimEnv('MS_SHAREPOINT_SITE_PATH', '/sites/DocumentalProser');
  if (sitePath && !sitePath.startsWith('/')) {
    sitePath = `/${sitePath}`;
  }

  return Object.freeze({
    tenantId: trimEnv('MS_TENANT_ID'),
    clientId: trimEnv('MS_CLIENT_ID'),
    clientSecret: trimEnv('MS_CLIENT_SECRET'),
    hostname,
    sitePath,
    siteId: trimEnv('MS_SHAREPOINT_SITE_ID'),
    driveId: trimEnv('MS_SHAREPOINT_DRIVE_ID'),
    libraryName: trimEnv('MS_SHAREPOINT_LIBRARY_NAME', 'Documentos'),
    siteDisplayName: trimEnv('MS_SHAREPOINT_SITE_DISPLAY_NAME', 'Documental Proser'),
    /** Si true, el health crea/borra una carpeta efímera bajo TEST_ARNALD. */
    healthWriteProbe: envFlag('MS_SHAREPOINT_HEALTH_WRITE_PROBE', true),
    testRootFolder: trimEnv('MS_SHAREPOINT_ROOT_TEST', 'TEST_ARNALD'),
    graphBaseUrl: 'https://graph.microsoft.com/v1.0',
    graphScope: 'https://graph.microsoft.com/.default',
  });
}

export function isSharePointConfigured() {
  const c = getSharePointConfig();
  if (!c.tenantId || !c.clientId || !c.clientSecret || !c.hostname || !c.sitePath) {
    return false;
  }
  return validateSharePointCredentialShapes(c).ok;
}

export function logSharePointStatusOnBoot() {
  if (!trimEnv('MS_TENANT_ID') || !trimEnv('MS_CLIENT_ID') || !trimEnv('MS_CLIENT_SECRET')) {
    console.log(
      '📎 SharePoint: no configurado (faltan MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET). Health devolverá connected:false.'
    );
    return;
  }
  const c = getSharePointConfig();
  const validation = validateSharePointCredentialShapes(c);
  if (!validation.ok) {
    console.error('❌ SharePoint: credenciales MS_* con formato inválido (causa típica de AADSTS700016):');
    for (const issue of validation.issues) {
      console.error(`   - ${issue.field}: ${issue.message}`);
    }
    return;
  }
  console.log(
    `📎 SharePoint: credenciales OK — ${c.hostname}${c.sitePath} (biblioteca: ${c.libraryName}) · client…${validation.fingerprint.clientEnd}`
  );
  if (c.siteId) console.log(`   Site ID fijado en env`);
  if (c.driveId) console.log(`   Drive ID fijado en env`);
}
