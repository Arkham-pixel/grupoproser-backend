/**
 * Suite de calidad bilingüe ES/EN (plan plataforma-bilingue).
 * Ejecutar: node scripts/test-bilingual-quality.mjs
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { messages, resolveLocale, SUPPORTED_LOCALES } from '../middleware/locale.js';
import {
  getEmailText,
  getEmailSubject,
  normalizeEmailLocale,
} from '../services/emailI18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendLocales = path.resolve(__dirname, '../../grupoproser-frontend/src/locales');

function flat(o, p = '', a = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, a);
  } else a[p] = o;
  return a;
}

function mockReq(overrides = {}) {
  return {
    body: {},
    query: {},
    headers: {},
    user: undefined,
    ...overrides,
  };
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('OK:', name);
  } catch (e) {
    failed += 1;
    console.error('FAIL:', name, '-', e.message);
  }
}

// --- Backend locale middleware ---
check('SUPPORTED_LOCALES includes es and en', () => {
  assert.deepStrictEqual([...SUPPORTED_LOCALES].sort(), ['en', 'es']);
});

check('messages key parity es===en', () => {
  const esKeys = Object.keys(messages.es).sort();
  const enKeys = Object.keys(messages.en).sort();
  assert.deepStrictEqual(esKeys, enKeys);
  assert.ok(esKeys.length >= 50);
});

check('resolveLocale prefers body.locale', () => {
  assert.strictEqual(resolveLocale(mockReq({ body: { locale: 'en' }, headers: { 'accept-language': 'es' } })), 'en');
});

check('resolveLocale uses Accept-Language', () => {
  assert.strictEqual(resolveLocale(mockReq({ headers: { 'accept-language': 'en-US,en;q=0.9' } })), 'en');
});

check('resolveLocale prefers Accept-Language over JWT user', () => {
  assert.strictEqual(
    resolveLocale(mockReq({ user: { locale: 'en' }, headers: { 'accept-language': 'es' } })),
    'es'
  );
});

check('resolveLocale uses req.user.locale when no header', () => {
  assert.strictEqual(resolveLocale(mockReq({ user: { locale: 'en' } })), 'en');
});

check('invalidCredentials differs ES vs EN', () => {
  assert.notStrictEqual(messages.es.invalidCredentials, messages.en.invalidCredentials);
});

// --- Email i18n ---
check('email normalizeEmailLocale', () => {
  assert.strictEqual(normalizeEmailLocale({ locale: 'en' }), 'en');
  assert.strictEqual(normalizeEmailLocale({}), 'es');
});

check('email subjects differ by locale', () => {
  const es = getEmailSubject({ locale: 'es' }, 'subjectCasoCreado', { numero: 'C-1' });
  const en = getEmailSubject({ locale: 'en' }, 'subjectCasoCreado', { numero: 'C-1' });
  assert.ok(es && en);
  assert.notStrictEqual(es, en);
  assert.ok(es.includes('C-1') && en.includes('C-1'));
});

check('email text openCase bilingual', () => {
  assert.notStrictEqual(getEmailText({ locale: 'es' }).openCase, getEmailText({ locale: 'en' }).openCase);
});

// --- Frontend locale JSON parity ---
check('frontend es.json / en.json leaf parity', () => {
  const es = flat(JSON.parse(fs.readFileSync(path.join(frontendLocales, 'es.json'), 'utf8')));
  const en = flat(JSON.parse(fs.readFileSync(path.join(frontendLocales, 'en.json'), 'utf8')));
  const esKeys = Object.keys(es).sort();
  const enKeys = Object.keys(en).sort();
  const onlyEs = esKeys.filter((k) => !enKeys.includes(k));
  const onlyEn = enKeys.filter((k) => !esKeys.includes(k));
  assert.strictEqual(onlyEs.length, 0, `onlyEs: ${onlyEs.slice(0, 10)}`);
  assert.strictEqual(onlyEn.length, 0, `onlyEn: ${onlyEn.slice(0, 10)}`);
  assert.ok(esKeys.length > 1000);
});

check('critical frontend namespaces exist', () => {
  const es = JSON.parse(fs.readFileSync(path.join(frontendLocales, 'es.json'), 'utf8'));
  for (const ns of ['auth', 'language', 'nav', 'complex', 'express', 'pol', 'autoSave', 'translation']) {
    assert.ok(es[ns], `missing namespace ${ns}`);
  }
});

check('login applies changeLanguage', () => {
  const login = fs.readFileSync(
    path.resolve(__dirname, '../../grupoproser-frontend/src/components/login.tsx'),
    'utf8'
  );
  assert.ok(login.includes('changeLanguage'));
});

check('DocumentLanguageSelector exists', () => {
  assert.ok(
    fs.existsSync(
      path.resolve(__dirname, '../../grupoproser-frontend/src/components/DocumentLanguageSelector.jsx')
    )
  );
});

check('TranslatedTextArea exists', () => {
  assert.ok(
    fs.existsSync(
      path.resolve(__dirname, '../../grupoproser-frontend/src/components/TranslatedTextArea.jsx')
    )
  );
});

if (failed) {
  console.error(`RESULT: FAIL (${failed} checks)`);
  process.exit(1);
}
console.log('RESULT: OK');
