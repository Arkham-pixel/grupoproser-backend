import '../config/loadEnv.js';
import nodemailer from 'nodemailer';

const t = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

try {
  await t.verify();
  console.log('SMTP_OK', process.env.EMAIL_USER);
} catch (e) {
  console.error('SMTP_FAIL', e.message);
  process.exit(1);
}
