// Harness de regresión del generador de remitos: lo corre con los inputs más hostiles que
// puede mandar un cliente real (emoji, ★, acentos descompuestos de teclado móvil, saltos de
// línea, el '−' tipográfico del descuento) y con un caso "limpio" de control.
// Correr desde la raíz del repo:  npx -y tsx scripts/test-remito.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildRemito } from '../src/lib/remito';

const hostil = {
  id: 99,
  order_number: 'TEIA-0099',
  client_name: 'Café “La Estrella” ★ 😀 Ñandú',
  client_contact: 'ñandu.pastelería@gmail.com 🙏 +54 9 11 5555-1234',
  delivery_address: 'Av. Libertador 12345 🏠, Vicente López — timbre B',
  delivery_date: '2026-07-20',
  notes: 'Sin frutos secos 🥜 (alergia)\nTocar timbre B ✓\ncafé con acento descompuesto (NFD)',
  discount_pct: 10, // dispara el bloque Subtotal/Descuento (el del '−' U+2212 que crasheaba)
  total: 40500,
  confirmed_at: '2026-07-16T23:45:00.000Z',
  created_at: '2026-07-15T12:00:00Z',
};
const itemsHostiles = [
  { name: 'Cheesecake de frutos rojos 🍓', pack_label: 'x6', qty: 3, unit_price: 9000, line_total: 27000 },
  { name: 'Pavlova —edición especial— 中文', pack_label: 'x12', qty: 2, unit_price: 9000, line_total: 18000 },
];

const limpio = { ...hostil, id: 100, order_number: 'TEIA-0100', client_name: 'Café de la Esquina', client_contact: '11 5555-1234', delivery_address: 'Mitre 500, San Isidro', notes: 'Entregar antes de las 10 hs.', discount_pct: 0, total: 45000 };
const itemsLimpios = [{ name: 'Torta de ñoquis… no, de chocolate', pack_label: 'x6', qty: 5, unit_price: 9000, line_total: 45000 }];

// Caso LARGO: 30 ítems + aclaraciones de ~480 chars → tiene que paginar (antes de la
// paginación, desde ~22 ítems las filas pisaban el pie y se salían de la hoja).
const itemsLargos = Array.from({ length: 30 }, (_, i) => ({
  name: `Producto de prueba número ${i + 1} con nombre bien largo para el clip`,
  pack_label: i % 2 ? 'x12' : 'x6', qty: (i % 9) + 1, unit_price: 9000, line_total: 9000 * ((i % 9) + 1),
}));
const largo = {
  ...limpio, id: 101, order_number: 'TEIA-0101', discount_pct: 10,
  total: Math.round(itemsLargos.reduce((s, i) => s + i.line_total, 0) * 0.9),
  notes: ('Cliente con alergias: sin frutos secos ni maní en NINGÚN producto. Entregar entre 8 y 10 hs por el portón lateral de la calle interna. ').repeat(3) + 'Facturar aparte los envíos. Timbre B.',
};

const outDir = fileURLToPath(new URL('../.test-out/', import.meta.url));
mkdirSync(outDir, { recursive: true });

let fallos = 0;
for (const [tag, order, items] of [
  ['hostil', hostil, itemsHostiles],
  ['limpio', limpio, itemsLimpios],
  ['largo', largo, itemsLargos],
] as const) {
  for (const variant of ['cliente', 'interno'] as const) {
    try {
      const bytes = await buildRemito(order as any, items as any, variant);
      writeFileSync(join(outDir, `remito-${tag}-${variant}.pdf`), bytes);
      console.log(`OK  remito ${tag}/${variant} → ${bytes.length} bytes`);
    } catch (e: any) {
      fallos++;
      console.error(`FALLÓ remito ${tag}/${variant}: ${e?.message}`);
    }
  }
}
if (fallos) { console.error(`\n${fallos} caso(s) fallaron`); process.exit(1); }
console.log('\nTodos los remitos se generaron sin excepción ✓');
