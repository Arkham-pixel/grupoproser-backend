import {
  sonElMismoCasoFdm,
  clavesDeduplicacionFdm,
  colapsarFilasDuplicadasFdm,
} from '../services/fdmImportService.js';

const evento = 'TERREMOTO 10 AGOSTO 2026';
const yojanis = { nombre: 'YOJANIS', cedula: 'SIN INFO', evento, estado: 'PENDIENTE' };
const yojanisVacio = { nombre: 'YOJANIS', cedula: '', evento, estado: 'PENDIENTE' };
const yojanis2 = { nombre: 'YOJANIS', cedula: null, evento, estado: 'PENDIENTE' };
const carlosCali = { nombre: 'CARLOS', cedula: '', municipio: 'CALI', evento };
const carlosBogota = { nombre: 'CARLOS', cedula: '', municipio: 'BOGOTA', evento };
const carlosSinCiudad = { nombre: 'CARLOS', cedula: '', evento };
const mariaFull = {
  nombre: 'MARIA PEREZ GOMEZ',
  cedula: '12345678',
  evento,
};
const mariaPobre = { nombre: 'MARIA PEREZ GOMEZ', cedula: '', evento };

const checks = [
  ['YOJANIS SIN INFO vs vacío = mismo', sonElMismoCasoFdm(yojanis, yojanisVacio), true],
  ['YOJANIS reimport = mismo', sonElMismoCasoFdm(yojanisVacio, yojanis2), true],
  ['CARLOS distinta ciudad ≠ mismo', sonElMismoCasoFdm(carlosCali, carlosBogota), false],
  ['CARLOS con ciudad vs incompleto = mismo', sonElMismoCasoFdm(carlosCali, carlosSinCiudad), true],
  ['MARIA con cédula vs sin cédula = mismo', sonElMismoCasoFdm(mariaFull, mariaPobre), true],
];

const { filas, fusionados } = colapsarFilasDuplicadasFdm([yojanis, yojanisVacio, yojanis2]);
checks.push(['colapsar 3 YOJANIS → 1 fila', filas.length === 1 && fusionados === 2, true]);
checks.push([
  'clave NOID presente',
  clavesDeduplicacionFdm(yojanisVacio).some((k) => k.includes('|N:YOJANIS|NOID')),
  true,
]);

let fail = 0;
for (const [label, got, expected] of checks) {
  const ok = got === expected;
  if (!ok) fail += 1;
  console.log(`${ok ? 'OK' : 'FAIL'} ${label} → ${got}`);
}
if (fail) process.exit(1);
console.log('testFdmDedupSharePoint: PASS');
