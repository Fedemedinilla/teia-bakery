/**
 * Vista previa del mail de aviso de pedido nuevo, con datos de ejemplo.
 * Uso:  node scripts/preview-aviso.ts
 * Deja .test-out/aviso.html para abrirlo en el navegador.
 *
 * Se bundlea con esbuild (ya viene con Vite) porque el módulo importa sin
 * extensión, como el resto del repo, y node solo no lo resuelve.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.test-out', { recursive: true });
const tmp = '.test-out/aviso.bundle.mjs';
await build({ entryPoints: ['src/lib/aviso.ts'], bundle: true, format: 'esm', platform: 'node', outfile: tmp, logLevel: 'silent' });

const { armarHtml } = await import('../' + tmp);

writeFileSync('.test-out/aviso.html', armarHtml({
  order_number: 'TEIA-0042',
  comercio: 'Café Cid',
  cuit: '30-71234567-8',
  contacto: '11 5555-4444',
  direccion: 'Av. Maipú 2340, Olivos',
  notas: 'Si puede ser antes de las 10, mejor. Tocar el timbre del local, no el de arriba.',
  total: 68400,
  items: [
    { name: 'Medialunas de manteca', pack_label: 'x12', qty: 6, line_total: 25200 },
    { name: 'Pan de campo', pack_label: 'unidad', qty: 8, line_total: 14400 },
    { name: 'Budín de limón', pack_label: 'x6', qty: 4, line_total: 18800 },
    { name: 'Alfajores de maicena', pack_label: 'x12', qty: 2, line_total: 10000 },
  ],
  panelUrl: 'https://teia-bakery.vercel.app/administradora#pedidos',
}), 'utf8');

rmSync(tmp, { force: true });
console.log('OK → .test-out/aviso.html');
