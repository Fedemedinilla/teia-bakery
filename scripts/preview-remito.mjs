/**
 * Genera un remito de prueba para mirarlo. Bundlea con esbuild (los imports del
 * repo van sin extensión y node solo no los resuelve).
 * Uso: node scripts/preview-remito.mjs
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.test-out', { recursive: true });
const tmp = '.test-out/remito.bundle.mjs';
await build({ entryPoints: ['src/lib/remito.ts'], bundle: true, format: 'esm', platform: 'node',
  outfile: tmp, external: ['pdf-lib'], logLevel: 'silent' });
const { buildRemito } = await import('../' + tmp);

const order = {
  id: 42, order_number: 'TEIA-0042', status: 'confirmado',
  confirmed_at: '2026-07-28T13:20:00.000Z',
  client_name: 'Café Cid', client_contact: '11 5555-4444',
  delivery_address: 'Av. Maipú 2340, Olivos', delivery_date: '2026-07-30',
  notes: 'Si puede ser antes de las 10, mejor. Tocar el timbre del local.',
  total: 61560, discount_pct: 10,
};
const items = [
  { name: 'Medialunas de manteca', pack_label: 'x12', qty: 6, unit_price: 4200, line_total: 25200 },
  { name: 'Pan de campo', pack_label: 'unidad', qty: 8, unit_price: 1800, line_total: 14400 },
  { name: 'Budín de limón', pack_label: 'x6', qty: 4, unit_price: 4700, line_total: 18800 },
  { name: 'Alfajores de maicena', pack_label: 'x12', qty: 2, unit_price: 5000, line_total: 10000 },
];

writeFileSync('.test-out/remito-logo.pdf', Buffer.from(await buildRemito(order, items, 'cliente')));
rmSync(tmp, { force: true });
console.log('OK → .test-out/remito-logo.pdf');
