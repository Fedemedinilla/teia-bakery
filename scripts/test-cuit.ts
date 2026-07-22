// Test del validador de CUIT (mod-11 AFIP) con CUITs públicos conocidos.
// Correr: npx -y tsx scripts/test-cuit.ts
import { isValidCuit, normCuit, fmtCuit } from '../src/lib/cuit';

const casos: Array<[string, boolean]> = [
  ['33-69345023-9', true],   // AFIP (público)
  ['30-70308853-4', true],   // Mercado Libre SRL (público)
  ['20-00000000-1', true],   // verificador calculado a mano
  ['20 00000000 1', true],   // con espacios
  ['30-12345678-1', true],   // el EJEMPLO de los placeholders — si esto falla, el placeholder miente
  ['30-12345678-6', false],  // el placeholder viejo roto (verificador incorrecto) — nunca volver
  ['33-69345023-8', false],  // verificador pisado
  ['123', false],
  ['20-11111111-1', false],
  ['', false],
];

let fallos = 0;
for (const [c, esperado] of casos) {
  const dio = isValidCuit(c);
  if (dio !== esperado) { fallos++; console.error(`FALLO  ${c || '(vacío)'} → esperaba ${esperado}, dio ${dio}`); }
  else console.log(`ok     ${(c || '(vacío)').padEnd(15)} → ${dio}`);
}
console.log('fmt:', fmtCuit('20000000001'), '· norm:', normCuit('20-00.000 000/1'));
if (fallos) { console.error(`${fallos} caso(s) fallaron`); process.exit(1); }
console.log('Validador de CUIT ✓');
