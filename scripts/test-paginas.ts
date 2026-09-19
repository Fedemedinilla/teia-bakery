// Arnés de la lectura PAGINADA (sbSelectTodoStrict) y del espejo del Sheet que la usa.
// Correr:  npx -y tsx scripts/test-paginas.ts
//
// PostgREST corta cada respuesta en `db-max-rows` (1000 en Supabase) SIN avisar: pedir limit=8000
// devuelve 1000 filas con un 200 normal. El espejo pedía limit=8000 de ítems y limit=2000 de
// pedidos, así que al pasar las 1000 líneas el Sheet iba a perder en silencio los pedidos viejos
// (auditoría del 19/9). Acá el fake corta igual que Supabase (maxFilas = 1000), y el FakeDrive
// guarda lo que se escribe en cada pestaña del Sheet, para contar las filas que llegan de verdad.
import { FakeDrive } from './fake-drive';
import { instalarFakes } from './fake-supabase';
import { readFileSync } from 'node:fs';

let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${que}`);
  if (!cond) fallas++;
};
const seccion = (t: string) => console.log(`\n== ${t} ==\n`);

const drive = new FakeDrive();
const { supa, desinstalar } = instalarFakes(drive);
const { sbSelectStrict, sbSelectTodoStrict } = await import('../src/lib/supabase');

const sembrar = (nPedidos: number, lineasPorPedido: number) => {
  supa.llamadas.length = 0;
  supa.limpiarGanchos();
  (supa as any).fallas.length = 0;
  const pedidos: any[] = [], items: any[] = [];
  let idItem = 1;
  for (let i = 1; i <= nPedidos; i++) {
    pedidos.push({ id: i, order_number: `TEIA-${String(i).padStart(4, '0')}`, client_name: 'Café Uno', client_id: null, status: 'confirmado',
      total: 1000 * lineasPorPedido, discount_pct: 0, created_at: new Date(Date.UTC(2026, 7, 1) + i * 60000).toISOString() });
    for (let j = 0; j < lineasPorPedido; j++) {
      items.push({ id: idItem++, order_id: i, product_id: 1, name: 'Chipá', qty: 1, unit_price: 1000, line_total: 1000 });
    }
  }
  supa.tablas = { teia_orders: pedidos, teia_order_items: items, teia_products: [{ id: 1, name: 'Chipá', category: 'Salados' }], teia_clients: [] };
};
const leidasDe = (tabla: string) => supa.llamadas.filter((l: any) => l.metodo === 'GET' && new RegExp(`/${tabla}\\?`).test(l.url));

seccion('El fake corta como Supabase (si no, esta prueba no prueba nada)');
supa.maxFilas = 1000;
sembrar(500, 5); // 2.500 líneas
const cortada = await sbSelectStrict(`teia_order_items?select=*&order=order_id.desc&limit=8000`);
ok(cortada?.length === 1000, `limit=8000 devuelve 1000 filas, sin error (${cortada?.length}) — lo que le pasaba al Sheet`);

seccion('sbSelectTodoStrict trae TODO');
supa.llamadas.length = 0;
let todas = await sbSelectTodoStrict('teia_order_items');
ok(todas?.length === 2500, `las 2.500 líneas (${todas?.length})`);
ok(new Set(todas?.map((f: any) => f.id)).size === 2500, '  ...sin repetidas');
ok(todas?.every((f: any, i: number, a: any[]) => i === 0 || a[i - 1].id < f.id), '  ...en orden de id');
ok(leidasDe('teia_order_items').length === 4, `  ...en 4 páginas: 3 con datos + 1 vacía que cierra (${leidasDe('teia_order_items').length})`);
ok(leidasDe('teia_order_items').slice(1).every((l: any) => /id=gt\.\d+/.test(l.url)), '  ...por rangos de id (id=gt.N), no por offset');

supa.maxFilas = 300; // un tope MENOR que la página pedida: igual tiene que recorrer todo
sembrar(500, 5);
todas = await sbSelectTodoStrict('teia_order_items');
ok(todas?.length === 2500, `con un tope de 300 (menor que la página de 1000) también trae las 2.500 (${todas?.length})`);
supa.maxFilas = 1000;

seccion('Un borrado ENTRE páginas no hace saltear una fila que sigue existiendo');
// Con offset, borrar una fila de la primera página corría a las demás un lugar y la primera de la
// segunda página se salteaba en silencio (segunda auditoría del 19/9).
sembrar(1500, 1);
// El gancho corre UNA vez, después de la primera lectura de la tabla, se pagine como se pagine
// (atarlo a la forma exacta de la URL hacía que con offset el borrado no ocurriera y la prueba pasara).
const borrado = supa.despuesDe(/\/teia_orders\?/, 'GET', () => {
  supa.tablas.teia_orders = supa.tablas.teia_orders.filter((o: any) => o.id !== 400);
});
todas = await sbSelectTodoStrict('teia_orders');
const ids = new Set(todas?.map((o: any) => o.id));
ok(borrado.disparos === 1, 'el borrado entre páginas ocurrió de verdad');
ok(ids.has(1001), 'el pedido 1001 (primero de la segunda página) llegó');
ok(todas?.length === 1500, `llegaron los 1.500 que se leyeron en la página 1 más los 500 de la 2 (${todas?.length})`);
supa.limpiarGanchos();

seccion('Fallas');
sembrar(500, 5);
supa.fallar(/teia_order_items\?select=\*&id=gt\.1000/, 503, 1, undefined, 'GET');
todas = await sbSelectTodoStrict('teia_order_items');
ok(supa.fallasDisparadas() === 1 && todas === null, 'si falla una página del medio: null, nunca una lectura a medias');
sembrar(0, 0);
todas = await sbSelectTodoStrict('teia_order_items');
ok(Array.isArray(todas) && todas.length === 0, 'una tabla vacía da [] (no null)');
let tiro = false;
try { await sbSelectTodoStrict('teia_orders', 'select=*&order=created_at.desc'); } catch { tiro = true; }
ok(tiro, 'con un order en la consulta, avisa en vez de paginar mal');

seccion('El espejo del Sheet: TODAS las filas llegan a sus pestañas');
const google = readFileSync(new URL('../src/lib/google.ts', import.meta.url), 'utf8');
const codigo = google.replace(/\/\/.*$/gm, '');
ok(!/limit=\d{4,}/.test(codigo), 'no queda ningún limit=NNNN en el código de google.ts');
sembrar(1500, 2); // 1.500 pedidos y 3.000 líneas
supa.tablas.teia_clients = [];
const { mirrorToSheet } = await import('../src/lib/google');
let error: unknown = null;
try { await mirrorToSheet(); } catch (e) { error = e; }
ok(!error, `el espejo terminó sin error (${error ? (error as any).message : 'ok'})`);
const pedidosSheet = drive.filasDe('Pedidos'), itemsSheet = drive.filasDe('Ítems');
ok(pedidosSheet?.length === 1501, `la pestaña Pedidos tiene los 1.500 pedidos + el encabezado (${pedidosSheet?.length})`);
ok(itemsSheet?.length === 3001, `la pestaña Ítems tiene las 3.000 líneas + el encabezado (${itemsSheet?.length}) — antes llegaban 1.000`);
ok(pedidosSheet?.[1]?.[0] === 'TEIA-1500' && pedidosSheet?.[1500]?.[0] === 'TEIA-0001', '  ...del pedido más nuevo al más viejo');

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
desinstalar();
process.exit(fallas ? 1 : 0);
