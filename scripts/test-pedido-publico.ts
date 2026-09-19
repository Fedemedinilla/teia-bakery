// Arnés del ALTA DE PEDIDOS del comercio (POST /api/order): el camino por el que entra la plata.
// Correr:  npx -y tsx scripts/test-pedido-publico.ts
//
// Por qué existe: hasta la tarea 3 (19/9) este endpoint no tenía NINGUNA prueba, y la tarea 3 saca
// su parte de grabado a src/lib/pedidos.ts para compartirla con el armado de pedidos del panel.
// Estas pruebas se escribieron y se corrieron contra el código VIEJO primero: fijan lo que hace
// hoy, caso por caso, incluidas las rarezas (una cantidad 0 se graba como 1; un producto a $0 se
// acepta). Un refactor no puede mover nada de esto sin que se note.
//
// Además, con GUARDAR=ruta escribe la secuencia exacta de llamadas a la base del camino feliz, para
// diffearla contra la del código nuevo (misma secuencia = mismo comportamiento frente a la base).
import { writeFileSync } from 'node:fs';
import { FakeDrive } from './fake-drive';
import { instalarFakes } from './fake-supabase';

let fallas = 0;
const ok = (cond: boolean, que: string) => {
  console.log(`${cond ? '  ok  ' : ' FALLA'} ${que}`);
  if (!cond) fallas++;
};
const seccion = (t: string) => console.log(`\n== ${t} ==\n`);

const drive = new FakeDrive();
const { supa, desinstalar } = instalarFakes(drive);
delete process.env.TEIA_SESSION_SECRET; // la firma sale de SUPABASE_SERVICE_ROLE_KEY (la del fake)
// El mail de pedido nuevo: se configura para ver si SALE, y se intercepta (nunca llega a Resend).
process.env.RESEND_API_KEY = 're_falsa';
process.env.TEIA_ALERT_EMAIL = 'avisos@example.com';
const mails: any[] = [];
const fetchFakes = globalThis.fetch;
globalThis.fetch = (async (entrada: any, init: any = {}) => {
  if (String(entrada).startsWith('https://api.resend.com/')) {
    mails.push(JSON.parse(String(init.body || '{}')));
    return new Response(JSON.stringify({ id: 'mail-falso' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fetchFakes(entrada, init);
}) as typeof fetch;

const { makeSession } = await import('../src/lib/session');
const { POST } = await import('../src/pages/api/order');

// Esquema de producción (con placed_by desde la tarea 3 solo si la suite lo agrega): una columna mal
// escrita en un select, un filtro o un cuerpo da 400, como en PostgREST.
const COLS_ORDERS = ['id', 'order_number', 'client_id', 'client_name', 'client_contact', 'delivery_address',
  'delivery_date', 'notes', 'status', 'version', 'total', 'discount_pct', 'created_at', 'confirmed_at', 'archive_status',
  'archive_error', 'archived_at', 'remito_cliente_url', 'remito_interno_url', 'saldo_anterior', 'costo_envio'];
supa.columnas.teia_orders = COLS_ORDERS;
supa.columnas.teia_order_items = ['id', 'order_id', 'product_id', 'name', 'pack_label', 'qty', 'unit_price', 'line_total'];
supa.columnas.teia_products = ['id', 'name', 'description', 'category', 'image_url', 'image_original_url', 'pack_label',
  'pack_size', 'price', 'stock', 'low_stock_threshold', 'active', 'catalog', 'sort_order', 'created_at'];

function sembrar() {
  supa.llamadas.length = 0;
  supa.limpiarGanchos();
  (supa as any).fallas.length = 0;
  mails.length = 0;
  supa.tablas = {
    teia_clients: [
      { id: 1, cuit: '30000000031', business_name: 'Café Uno', client_contact: '1100000003', delivery_address: 'Calle Falsa 303',
        catalog: 'general', active: true, access_code: null, discount_pct: 0, notes: '', last_order_at: null },
      { id: 2, cuit: '30000000023', business_name: 'Chungo Pilar', client_contact: '', delivery_address: '',
        catalog: 'chungo', active: true, access_code: null, discount_pct: 0, notes: '', last_order_at: null },
      { id: 3, cuit: '30000000058', business_name: 'Viejo SRL', client_contact: '', delivery_address: '',
        catalog: 'general', active: false, access_code: null, discount_pct: 0, notes: '', last_order_at: null },
    ],
    teia_products: [
      { id: 10, name: 'Torta de chocolate', pack_label: 'x1', price: 30000, stock: 5, active: true, catalog: 'general' },
      { id: 11, name: 'Lemon pie', pack_label: 'x1', price: 25000.5, stock: 3, active: true, catalog: 'general' },
      { id: 12, name: 'Chipá', pack_label: 'x12', price: 3000, stock: 99, active: true, catalog: 'chungo' },
      { id: 13, name: 'Producto discontinuado', pack_label: 'x1', price: 20000, stock: 9, active: false, catalog: 'general' },
      { id: 14, name: 'Recién creado sin precio', pack_label: '', price: 0, stock: 9, active: true, catalog: 'general' },
    ],
    teia_orders: [
      { id: 40, order_number: 'TEIA-0040', client_id: 1, client_name: 'Café Uno', client_contact: '1', delivery_address: 'X',
        status: 'confirmado', version: 1, total: 1000, discount_pct: 0, notes: '' },
    ],
    teia_order_items: [],
    teia_push_subs: [],
  };
}

// Un request del comercio con su cookie de sesión (la identidad sale SOLO de ahí).
async function pedir(body: any, clienteId: number | null = 1) {
  const r = await POST({
    request: new Request('http://localhost/api/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    cookies: { get: (n: string) => (n === 'teia_sess' && clienteId ? { value: makeSession(clienteId) } : undefined) },
  } as any);
  return { status: r.status, o: await r.json().catch(() => null) };
}
const datos = { client_name: 'Café Uno', client_contact: '11 5555-0000', delivery_address: 'Calle Falsa 303', notes: '' };
const nuevos = () => supa.tablas.teia_orders.filter((o) => o.id !== 40);
const lineasDe = (id: number) => supa.tablas.teia_order_items.filter((l) => l.order_id === id);

// ---------------------------------------------------------------------------
seccion('Camino feliz: precios de la BASE, número, fecha del último pedido y avisos');
sembrar();
let r = await pedir({ ...datos, notes: 'Entregar <antes> de las "10"', delivery_date: '2026-09-26',
  items: [{ id: '10', name: 'Torta', price: 1, qty: 2 }, { id: 11, name: 'Lemon', price: 1, qty: '3' }] });
const creado = nuevos()[0];
ok(r.status === 200 && r.o?.ok === true, `200 ok (${r.status})`);
ok(r.o?.order_number === 'TEIA-' + String(creado?.id).padStart(4, '0') && creado?.order_number === r.o?.order_number,
  `número TEIA-000N en la respuesta y en la base (${r.o?.order_number})`);
ok(r.o?.total === 30000 * 2 + 25000.5 * 3 && Number(creado?.total) === r.o?.total, `total con los precios de la base, no los del carrito: ${r.o?.total}`);
ok(creado?.client_id === 1 && creado?.status === 'pendiente' && creado?.version === 1 && creado?.discount_pct === 0,
  '  ...pendiente, versión 1, sin descuento, a nombre de la cuenta de la cookie');
// CAMBIO INTENCIONAL de la tarea 3 (19/9): antes la fecha que mandaba el cuerpo se grababa tal cual
// (el checkout no la ofrece: un comercio se fijaba solo el día de entrega). Ahora se ignora.
ok(creado?.notes === 'Entregar  antes  de las  10' && creado?.delivery_date === null,
  `  ...notas sin < > " (${JSON.stringify(creado?.notes)}) y SIN la fecha que mandó el cuerpo (${creado?.delivery_date})`);
ok(!('placed_by' in (creado || {})), '  ...y SIN marca de "cargado por Teia" (el comercio no la puede poner)');
const ls = lineasDe(creado?.id);
ok(ls.length === 2 && ls[0].product_id === 10 && ls[0].name === 'Torta de chocolate' && ls[0].unit_price === 30000 && ls[0].qty === 2 && ls[0].line_total === 60000,
  `línea 1 con nombre y precio de la base: ${JSON.stringify(ls[0])}`);
ok(ls[1]?.qty === 3 && ls[1]?.line_total === 25000.5 * 3 && ls[1]?.pack_label === 'x1', `línea 2 (qty '3' → 3): ${JSON.stringify(ls[1])}`);
ok(!!supa.tablas.teia_clients[0].last_order_at, '  ...actualiza la fecha del último pedido de la cuenta');
ok(supa.llamadas.some((l) => l.metodo === 'GET' && /teia_orders\?status=eq\.pendiente/.test(l.url)), '  ...dispara el aviso push (cuenta los pendientes para el globo)');
ok(mails.length === 1 && new RegExp(r.o?.order_number).test(mails[0].subject || ''), `  ...y el mail de pedido nuevo (${mails[0]?.subject})`);
// La secuencia exacta de llamadas a la base, para diffear el código viejo contra el nuevo.
const secuencia = supa.llamadas.map((l) => `${l.metodo} ${decodeURIComponent(l.url.replace('https://fake.supabase.co', ''))}` +
  (l.cuerpo ? ' ' + JSON.stringify(l.cuerpo, (k, v) => (k === 'last_order_at' ? '<ahora>' : v)) : ''));
if (process.env.GUARDAR) writeFileSync(process.env.GUARDAR, secuencia.join('\n') + '\n');

// ---------------------------------------------------------------------------
seccion('Identidad: la cookie, no el cuerpo');
sembrar();
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }] }, null);
ok(r.status === 401 && /sesión venció/.test(r.o?.error || '') && !nuevos().length, `sin sesión → 401 (${r.o?.error})`);
sembrar();
r = await pedir({ ...datos, client_id: 2, items: [{ id: 10, qty: 1 }] }, 1);
ok(r.status === 200 && nuevos()[0]?.client_id === 1, 'un client_id en el cuerpo se ignora: vale la cookie');
sembrar();
// Lo que un comercio podría mandar para hacerse pasar por Teia (tarea 3): marcar el pedido "cargado
// por Teia", apagar los avisos, fijarse el día, o pedir a nombre de otra cuenta. Nada de eso pasa.
r = await pedir({ ...datos, client_name: 'Otro Nombre SA', client_id: 2, placed_by: 'teia', armado_id: 'armado-falso-0000000',
  avisar: false, panel: 2, delivery_date: '2026-02-30', discount_pct: 20, items: [{ id: 10, qty: 1 }] }, 1);
const trucho = nuevos()[0];
ok(r.status === 200 && trucho?.client_id === 1 && trucho?.placed_by === undefined && trucho?.armado_id === undefined
  && trucho?.delivery_date === null && trucho?.discount_pct === 0,
  `un cuerpo que se hace pasar por Teia: sale a nombre de la cookie, sin marca, sin fecha, sin descuento (${JSON.stringify({ c: trucho?.client_id, p: trucho?.placed_by, f: trucho?.delivery_date, d: trucho?.discount_pct })})`);
ok(mails.length === 1 && supa.llamadas.some((l) => l.metodo === 'GET' && /teia_orders\?status=eq\.pendiente/.test(l.url)),
  '  ...y los dos avisos salen igual (push y mail)');
ok(trucho?.client_name === 'Otro Nombre SA', '  ...(el nombre del pedido sí sale del cuerpo: el comercio lo escribe en el checkout; se fija tal cual)');
sembrar();
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }] }, 3);
ok(r.status === 403 && /no está habilitada/.test(r.o?.error || '') && !nuevos().length, `cuenta de baja → 403 (${r.o?.error})`);
sembrar();
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }] }, 99);
ok(r.status === 403 && !nuevos().length, `cuenta borrada → 403 (${r.status})`);
sembrar();
supa.fallar(/teia_clients/, 503, 1, undefined, 'GET');
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }] });
ok(r.status === 503 && !nuevos().length, `no se pudo leer la cuenta → 503 (${r.o?.error})`);

// ---------------------------------------------------------------------------
seccion('El carrito y los datos');
sembrar();
r = await pedir('esto no es json');
ok(r.status === 400, `JSON inválido → 400 (${r.o?.error})`);
r = await pedir({ ...datos, items: [] });
ok(r.status === 400 && /vacío/.test(r.o?.error || ''), `carrito vacío → 400 (${r.o?.error})`);
r = await pedir({ ...datos, items: Array.from({ length: 201 }, () => ({ id: 10, qty: 1 })) });
ok(r.status === 400 && /Demasiados/.test(r.o?.error || ''), `más de 200 ítems → 400 (${r.o?.error})`);
for (const falta of ['client_name', 'client_contact', 'delivery_address']) {
  sembrar();
  r = await pedir({ ...datos, [falta]: '  <> ', items: [{ id: 10, qty: 1 }] });
  ok(r.status === 400 && /Faltan datos/.test(r.o?.error || '') && !nuevos().length, `${falta} vacío (o solo símbolos) → 400`);
}
sembrar();
r = await pedir({ ...datos, items: [{ id: 'abc', qty: 1 }] });
ok(r.status === 400 && /inválidos/.test(r.o?.error || ''), `id no numérico → 400 (${r.o?.error})`);
sembrar();
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }, { id: 13, name: 'Discontinuado', qty: 1 }, { id: 12, name: 'Chipá de otra lista', qty: 1 }] });
ok(r.status === 409 && /Discontinuado/.test(r.o?.error || '') && /Chipá de otra lista/.test(r.o?.error || '') && !nuevos().length,
  `oculto o de otra lista → 409 con los nombres del carrito (${r.o?.error})`);
sembrar();
supa.fallar(/teia_products/, 503, 1, undefined, 'GET');
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }] });
ok(r.status === 503 && !nuevos().length, `no se pudieron leer los precios → 503, nunca a $0 (${r.o?.error})`);

// ---------------------------------------------------------------------------
seccion('Rarezas de hoy (se fijan tal cual: un refactor no las mueve sin avisar)');
sembrar();
r = await pedir({ ...datos, items: [{ id: 10, qty: 0 }, { id: 11, qty: 'abc' }, { id: 14, qty: 20000 }, { id: 10, qty: 2.7 }] });
const raras = lineasDe(nuevos()[0]?.id);
ok(r.status === 200 && raras.map((l) => l.qty).join(',') === '1,1,9999,2',
  `qty 0 → 1, 'abc' → 1, 20000 → 9999, 2.7 → 2: ${raras.map((l) => l.qty).join(',')}`);
ok(raras.length === 4 && raras[0].product_id === 10 && raras[3].product_id === 10, '  ...el mismo producto dos veces da DOS líneas (no se fusionan)');
ok(raras[2]?.unit_price === 0 && raras[2]?.line_total === 0, '  ...y un producto a $0 entra a $0');

// ---------------------------------------------------------------------------
seccion('Si algo falla al grabar');
sembrar();
supa.fallar(/teia_orders/, 500, 1, undefined, 'POST');
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }] });
ok(r.status === 500 && r.o?.error === 'No se pudo crear el pedido.' && !nuevos().length, `falla el pedido → 500 (${r.o?.error})`);
ok(!!supa.tablas.teia_clients[0].last_order_at, '  ...(la fecha del último pedido se actualiza igual: se escribe antes, hoy es así)');
sembrar();
supa.fallar(/teia_order_items/, 500, 1, undefined, 'POST');
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }] });
ok(r.status === 500 && /No se pudo guardar el pedido/.test(r.o?.error || '') && !nuevos().length,
  `fallan las líneas → se borra el pedido huérfano y 500 (${r.o?.error}; quedan ${nuevos().length})`);
ok(mails.length === 0, '  ...y no avisa de un pedido que no existe');
sembrar();
supa.fallar(/teia_orders\?id=eq\./, 500, 1, undefined, 'PATCH');
r = await pedir({ ...datos, items: [{ id: 10, qty: 1 }] });
ok(r.status === 200 && nuevos()[0]?.order_number === r.o?.order_number && supa.fallasDisparadas() === 1,
  `el número falla una vez → se reintenta y queda (${nuevos()[0]?.order_number})`);

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
globalThis.fetch = fetchFakes;
desinstalar();
process.exit(fallas ? 1 : 0);
