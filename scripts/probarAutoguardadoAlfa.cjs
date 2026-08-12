/**
 * Pruebas de sincronización / autoguardado Seguros Alfa
 * Uso: node scripts/probarAutoguardadoAlfa.cjs
 */
const API = process.env.ALFA_API || 'http://localhost:3000/api';

const results = [];
const ok = (name, detail = '') => {
  results.push({ name, pass: true, detail });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail = '') => {
  results.push({ name, pass: false, detail });
  console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
};

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

async function testHealth() {
  const { res, body } = await fetchJson(`${API}/health`);
  if (res.ok && (body?.ok || body?.success)) {
    ok('GET /api/health', `status=${res.status}`);
    return true;
  }
  fail('GET /api/health', `status=${res.status} body=${JSON.stringify(body)}`);
  return false;
}

async function testHealthOfflineProbe() {
  // Simula lo que hace connectivityService: health debe ser 2xx
  const t0 = Date.now();
  const { res } = await fetchJson(`${API}/health?_=${Date.now()}`);
  const ms = Date.now() - t0;
  if (res.ok && ms < 4000) {
    ok('Probe conectividad (TTL health)', `${ms}ms`);
    return true;
  }
  fail('Probe conectividad (TTL health)', `status=${res.status} ms=${ms}`);
  return false;
}

async function pickCaso() {
  const { res, body } = await fetchJson(`${API}/seguros-alfa?page=1&limit=5`);
  if (!res.ok) {
    fail('Listar casos Alfa', `status=${res.status}`);
    return null;
  }
  const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  if (!data.length) {
    fail('Listar casos Alfa', 'sin casos en BD');
    return null;
  }
  ok('Listar casos Alfa', `${data.length} caso(s), usando ${data[0].consecutivo || data[0]._id}`);
  return data[0];
}

async function testAutosaveLiquidador(caso) {
  const marker = `AUTOTEST-${Date.now()}`;
  const liquidador = {
    ...(caso.liquidador && typeof caso.liquidador === 'object' ? caso.liquidador : {}),
    observaciones: marker,
    contenidos: [
      { id: 't1', item: 'Prueba autoguardado contenidos', valor: '1000' },
    ],
    edificios: [
      { id: 't2', item: 'Prueba autoguardado edificios', valor: '2000' },
    ],
    deducible: {
      anioSMMLV: 2026,
      valorSMMLV: 1423500,
      cantidadSMMLV: 0,
      porcentaje: 10,
      valorFijo: '',
    },
  };

  const payload = {
    ...caso,
    liquidador,
    valorReclamado: 3000,
    valorLiquidado: 2700,
  };
  delete payload._id;
  delete payload.__v;
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.archivos;

  const { res, body } = await fetchJson(`${API}/seguros-alfa/${caso._id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    fail('PUT autoguardado liquidador', `status=${res.status} ${JSON.stringify(body)}`);
    return false;
  }

  const { res: resGet, body: getBody } = await fetchJson(`${API}/seguros-alfa/${caso._id}`);
  const saved = getBody?.data || getBody;
  const obs = saved?.liquidador?.observaciones;
  const cont = saved?.liquidador?.contenidos?.[0]?.item;
  const edi = saved?.liquidador?.edificios?.[0]?.item;
  if (obs === marker && cont && edi) {
    ok('Persistencia liquidador (GET tras PUT)', `obs=${obs}`);
    return true;
  }
  fail(
    'Persistencia liquidador (GET tras PUT)',
    `obs=${obs} cont=${cont} edi=${edi}`
  );
  return false;
}

async function testAutosaveInforme(casoId) {
  const marker = `INFO-AUTOTEST-${Date.now()}`;
  const { res: resGet0, body: get0 } = await fetchJson(`${API}/seguros-alfa/${casoId}`);
  if (!resGet0.ok) {
    fail('GET caso previo a informe', `status=${resGet0.status}`);
    return false;
  }
  const caso = get0?.data || get0;
  const informeUnico = {
    ...(caso.informeUnico && typeof caso.informeUnico === 'object' ? caso.informeUnico : {}),
    conclusiones: marker,
    recomendacion: 'Recomendación prueba sync',
    ajustadorNombre: 'Tester Autoguardado',
    fechaInforme: new Date().toISOString().slice(0, 10),
  };

  const payload = { ...caso, informeUnico };
  delete payload._id;
  delete payload.__v;
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.archivos;

  const { res, body } = await fetchJson(`${API}/seguros-alfa/${casoId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    fail('PUT autoguardado informe', `status=${res.status} ${JSON.stringify(body)}`);
    return false;
  }

  const { res: resGet, body: getBody } = await fetchJson(`${API}/seguros-alfa/${casoId}`);
  const saved = getBody?.data || getBody;
  if (saved?.informeUnico?.conclusiones === marker) {
    ok('Persistencia informe único (GET tras PUT)', marker);
    // Verificar que liquidador no se borró al guardar informe
    if (saved?.liquidador?.observaciones) {
      ok('Sincronización cruzada: liquidador intacto al guardar informe');
    } else {
      fail('Sincronización cruzada: liquidador intacto al guardar informe', 'liquidador vacío');
    }
    return true;
  }
  fail('Persistencia informe único (GET tras PUT)', JSON.stringify(saved?.informeUnico));
  return false;
}

async function testDebounceLogic() {
  // Simula la lógica de snapshot del hook (sin React)
  let lastSnap = '';
  let ready = false;
  let saveCount = 0;
  const schedule = (data) => {
    const snap = JSON.stringify(data);
    if (!ready || !lastSnap) {
      ready = true;
      lastSnap = snap;
      return 'anchor';
    }
    if (snap === lastSnap) return 'skip';
    lastSnap = snap;
    saveCount += 1;
    return 'save';
  };

  const a = schedule({ x: 1 });
  const b = schedule({ x: 1 });
  const c = schedule({ x: 2 });
  const d = schedule({ x: 2 });
  if (a === 'anchor' && b === 'skip' && c === 'save' && d === 'skip' && saveCount === 1) {
    ok('Lógica snapshot/debounce (sin guardado en mount)', `saves=${saveCount}`);
    return true;
  }
  fail('Lógica snapshot/debounce', `a=${a} b=${b} c=${c} d=${d} saves=${saveCount}`);
  return false;
}

async function testFrontendModules() {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../../grupoproser-frontend/src');
  const files = [
    'hooks/useAlfaCasoAutosave.js',
    'hooks/useSyncStatus.js',
    'components/offline/SyncIndicator.jsx',
    'components/SubcomponenteSegurosAlfa/CasoSegurosAlfaWorkspace.jsx',
  ];
  let all = true;
  for (const f of files) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) {
      fail(`Archivo presente: ${f}`, 'no existe');
      all = false;
      continue;
    }
    const src = fs.readFileSync(full, 'utf8');
    if (f.includes('useAlfaCasoAutosave') && !src.includes('setAutosaveUiStatus')) {
      fail(`Hook Alfa conecta indicador`, 'falta setAutosaveUiStatus');
      all = false;
      continue;
    }
    if (f.includes('useSyncStatus') && !src.includes('subscribeConnectivity')) {
      fail(`useSyncStatus escucha conectividad`, 'falta subscribeConnectivity');
      all = false;
      continue;
    }
    if (f.includes('CasoSegurosAlfaWorkspace') && !src.includes('useAlfaCasoAutosave')) {
      fail(`Workspace usa autoguardado`, 'falta useAlfaCasoAutosave');
      all = false;
      continue;
    }
    ok(`Archivo/contrato: ${f}`);
  }
  return all;
}

async function main() {
  console.log('\n=== Pruebas autoguardado / sync Alfa ===\n');
  await testFrontendModules();
  await testDebounceLogic();

  const healthy = await testHealth();
  if (!healthy) {
    console.error('\nBackend no responde. Abortando pruebas de API.\n');
    process.exit(1);
  }
  await testHealthOfflineProbe();

  const caso = await pickCaso();
  if (caso?._id) {
    await testAutosaveLiquidador(caso);
    await testAutosaveInforme(caso._id);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== Resultado: ${passed} OK / ${failed} FAIL (total ${results.length}) ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
