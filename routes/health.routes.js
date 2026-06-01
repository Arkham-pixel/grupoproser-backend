import express from 'express';
import { getMailConfigStatus, verifyMailOnStartup } from '../services/mailTransport.js';
import { getEmailOutboxStats } from '../services/emailOutboxService.js';

const router = express.Router();

router.get('/email', async (req, res) => {
  try {
    const config = getMailConfigStatus();
    const outbox = await getEmailOutboxStats().catch(() => ({
      pending: null,
      failed: null,
      sent: null,
      enabled: false,
    }));

    res.json({
      success: true,
      mail: config,
      outbox,
      hint: !config.configured
        ? 'Configure EMAIL_USER y EMAIL_PASS en backend/.env'
        : !config.lastStartupCheck?.ok
          ? 'Credenciales presentes pero SMTP no autenticó — use contraseña de aplicación de Google'
          : 'SMTP operativo',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/email/verify', async (req, res) => {
  try {
    const result = await verifyMailOnStartup();
    const statusCode = result.ok ? 200 : 503;
    res.status(statusCode).json({ success: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
