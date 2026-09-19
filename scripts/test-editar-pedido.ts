// Arnés de la EDICIÓN de un pedido pendiente, con "agregar producto" (tarea 2).
// Correr:  npx -y tsx scripts/test-editar-pedido.ts
//
// El pedido de la clienta: "me piden una torta y no la tengo; le pregunto por cuál la quiere
// cambiar, y poder hacer ese cambio sin que el comercio tenga que hacer todo el pedido de nuevo".
// O sea: sacar una línea (cantidad 0) y agregar otra, en el mismo Guardar.
//
// Casi todo lo que se prueba acá es PLATA o es no dejar un pedido a medias:
//   · el precio de una línea agregada sale de la base, de la lista de ESE comercio;
//   · nada se escribe hasta haber validado todo;
//   · el orden de las escrituras hace que, si algo falla, sobre una línea y nunca falte;
//   · dos guardados a la vez (doble clic, dos pestañas) no pueden meter la misma torta dos veces;
//   · un pedido confirmado no se toca.
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
process.env.TEIA_ADMIN_PASSWORD = 'clave-de-prueba';
const { POST } = await import('../src/pages/api/admin/order');

// Esquema de producción de las tablas que toca la edición: una columna mal escrita en un
// select, un filtro o un cuerpo da 400, como en PostgREST.
supa.columnas.teia_orders = ['id', 'order_number', 'client_id', 'client_name', 'client_contact', 'delivery_address',
  'delivery_date', 'notes', 'status', 'version', 'total', 'discount_pct', 'created_at', 'confirmed_at', 'archive_status',
  'archive_error', 'archived_at', 'remito_cliente_url', 'remito_interno_url', 'saldo_anterior', 'costo_envio'];
supa.columnas.teia_order_items = ['id', 'order_id', 'product_id', 'name', 'pack_label', 'qty', 'unit_price', 'line_total'];
supa.columnas.teia_products = ['id', 'name', 'description', 'category', 'image_url', 'image_original_url', 'pack_label',
  'pack_size', 'price', 'stock', 'low_stock_threshold', 'active', 'catalog', 'sort_order', 'created_at'];

function sembrar() {
  supa.llamadas.length = 0;
  supa.limpiarGanchos();
  (supa as any).fallas.length = 0;
  supa.tablas = {
    teia_clients: [
      { id: 1, cuit: '30000000031', business_name: 'Café Uno', catalog: 'general', active: true },
      { id: 2, cuit: '30000000023', business_name: 'Chungo Pilar', catalog: 'chungo', active: true },
    ],
    teia_products: [
      { id: 10, name: 'Torta de chocolate', pack_label: 'x1', price: 30000, stock: 5, active: true, catalog: 'general' },
      { id: 11, name: 'Lemon pie', pack_label: 'x1', price: 25000, stock: 3, active: true, catalog: 'general' },
      { id: 12, name: 'Chipá', pack_label: 'x12', price: 3000, stock: 99, active: true, catalog: 'chungo' },
      { id: 13, name: 'Producto discontinuado', pack_label: 'x1', price: 20000, stock: 9, active: false, catalog: 'general' },
      { id: 14, name: 'Recién creado sin precio', pack_label: 'x1', price: 0, stock: 9, active: true, catalog: 'general' },
      { id: 15, name: 'Cheesecake', pack_label: 'x6', price: 40000, stock: 0, active: true, catalog: 'general' },
    ],
    teia_orders: [
      // Café Uno pidió 2 tortas de chocolate, con 10% de descuento: total 54.000.
      { id: 100, order_number: 'TEIA-0100', client_id: 1, client_name: 'Café Uno', client_contact: '11', delivery_address: 'X',
        status: 'pendiente', version: 1, total: 54000, discount_pct: 10, notes: '' },
      { id: 200, order_number: 'TEIA-0200', client_id: 1, client_name: 'Café Uno', client_contact: '11', delivery_address: 'X',
        status: 'confirmado', version: 1, total: 30000, discount_pct: 0, notes: '' },
      // La cuenta de este pedido se borró: no se sabe su lista.
      { id: 300, order_number: 'TEIA-0300', client_id: null, client_name: 'Ex cliente', client_contact: '11', delivery_address: 'X',
        status: 'pendiente', version: 1, total: 30000, discount_pct: 0, notes: '' },
    ],
    teia_order_items: [
      { id: 1, order_id: 100, product_id: 10, name: 'Torta de chocolate', pack_label: 'x1', qty: 2, unit_price: 30000, line_total: 60000 },
      { id: 2, order_id: 200, product_id: 10, name: 'Torta de chocolate', pack_label: 'x1', qty: 1, unit_price: 30000, line_total: 30000 },
      { id: 3, order_id: 300, product_id: 10, name: 'Torta de chocolate', pack_label: 'x1', qty: 1, unit_price: 30000, line_total: 30000 },
    ],
  };
}
const pedido = (id = 100) => supa.tablas.teia_orders.find((o) => o.id === id)!;
const lineas = (id = 100) => supa.tablas.teia_order_items.filter((l) => l.order_id === id);
const escrituras = () => supa.llamadas.filter((l) => l.metodo !== 'GET');
// "No se escribió nada": ni líneas, ni total, ni descuento, ni estado.
const foto = (id = 100) => JSON.stringify({ l: lineas(id), t: pedido(id).total, d: pedido(id).discount_pct, s: pedido(id).status });

async function postear(body: Record<string, any>) {
  const r = await POST({
    request: new Request('http://localhost/api/admin/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('teia:clave-de-prueba').toString('base64') },
      body: JSON.stringify(body),
    }),
  } as any);
  return { status: r.status, o: await r.json().catch(() => null) };
}
// El panel nuevo se identifica con `panel: 2` (lib/panel.ts). El viejo (JS de antes del deploy), no.
const guardar = (body: Record<string, any>) => postear({ panel: 2, ...body });
const guardarViejo = (body: Record<string, any>) => postear(body);

// ---------------------------------------------------------------------------
seccion('El caso de la clienta: sacar la torta y poner otra, en el mismo Guardar');

sembrar();
let r = await guardar({ id: 100, items: [{ id: 1, qty: '0' }], add: [{ product_id: 11, qty: '2', unit_price: 1 }], discount_pct: 10 });
ok(r.status === 200 && r.o?.ok, `responde ok (${r.status} ${JSON.stringify(r.o)?.slice(0, 80)})`);
ok(lineas().length === 1, 'queda UNA línea');
const nueva = lineas()[0];
ok(nueva?.product_id === 11 && nueva?.name === 'Lemon pie', '  ...que es el Lemon pie, con su product_id (para que el confirm le descuente stock)');
ok(nueva?.unit_price === 25000, '  ...a $25.000, el precio de la BASE — el unit_price:1 que vino en el cuerpo se ignoró');
ok(nueva?.line_total === 50000, '  ...2 × 25.000 = 50.000');
ok(pedido().total === 45000, `total recalculado con el 10%: 50.000 × 0,9 = 45.000 (dio ${pedido().total})`);
ok(r.o?.total === 45000, '  ...y la respuesta trae el mismo total');

// ---------------------------------------------------------------------------
seccion('El precio sale de la lista de ESE comercio');

sembrar();
r = await guardar({ id: 100, items: [], add: [{ product_id: 12, qty: 1 }] });
ok(r.status === 409 && /Chipá/.test(r.o?.error || ''), `un producto de la OTRA lista (Chipá, de Chungo) → 409 que lo nombra (${r.o?.error?.slice(0, 70)})`);
ok(escrituras().length === 0, '  ...y no se escribió nada');

sembrar();
r = await guardar({ id: 100, items: [], add: [{ product_id: 13, qty: 1 }] });
ok(r.status === 409 && /discontinuado/.test(r.o?.error || ''), 'un producto INACTIVO → 409 con su nombre, sacado de la base');

sembrar();
r = await guardar({ id: 100, items: [], add: [{ product_id: 999, qty: 1 }] });
ok(r.status === 409 && escrituras().length === 0, 'un producto que no existe → 409, sin escribir');

sembrar();
r = await guardar({ id: 100, items: [], add: [{ product_id: 14, qty: 1 }] });
ok(r.status === 400 && /precio/i.test(r.o?.error || '') && escrituras().length === 0, 'un producto a $0 (recién creado) → 400: no entra una línea gratis');

// ---------------------------------------------------------------------------
seccion('Duplicados: la misma torta no puede quedar dos veces');

sembrar();
r = await guardar({ id: 100, items: [], add: [{ product_id: 10, qty: 1 }] });
ok(r.status === 409 && /ya está en el pedido/.test(r.o?.error || '') && escrituras().length === 0, 'agregar un producto que YA está → 409 "cambiale la cantidad", sin escribir');

sembrar();
r = await guardar({ id: 100, items: [], add: [{ product_id: 11, qty: 1 }, { product_id: 11, qty: 2 }] });
ok(r.status === 409 && escrituras().length === 0, 'el mismo producto dos veces en el mismo alta → 409');

sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 10, qty: 3 }] });
ok(r.status === 409 && escrituras().length === 0, 'sacarlo con 0 y volver a agregarlo (un cambio de precio encubierto) → 409');

sembrar();
supa.tablas.teia_order_items[0].product_id = null; // línea vieja cuyo producto se borró
r = await guardar({ id: 100, items: [], add: [{ product_id: 10, qty: 1 }] });
ok(r.status === 200, 'una línea vieja SIN product_id no bloquea agregar ese producto');

// ---------------------------------------------------------------------------
seccion('Cantidades: vacío NO es cero (el bug viejo que borraba la línea sin aviso)');

for (const [q, d] of [['', "''"], ['abc', "'abc'"], [-1, '-1'], [1.5, '1.5'], ['1.5', "'1.5'"], [10000, '10000'], [null, 'null']] as const) {
  sembrar();
  const antes = foto();
  r = await guardar({ id: 100, items: [{ id: 1, qty: q }] });
  ok(r.status === 400 && foto() === antes && escrituras().length === 0, `cantidad ${d} → 400 y la línea sigue ahí`);
}
sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 1 }] });
ok(r.status === 200 && !lineas().some((l) => l.product_id === 10), 'un 0 EXPLÍCITO sí saca la línea');
sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: '3' }] });
ok(r.status === 200 && lineas()[0].qty === 3 && lineas()[0].line_total === 90000, "'3' (como viene de un input) cambia la cantidad a 3");
sembrar();
r = await guardar({ id: 100, items: [], add: [{ product_id: 11, qty: 0 }] });
ok(r.status === 400 && escrituras().length === 0, 'agregar con cantidad 0 → 400');

// ---------------------------------------------------------------------------
seccion('Un pedido no puede quedar vacío');

sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }] });
ok(r.status === 400 && /borralo/i.test(r.o?.error || '') && escrituras().length === 0, 'sacar la única línea sin agregar otra → 400 "borralo", sin escribir');

// ---------------------------------------------------------------------------
seccion('Solo se editan pedidos PENDIENTES');

sembrar();
let antes = foto(200);
r = await guardar({ id: 200, items: [{ id: 2, qty: 5 }] });
ok(r.status === 409 && foto(200) === antes && escrituras().length === 0, 'editar cantidades de un CONFIRMADO → 409, sin tocarlo (el agujero viejo: antes se podía)');
sembrar();
r = await guardar({ id: 200, items: [], add: [{ product_id: 11, qty: 1 }] });
ok(r.status === 409 && escrituras().length === 0, 'agregar a un confirmado → 409');
sembrar();
r = await guardar({ id: 200, discount_pct: 20 });
ok(r.status === 409 && pedido(200).discount_pct === 0, 'cambiarle el descuento a un confirmado → 409');
sembrar();
r = await guardar({ id: 100, discount_pct: 20, saldo_anterior: '', costo_envio: '' });
ok(r.status === 200 && pedido().discount_pct === 20 && pedido().total === 48000, 'el selector de descuento de un PENDIENTE sigue andando (60.000 × 0,8 = 48.000)');
sembrar();
r = await guardar({ id: 999, items: [] });
ok(r.status === 404, 'un pedido que no existe → 404');

// ---------------------------------------------------------------------------
seccion('Pedido cuya cuenta se borró');

sembrar();
r = await guardar({ id: 300, items: [], add: [{ product_id: 11, qty: 1 }] });
ok(r.status === 409 && /cuenta/.test(r.o?.error || '') && escrituras().length === 0, 'agregar → 409: no se sabe su lista, y no se le inventa la general');
sembrar();
r = await guardar({ id: 300, items: [{ id: 3, qty: 2 }] });
ok(r.status === 200 && lineas(300)[0].qty === 2, 'cambiar cantidades sí se puede');

// ---------------------------------------------------------------------------
seccion('Validar TODO antes de escribir nada');

sembrar();
antes = foto();
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 1 }], costo_envio: 'ocho mil' });
ok(r.status === 400 && foto() === antes && escrituras().length === 0, 'un monto del remito inválido junto con un cambio → 400 y NI el alta NI la baja llegaron a la base');
sembrar();
r = await guardar({ id: 100, items: [{ id: 77, qty: 1 }] });
ok(r.status === 409 && escrituras().length === 0, 'una línea que ya no es de este pedido (pantalla vieja) → 409 "recargá", no se ignora en silencio');

// ---------------------------------------------------------------------------
seccion('Si algo falla: sobra una línea, nunca falta — y el panel no dice "Guardado"');

sembrar();
supa.fallar(/teia_order_items/, 500, 1, undefined, 'POST');
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 1 }] });
ok(supa.fallasDisparadas() === 1, 'el fallo del alta se inyectó de verdad');
ok(r.status >= 500 && !r.o?.ok, 'falla el ALTA → error, no ok');
ok(r.o?.partial === true && /Recargá/.test(r.o?.error || ''), '  ...con partial:true: no se sabe si el INSERT entró, así que el panel recarga en vez de ofrecer un reintento a ciegas');
ok(lineas().length === 1 && lineas()[0].product_id === 10, '  ...y la torta vieja SIGUE ahí (el alta va primero: si falla, no se sacó nada)');

sembrar();
supa.fallar(/teia_order_items/, 500, 1, undefined, 'DELETE');
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 1 }] });
ok(supa.fallasDisparadas() === 1, 'el fallo de la baja se inyectó de verdad');
ok(r.status >= 500 && r.o?.partial === true && !r.o?.ok, `falla la BAJA → error con partial:true, nunca "Guardado" (${r.status})`);
ok(/Torta de chocolate/.test(r.o?.error || ''), '  ...y nombra la línea que no se pudo sacar');
ok(lineas().length === 2, '  ...quedaron las dos líneas (sobra una, a la vista), no ninguna');
const suma = lineas().reduce((s, l) => s + l.line_total, 0);
ok(pedido().total === Math.round(suma * 0.9), `  ...y el total se recalculó igual con lo que quedó (${pedido().total} = líneas × 0,9)`);

// ---------------------------------------------------------------------------
seccion('Dos guardados a la vez (doble clic, dos pestañas)');

sembrar();
const [a, b] = await Promise.all([
  guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 1 }] }),
  guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 1 }] }),
]);
const estados = [a.status, b.status].sort();
ok(estados[0] === 200 && estados[1] === 409, `uno gana y el otro da 409 (${a.status}, ${b.status})`);
ok(lineas().filter((l) => l.product_id === 11).length === 1, 'hay UN solo Lemon pie, no dos');

sembrar();
const g = supa.despuesDe(/teia_orders\?id=eq\.100&status=eq\.pendiente&version=eq\.1/, 'PATCH', () => { pedido().status = 'confirmado'; });
r = await guardar({ id: 100, items: [{ id: 1, qty: 3 }] });
ok(g.disparos === 1, 'se confirmó el pedido JUSTO después del claim de la edición');
ok(r.status === 409 && /confirm/i.test(r.o?.error || ''), `  ...y la edición lo detecta al guardar el total: 409 "se confirmó" (${r.status})`);

// ---------------------------------------------------------------------------
seccion('Pantalla vieja: el celular cambió una cantidad y la compu no se enteró');

sembrar(); // en la base la torta tiene 2
r = await guardar({ id: 100, items: [{ id: 1, qty: 5, desde: 3 }] });
ok(r.status === 409 && escrituras().length === 0, `la pantalla mostraba 3 y la base tiene 2 → 409 sin escribir nada (${r.status})`);
ok(/vieja/.test(r.o?.error || '') && /Torta de chocolate \(ahora tiene 2\)/.test(r.o?.error || ''), '  ...y le dice cuál y cuánto tiene ahora');
sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: 5, desde: 2 }] });
ok(r.status === 200 && lineas()[0].qty === 5, 'con la pantalla al día (desde = 2) se guarda');
sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: 5 }] });
ok(r.status === 200 && lineas()[0].qty === 5, 'sin `desde` (un panel abierto antes del deploy) sigue andando como antes');
sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: 5, desde: 'dos' }] });
ok(r.status === 400 && escrituras().length === 0, 'un `desde` que no es cantidad → 400');
sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }, { id: 1, qty: 3 }], add: [{ product_id: 11, qty: 1 }] });
ok(r.status === 400 && escrituras().length === 0, 'la misma línea dos veces → 400 sin escribir');

// ---------------------------------------------------------------------------
seccion('Un pendiente que YA estaba vacío (la versión de producción dejaba vaciarlo)');

sembrar();
supa.tablas.teia_order_items = supa.tablas.teia_order_items.filter((l) => l.order_id !== 100);
r = await guardar({ id: 100, discount_pct: 20, saldo_anterior: '', costo_envio: '8000' });
ok(r.status === 200 && pedido().discount_pct === 20 && pedido().costo_envio === 8000 && pedido().total === 0, `el descuento y el envío se pueden guardar (${r.status} ${r.o?.error || ''})`);
r = await guardar({ id: 100, items: [], add: [{ product_id: 11, qty: 2 }] });
ok(r.status === 200 && lineas().length === 1 && pedido().total === 40000, `y se le puede agregar un producto: 2 × 25.000 × 0,8 = 40.000 (${pedido().total})`);

// ---------------------------------------------------------------------------
seccion('"Quedó a medias" SOLO si de verdad se escribió una línea');

sembrar();
supa.fallar(/teia_order_items\?order_id=eq\.100&select=line_total/, 500, 1, undefined, 'GET');
r = await guardar({ id: 100, items: [{ id: 1, qty: 2 }], notes: 'tocar timbre', costo_envio: '8000' });
ok(supa.fallasDisparadas() === 1, 'el fallo de la relectura se inyectó de verdad');
ok(r.status === 503 && !r.o?.partial && /No se guardó nada/.test(r.o?.error || ''), `sin líneas tocadas: "no se guardó nada" y SIN partial, así el panel no recarga y no le borra el envío (${JSON.stringify(r.o)})`);
ok(pedido().notes === '' && pedido().costo_envio == null, '  ...y es verdad: ni la nota ni el envío llegaron');
sembrar();
supa.fallar(/teia_order_items\?order_id=eq\.100&select=line_total/, 500, 1, undefined, 'GET');
r = await guardar({ id: 100, items: [{ id: 1, qty: 3 }] });
ok(r.status === 503 && r.o?.partial === true, 'con una cantidad cambiada: partial:true (la línea sí se escribió)');
sembrar();
supa.fallar(/teia_orders\?id=eq\.100&status=eq\.pendiente&version=eq\.2/, 500, 1, undefined, 'PATCH');
r = await guardar({ id: 100, discount_pct: 5 });
ok(supa.fallasDisparadas() === 1 && r.status === 500 && !r.o?.partial, 'falla el PATCH final de un guardado sin líneas (el selector de descuento) → sin partial');

sembrar();
supa.fallar(/teia_order_items/, 500, 1, undefined, 'POST');
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 1 }], costo_envio: '8000', notes: 'x' });
ok(r.o?.partial === true && /NO se guardó/.test(r.o?.error || '') && /costo de envío/.test(r.o?.error || '') && /notas/.test(r.o?.error || ''),
  `a medias ANTES del PATCH final: el mensaje nombra lo que ella tipeó y no entró (el panel recarga y lo pierde de vista): ${r.o?.error}`);

sembrar();
supa.fallar(/teia_order_items\?id=eq\.1&order_id=eq\.100/, 500, 1, undefined, 'DELETE');
supa.fallar(/teia_order_items\?order_id=eq\.100&select=line_total/, 500, 1, undefined, 'GET');
r = await guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 2 }] });
ok(supa.fallasDisparadas() === 2 && r.o?.partial === true, 'falla la baja de la torta Y la relectura: partial');
ok(/Torta de chocolate sigue en el pedido/.test(r.o?.error || '') && !/Las líneas se guardaron/.test(r.o?.error || ''),
  `  ...y NO dice "las líneas se guardaron": nombra la torta que sigue (si no, Guardar la cobraba junto con la nueva): ${r.o?.error}`);

// ---------------------------------------------------------------------------
seccion('Un panel abierto ANTES del deploy no puede pisar montos (ni vacíos ni viejos)');

sembrar();
pedido().costo_envio = 8000; // cargado desde el celular
antes = foto();
r = await guardarViejo({ id: 100, items: [{ id: 1, qty: 3 }], saldo_anterior: '', costo_envio: '' }); // JS viejo: manda todo
ok(r.status === 409 && /antes de la última actualización/.test(r.o?.error || ''), `JS viejo con el envío VACÍO → 409 "recargá" (${r.status})`);
ok(pedido().costo_envio === 8000 && foto() === antes && escrituras().length === 0, '  ...y no escribió NADA: ni el envío, ni la cantidad');
sembrar();
r = await guardarViejo({ id: 100, items: [{ id: 1, qty: 3 }], saldo_anterior: '', costo_envio: '8000' }); // pantalla vieja con un envío que el celular ya sacó
ok(r.status === 409 && pedido().costo_envio == null && escrituras().length === 0, 'JS viejo con un envío NO vacío (el que el celular ya sacó) → 409 sin escribir');
sembrar();
r = await guardarViejo({ id: 100, items: [{ id: 1, qty: 3 }] });
ok(r.status === 200 && lineas()[0].qty === 3, 'sin montos en el cuerpo (una llamada que no los toca) sigue andando');
sembrar();
pedido().costo_envio = 8000;
r = await guardar({ id: 100, costo_envio: '' });
ok(r.status === 200 && pedido().costo_envio === null, 'el panel nuevo (manda solo lo cambiado): vaciarlo SÍ lo borra, fue ella');
sembrar();
pedido().costo_envio = 8000;
r = await guardar({ id: 100, costo_envio: '9000' });
ok(r.status === 200 && pedido().costo_envio === 9000, '  ...y un monto escrito se guarda');

// ---------------------------------------------------------------------------
seccion('Sin descuento, el total es la suma tal cual (con centavos)');

sembrar();
pedido().discount_pct = 0;
lineas()[0].unit_price = 1234.56; lineas()[0].line_total = 2469.12; lineas()[0].qty = 2;
r = await guardar({ id: 100, items: [{ id: 1, qty: 3 }] });
ok(r.status === 200 && pedido().total === 3703.68, `3 × 1.234,56 = 3.703,68, no 3.704 (${pedido().total})`);
sembrar();
r = await guardar({ id: 100, items: [{ id: 1, qty: 3 }] });
ok(pedido().total === 81000, 'con descuento sigue redondeando a pesos como siempre (3 × 30.000 × 0,9 = 81.000)');

// ---------------------------------------------------------------------------
seccion('Los mensajes concuerdan en número');

sembrar();
supa.tablas.teia_order_items.push({ id: 9, order_id: 100, product_id: 11, name: 'Lemon pie', pack_label: 'x1', qty: 1, unit_price: 25000, line_total: 25000 });
r = await guardar({ id: 100, items: [], add: [{ product_id: 10, qty: 1 }, { product_id: 11, qty: 1 }] });
ok(/ya están en el pedido/.test(r.o?.error || ''), `dos repetidos → "ya están" (${r.o?.error?.slice(0, 60)})`);
sembrar();
r = await guardar({ id: 100, items: [], add: [{ product_id: 12, qty: 1 }, { product_id: 13, qty: 1 }] });
ok(/no están disponibles/.test(r.o?.error || ''), `dos no disponibles → "no están disponibles" (${r.o?.error?.slice(0, 70)})`);

// ---------------------------------------------------------------------------
seccion('PATCH final sin respuesta: se relee en vez de suponer');

sembrar();
let corte = supa.despuesDe(/teia_orders\?id=eq\.100&status=eq\.pendiente&version=eq\.2/, 'PATCH', () => { throw new TypeError('se cortó la respuesta'); });
r = await guardar({ id: 100, discount_pct: 20 });
ok(corte.disparos === 1 && pedido().discount_pct === 20, 'el PATCH final ENTRÓ en la base y se perdió la respuesta');
ok(r.status === 200 && r.o?.ok === true && r.o?.total === 48000, `  ...y la respuesta es ok con el total real, no "no se guardó nada" (${r.status} ${JSON.stringify(r.o)})`);
supa.limpiarGanchos();
sembrar();
supa.fallar(/teia_orders\?id=eq\.100&status=eq\.pendiente&version=eq\.2/, 500, 1, undefined, 'PATCH');
r = await guardar({ id: 100, items: [{ id: 1, qty: 3 }], costo_envio: '8000' });
ok(r.status === 500 && r.o?.partial === true && /costo de envío/.test(r.o?.error || '') && pedido().costo_envio == null,
  `el PATCH final NO entró (Supabase dijo que no): partial por la línea, y nombra el envío que no se guardó: ${r.o?.error}`);
sembrar();
supa.fallar(/teia_orders\?id=eq\.100&status=eq\.pendiente&version=eq\.2/, 500, 1, undefined, 'PATCH');
supa.fallar(/teia_orders\?id=eq\.100&select=status,version,/, 500, 1, undefined, 'GET');
r = await guardar({ id: 100, discount_pct: 5 });
ok(supa.fallasDisparadas() === 2 && r.o?.partial === true && /No sé si se guardó/.test(r.o?.error || ''), `sin respuesta Y sin poder releer: "no sé si se guardó" y recargar (${r.o?.error})`);

// ---------------------------------------------------------------------------
seccion('Si otro lo tocó en el medio, el mensaje dice QUÉ pasó');

sembrar();
let h = supa.despuesDe(/teia_orders\?id=eq\.100&status=eq\.pendiente&version=eq\.1/, 'PATCH', () => { pedido().version = 3; });
r = await guardar({ id: 100, items: [{ id: 1, qty: 3 }] });
ok(h.disparos === 1 && r.status === 409 && /Otro guardado/.test(r.o?.error || '') && !/confirm/i.test(r.o?.error || ''), `otro guardado en el medio → "otro guardado", NO "se confirmó" (el pedido sigue pendiente): ${r.o?.error}`);
ok(r.o?.partial === true, '  ...con partial (la línea se escribió): el panel recarga para mostrar cómo quedó');
supa.limpiarGanchos();
sembrar();
h = supa.despuesDe(/teia_orders\?id=eq\.100&status=eq\.pendiente&version=eq\.1/, 'PATCH', () => { pedido().version = 3; });
r = await guardar({ id: 100, notes: 'nota nueva' });
ok(r.status === 409 && !r.o?.partial && /No se guardó nada/.test(r.o?.error || ''), '  ...y si solo eran datos, "no se guardó nada" sin partial');
supa.limpiarGanchos();
sembrar();
h = supa.despuesDe(/teia_orders\?id=eq\.100&status=eq\.pendiente&version=eq\.1/, 'PATCH', () => {
  supa.tablas.teia_orders = supa.tablas.teia_orders.filter((o) => o.id !== 100);
});
r = await guardar({ id: 100, items: [{ id: 1, qty: 3 }] });
ok(r.status === 409 && /se borró/.test(r.o?.error || ''), `lo borraron en el medio → "se borró" (${r.o?.error})`);
supa.limpiarGanchos();

// ---------------------------------------------------------------------------
seccion('El espejo del Sheet colgado no se come la respuesta');

sembrar();
const driveOriginal = drive.fetch;
(drive as any).fetch = () => new Promise(() => {}); // Google que nunca contesta
const t0 = Date.now();
const colgado = Symbol('colgado');
const rr = await Promise.race([
  guardar({ id: 100, items: [{ id: 1, qty: 4 }] }),
  new Promise((res) => setTimeout(() => res(colgado), 25000)), // el tope del espejo es 20 s
]);
(drive as any).fetch = driveOriginal;
ok(rr !== colgado, 'el guardado CONTESTA aunque Google no conteste (antes se comía los 30 s de la función)');
ok(rr !== colgado && (rr as any).status === 200 && lineas()[0].qty === 4, `  ...con ok: lo que se guardó, se guardó (${Math.round((Date.now() - t0) / 1000)} s)`);

// ---------------------------------------------------------------------------
seccion('Lo que viene después: el confirm descuenta el stock de la línea agregada');

sembrar();
await guardar({ id: 100, items: [{ id: 1, qty: 0 }], add: [{ product_id: 11, qty: 2 }] });
const { POST: CONFIRM } = await import('../src/pages/api/admin/confirm');
const rc = await CONFIRM({
  request: new Request('http://localhost/api/admin/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('teia:clave-de-prueba').toString('base64') },
    body: JSON.stringify({ id: 100 }),
  }),
} as any);
const lemon = supa.tablas.teia_products.find((p) => p.id === 11);
ok(rc.status === 200 && lemon.stock === 1, `confirmar descuenta el stock del Lemon pie agregado: 3 − 2 = 1 (quedó ${lemon.stock})`);
ok(supa.tablas.teia_products.find((p) => p.id === 10).stock === 5, '  ...y NO el de la torta que se sacó');

const confirmar = async (body: Record<string, any>) => CONFIRM({
  request: new Request('http://localhost/api/admin/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('teia:clave-de-prueba').toString('base64') },
    body: JSON.stringify(body),
  }),
} as any);
sembrar();
pedido().costo_envio = 8000; // cargado desde el celular
let rc2 = await confirmar({ id: 100, saldo_anterior: '', costo_envio: '' }); // Confirmar desde un panel con JS viejo
ok(rc2.status === 409 && pedido().status === 'pendiente' && pedido().costo_envio === 8000,
  `Confirmar desde un panel VIEJO → 409 "recargá": no confirma ni le toca el envío (${rc2.status}, ${pedido().status}, ${pedido().costo_envio})`);
sembrar();
rc2 = await confirmar({ id: 100, saldo_anterior: '', costo_envio: '8000' }); // el envío que el celular ya había sacado
ok(rc2.status === 409 && pedido().status === 'pendiente' && pedido().costo_envio == null, '  ...tampoco con un envío viejo NO vacío (se lo volvía a poner al remito)');
sembrar();
rc2 = await confirmar({ id: 100, panel: 2 });
ok(rc2.status === 200 && pedido().status === 'confirmado', 'el panel nuevo sin montos cambiados confirma normal');
sembrar();
pedido().costo_envio = 8000;
rc2 = await confirmar({ id: 100, panel: 2, costo_envio: '' });
ok(rc2.status === 200 && pedido().costo_envio === null, '  ...y vaciarlo a propósito desde el panel nuevo sí lo borra');
rc2 = await confirmar({ id: 100, panel: 2 });
const o409 = await rc2.json().catch(() => ({}));
ok(rc2.status === 409 && /ya se confirmó o se borró/.test(o409.error || ''), `confirmar dos veces → 409 con un mensaje para ella, no "ya procesado" (${o409.error})`);

sembrar();
supa.fallar(/teia_products\?id=eq\.10$/, 503, 1, undefined, 'PATCH');
rc2 = await confirmar({ id: 100, panel: 2 });
const oStock = await rc2.json().catch(() => ({}));
ok(supa.fallasDisparadas() === 1 && rc2.status === 200 && pedido().status === 'confirmado', 'falla descontar el stock de la torta: el pedido se confirma igual');
ok(Array.isArray(oStock.stock_sin_descontar) && /Torta de chocolate ×2/.test(oStock.stock_sin_descontar.join()),
  `  ...y la respuesta dice cuál restar a mano (antes se perdía en silencio): ${JSON.stringify(oStock.stock_sin_descontar)}`);

// ---------------------------------------------------------------------------
seccion('Confirmar con FALTANTE y después borrar: el stock vuelve EXACTAMENTE a donde estaba');
// Auditoría del 19/9 (la única ALTA): el confirm frenaba el stock en 0 y el borrado reponía lo
// PEDIDO. Con 3 en stock y 10 pedidos, confirmar dejaba 0 y borrar dejaba 10: siete que no existen.
sembrar();
const lemonSP = () => supa.tablas.teia_products.find((p) => p.id === 10);
lemonSP().stock = 3; // la torta: hay 3, el pedido 100 pide 2... se sube a 10 para el faltante
lineas()[0].qty = 10; lineas()[0].line_total = 300000; pedido().total = 270000;
rc2 = await confirmar({ id: 100, panel: 2 });
const oFalt = await rc2.json().catch(() => ({}));
ok(rc2.status === 200 && lemonSP().stock === -7, `confirmar 10 con 3 en stock deja -7, no 0 (${lemonSP().stock})`);
ok(/pedía 10 y había 3 \(quedó en -7\)/.test((oFalt.shortages || []).join()), `  ...y el aviso lo dice: ${JSON.stringify(oFalt.shortages)}`);
const rb = await postear({ id: 100, action: 'delete' });
ok(rb.status === 200 && lemonSP().stock === 3, `borrarlo lo deja en 3, donde estaba (antes quedaba en 10): ${lemonSP().stock}`);

sembrar();
// Faltante Y falla la escritura del stock: antes decía "quedó en -7" y a la vez "restáselo a mano",
// con el stock todavía en 3 (verificación del 19/9).
lemonSP().stock = 3;
lineas()[0].qty = 10; lineas()[0].line_total = 300000; pedido().total = 270000;
supa.fallar(/teia_products/, 503, 1, undefined, 'PATCH');
rc2 = await confirmar({ id: 100, panel: 2 });
const oFalla = await rc2.json().catch(() => ({}));
ok(supa.fallasDisparadas() === 1 && lemonSP().stock === 3, `la escritura falló de verdad: el stock sigue en 3 (${lemonSP().stock})`);
ok(!(oFalla.shortages || []).length && /Torta de chocolate ×10/.test((oFalla.stock_sin_descontar || []).join()),
  `  ...y el aviso dice solo "restáselo a mano", no "quedó en -7": ${JSON.stringify(oFalla.shortages)} / ${JSON.stringify(oFalla.stock_sin_descontar)}`);

// ---------------------------------------------------------------------------
seccion('Drive COLGADO al confirmar: la respuesta llega igual, con los avisos de stock');
// Verificación del 19/9: el tope estaba solo en el espejo, y el cuelgue llegaba antes, en el
// archivado (la subida del remito a Drive). La función se cortaba a los 30 s y el panel no recibía
// "pedía 10 y había 3", que es justo lo que ella tiene que saber al confirmar.
sembrar();
lemonSP().stock = 3;
lineas()[0].qty = 10; lineas()[0].line_total = 300000; pedido().total = 270000;
const fetchDrive = drive.fetch;
// Solo la SUBIDA de archivos se cuelga: el espejo del Sheet contesta normal.
(drive as any).fetch = (url: string, init?: any) => (/\/upload\/drive\//.test(String(url)) ? new Promise(() => {}) : fetchDrive.call(drive, url, init));
const t1 = Date.now();
const rcc = await Promise.race([
  confirmar({ id: 100, panel: 2 }),
  new Promise((res) => setTimeout(() => res(colgado), 20000)), // el archivado tiene hasta 12 s
]);
(drive as any).fetch = fetchDrive;
ok(rcc !== colgado, `el confirm CONTESTA aunque Drive no conteste (${Math.round((Date.now() - t1) / 1000)} s)`);
const occ = rcc !== colgado ? await (rcc as Response).json().catch(() => ({})) : {};
ok(rcc !== colgado && (rcc as Response).status === 200 && /quedó en -7/.test((occ.shortages || []).join()),
  `  ...con el aviso de faltante adentro: ${JSON.stringify(occ.shortages)}`);
ok(pedido().status === 'confirmado' && lemonSP().stock === -7, '  ...y el pedido quedó confirmado con el stock descontado');

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
desinstalar();
process.exit(fallas ? 1 : 0);
