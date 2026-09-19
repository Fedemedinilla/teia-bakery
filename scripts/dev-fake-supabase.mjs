// Servidor PostgREST + Storage FALSO, para levantar el panel en el navegador con datos con forma
// real (pedidos confirmados, con remito) sin tocar la base de la clienta ni tener credenciales.
//
// Uso:
//   node scripts/dev-fake-supabase.mjs        (queda escuchando en :54321)
// y en otra terminal:
//   SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=x TEIA_ADMIN_PASSWORD=test npm run dev
//
// Solo para desarrollo. No se importa desde `src/`.
import { createServer } from 'node:http';

const PUERTO = 54321;

const ahora = Date.now();
const haceHoras = (h) => new Date(ahora - h * 3600 * 1000).toISOString();

const db = {
  teia_orders: [
    { id: 101, order_number: 'TEIA-9029', client_id: 1, client_name: 'Chungo Local Uno', client_contact: '1100000001',
      delivery_address: 'Calle Falsa 101, local 6', delivery_date: null, notes: '', total: 128600, discount_pct: 0,
      status: 'confirmado', version: 1, created_at: haceHoras(6), confirmed_at: haceHoras(5),
      archive_status: 'archivado', archive_error: null, archived_at: haceHoras(5),
      remito_cliente_url: 'remito-101-aaaa-cliente-v1.pdf', remito_interno_url: null, saldo_anterior: null, costo_envio: null },
    { id: 102, order_number: 'TEIA-9028', client_id: 2, client_name: 'Chungo Local Dos', client_contact: '1100000002',
      delivery_address: 'Calle Falsa 202, local 2', delivery_date: null, notes: '', total: 857900, discount_pct: 0,
      status: 'confirmado', version: 1, created_at: haceHoras(8), confirmed_at: haceHoras(7),
      // Archivado FALLIDO pero con remito: el caso donde el boton "Mandar a imprimir" mas hace falta.
      archive_status: 'error', archive_error: 'Google API 503', archived_at: null,
      remito_cliente_url: 'remito-102-bbbb-cliente-v1.pdf', remito_interno_url: null, saldo_anterior: null, costo_envio: null },
    { id: 103, order_number: 'TEIA-0030', client_id: 4, client_name: 'Café Uno', client_contact: '1100000003',
      delivery_address: 'Calle Falsa 303, CABA', delivery_date: null, notes: 'Entregar entre 8 y 19:30', total: 193000,
      discount_pct: 10, status: 'pendiente', version: 1, created_at: haceHoras(1), confirmed_at: null,
      archive_status: null, archive_error: null, archived_at: null,
      remito_cliente_url: null, remito_interno_url: null, saldo_anterior: null, costo_envio: null },
    // Dos pedidos PENDIENTES de $180.000 de Chungo: el mismo monto tiene que dar respuestas
    // distintas según el comercio. Local Dos sigue la lista ($140.000 → llega); Pilar tiene su
    // monto propio ($250.000 → no llega). Es el caso exacto del pedido de la clienta del 14/9.
    { id: 104, order_number: 'TEIA-0031', client_id: 3, client_name: 'Chungo Pilar', client_contact: '1100000004',
      delivery_address: 'Calle Falsa 404, Pilar', delivery_date: null, notes: '', total: 180000, discount_pct: 0,
      status: 'pendiente', version: 1, created_at: haceHoras(2), confirmed_at: null,
      archive_status: null, archive_error: null, archived_at: null,
      remito_cliente_url: null, remito_interno_url: null, saldo_anterior: null, costo_envio: null },
    { id: 105, order_number: 'TEIA-0032', client_id: 2, client_name: 'Chungo Local Dos', client_contact: '1100000002',
      delivery_address: 'Calle Falsa 202, local 2', delivery_date: null, notes: '', total: 180000, discount_pct: 0,
      status: 'pendiente', version: 1, created_at: haceHoras(3), confirmed_at: null,
      archive_status: null, archive_error: null, archived_at: null,
      remito_cliente_url: null, remito_interno_url: null, saldo_anterior: null, costo_envio: null },
    // Pendiente cuya cuenta ya no existe (se borró después de pedir): "＋ Agregar" no puede saber
    // de qué lista sacar el precio, así que el panel lo explica en vez de ofrecer el menú.
    { id: 106, order_number: 'TEIA-0033', client_id: null, client_name: 'Cuenta borrada', client_contact: '1100000000',
      delivery_address: 'Sin dirección', delivery_date: null, notes: '', total: 22300, discount_pct: 0,
      status: 'pendiente', version: 1, created_at: haceHoras(4), confirmed_at: null,
      archive_status: null, archive_error: null, archived_at: null,
      remito_cliente_url: null, remito_interno_url: null, saldo_anterior: null, costo_envio: null },
  ],
  teia_order_items: [
    { id: 5, order_id: 104, product_id: 4, name: 'Chipá (Chungo)', pack_label: 'x12', qty: 60, unit_price: 3000, line_total: 180000 },
    { id: 6, order_id: 105, product_id: 4, name: 'Chipá (Chungo)', pack_label: 'x12', qty: 60, unit_price: 3000, line_total: 180000 },
    { id: 1, order_id: 101, product_id: 1, name: 'Chipá', pack_label: 'x12', qty: 40, unit_price: 2100, line_total: 84000 },
    { id: 2, order_id: 101, product_id: 2, name: 'Cheesecake', pack_label: 'x6', qty: 2, unit_price: 22300, line_total: 44600 },
    { id: 3, order_id: 102, product_id: 1, name: 'Chipá', pack_label: 'x12', qty: 70, unit_price: 2100, line_total: 147000 },
    { id: 4, order_id: 103, product_id: 3, name: 'Alfajor de maicena', pack_label: 'x12', qty: 10, unit_price: 19300, line_total: 193000 },
    { id: 7, order_id: 106, product_id: 2, name: 'Cheesecake', pack_label: 'x6', qty: 1, unit_price: 22300, line_total: 22300 },
  ],
  teia_products: [
    { id: 1, name: 'Chipá', description: '', category: 'Salados', image_url: '', pack_label: 'x12', pack_size: 12,
      price: 2100, stock: 40, low_stock_threshold: 5, active: true, catalog: 'general', sort_order: 1, created_at: haceHoras(200) },
    { id: 2, name: 'Cheesecake', description: '', category: 'Tortas', image_url: '', pack_label: 'x6', pack_size: 6,
      price: 22300, stock: 12, low_stock_threshold: 5, active: true, catalog: 'general', sort_order: 2, created_at: haceHoras(200) },
    { id: 3, name: 'Alfajor de maicena', description: '', category: 'Salados', image_url: '', pack_label: 'x12', pack_size: 12,
      price: 19300, stock: 3, low_stock_threshold: 5, active: true, catalog: 'general', sort_order: 3, created_at: haceHoras(200) },
    { id: 4, name: 'Chipá (Chungo)', description: '', category: 'Salados', image_url: '', pack_label: 'x12', pack_size: 12,
      price: 3000, stock: 200, low_stock_threshold: 5, active: true, catalog: 'chungo', sort_order: 1, created_at: haceHoras(200) },
    // Para "＋ Agregar producto": uno sin stock (se ofrece igual, avisando), uno sin precio (se
    // muestra apagado) y uno inactivo (no se ofrece).
    { id: 5, name: 'Cheesecake (Chungo)', description: '', category: 'Tortas', image_url: '', pack_label: 'x6', pack_size: 6,
      price: 25000, stock: 0, low_stock_threshold: 2, active: true, catalog: 'chungo', sort_order: 2, created_at: haceHoras(200) },
    { id: 6, name: 'Budín de limón (Chungo)', description: '', category: '', image_url: '', pack_label: 'x1', pack_size: 1,
      price: 0, stock: 10, low_stock_threshold: 2, active: true, catalog: 'chungo', sort_order: 3, created_at: haceHoras(200) },
    { id: 7, name: 'Torta discontinuada (Chungo)', description: '', category: 'Tortas', image_url: '', pack_label: 'x1', pack_size: 1,
      price: 18000, stock: 5, low_stock_threshold: 2, active: false, catalog: 'chungo', sort_order: 4, created_at: haceHoras(200) },
  ],
  teia_clients: [
    { id: 1, cuit: '30000000015', business_name: 'Chungo Local Uno', client_contact: '1100000001',
      delivery_address: 'Calle Falsa 101', catalog: 'chungo', active: true, access_code: null,
      discount_pct: 0, notes: '', created_at: haceHoras(500), last_order_at: haceHoras(5), envio_min: null },
    { id: 2, cuit: '30000000023', business_name: 'Chungo Local Dos', client_contact: '1100000002',
      delivery_address: 'Calle Falsa 202', catalog: 'chungo', active: true, access_code: null,
      discount_pct: 0, notes: '', created_at: haceHoras(500), last_order_at: haceHoras(7), envio_min: null },
    // El único local de Chungo con monto propio (pedido de la clienta, 14/9).
    { id: 3, cuit: '30000000031', business_name: 'Chungo Pilar', client_contact: '1100000004',
      delivery_address: 'Calle Falsa 404, Pilar', catalog: 'chungo', active: true, access_code: null,
      discount_pct: 0, notes: '', created_at: haceHoras(500), last_order_at: haceHoras(2), envio_min: 250000 },
    // Un comercio de la lista GENERAL (el pedido 103 es suyo): su menú de "＋ Agregar" no puede
    // traer nada de Chungo.
    { id: 4, cuit: '30000000058', business_name: 'Café Uno', client_contact: '1100000003',
      delivery_address: 'Calle Falsa 303, CABA', catalog: 'general', active: true, access_code: null,
      discount_pct: 10, notes: '', created_at: haceHoras(500), last_order_at: haceHoras(1), envio_min: null },
  ],
  teia_categories: [
    { id: 1, name: 'Tortas', sort_order: 1, created_at: haceHoras(500) },
    { id: 2, name: 'Salados', sort_order: 2, created_at: haceHoras(500) },
  ],
  teia_info: [
    { id: 1, pregunta: '¿Cómo se paga?', respuesta: 'Transferencia o efectivo.', sort_order: 1, en_checkout: true, created_at: haceHoras(500) },
  ],
  teia_settings: [
    { key: 'envio_min_general', value: '140000', updated_at: haceHoras(100) },
    // Era '250000': el error de agosto. La lista Chungo es $140.000; lo de Pilar va en su ficha.
    { key: 'envio_min_chungo', value: '140000', updated_at: haceHoras(100) },
    { key: 'require_code', value: 'false', updated_at: haceHoras(100) },
  ],
  teia_push_subs: [],
};

// ANTES_DEL_SQL=1 → la base como está HOY en producción: sin la columna teia_clients.envio_min.
// Se le saca la clave a las filas y se rechaza la columna como lo hace PostgREST: 400 en un select
// explícito que la nombre (42703) y en el cuerpo de un PATCH/POST (PGRST204). Es la única forma de
// ver en el navegador que el catálogo y la ficha sobreviven a un deploy sin el SQL corrido.
const ANTES_DEL_SQL = process.env.ANTES_DEL_SQL === '1';
if (ANTES_DEL_SQL) for (const c of db.teia_clients) delete c.envio_min;
const COLUMNA_NUEVA = { tabla: 'teia_clients', columna: 'envio_min' };

// Los filtros de PostgREST que usa la app: eq, neq, in.(a,b), is.true/false/null y not.is.X.
// Un operador desconocido se AVISA en la consola (antes se ignoraba y el filtro "pasaba").
const ultimoId = {};

const filtrar = (tabla, params) => {
  let filas = db[tabla] || [];
  const cumple = (valor, op, arg) => {
    if (op === 'eq') return String(valor) === arg;
    if (op === 'neq') return String(valor) !== arg;
    if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim()).includes(String(valor));
    if (op === 'is') return arg === 'null' ? valor == null : String(valor) === arg;
    // Comparaciones (la lectura paginada por rangos de id usa `id=gt.N`).
    if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
      if (valor == null) return false;
      const a = typeof valor === 'number' && Number.isFinite(Number(arg)) ? valor : String(valor);
      const b = typeof a === 'number' ? Number(arg) : arg;
      return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b;
    }
    return null;
  };
  for (const [k, v] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = String(v).match(/^(not\.)?([a-z]+)\.(.*)$/);
    if (!m || cumple(undefined, m[2], m[3]) === null) {
      console.log(`    !! OPERADOR NO SOPORTADO por el fake: ${tabla}?${k}=${v}`);
      continue;
    }
    filas = filas.filter((f) => (m[1] ? !cumple(f[k], m[2], m[3]) : cumple(f[k], m[2], m[3])));
  }
  return filas;
};

// Orden, offset, limit y el tope de 1000 filas de Supabase (db-max-rows), como PostgREST. Antes este
// servidor los ignoraba: la lectura paginada del espejo hacía 500 pedidos y terminaba en null, y el
// panel nunca veía el corte de 1000 filas (auditoría del 19/9).
const MAX_FILAS = 1000;
const ordenarYPaginar = (filas, params) => {
  const orden = params.get('order');
  if (orden) {
    const claves = orden.split(',').map((s) => { const [col, dir] = s.trim().split('.'); return { col, desc: dir === 'desc' }; });
    filas = filas.map((f, i) => ({ f, i })).sort((x, y) => {
      for (const k of claves) {
        const a = x.f[k.col], b = y.f[k.col];
        if (a === b) continue;
        if (a == null) return k.desc ? -1 : 1;
        if (b == null) return k.desc ? 1 : -1;
        const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : 1;
        return k.desc ? -c : c;
      }
      return x.i - y.i;
    }).map((x) => x.f);
  }
  const offset = Number(params.get('offset') || 0);
  const limit = params.has('limit') ? Number(params.get('limit')) : Infinity;
  return filas.slice(offset, offset + Math.min(limit, MAX_FILAS));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  let cuerpo = '';
  for await (const c of req) cuerpo += c;
  const enviar = (o, s = 200) => {
    res.writeHead(s, { 'Content-Type': 'application/json' });
    res.end(typeof o === 'string' ? o : JSON.stringify(o));
  };
  console.log(`  ${req.method} ${url.pathname}${url.search.slice(0, 90)}`);

  // La función SQL de la tarea 3 (supabase/2026-09-19-armar-pedidos.sql): pedido + líneas de una vez,
  // idempotente por armado_id. SIN_FUNCION=1 simula el SQL sin correr (404 PGRST202). RPC_SE_PIERDE=1
  // graba el PRIMER armado y corta la conexión sin contestar (la respuesta que se pierde).
  if (url.pathname === '/rest/v1/rpc/teia_armar_pedido' && req.method === 'POST') {
    if (process.env.SIN_FUNCION === '1') return enviar({ code: 'PGRST202', message: 'Could not find the function' }, 404);
    const p = (JSON.parse(cuerpo || '{}') || {}).p || {};
    // La huella de las líneas guardadas, igual que string_agg en el SQL: el servidor la compara con lo
    // que llega para no contestar "ya estaba creado" cuando el contenido es otro.
    const huella = (id) => db.teia_order_items.filter((l) => l.order_id === id && l.product_id != null)
      .sort((a, b) => Number(a.product_id) - Number(b.product_id) || Number(a.qty) - Number(b.qty))
      .map((l) => `${l.product_id}x${l.qty}`).join(',');
    const resumen = (o, repetido) => ({ id: o.id, order_number: o.order_number, total: Number(o.total),
      discount_pct: Number(o.discount_pct) || 0, status: o.status, client_id: o.client_id, huella: huella(o.id), repetido });
    const ya = db.teia_orders.find((o) => o.armado_id && o.armado_id === p.armado_id);
    if (ya) return enviar(resumen(ya, true));
    if (p.solo_buscar === true || p.solo_buscar === 'true') return enviar(null);
    ultimoId.teia_orders = Math.max(ultimoId.teia_orders || 0, ...db.teia_orders.map((f) => Number(f.id) || 0)) + 1;
    const id = ultimoId.teia_orders;
    const order_number = 'TEIA-' + (id < 1000 ? String(id).padStart(4, '0') : String(id));
    db.teia_orders.push({
      id, order_number, client_id: p.client_id, client_name: p.client_name, client_contact: p.client_contact,
      delivery_address: p.delivery_address, delivery_date: p.delivery_date || null, notes: p.notes || '', total: p.total,
      discount_pct: p.discount_pct || 0, status: 'pendiente', version: 1, created_at: new Date().toISOString(),
      confirmed_at: null, archive_status: null, archive_error: null, archived_at: null, remito_cliente_url: null,
      remito_interno_url: null, saldo_anterior: null, costo_envio: null, placed_by: 'teia', armado_id: p.armado_id,
    });
    ultimoId.teia_order_items = Math.max(ultimoId.teia_order_items || 0, ...db.teia_order_items.map((f) => Number(f.id) || 0));
    for (const it of p.items || []) db.teia_order_items.push({ id: ++ultimoId.teia_order_items, order_id: id, ...it });
    if (process.env.RPC_SE_PIERDE === '1' && !globalThis.__rpcPerdido) {
      globalThis.__rpcPerdido = true;
      console.log('    -> grabado, y la respuesta SE PIERDE (RPC_SE_PIERDE)');
      return req.socket.destroy();
    }
    return enviar(resumen(db.teia_orders.find((o) => o.id === id), false));
  }

  const rest = url.pathname.match(/^\/rest\/v1\/(.+)$/);
  if (rest) {
    const tabla = rest[1];
    db[tabla] ||= [];
    if (ANTES_DEL_SQL && tabla === COLUMNA_NUEVA.tabla) {
      const pedidas = (url.searchParams.get('select') || '*').split(',').map((s) => s.trim());
      if (req.method === 'GET' && pedidas.includes(COLUMNA_NUEVA.columna)) {
        console.log(`    -> 400 42703 (columna ${COLUMNA_NUEVA.columna} inexistente, ANTES_DEL_SQL)`);
        return enviar({ code: '42703', message: `column ${tabla}.${COLUMNA_NUEVA.columna} does not exist` }, 400);
      }
      if ((req.method === 'PATCH' || req.method === 'POST') && cuerpo.includes(`"${COLUMNA_NUEVA.columna}"`)) {
        console.log(`    -> 400 PGRST204 (columna ${COLUMNA_NUEVA.columna} en el cuerpo, ANTES_DEL_SQL)`);
        return enviar({ code: 'PGRST204', message: `Could not find the '${COLUMNA_NUEVA.columna}' column` }, 400);
      }
    }
    if (req.method === 'GET') return enviar(ordenarYPaginar(filtrar(tabla, url.searchParams), url.searchParams));
    if (req.method === 'PATCH') {
      const cambio = JSON.parse(cuerpo || '{}');
      const afectadas = filtrar(tabla, url.searchParams);
      afectadas.forEach((f) => Object.assign(f, cambio));
      return enviar(afectadas);
    }
    if (req.method === 'POST') {
      // Ids como una identity: crecen y no se repiten (antes `length + i + 1` reusaba ids tras un DELETE).
      ultimoId[tabla] = Math.max(ultimoId[tabla] || 0, ...db[tabla].map((f) => Number(f.id) || 0));
      const nuevas = [].concat(JSON.parse(cuerpo || '[]')).map((f, i) => ({ id: ultimoId[tabla] + i + 1, ...f }));
      ultimoId[tabla] += nuevas.length;
      db[tabla].push(...nuevas);
      return enviar(nuevas);
    }
    if (req.method === 'DELETE') {
      const afectadas = filtrar(tabla, url.searchParams);
      db[tabla] = db[tabla].filter((f) => !afectadas.includes(f));
      // `on delete cascade` de schema.sql: borrar un pedido borra sus líneas.
      if (tabla === 'teia_orders') {
        const ids = new Set(afectadas.map((f) => String(f.id)));
        db.teia_order_items = db.teia_order_items.filter((l) => !ids.has(String(l.order_id)));
      }
      // Con `Prefer: return=representation`, como PostgREST, devuelve lo borrado (el borrado de
      // pedidos lo usa para saber si borró algo con la condición de estado).
      const prefer = String(req.headers['prefer'] || '');
      return prefer.includes('representation') ? enviar(afectadas) : enviar(null, 204);
    }
  }

  // Storage: el GET devuelve un PDF de verdad (chico pero valido). Antes devolvia JSON, y
  // sbDownload lo tomaba por bueno: la prueba pasaba con bytes que no eran un PDF.
  if (url.pathname.startsWith('/storage/v1/')) {
    if (req.method === 'GET') {
      const pdf = Buffer.from(
        ['%PDF-1.4', '1 0 obj<</Type/Catalog>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF', ''].join('\n'),
        'latin1'
      );
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length });
      return res.end(pdf);
    }
    return enviar({ Key: 'ok' });
  }
  enviar({ error: 'ruta no soportada por el fake', path: url.pathname }, 404);
}).listen(PUERTO, () => {
  console.log(`Supabase falsa escuchando en http://localhost:${PUERTO}`);
  console.log('Levantá el dev server con:');
  console.log('  SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=x TEIA_ADMIN_PASSWORD=test npm run dev\n');
});
