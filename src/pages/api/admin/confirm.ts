export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelect, sbPatch, supaConfigured } from '../../../lib/supabase';
import { archiveOrder } from './archive';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: confirm a pending order → decrement stock per item, flag low stock, and run the
// app-native archiver (2 remitos PDF → Supabase Storage). Confirms are serial (one admin), so
// the read-then-write stock loop is fine for this volume.
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

  // Archivar (app-native): genera los 2 remitos → Supabase Storage + estado. No bloquea el
  // confirm: archiveOrder captura sus propios errores (quedan en archive_status='error').
  await archiveOrder(id);

  // Low-stock alert. For now logged; next step = email via Resend to Teia.
  if (lowStock.length) console.warn('[teia] poco stock tras confirmar', order.order_number, '→', lowStock.join(', '));

  return json({ ok: true, low_stock: lowStock });
};
