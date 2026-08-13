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
  return String(v).trim();
}

function envFlag(name, defaultValue = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  return v === 'true' || v === '1';
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
  return Boolean(c.tenantId && c.clientId && c.clientSecret && c.hostname && c.sitePath);
}

export function logSharePointStatusOnBoot() {
  if (!isSharePointConfigured()) {
    console.log(
      '📎 SharePoint: no configurado (faltan MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET). Health devolverá connected:false.'
    );
    return;
  }
  const c = getSharePointConfig();
  console.log(
    `📎 SharePoint: credenciales presentes — ${c.hostname}${c.sitePath} (biblioteca: ${c.libraryName})`
  );
  if (c.siteId) console.log(`   Site ID fijado en env`);
  if (c.driveId) console.log(`   Drive ID fijado en env`);
}
