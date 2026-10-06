// Arnés del BORRADO de un pedido — el camino destructivo.
// Correr:  npx -y tsx scripts/test-borrado.ts
//
// Nació de la auditoría. El hallazgo, confirmado por 3 escépticos: reponer el stock y DESPUÉS
// llamar a Drive sin tope de tiempo deja una ventana de hasta 30 s (el máximo de la lambda) en la
// que el pedido ya devolvió el stock pero todavía existe. Si Google se CUELGA —no falla: cuelga—
// Vercel mata la función, el DELETE nunca sale, Mica ve un error, vuelve a tocar Borrar, y el
// stock se repone por segunda vez. El catálogo queda ofreciendo mercadería que no existe.
//
// Un try/catch atrapa un fallo. No atrapa un cuelgue. Por eso acá se prueba el cuelgue.
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

// Request con Basic Auth: isTeiaAdmin lo acepta (está pensado para curl y scripts).
const pedirBorrado = (id: number) =>
  POST({
    request: new Request('http://localhost/api/admin/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('teia:clave-de-prueba').toString('base64'),
      },
      body: JSON.stringify({ id, action: 'delete' }),
    }),
  } as any);

function sembrar() {
  drive.archivos.clear(); drive.llamadas.length = 0; drive.limpiarFallas();
  supa.objetos.clear(); supa.llamadas.length = 0;
  (supa as any).fallas.length = 0; // si no, fallasDisparadas() arrastra las de la sección anterior
  supa.tablas = {
    teia_orders: [{
      id: 28, order_number: 'TEIA-9028', client_name: 'Chungo Local Dos', status: 'confirmado',
      created_at: '2026-09-07T10:00:00Z', confirmed_at: '2026-09-07T11:00:00Z',
      remito_cliente_url: 'remito-28-aaaa-cliente-v1.pdf',
    }],
    teia_order_items: [{ id: 1, order_id: 28, product_id: 1, name: 'Chipá', qty: 10, unit_price: 2100, line_total: 21000 }],
    teia_products: [{ id: 1, name: 'Chipá', stock: 5, low_stock_threshold: 5 }],
  };
}
const stock = () => Number(supa.tablas.teia_products[0].stock);
const quedanPedidos = () => supa.tablas.teia_orders.length;

// ---------------------------------------------------------------------------
seccion('Camino normal — se borra, repone el stock UNA vez y saca el remito');

sembrar();
await drive.fetch('https://oauth2.googleapis.com/token', { method: 'POST' }); // calienta el token
const { uploadPrintCopy, printFileName } = await import('../src/lib/google');
await uploadPrintCopy(printFileName(supa.tablas.teia_orders[0]), new Uint8Array([37, 80, 68, 70]));
const carpeta = [...drive.archivos.values()].find((a) => a.appProperties.teia_role === 'print')!;
ok(drive.hijos(carpeta.id).length === 1, 'el remito está en la carpeta antes de borrar');

let r = await pedirBorrado(28);
const normal: any = await r.json().catch(() => ({}));
ok(r.status === 200, `responde 200 (dio ${r.status})`);
ok(quedanPedidos() === 0, 'el pedido se borró');
ok(stock() === 15, `el stock se repuso una vez: 5 + 10 = 15 (dio ${stock()})`);
ok(drive.hijos(carpeta.id).length === 0, 'y el remito salió de la carpeta de impresión');
ok(normal.ok === true && !normal.warning, `  ...sin ningún aviso (control de los casos de abajo): ${JSON.stringify(normal)}`);

// ---------------------------------------------------------------------------
seccion('Drive COLGADO — el borrado no puede quedar por la mitad');

sembrar();
let colgadas = 0;
const fetchAnterior = globalThis.fetch;
globalThis.fetch = (async (e: any, i: any = {}) => {
  const u = String(e);
  if (u.startsWith('https://fake.supabase.co/')) return supa.responder(u, i);
  if (/'print'/.test(u)) { colgadas++; return new Promise(() => {}) as any; }
  return drive.fetch(e, i);
}) as typeof fetch;

const t0 = Date.now();
r = await pedirBorrado(28);
const tardo = Date.now() - t0;
globalThis.fetch = fetchAnterior;

const colgado: any = await r.json().catch(() => ({}));
ok(colgadas > 0, `Drive quedó colgado de verdad (${colgadas} peticiones)`);
ok(r.status === 200, `responde 200 igual (dio ${r.status})`);
// Revisión del 6/10: antes respondía {ok:true} a secas y el remito podía quedar en la carpeta del local.
ok(colgado.ok === true && colgado.warning?.includes(printFileName({ order_number: 'TEIA-9028', client_name: 'Chungo Local Dos', confirmed_at: '2026-09-07T11:00:00Z' }))
  && /no confirmó/.test(colgado.warning || ''), `  ...y avisa, con el nombre del archivo: ${colgado.warning}`);
ok(quedanPedidos() === 0, 'EL PEDIDO SE BORRÓ pese al cuelgue de Drive');
ok(stock() === 15, `el stock se repuso UNA sola vez (dio ${stock()})`);
ok(tardo < 12000, `y corta por el tope, no por el de Vercel (tardó ${(tardo / 1000).toFixed(1)}s)`);

// ---------------------------------------------------------------------------
seccion('Drive FALLA al sacar la copia (no cuelga): se borra y se avisa');

sembrar();
await uploadPrintCopy(printFileName(supa.tablas.teia_orders[0]), new Uint8Array([37, 80, 68, 70]));
const carpeta2 = [...drive.archivos.values()].find((a) => a.appProperties.teia_role === 'print')!;
drive.fallar(/\/files\/[^/?]+\?fields=id$/, 500, 9); // el PATCH que la manda a la papelera, con sus reintentos
r = await pedirBorrado(28);
const fallo: any = await r.json().catch(() => ({}));
ok(drive.fallasDisparadas() >= 1, `el PATCH de la papelera falló de verdad (${drive.fallasDisparadas()} veces)`);
ok(r.status === 200 && quedanPedidos() === 0 && stock() === 15, 'el pedido se borra y el stock se repone una vez');
ok(drive.hijos(carpeta2.id).length === 1, '  ...la copia sigue en la carpeta (es lo que hay que avisar)');
ok(fallo.ok === true && fallo.warning?.includes(printFileName({ order_number: 'TEIA-9028', client_name: 'Chungo Local Dos', confirmed_at: '2026-09-07T11:00:00Z' })),
  `  ...y el aviso nombra el archivo: ${fallo.warning}`);

// ---------------------------------------------------------------------------
seccion('El reintento no puede duplicar la reposición');

// Ya borrado: un segundo Borrar tiene que rebotar sin volver a tocar el stock.
const stockAntes = stock();
r = await pedirBorrado(28);
ok(r.status === 404, `un segundo borrado da 404 (dio ${r.status})`);
ok(stock() === stockAntes, `y NO vuelve a reponer stock (sigue en ${stock()})`);

// ---------------------------------------------------------------------------
seccion('Un pedido sin remito no rompe nada');

sembrar();
supa.tablas.teia_orders[0].remito_cliente_url = null;
r = await pedirBorrado(28);
ok(r.status === 200, 'se borra igual');
ok(quedanPedidos() === 0, '  ...y desaparece');

// ---------------------------------------------------------------------------
seccion('El DELETE falla y ella toca Reintentar: el stock se repone UNA sola vez');
// Auditoría del 19/9: el stock se reponía y después se borraba, sin marca. Si el DELETE fallaba,
// el reintento encontraba el pedido todavía "confirmado" y reponía otra vez.
sembrar();
supa.fallar(/teia_orders\?id=eq\.28(&|$)/, 503, 1, undefined, 'DELETE'); // por tabla y verbo, no por la forma exacta de la URL
let o: any;
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(supa.fallasDisparadas() === 1 && r.status === 500, `el DELETE falló de verdad (${r.status})`);
ok(stock() === 15 && supa.tablas.teia_orders[0]?.status === 'anulado', `el stock se repuso (15) y el pedido quedó ANULADO (${supa.tablas.teia_orders[0]?.status})`);
ok(/stock ya se repuso/.test(o.error || ''), `  ...y el mensaje lo dice: ${o.error}`);
r = await pedirBorrado(28);
ok(r.status === 200 && quedanPedidos() === 0, 'Reintentar lo borra');
ok(stock() === 15, `  ...SIN volver a reponer (sigue en 15; antes quedaba en 25): ${stock()}`);

// ---------------------------------------------------------------------------
seccion('Si falla reponer un producto, no se borra y se dice cuál sumar a mano');
sembrar();
supa.fallar(/teia_products\?id=eq\.1$/, 503, 1, undefined, 'PATCH');
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(supa.fallasDisparadas() === 1 && r.status === 500 && quedanPedidos() === 1, 'falla la reposición → NO se borra');
ok(/Chipá ×10/.test(o.error || '') && /a mano/.test(o.error || ''), `  ...y nombra qué sumar a mano: ${o.error}`);
ok(supa.tablas.teia_orders[0].status === 'anulado' && stock() === 5, '  ...el pedido queda anulado y el stock como estaba');
r = await pedirBorrado(28);
ok(r.status === 200 && quedanPedidos() === 0 && stock() === 5, 'el reintento lo borra sin reponer (ella ya sabe qué sumar a mano)');

// ---------------------------------------------------------------------------
seccion('Si no se pueden leer las líneas, no se toca nada');
sembrar();
supa.fallar(/teia_order_items\?order_id=eq\.28/, 503, 1, undefined, 'GET');
r = await pedirBorrado(28);
ok(supa.fallasDisparadas() === 1 && r.status === 500 && quedanPedidos() === 1, 'no se pudo leer → no se borra');
ok(supa.tablas.teia_orders[0].status === 'confirmado' && stock() === 5, `  ...vuelve a 'confirmado' y el stock intacto (${supa.tablas.teia_orders[0].status}, ${stock()})`);
r = await pedirBorrado(28);
ok(r.status === 200 && stock() === 15, 'el reintento hace todo de cero, una vez');

// ---------------------------------------------------------------------------
seccion('Dos Borrar a la vez (compu y celular): el stock se repone una vez');
sembrar();
const [b1, b2] = await Promise.all([pedirBorrado(28), pedirBorrado(28)]);
ok(stock() === 15, `stock 15, no 25 (${stock()}); respuestas ${b1.status} y ${b2.status}`);
ok(quedanPedidos() === 0, '  ...y el pedido se borró');

// ---------------------------------------------------------------------------
seccion('Dos Borrar a la vez: el que pierde NO borra (si no, la cascada se lleva las líneas antes de reponer)');
sembrar();
// El segundo Borrar lee el pedido cuando el primero ya lo anuló y todavía no repuso: tiene que
// contestar "recargá" y no hacer el DELETE.
const g = supa.despuesDe(/teia_orders\?id=eq\.28&status=eq\.confirmado/, 'PATCH', () => { /* el primero ganó el claim */ });
const [p1, p2] = await Promise.all([pedirBorrado(28), pedirBorrado(28)]);
const estados = [p1.status, p2.status].sort().join(',');
ok(stock() === 15, `el stock se repuso UNA vez (15): ${stock()}`);
ok(quedanPedidos() === 0, '  ...el pedido se borró');
ok(estados === '200,409' || estados === '200,404', `  ...uno borró y el otro rebotó sin tocar nada (${estados})`);
const claims = supa.llamadas.filter((l: any) => l.metodo === 'PATCH' && /teia_orders\?id=eq\.28&status=eq\.confirmado/.test(l.url)).length;
const deletes = supa.llamadas.filter((l: any) => l.metodo === 'DELETE' && /teia_orders\?id=eq\.28/.test(l.url)).length;
ok(claims === 2, `  ...los dos llegaron a pedir el anulado a la vez (el cruce ocurrió de verdad): ${claims}`);
ok(deletes === 1, `  ...y hubo UN solo DELETE: el que perdió no borra (${deletes})`);
supa.limpiarGanchos();

// ---------------------------------------------------------------------------
seccion('El anulado sin respuesta: se relee antes de decir nada');
sembrar();
supa.fallar(/teia_orders\?id=eq\.28&status=eq\.confirmado/, 0, 1, undefined, 'PATCH'); // no llegó a la base
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(r.status === 500 && /No se cambió nada/.test(o.error || '') && supa.tablas.teia_orders[0].status === 'confirmado' && stock() === 5,
  `no llegó: "no se cambió nada", y es verdad (${o.error})`);
sembrar();
supa.despuesDe(/teia_orders\?id=eq\.28&status=eq\.confirmado/, 'PATCH', () => { throw new TypeError('se cortó la respuesta'); });
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(r.status === 500 && o.anulado === true && o.recargar === true && /este intento NO repuso/.test(o.error || '') && /Chipá ×10/.test(o.error || ''),
  `llegó pero se perdió la respuesta: "este intento no repuso", qué sumar y a Recargar (${o.error})`);
ok(stock() === 5 && supa.tablas.teia_orders[0].status === 'anulado', '  ...sin reponer a ciegas');
supa.limpiarGanchos();

// ---------------------------------------------------------------------------
seccion('El anulado sin respuesta Y la relectura también falla: no se le manda a sumar nada');
// El caso de la verificación del 19/9: antes la respuesta traía anulado:true y "sumá lo que falte;
// el próximo Borrar no repone". Pero el pedido seguía CONFIRMADO: ella sumaba 10 a mano, tocaba
// Borrar, y ese Borrar reponía otros 10. Stock final 25 en vez de 15.
sembrar();
// Las fallas se instalan justo después de leer las líneas (el paso anterior al anulado), por tabla y
// verbo: el anulado no llega a la base y la relectura del estado da 503.
supa.despuesDe(/teia_order_items/, 'GET', () => {
  supa.fallar(/teia_orders/, 0, 1, undefined, 'PATCH');
  supa.fallar(/teia_orders/, 503, 1, undefined, 'GET');
});
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(r.status === 500 && !o.anulado && o.recargar === true && /No sumes ni restes/.test(o.error || ''),
  `"no sé qué pasó: no sumes nada, recargá", sin anulado:true (${o.error})`);
ok(supa.fallasDisparadas() === 2, `  ...las dos fallas ocurrieron de verdad (${supa.fallasDisparadas()})`);
ok(supa.tablas.teia_orders[0].status === 'confirmado' && stock() === 5, '  ...y el pedido sigue confirmado, sin reponer');
supa.limpiarGanchos();
r = await pedirBorrado(28); // recargó, lo ve confirmado y vuelve a tocar Borrar, SIN haber sumado nada
ok(r.status === 200 && stock() === 15 && quedanPedidos() === 0, `el Borrar siguiente repone UNA vez: 15 (${stock()})`);

sembrar();
// El anulado llegó y se perdió la respuesta, y la relectura falla: tampoco se afirma nada.
supa.despuesDe(/teia_orders\?id=eq\.28&status=eq\.confirmado/, 'PATCH', () => {
  supa.fallar(/teia_orders/, 503, 1, undefined, 'GET');
  throw new TypeError('se cortó la respuesta');
});
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(r.status === 500 && !o.anulado && o.recargar === true && /No sumes ni restes/.test(o.error || ''), `llegó, se perdió y no se puede releer: "recargá" (${o.error})`);
ok(supa.tablas.teia_orders[0].status === 'anulado' && stock() === 5, '  ...quedó anulado sin reponer: la tarjeta, al recargar, dice qué revisar');
supa.limpiarGanchos();

sembrar();
// El anulado no llega, y en el medio el otro dispositivo lo borró del todo.
supa.despuesDe(/teia_order_items/, 'GET', () => {
  supa.fallar(/teia_orders/, 0, 1, undefined, 'PATCH');
  supa.tablas.teia_orders = [];
});
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(r.status === 409 && o.recargar === true && /ya se borró/.test(o.error || ''), `ya no existe: "ya se borró desde otro lado" (${r.status}: ${o.error})`);
supa.limpiarGanchos();

// ---------------------------------------------------------------------------
seccion('El otro Borrar lo sacó mientras este reponía: no es un error');
sembrar();
// Este Borrar ganó el anulado y repone; el otro lo encontró 'anulado' y lo borró sin reponer. El
// DELETE de este no encuentra fila: antes contestaba 409 "no se borró nada", y sí se había borrado.
supa.despuesDe(/teia_products/, 'PATCH', () => { supa.tablas.teia_orders = []; });
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(r.status === 200 && stock() === 15, `200 y stock 15: lo que ella pidió está hecho (${r.status}: ${o.error || 'ok'})`);
supa.limpiarGanchos();

// ---------------------------------------------------------------------------
seccion('Borrar un PENDIENTE mientras el celular lo confirma: no se borra');
sembrar();
supa.tablas.teia_orders[0].status = 'pendiente';
supa.despuesDe(/teia_orders\?id=eq\.28&select=/, 'GET', () => { supa.tablas.teia_orders[0].status = 'confirmado'; });
r = await pedirBorrado(28);
o = await r.json().catch(() => ({}));
ok(r.status === 409 && quedanPedidos() === 1, `lo confirmaron entre la lectura y el DELETE → 409, el pedido sigue (${r.status}): ${o.error}`);
supa.limpiarGanchos();

console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`}\n`);
desinstalar();
process.exit(fallas ? 1 : 0);
