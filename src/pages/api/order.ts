export const prerender = false;
import type { APIRoute } from 'astro';
import { sbSelectStrict, sbInsert, sbPatch, sbDelete, supaConfigured, env } from '../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Public: create an order from the cart. Prices are RE-READ from the DB — never trust the
// client's prices. Status starts 'pendiente'; Teia confirms it from /administradora.
export const POST: APIRoute = async ({ request }) => {
  // Demo mode (no Supabase): don't persist, but return OK so the checkout flow is fully clickable.
  if (!supaConfigured()) return json({ ok: true, order_number: 'TEIA-DEMO' });

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return json({ error: 'El carrito está vacío.' }, 400);
  if (items.length > 200) return json({ error: 'Demasiados ítems en el pedido.' }, 400);

  const client_name = String(body?.client_name || '').slice(0, 160).trim();
  const client_contact = String(body?.client_contact || '').slice(0, 160).trim();
  const delivery_address = String(body?.delivery_address || '').slice(0, 300).trim();
  if (!client_name || !client_contact || !delivery_address) return json({ error: 'Faltan datos del pedido.' }, 400);

  // Los ids tienen que ser enteros: un id inválido haría que PostgREST rechace el in.() ENTERO
  // y el pedido se cotizaría sin precios. Mejor rebotar el carrito de entrada.
  const rawIds = items.map((i: any) => Number(i.id));
  if (rawIds.some((n: number) => !Number.isInteger(n) || n <= 0)) return json({ error: 'El carrito tiene productos inválidos. Volvé al catálogo y armalo de nuevo.' }, 400);
  const ids = [...new Set(rawIds)];

  // Select ESTRICTO: null = no se pudo leer (red/5xx) y se aborta — jamás cotizar a $0 por un
  // fallo transitorio. Solo se venden productos existentes y visibles (active).
  const prods = await sbSelectStrict(`teia_products?id=in.(${ids.join(',')})&active=is.true&select=id,name,pack_label,price`);
  if (prods === null) return json({ error: 'No pudimos procesar el pedido en este momento. Esperá un minuto y probá de nuevo.' }, 503);
  const byId: Record<string, any> = Object.fromEntries(prods.map((p: any) => [String(p.id), p]));

  // Producto borrado u ocultado después de armar el carrito (o cargado por la recompra):
  // avisar QUÉ falta en vez de grabar esa línea a $0 en silencio.
  const missing = items.filter((i: any) => !byId[String(Number(i.id))]);
  if (missing.length) {
    const names = missing.map((i: any) => String(i.name || 'un producto').slice(0, 60)).join(', ');
    return json({ error: `Estos productos ya no están disponibles: ${names}. Quitalos del pedido y volvé a enviarlo.` }, 409);
  }

  let total = 0;
  const orderItems = items.map((i: any) => {
    const p = byId[String(Number(i.id))];
    const qty = Math.min(9999, Math.max(1, parseInt(i.qty) || 1));
    const unit_price = Number(p.price) || 0;
    const line_total = unit_price * qty;
    total += line_total;
    return {
      product_id: p.id,
      name: p.name,
      pack_label: p.pack_label || '',
      qty,
      unit_price,
      line_total,
    };
  });

  // Pedido mínimo también en el server: la UI del catálogo lo muestra, pero desde /pedido se
  // pueden bajar cantidades y sin este chequeo entraría cualquier monto.
  const MIN_ORDER = Number(env('TEIA_MIN_ORDER')) || 40000;
  if (total < MIN_ORDER) {
    return json({ error: `El pedido mínimo mayorista es de $${MIN_ORDER.toLocaleString('es-AR')}. Sumá productos para llegar.` }, 400);
  }

  const created = await sbInsert<any>('teia_orders', {
    client_name, client_contact, delivery_address,
    delivery_date: body?.delivery_date || null,
    notes: String(body?.notes || '').slice(0, 500),
    status: 'pendiente', version: 1, total,
  });
  const order = created && created[0];
  if (!order) return json({ error: 'No se pudo crear el pedido.' }, 500);

  // Ítems PRIMERO y chequeado (sin ítems no hay pedido): si el insert falla, se borra el
  // encabezado huérfano y el cliente recibe un error real en vez de "¡Pedido enviado!".
  const inserted = await sbInsert('teia_order_items', orderItems.map((it: any) => ({ ...it, order_id: order.id })));
  if (!inserted) {
    await sbDelete(`teia_orders?id=eq.${order.id}`);
    return json({ error: 'No se pudo guardar el pedido. Probá de nuevo en un momento.' }, 500);
  }

  const order_number = 'TEIA-' + String(order.id).padStart(4, '0');
  // El número es cosmético (el panel cae a #id si falta): con un reintento alcanza.
  if (!(await sbPatch(`teia_orders?id=eq.${order.id}`, { order_number }))) {
    await sbPatch(`teia_orders?id=eq.${order.id}`, { order_number });
  }

  return json({ ok: true, order_number });
};
