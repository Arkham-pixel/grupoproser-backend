/**
 * Validación FASE 1 — solo lectura (no crea/modifica/elimina en SharePoint).
 * Uso: node scripts/validateSharePointPhase1.js
 * No imprime secretos ni access tokens.
 */
import '../config/loadEnv.js';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/secrets.js';
import {
  getAccessToken,
  getSite,
  getDrive,
  graphRequest,
  listDriveRootChildren,
  checkSharePointHealth,
  resetMicrosoftGraphClient,
} from '../services/microsoftGraphService.js';
import { getSharePointConfig, isSharePointConfigured } from '../config/sharepoint.js';

function mask(value) {
  if (!value) return '(vacío)';
  const s = String(value);
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`;
}

async function main() {
  // Forzar solo lectura en esta corrida
  process.env.MS_SHAREPOINT_HEALTH_WRITE_PROBE = 'false';
  resetMicrosoftGraphClient();

  const cfg = getSharePointConfig();
  const report = {
    configured: isSharePointConfigured(),
    env: {
      MS_TENANT_ID: mask(cfg.tenantId),
      MS_CLIENT_ID: mask(cfg.clientId),
      MS_CLIENT_SECRET: cfg.clientSecret ? `(definido, len=${cfg.clientSecret.length})` : '(vacío)',
      hostname: cfg.hostname,
      sitePath: cfg.sitePath,
      libraryName: cfg.libraryName,
      healthWriteProbe: cfg.healthWriteProbe,
    },
    token: null,
    site: null,
    drives: [],
    selectedDrive: null,
    readSample: null,
    health: null,
    httpHealth: null,
    errors: [],
  };

  try {
    const token = await getAccessToken();
    report.token = {
      obtained: Boolean(token),
      length: token?.length || 0,
      preview: token ? `${token.slice(0, 12)}…` : null,
    };
  } catch (error) {
    report.token = { obtained: false };
    report.errors.push({ step: 'token', message: error.message, code: error.code, status: error.status });
  }

  if (report.token?.obtained) {
    try {
      const site = await getSite();
      report.site = {
        id: site.id,
        displayName: site.displayName,
        name: site.name,
        webUrl: site.webUrl,
        siteCollectionHostname: site.siteCollection?.hostname,
      };
    } catch (error) {
      report.errors.push({
        step: 'site',
        message: error.message,
        code: error.code,
        status: error.status,
        body: error.body?.error || error.cause?.body?.error || undefined,
      });
    }
  }

  if (report.site?.id) {
    try {
      const list = await graphRequest(`/sites/${report.site.id}/drives`);
      report.drives = (list?.value || []).map((d) => ({
        id: d.id,
        name: d.name,
        driveType: d.driveType,
        webUrl: d.webUrl,
      }));

      const drive = await getDrive(report.site.id);
      report.selectedDrive = {
        id: drive.id,
        name: drive.name,
        driveType: drive.driveType,
        webUrl: drive.webUrl,
      };
    } catch (error) {
      report.errors.push({
        step: 'drives',
        message: error.message,
        code: error.code,
        status: error.status,
        body: error.body?.error || undefined,
      });
    }
  }

  if (report.selectedDrive?.id) {
    try {
      const children = await listDriveRootChildren(report.selectedDrive.id, { top: 10 });
      report.readSample = {
        ok: true,
        count: (children?.value || []).length,
        names: (children?.value || []).map((c) => c.name),
      };
    } catch (error) {
      report.readSample = { ok: false };
      report.errors.push({
        step: 'read',
        message: error.message,
        code: error.code,
        status: error.status,
        body: error.body?.error || undefined,
      });
    }
  }

  try {
    report.health = await checkSharePointHealth();
  } catch (error) {
    report.errors.push({ step: 'healthService', message: error.message, code: error.code });
  }

  // Endpoint HTTP (si el servidor está arriba)
  try {
    const adminJwt = jwt.sign(
      { id: 'phase1-validation', login: 'phase1', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    const res = await fetch('http://localhost:3000/api/integrations/sharepoint/health', {
      headers: { Authorization: `Bearer ${adminJwt}` },
    });
    const body = await res.json().catch(() => ({}));
    report.httpHealth = { status: res.status, body };
  } catch (error) {
    report.httpHealth = { status: null, error: error.message };
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }, null, 2));
  process.exit(1);
});
