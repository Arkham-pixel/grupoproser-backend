/**
 * Smoke test for locale middleware / message catalog.
 * Run: node scripts/test-locale-middleware.mjs
 */
import {
  resolveLocale,
  messages,
  SUPPORTED_LOCALES,
  translate,
} from '../middleware/locale.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('ASSERT FAIL:', msg);
    process.exit(1);
  }
}

const esKeys = Object.keys(messages.es).sort();
const enKeys = Object.keys(messages.en).sort();

assert(
  JSON.stringify(esKeys) === JSON.stringify(enKeys),
  `Key parity es===en failed.\nOnly ES: ${esKeys.filter((k) => !messages.en[k])}\nOnly EN: ${enKeys.filter((k) => !messages.es[k])}`
);

assert(SUPPORTED_LOCALES.includes('es') && SUPPORTED_LOCALES.includes('en'), 'SUPPORTED_LOCALES');

assert(
  resolveLocale({ headers: { 'accept-language': 'en-US,en;q=0.9' } }) === 'en',
  'resolveLocale Accept-Language en'
);

assert(
  resolveLocale({ headers: { 'accept-language': 'es-CO,es;q=0.9' } }) === 'es',
  'resolveLocale Accept-Language es'
);

assert(
  resolveLocale({ body: { locale: 'en' }, headers: { 'accept-language': 'es' } }) === 'en',
  'resolveLocale body.locale overrides header'
);

assert(
  resolveLocale({
    user: { locale: 'en' },
    headers: { 'accept-language': 'es' },
  }) === 'es',
  'resolveLocale Accept-Language overrides JWT user.locale'
);

assert(
  resolveLocale({ user: { locale: 'en' }, headers: {} }) === 'en',
  'resolveLocale req.user.locale when no Accept-Language'
);

assert(resolveLocale({ headers: {} }) === 'es', 'resolveLocale default es');

const enMsg = translate('en', 'invalidCredentials');
const esMsg = translate('es', 'invalidCredentials');
assert(enMsg === 'Incorrect username or password', `EN invalidCredentials: ${enMsg}`);
assert(esMsg === 'Usuario o contraseña incorrectos', `ES invalidCredentials: ${esMsg}`);
assert(enMsg !== esMsg, 'EN vs ES invalidCredentials must differ');

const withVars = translate('en', 'passwordUpdatedForUser', { name: 'Ada' });
assert(withVars === 'Password updated for Ada', `vars replace: ${withVars}`);

console.log(`Keys: ${esKeys.length}`);
console.log('RESULT: OK');
process.exit(0);
