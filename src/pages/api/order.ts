export const prerender = false;
import type { APIRoute } from 'astro';
import { sbSelect, sbInsert, sbPatch, supaConfigured } from '../../lib/supabase';

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

  const client_name = String(body?.client_name || '').slice(0, 160).trim();
  const client_contact = String(body?.client_contact || '').slice(0, 160).trim();
  const delivery_address = String(body?.delivery_address || '').slice(0, 300).trim();
  if (!client_name || !client_contact || !delivery_address) return json({ error: 'Faltan datos del pedido.' }, 400);

  const ids = items.map((i: any) => Number(i.id)).filter(Boolean);
  const prods = ids.length ? await sbSelect(`products?id=in.(${ids.join(',')})&select=id,name,pack_label,price`) : [];
  const byId: Record<string, any> = Object.fromEntries(prods.map((p: any) => [String(p.id), p]));

  let total = 0;
  const orderItems = items.map((i: any) => {
    const p = byId[String(i.id)];
    const qty = Math.max(1, parseInt(i.qty) || 1);
    const unit_price = Number(p?.price || 0);
    const line_total = unit_price * qty;
    total += line_total;
    return {
      product_id: p?.id || null,
      name: p?.name || String(i.name || ''),
      pack_label: p?.pack_label || '',
      qty,
      unit_price,
      line_total,
    };
  });

  const created = await sbInsert<any>('orders', {
    client_name, client_contact, delivery_address,
    delivery_date: body?.delivery_date || null,
    notes: String(body?.notes || '').slice(0, 500),
    status: 'pendiente', version: 1, total,
  });
  const order = created && created[0];
  if (!order) return json({ error: 'No se pudo crear el pedido.' }, 500);

  const order_number = 'TEIA-' + String(order.id).padStart(4, '0');
  await sbPatch(`orders?id=eq.${order.id}`, { order_number });
  await sbInsert('order_items', orderItems.map((it: any) => ({ ...it, order_id: order.id })));

  return json({ ok: true, order_number });
};
