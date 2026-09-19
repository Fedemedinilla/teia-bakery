// Arnés del lector de MONTOS del remito (saldo anterior y costo de envío).
// Correr:  npx -y tsx scripts/test-montos.ts
//
// Por qué existe: el lector viejo (montoEscrito en lib/remito.ts) sacaba todo lo que no fuera
// dígito, coma o punto, y después borraba TODOS los puntos. Así guardaba en silencio montos que ella
// no escribió: "8 mil" → $8, "8000.50" → $800.050, "1e4" → $14, "8,000" → $8. Y el remito salía con
// ese número, en un pedido que ya no se puede editar (auditoría del 19/9).
//
// Un lector de plata tiene TRES respuestas, no dos: un número, "vacío" (el renglón queda en blanco
// para completar a mano) o "esto no lo entiendo" (se rechaza y se le pide que lo vuelva a escribir).
// El punto solo vale como separador de MILES bien formado (grupos de tres); los decimales van con
// coma. Lo que tiene dos lecturas posibles se rechaza, no se adivina.
import { montoEscrito, montoParaCampo, porQueNoSeEntiende } from '../src/lib/montos';

let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${que}`);
  if (!cond) fallas++;
};
const seccion = (t: string) => console.log(`\n== ${t} ==\n`);

// El lector de PRODUCCIÓN, copiado tal cual (lib/remito.ts hasta el 19/9), para diffear.
function viejo(v: any): number | null | undefined {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const limpio = s.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
  if (!/[0-9]/.test(limpio)) return undefined;
  const n = Number(limpio);
  if (!Number.isFinite(n) || Math.abs(n) > 99_999_999) return undefined;
  return Math.round(n * 100) / 100;
}

const txt = (v: unknown) => (v === undefined ? 'RECHAZA' : v === null ? 'vacío' : String(v));

seccion('Lo que ella escribe de verdad: da EXACTAMENTE lo mismo que antes');
const iguales: [unknown, number | null][] = [
  ['8000', 8000], ['8.000', 8000], ['$8.000', 8000], ['$ 8.000', 8000], [' 8000 ', 8000], ['$8000', 8000],
  ['12.500', 12500], ['1.000.000', 1000000], ['0', 0], ['$0', 0],
  ['-3000', -3000], ['-3.000', -3000], ['-$3.000', -3000], ['$-3.000', -3000],
  ['8.000,50', 8000.5], ['8000,5', 8000.5], ['8000,50', 8000.5], ['0,5', 0.5],
  ['', null], ['   ', null], [null, null], [undefined, null],
];
for (const [v, esperado] of iguales) {
  const n = montoEscrito(v);
  ok(n === esperado && viejo(v) === esperado, `${JSON.stringify(v)} → ${txt(esperado)} (viejo ${txt(viejo(v))}, nuevo ${txt(n)})`);
}

seccion('Lo que el viejo DESTROZABA en silencio: el nuevo lo rechaza');
const destrozados: [string, number][] = [
  ['8 mil', 8], ['$8 mil', 8], ['8.5 mil', 85], ['8k', 8], ['1e4', 14], ['8000.50', 800050],
  ['8000.5', 80005], ['8.5', 85], ['8,000', 8], ['8.000.5', 80005], ['2.50.000', 250000], ['25.0000', 250000],
];
for (const [v, loQueGuardaba] of destrozados) {
  ok(viejo(v) === loQueGuardaba && montoEscrito(v) === undefined,
    `${JSON.stringify(v)}: el viejo guardaba ${loQueGuardaba.toLocaleString('es-AR')}, el nuevo lo rechaza (${txt(montoEscrito(v))})`);
}

seccion('Otras cosas que no se entienden: rechazadas (tercera respuesta)');
for (const v of ['ocho mil', 'abc', '$', '-', ',5', '.5', '8000,', '8000,505', '8 000', '1 000 000', '--5', '5-', '$$5', '8.000,5,0', '100000000', '99999999,999']) {
  ok(montoEscrito(v) === undefined, `${JSON.stringify(v)} → rechazado (${txt(montoEscrito(v))})`);
}
ok(montoEscrito('99.999.999') === 99999999, "el tope: '99.999.999' vale");

seccion('Números que llegan como número (JSON), no como texto');
ok(montoEscrito(8000) === 8000, '8000 → 8000');
ok(montoEscrito(8000.5) === 8000.5, `8000.5 (número) → 8000.5; el viejo daba ${viejo(8000.5)} porque lo pasaba a texto y borraba el punto`);
ok(montoEscrito(-3000.25) === -3000.25, '-3000.25 → -3000.25');
ok(montoEscrito(0.005) === 0.01 || montoEscrito(0.005) === 0, 'se redondea a centavos');
ok(montoEscrito(NaN) === undefined && montoEscrito(Infinity) === undefined, 'NaN / Infinity → rechazado');
ok(montoEscrito(100_000_000) === undefined, 'fuera de tope → rechazado');
ok(Object.is(montoEscrito('-0'), 0), "'-0' → 0 (no -0)");

seccion('Ida y vuelta: lo que se guardó, puesto en el campo, se vuelve a leer igual');
// El campo del panel se llena con montoParaCampo. Antes se llenaba con String(n): un envío de
// 8000,50 guardado se mostraba "8000.5", y al volver a leerlo daba 80005 (el punto como miles).
for (const n of [8000, 8000.5, 0.5, 1234567.89, -3000, -3000.25, 0, 99999999]) {
  const campo = montoParaCampo(n);
  ok(montoEscrito(campo) === n, `${n} → campo "${campo}" → ${txt(montoEscrito(campo))}`);
}
for (const n of ['8000.50', '8000']) { // PostgREST puede devolver numeric como texto
  ok(montoEscrito(montoParaCampo(n)) === Number(n), `"${n}" (texto de la base) → campo "${montoParaCampo(n)}" → ${txt(montoEscrito(montoParaCampo(n)))}`);
}
ok(montoParaCampo(null) === '' && montoParaCampo(undefined) === '' && montoParaCampo('') === '', 'vacío → campo vacío');
ok(montoParaCampo(0) === '0', "el 0 se muestra '0', no vacío (un envío de $0 no es un envío sin cargar)");

seccion('El precio redondo a la argentina: "$ 8.000.-"');
for (const [v, n] of [['$ 8.000.-', 8000], ['8.000,-', 8000], ['8000.-', 8000], ['$8.000.-', 8000]] as const) {
  ok(montoEscrito(v) === n, `${JSON.stringify(v)} → ${n} (${txt(montoEscrito(v))})`);
}
ok(montoEscrito('8.000,50-') === undefined && montoEscrito('8000,') === undefined, 'pero "8.000,50-" y "8000," no');

seccion('El costo de envío NO puede ser negativo; el saldo sí (a favor del comercio)');
const envio = { negativo: false };
for (const v of ['-8000', '−8.000', '- 8000', '$-8000', '-$8.000', -8000]) {
  ok(montoEscrito(v, envio) === undefined, `envío ${JSON.stringify(v)} → rechazado (antes: el remito le descontaba el flete al total)`);
}
ok(montoEscrito('-3.000') === -3000 && montoEscrito('-3.000', { negativo: true }) === -3000, 'saldo "-3.000" → -3000 (sigue valiendo)');
ok(montoEscrito('0', envio) === 0 && montoEscrito('-0', envio) === 0, 'envío 0 y "-0" → 0 (no es negativo)');

seccion('El motivo del rechazo, dicho para ella');
const motivo = (v: unknown, o = {}) => porQueNoSeEntiende(v, o);
ok(/sin letras/.test(motivo('8 mil')), `"8 mil": ${motivo('8 mil')}`);
ok(/van con coma/.test(motivo('8000.50')), `"8000.50": ${motivo('8000.50')}`);
ok(/demasiado grande/.test(motivo('150.000.000')), `"150.000.000": ${motivo('150.000.000')}`);
ok(/negativo/.test(motivo('-8000', envio)), `envío "-8000": ${motivo('-8000', envio)}`);
ok(/no se entiende/.test(motivo('8 000')), `"8 000": ${motivo('8 000')}`);
// Antes: "--3000" en el saldo decía "es demasiado grande" (auditoría del 19/9).
for (const v of ['--3000', '-$-3000', '−-3.000']) {
  ok(montoEscrito(v) === undefined && /dos signos/.test(motivo(v)), `saldo ${JSON.stringify(v)}: ${motivo(v)}`);
  ok(/dos signos/.test(motivo(v, envio)), `envío ${JSON.stringify(v)}: ${motivo(v, envio)}`);
}

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
process.exit(fallas ? 1 : 0);
