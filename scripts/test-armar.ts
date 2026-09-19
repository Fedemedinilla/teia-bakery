// Arnés del ARMADO DE PEDIDOS de la administradora (tarea 3, 19/9): POST /api/admin/armar y las
// piezas puras de src/lib/pedidos.ts. Correr:  npx -y tsx scripts/test-armar.ts
//
// La función SQL que graba (teia_armar_pedido) se probó contra Postgres de verdad (PGlite:
// scratchpad/pg/test-sql-armar.mjs). Acá corre su emulación en el fake, con las mismas reglas.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
delete process.env.TEIA_SESSION_SECRET;
process.env.TEIA_ADMIN_PASSWORD = 'clave-de-prueba';
// El mail de pedido nuevo CONFIGURADO: así "no avisa" significa algo (sin configurar, no avisaría nunca).
process.env.RESEND_API_KEY = 're_falsa';
process.env.TEIA_ALERT_EMAIL = 'avisos@example.com';
const mails: any[] = [];
const fetchFakes = globalThis.fetch;
globalThis.fetch = (async (entrada: any, init: any = {}) => {
  if (String(entrada).startsWith('https://api.resend.com/')) {
    mails.push(JSON.parse(String(init.body || '{}')));
    return new Response('{"id":"x"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return fetchFakes(entrada, init);
}) as typeof fetch;

const { makeAdminSession } = await import('../src/lib/auth');
const { makeSession } = await import('../src/lib/session');
const { POST } = await import('../src/pages/api/admin/armar');
const { POST: PEDIDO_PUBLICO } = await import('../src/pages/api/order');
const { lineasParaRepetir, fechaDeEntrega, totalConDescuento, centavos, DESCUENTOS } = await import('../src/lib/pedidos');

supa.columnas.teia_orders = ['id', 'order_number', 'client_id', 'client_name', 'client_contact', 'delivery_address',
  'delivery_date', 'notes', 'status', 'version', 'total', 'discount_pct', 'created_at', 'confirmed_at', 'archive_status',
  'archive_error', 'archived_at', 'remito_cliente_url', 'remito_interno_url', 'saldo_anterior', 'costo_envio',
  'placed_by', 'armado_id'];
supa.columnas.teia_order_items = ['id', 'order_id', 'product_id', 'name', 'pack_label', 'qty', 'unit_price', 'line_total'];
supa.columnas.teia_products = ['id', 'name', 'description', 'category', 'image_url', 'image_original_url', 'pack_label',
  'pack_size', 'price', 'stock', 'low_stock_threshold', 'active', 'catalog', 'sort_order', 'created_at'];

function sembrar() {
  supa.llamadas.length = 0;
  supa.limpiarGanchos();
  (supa as any).fallas.length = 0;
  supa.funcionArmar = true;
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
      { id: 11, name: 'Lemon pie', pack_label: 'x1', price: 1234.56, stock: 3, active: true, catalog: 'general' },
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
const nuevos = () => supa.tablas.teia_orders.filter((o) => o.id !== 40);
const lineasDe = (id: number) => supa.tablas.teia_order_items.filter((l) => l.order_id === id);
const escrituras = () => supa.llamadas.filter((l) => l.metodo !== 'GET');
const avisoPush = () => supa.llamadas.some((l) => l.metodo === 'GET' && /teia_orders\?status=eq\.pendiente/.test(l.url));

let nArmado = 0;
const nuevoArmado = () => `armado-prueba-${String(++nArmado).padStart(6, '0')}`;
// Lo que manda la página: cantidades, lo que ella VIO (precio de cada línea, lista, total) y la entrega.
function cuerpo(extra: Record<string, any> = {}) {
  const items = extra.items ?? [{ product_id: 10, qty: 2, precio: 30000 }, { product_id: 11, qty: 3, precio: 1234.56 }];
  const pct = extra.discount_pct ?? 0;
  const sub = items.reduce((s: number, i: any) => s + Math.round(i.precio * i.qty * 100) / 100, 0);
  return {
    panel: 2, armado_id: nuevoArmado(), client_id: 1, catalog_visto: 'general', discount_pct: pct,
    total_visto: totalConDescuento(sub, pct), client_contact: '11 5555-0000', delivery_address: 'Calle Falsa 303',
    delivery_date: '2026-09-26', notes: 'Entregar temprano', items, ...extra,
  };
}
async function armar(body: any, { cookie = true, basic = false, tipo = 'application/json' } = {}) {
  const headers: Record<string, string> = { 'Content-Type': tipo };
  if (cookie) headers.Cookie = `teia_admin=${makeAdminSession()}`;
  if (basic) headers.Authorization = 'Basic ' + Buffer.from('teia:clave-de-prueba').toString('base64');
  const r = await POST({
    request: new Request('http://localhost/api/admin/armar', {
      method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any);
  return { status: r.status, o: await r.json().catch(() => null) };
}

// ---------------------------------------------------------------------------
seccion('Piezas puras (lib/pedidos.ts)');
ok(totalConDescuento(61703.68, 0) === 61703.68 && totalConDescuento(61703.68, 10) === 55533 && totalConDescuento(0.1 + 0.2, 0) === 0.3,
  'total: sin descuento a centavos, con descuento a pesos');
ok(JSON.stringify(DESCUENTOS) === '[0,5,10,15,20]', 'los descuentos del panel');
ok(centavos(0.1 + 0.2) === centavos(0.3) && centavos('1234.56') === 123456, 'centavos compara sin ruido de flotante');
const fechas: [unknown, string | null | undefined][] = [['', null], [null, null], ['  ', null], ['2026-09-26', '2026-09-26'],
  ['2026-02-30', undefined], ['2026-13-01', undefined], ['26/09/2026', undefined], ['2026-9-26', undefined], ['1999-01-01', undefined], ['2028-02-29', '2028-02-29']];
for (const [v, esperado] of fechas) ok(fechaDeEntrega(v) === esperado, `fecha ${JSON.stringify(v)} → ${JSON.stringify(esperado)}`);

const hoy = new Map([
  [10, { id: 10, name: 'Torta de chocolate', price: 32000, stock: 5 }],
  [11, { id: 11, name: 'Lemon pie', price: 1234.56, stock: 0 }],
  [14, { id: 14, name: 'Sin precio', price: 0, stock: 3 }],
]);
const rep = lineasParaRepetir([
  { product_id: 10, name: 'Torta de chocolate', qty: 2, unit_price: 30000 },
  { product_id: 10, name: 'Torta de chocolate', qty: 2, unit_price: 30000 },
  { product_id: null, name: 'Algo que se borró', qty: 1 },
  { product_id: 13, name: 'Discontinuado', qty: 1 },
  { product_id: 14, name: 'Sin precio', qty: 1 },
  { product_id: 11, name: 'Lemon pie', qty: 9000, unit_price: 1234.56 },
  { product_id: 11, name: 'Lemon pie', qty: 5000, unit_price: 1234.56 },
], hoy as any);
ok(JSON.stringify(rep.lineas) === JSON.stringify([{ product_id: 10, qty: 4 }, { product_id: 11, qty: 9999 }]), `precarga: ${JSON.stringify(rep.lineas)}`);
ok(rep.omitidas.map((x) => x.name).join('|') === 'Algo que se borró|Discontinuado|Sin precio', `omitidas con motivo: ${rep.omitidas.map((x) => x.name + ' (' + x.motivo + ')').join('; ')}`);
ok(rep.juntadas.length === 2 && rep.juntadas[0].qty === 4 && rep.topeadas[0]?.qty === 14000, 'las repetidas se juntan y el tope se avisa');
ok(rep.sinStock.map((x) => x.name).join() === 'Lemon pie' && rep.cambiosDePrecio[0]?.antes === 30000 && rep.cambiosDePrecio[0]?.hoy === 32000,
  'sin stock y cambios de precio, avisados');

// ---------------------------------------------------------------------------
seccion('Camino feliz: a nombre de la cuenta, marcado, sin avisar a nadie');
sembrar();
let r = await armar(cuerpo({ client_name: 'Nombre inventado', placed_by: 'otro', total_visto: 60000 + 3703.68 }));
const creado = nuevos()[0];
ok(r.status === 200 && r.o?.ok && r.o?.order_number === creado?.order_number && /^TEIA-\d{4,}$/.test(r.o?.order_number || ''),
  `200 y número (${r.status}: ${r.o?.order_number || r.o?.error})`);
ok(creado?.client_id === 1 && creado?.client_name === 'Café Uno', `a nombre de la CUENTA, no del cuerpo (${creado?.client_name})`);
ok(creado?.placed_by === 'teia' && creado?.status === 'pendiente' && creado?.version === 1, '  ...marcado "cargado por Teia", pendiente');
ok(Number(creado?.total) === 63703.68 && r.o?.total === 63703.68 && creado?.discount_pct === 0, `  ...total a centavos (${creado?.total})`);
ok(creado?.delivery_date === '2026-09-26' && creado?.notes === 'Entregar temprano' && creado?.client_contact === '11 5555-0000', '  ...con el día y los datos de entrega');
const ls = lineasDe(creado?.id);
ok(ls.length === 2 && ls[1].name === 'Lemon pie' && ls[1].unit_price === 1234.56 && ls[1].line_total === 3703.68, `  ...líneas con nombre y precio de la base: ${JSON.stringify(ls[1])}`);
ok(!!supa.tablas.teia_clients[0].last_order_at, '  ...y "último pedido" de la cuenta al día');
ok(!avisoPush() && mails.length === 0, 'NO avisa: ni push ni mail (con el mail configurado)');
// Control en la MISMA corrida: el alta del comercio sí avisa. Si esto falla, el "no avisa" de arriba no prueba nada.
const rp = await PEDIDO_PUBLICO({
  request: new Request('http://localhost/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Café Uno', client_contact: '1', delivery_address: 'X', items: [{ id: 10, qty: 1 }] }) }),
  cookies: { get: (n: string) => (n === 'teia_sess' ? { value: makeSession(1) } : undefined) },
} as any);
ok(rp.status === 200 && avisoPush() && mails.length === 1, 'control: el pedido del comercio SÍ avisa (push y mail)');
ok(!('placed_by' in (nuevos()[1] || {})), '  ...y no queda marcado');

sembrar();
r = await armar(cuerpo({ discount_pct: 15, items: [{ product_id: 11, qty: 3, precio: 1234.56 }] }));
ok(r.status === 200 && Number(nuevos()[0]?.total) === Math.round(3703.68 * 0.85) && nuevos()[0]?.discount_pct === 15,
  `con descuento: a pesos, como el panel (${nuevos()[0]?.total})`);
sembrar();
r = await armar(cuerpo({ client_id: 2, catalog_visto: 'chungo', delivery_date: '', items: [{ product_id: 12, qty: 5, precio: 3000 }] }));
ok(r.status === 200 && nuevos()[0]?.client_name === 'Chungo Pilar' && nuevos()[0]?.delivery_date === null, 'otra lista (Chungo) y sin día: a coordinar');

// ---------------------------------------------------------------------------
seccion('Idempotencia: el mismo armado nunca entra dos veces');
sembrar();
const unArmado = cuerpo();
r = await armar(unArmado);
const r2 = await armar(unArmado);
ok(r.status === 200 && r2.status === 200 && r2.o?.repetido === true && r2.o?.order_number === r.o?.order_number && nuevos().length === 1,
  `dos toques / el botón atrás: un solo pedido (${nuevos().length}), el segundo dice repetido`);

// La función se llama DOS veces por armado: primero busca (¿ya se creó?), después crea. Las fallas de
// abajo se inyectan en la SEGUNDA (saltear 1): la que graba.
sembrar();
const perdido = cuerpo();
supa.despuesDe(/rpc\/teia_armar_pedido/, 'POST', () => { throw new TypeError('se cortó la respuesta'); }, 1);
r = await armar(perdido);
ok(r.status === 503 && r.o?.incierto === true && /Reintentar/.test(r.o?.error || '') && nuevos().length === 1,
  `entró pero se perdió la respuesta → "no sé, tocá Reintentar" (${r.o?.error})`);
ok(!supa.tablas.teia_clients[0].last_order_at, '  ...(la respuesta se perdió antes de actualizar "último pedido")');
supa.limpiarGanchos();
r = await armar(perdido);
ok(r.status === 200 && r.o?.repetido === true && nuevos().length === 1 && lineasDe(nuevos()[0].id).length === 2,
  '  ...y Reintentar NO lo duplica: devuelve el que ya estaba, con sus líneas');
ok(!!supa.tablas.teia_clients[0].last_order_at, '  ...y ahí sí se actualiza "último pedido" (antes quedaba viejo)');

// Auditoría de la tarea 3: la misma clave con OTRO contenido. Antes el servidor contestaba "listo, ya
// estaba creado" y lo que ella había cambiado se perdía sin aviso.
sembrar();
const conCambio = cuerpo();
supa.despuesDe(/rpc\/teia_armar_pedido/, 'POST', () => { throw new TypeError('se cortó la respuesta'); }, 1);
await armar(conCambio);
supa.limpiarGanchos();
// El comercio pidió 2 lemon pie más: 3 → 5.
const cambiado = { ...conCambio, items: [{ product_id: 10, qty: 2, precio: 30000 }, { product_id: 11, qty: 5, precio: 1234.56 }],
  total_visto: 60000 + Math.round(1234.56 * 5 * 100) / 100 };
r = await armar(cambiado);
ok(r.status === 409 && r.o?.otro_armado === true && !r.o?.ok && /NO se guardó/.test(r.o?.error || '') && /Crear como otro pedido/.test(r.o?.error || ''),
  `misma clave, otras cantidades → 409 "lo que cambiaste NO se guardó" (${r.o?.error})`);
ok(nuevos().length === 1 && lineasDe(nuevos()[0].id).find((l) => l.product_id === 11)?.qty === 3, '  ...y el pedido guardado queda como estaba (no se crea otro)');
r = await armar({ ...conCambio, discount_pct: 10, total_visto: totalConDescuento(conCambio.total_visto, 10) });
ok(r.status === 409 && r.o?.otro_armado === true, '  ...lo mismo si lo único que cambió es el descuento');
r = await armar({ ...cambiado, armado_id: nuevoArmado() });
ok(r.status === 200 && !r.o?.repetido && nuevos().length === 2, '  ..."Crear como otro pedido" (clave nueva) sí crea el segundo');

// La misma clave y el MISMO contenido, pero cambió un precio entre el primer intento (que entró) y el
// reintento: antes contestaba "no se creó nada: cambió el precio", con el pedido creado.
sembrar();
const conPrecio = cuerpo();
supa.despuesDe(/rpc\/teia_armar_pedido/, 'POST', () => { throw new TypeError('se cortó la respuesta'); }, 1);
await armar(conPrecio);
supa.limpiarGanchos();
supa.tablas.teia_products[0].price = 32000;
r = await armar(conPrecio);
ok(r.status === 200 && r.o?.repetido === true && r.o?.total === 63703.68 && nuevos().length === 1,
  `cambió el precio y el reintento trae lo mismo → "ya estaba creado" con su total, no "no se creó nada" (${r.status}: ${r.o?.error || r.o?.total})`);

sembrar();
supa.fallar(/rpc\/teia_armar_pedido/, 0, 1, undefined, 'POST', 1);
const sinRed = cuerpo();
r = await armar(sinRed);
ok(r.status === 503 && r.o?.incierto === true && nuevos().length === 0 && supa.fallasDisparadas() === 1, `sin respuesta al grabar y no entró → "no sé" (${r.status})`);
r = await armar(sinRed);
ok(r.status === 200 && !r.o?.repetido && nuevos().length === 1, '  ...Reintentar lo crea una vez');
sembrar();
supa.fallar(/rpc\/teia_armar_pedido/, 502, 1, undefined, 'POST', 1);
r = await armar(cuerpo());
ok(r.status === 503 && r.o?.incierto === true && supa.fallasDisparadas() === 1, 'un 5xx al grabar también es "no sé" (no "no se creó")');
sembrar();
supa.fallar(/rpc\/teia_armar_pedido/, 0, 1, undefined, 'POST');
r = await armar(cuerpo());
ok(r.status === 503 && r.o?.incierto === true && nuevos().length === 0, 'sin respuesta al BUSCAR → "no sé" (sin crear nada)');
sembrar();
supa.respuestaArmarForzada = { id: null, order_number: null, total: null, repetido: true };
r = await armar(cuerpo());
ok(r.status === 503 && r.o?.incierto === true && !r.o?.ok, `la base dice "repetido" sin pedido → "no sé", nunca "listo" (${r.status})`);

// ---------------------------------------------------------------------------
seccion('Sin el SQL de la tarea 3: no crea nada y lo dice');
sembrar();
supa.funcionArmar = false;
r = await armar(cuerpo());
ok(r.status === 503 && /todavía no está activo/.test(r.o?.error || '') && nuevos().length === 0 && !/supabase\//.test(r.o?.error || ''),
  `503 "todavía no está activo", sin rutas de archivos para ella (${r.o?.error})`);

// ---------------------------------------------------------------------------
seccion('Quién puede');
sembrar();
r = await armar(cuerpo(), { cookie: false });
ok(r.status === 401 && r.o?.sesion === true && /No se creó nada/.test(r.o?.error || ''), `sin sesión → 401 en JSON, "no se creó nada" (${r.o?.error})`);
r = await armar(cuerpo(), { cookie: false, basic: true });
ok(r.status === 401, 'con Basic Auth (clave correcta, sin cookie) → 401: armar es solo desde el panel');
r = await armar(JSON.stringify(cuerpo()), { tipo: 'text/plain' });
ok(r.status === 415, 'un form de otro sitio (text/plain) → 415');
const { panel, ...sinMarca } = cuerpo();
r = await armar(sinMarca);
ok(r.status === 409, 'sin panel: 2 → 409 (panel viejo)');
ok(nuevos().length === 0 && escrituras().length === 0, '  ...y en ninguno se escribió nada');

// ---------------------------------------------------------------------------
seccion('Validación: todo antes de tocar la base');
const invalidos: [string, any][] = [
  ['armado_id corto', { armado_id: 'corto' }],
  ['client_id como texto', { client_id: '1' }],
  ['sin productos', { items: [] }],
  ['cantidad 0', { items: [{ product_id: 10, qty: 0, precio: 30000 }] }],
  ['cantidad con decimales', { items: [{ product_id: 10, qty: 2.5, precio: 30000 }] }],
  ['cantidad como texto', { items: [{ product_id: 10, qty: '2', precio: 30000 }] }],
  ['cantidad 10000', { items: [{ product_id: 10, qty: 10000, precio: 30000 }] }],
  ['producto repetido', { items: [{ product_id: 10, qty: 1, precio: 30000 }, { product_id: 10, qty: 1, precio: 30000 }] }],
  ['línea sin precio visto', { items: [{ product_id: 10, qty: 1 }] }],
  ['product_id como lista', { items: [{ product_id: [10], qty: 1, precio: 30000 }] }],
  ['descuento 7%', { discount_pct: 7 }],
  ['sin total visto', { total_visto: undefined }],
  ['contacto vacío', { client_contact: '  ' }],
  ['dirección solo con símbolos', { delivery_address: '<>"\'' }],
  ['fecha que no existe', { delivery_date: '2026-02-30' }],
];
for (const [que, extra] of invalidos) {
  sembrar();
  r = await armar(cuerpo(extra));
  ok(r.status === 400 && escrituras().length === 0 && nuevos().length === 0, `${que} → 400 sin escribir (${r.o?.error})`);
}

// ---------------------------------------------------------------------------
seccion('La cuenta, como está AHORA');
sembrar();
supa.fallar(/teia_clients/, 503, 1, undefined, 'GET');
r = await armar(cuerpo());
ok(r.status === 503 && nuevos().length === 0, `no se pudo leer la cuenta → 503 (${r.o?.error})`);
sembrar();
r = await armar(cuerpo({ client_id: 99 }));
ok(r.status === 404 && r.o?.recargar === true && nuevos().length === 0, `cuenta borrada → 404, a recargar (${r.o?.error})`);
sembrar();
r = await armar(cuerpo({ client_id: 3 }));
ok(r.status === 409 && /Clientes → Viejo SRL → Ver cuenta → Estado: Habilitado/.test(r.o?.error || '') && nuevos().length === 0,
  `de baja → 409 con el camino en sus palabras (${r.o?.error})`);
sembrar();
supa.tablas.teia_clients[0].catalog = 'chungo'; // el celular la pasó de lista mientras ella armaba
r = await armar(cuerpo());
ok(r.status === 409 && r.o?.recargar === true && /Chungo/.test(r.o?.error || '') && nuevos().length === 0,
  `cambió de lista → 409 "ahora está en la lista Chungo", no "faltan todos los productos" (${r.o?.error})`);

// ---------------------------------------------------------------------------
seccion('Lo que ella vio contra la base: un solo 409 con todo');
sembrar();
supa.tablas.teia_products[0].price = 32000; // subió la torta
r = await armar(cuerpo());
ok(r.status === 409 && /Torta de chocolate \(\$30\.000 → \$32\.000\)/.test(r.o?.error || '') && r.o?.precios?.['10'] === 32000 && nuevos().length === 0,
  `cambió un precio → 409 con antes y después, y los precios de hoy para la pantalla (${r.o?.error})`);
sembrar();
supa.tablas.teia_products[0].price = 32000;
r = await armar(cuerpo({ items: [{ product_id: 10, qty: 1, precio: 30000 }, { product_id: 13, qty: 1, precio: 20000 },
  { product_id: 14, qty: 1, precio: 0 }, { product_id: 12, qty: 1, precio: 3000 }] }));
const e = r.o?.error || '';
ok(r.status === 409 && /Producto discontinuado/.test(e) && /Chipá/.test(e) && /Recién creado sin precio/.test(e) && /Torta de chocolate/.test(e),
  `oculto + de otra lista + sin precio + precio cambiado: TODO en un 409, con nombres de la base (${e})`);
ok(JSON.stringify([...(r.o?.quitar || [])].sort()) === '[12,13,14]', `  ...y qué sacar de la pantalla (${JSON.stringify(r.o?.quitar)})`);
sembrar();
r = await armar(cuerpo({ total_visto: 1 }));
ok(r.status === 409 && /la pantalla mostraba/.test(r.o?.error || '') && nuevos().length === 0, `total distinto al visto → 409 (${r.o?.error})`);
sembrar();
supa.fallar(/teia_products/, 503, 1, undefined, 'GET');
r = await armar(cuerpo());
ok(r.status === 503 && nuevos().length === 0, 'no se pudieron leer los precios → 503, nunca a $0');
sembrar();
// Un producto se borra entre la lectura de precios y la grabación: la base lo rechaza (clave foránea).
supa.despuesDe(/teia_products\?id=in/, 'GET', () => { supa.tablas.teia_products = supa.tablas.teia_products.filter((p) => p.id !== 11); });
r = await armar(cuerpo());
ok(r.status === 409 && r.o?.recargar === true && nuevos().length === 0 && supa.tablas.teia_order_items.length === 0,
  `se borró un producto en el medio → 409, y no queda un pedido a medias (${r.o?.error})`);

// ---------------------------------------------------------------------------
seccion('Guardianes estáticos');
const archivos: string[] = [];
const recorrer = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) recorrer(p); else if (/\.(ts|astro)$/.test(n)) archivos.push(p); } };
recorrer(join(process.cwd(), 'src'));
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const rel = (f: string) => f.replace(process.cwd(), '').replace(/\\/g, '/');
// Las columnas nuevas no se NOMBRAN en ninguna consulta: si el SQL no se corrió, una consulta que las
// nombre da 400 (la trampa de julio). Se leen con select=* y las escribe solo la función SQL.
const nombranColumna = archivos.filter((f) => /(select|order|filter)=[^`'"\s]*(placed_by|armado_id)|[?&](placed_by|armado_id)=/.test(sinComentarios(readFileSync(f, 'utf8'))));
ok(nombranColumna.length === 0, 'ninguna consulta nombra placed_by ni armado_id' + (nombranColumna.length ? ': ' + nombranColumna.map(rel).join(', ') : ''));
const escribenMarca = archivos.filter((f) => /placed_by\s*:/.test(sinComentarios(readFileSync(f, 'utf8'))));
ok(escribenMarca.length === 0, 'ningún archivo del servidor arma un objeto con placed_by (la marca la pone solo la función SQL)' + (escribenMarca.length ? ': ' + escribenMarca.map(rel).join(', ') : ''));
const llamanFuncion = archivos.filter((f) => /teia_armar_pedido/.test(sinComentarios(readFileSync(f, 'utf8')))).map(rel);
ok(llamanFuncion.join() === '/src/pages/api/admin/armar.ts', `teia_armar_pedido se llama solo desde el endpoint del panel (${llamanFuncion.join(', ')})`);
const publico = sinComentarios(readFileSync(join(process.cwd(), 'src/pages/api/order.ts'), 'utf8'));
ok(/avisarPushPedido\(/.test(publico) && /avisarPedidoNuevo\(/.test(publico) && !/placed_by|armado_id|esSesionDelPanel|isTeiaAdmin/.test(publico),
  'el alta del comercio sigue avisando siempre y no sabe nada de la marca ni del panel');
const armarTs = sinComentarios(readFileSync(join(process.cwd(), 'src/pages/api/admin/armar.ts'), 'utf8'));
ok(!/avisarPushPedido|avisarPedidoNuevo|isTeiaAdmin/.test(armarTs) && /esSesionDelPanel\(request\)/.test(armarTs),
  'el armado no avisa y exige la sesión del panel (no Basic)');

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
globalThis.fetch = fetchFakes;
desinstalar();
process.exit(fallas ? 1 : 0);
