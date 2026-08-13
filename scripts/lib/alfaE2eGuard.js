/**
 * Guardas y utilidades para scripts E2E Alfa.
 * Por defecto NO tocar casos reales.
 */
export function parseE2eArgs(argv = process.argv.slice(2)) {
  const allowRealCase = argv.includes('--allow-real-case');
  const stampArg = argv.find((a) => /^\d{10,}$/.test(a));
  return { allowRealCase, stampArg };
}

export function assertAllowRealCaseOrExit({ allowRealCase, scriptName }) {
  if (allowRealCase) {
    console.warn(
      `[${scriptName}] --allow-real-case activo: se usará caso real. Debe hacer snapshot+cleanup.`
    );
    return;
  }
  console.error(
    `[${scriptName}] ABORTADO: por defecto no se usan casos reales.\n` +
      `  - Para fixture aislado: ejecuta el modo por defecto (próximamente) o crea caso TEST.\n` +
      `  - Para caso real explícito: añade --allow-real-case\n` +
      `Ejemplo: node scripts/${scriptName} --allow-real-case`
  );
  process.exit(2);
}

export function buildTestFileName({ etiqueta, stamp, ext }) {
  return `TEST_E2E_${stamp}_${String(etiqueta || 'DOC').toLowerCase()}.${ext}`;
}

export function isE2eTestFileName(name) {
  return /^(TEST_E2E_|e2e-|poliza-prueba-e2e)/i.test(String(name || ''));
}
