/**
 * Valida paridad ES/EN del diccionario emailI18n y que subjects EN ≠ ES.
 * RESULT esperado: OK
 */
import {
  emailText,
  getEmailText,
  normalizeEmailLocale,
  getEmailSubject,
} from '../services/emailI18n.js';

const SUBJECT_KEYS = [
  'subjectAsignacionRiesgo',
  'subjectAsignacionComplex',
  'subjectAlertas',
  'subjectCasosAsignados',
  'subjectCasoCreado',
  'subjectControlHorasDoc',
  'subjectControlHorasReg',
  'subjectCorreccionHoras',
  'subjectGerencia',
  'subjectHonorarios',
  'subjectEmailPrueba',
  'subjectAlertaTarea',
  'subjectSubtareaInterna',
  'subjectSubtareaExterna',
  'subjectSubtareaCompletada',
  'subjectSubtareaReabierta',
];

const errors = [];

// normalizeEmailLocale
if (normalizeEmailLocale({ locale: 'en' }) !== 'en') errors.push('normalize en failed');
if (normalizeEmailLocale({ locale: 'en-US' }) !== 'en') errors.push('normalize en-US failed');
if (normalizeEmailLocale({ locale: 'es' }) !== 'es') errors.push('normalize es failed');
if (normalizeEmailLocale({}) !== 'es') errors.push('normalize fallback failed');
if (normalizeEmailLocale({ locale: 'fr' }) !== 'es') errors.push('normalize unknown→es failed');

// Paridad de claves
const esKeys = Object.keys(emailText.es).sort();
const enKeys = Object.keys(emailText.en).sort();
const missingInEn = esKeys.filter((k) => !enKeys.includes(k));
const missingInEs = enKeys.filter((k) => !esKeys.includes(k));
if (missingInEn.length) errors.push(`Keys missing in EN: ${missingInEn.join(', ')}`);
if (missingInEs.length) errors.push(`Keys missing in ES: ${missingInEs.join(', ')}`);

// Subjects EN distintos de ES (con mismas vars de prueba)
const sampleVars = {
  numero: '123',
  siniestro: 'S-1',
  tipo: 'PENDIENTES',
  count: 3,
  caso: 'C-9',
  icono: '📋',
  titulo: 'Task',
  texto: 'Do thing',
};

for (const key of SUBJECT_KEYS) {
  if (!(key in emailText.es) || !(key in emailText.en)) {
    errors.push(`Subject key missing: ${key}`);
    continue;
  }
  const esSubj = getEmailSubject({ locale: 'es' }, key, sampleVars);
  const enSubj = getEmailSubject({ locale: 'en' }, key, sampleVars);
  if (!esSubj || !enSubj) {
    errors.push(`Empty subject for ${key}`);
  } else if (esSubj === enSubj) {
    // ANS EXPRESS / PENDIENTES brand tokens may coincide in subjectAlertas tipo alone;
    // full subject templates must still differ.
    errors.push(`Subject EN equals ES for ${key}: "${esSubj}"`);
  }
}

// getEmailText smoke
const tEs = getEmailText({ locale: 'es' });
const tEn = getEmailText({ locale: 'en' });
if (tEs.unassigned === tEn.unassigned) errors.push('Common phrase unassigned not translated');
if (tEs.recipientsTitle === tEn.recipientsTitle) errors.push('recipientsTitle not translated');
if (tEs.openCase !== 'Abrir caso') errors.push('ES openCase unexpected');
if (tEn.openCase !== 'Open case') errors.push('EN openCase unexpected');

if (errors.length) {
  console.error('RESULT: FAIL');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}

console.log('RESULT: OK');
console.log(`Checked ${esKeys.length} keys (parity) and ${SUBJECT_KEYS.length} subjects.`);
