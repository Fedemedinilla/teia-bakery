export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelect, sbPatch, env, supaConfigured } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: confirm a pending order → decrement stock per item, flag low stock, and fire the
// n8n archiver (remitos → Drive → Sheet → email). Confirms are serial (one admin), so the
// read-then-write stock loop is fine for this volume.
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ ok: true, demo: true }); // demo: nada que persistir
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const id = Number(body?.id);
  if (!id) return json({ error: 'id' }, 400);

  const orders = await sbSelect(`teia_orders?id=eq.${id}&select=*`);
  const order = orders[0];
  if (!order) return json({ error: 'no existe' }, 404);
  if (order.status !== 'pendiente') return json({ error: 'ya procesado' }, 409);

  const items = await sbSelect(`teia_order_items?order_id=eq.${id}&select=product_id,qty`);
  const lowStock: string[] = [];
  for (const it of items as any[]) {
    if (!it.product_id) continue;
    const prods = await sbSelect(`teia_products?id=eq.${it.product_id}&select=id,name,stock,low_stock_threshold`);
    const p = prods[0] as any;
    if (!p) continue;
    const newStock = Math.max(0, Number(p.stock) - Number(it.qty));
    await sbPatch(`teia_products?id=eq.${p.id}`, { stock: newStock });
    if (newStock <= Number(p.low_stock_threshold)) lowStock.push(`${p.name} (${newStock})`);
  }

  await sbPatch(`teia_orders?id=eq.${id}`, { status: 'confirmado', confirmed_at: new Date().toISOString() });

  // Fire the n8n archiver (no-op if the webhook isn't configured yet).
  const hook = env('N8N_WEBHOOK_URL');
  if (hook) {
    try {
      await fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: id, order_number: order.order_number }),
      });
    } catch { /* never block the confirm on the webhook */ }
  }

  // Low-stock alert. For now logged; next step = email via Resend to Teia.
  if (lowStock.length) console.warn('[teia] poco stock tras confirmar', order.order_number, '→', lowStock.join(', '));

  return json({ ok: true, low_stock: lowStock });
};
