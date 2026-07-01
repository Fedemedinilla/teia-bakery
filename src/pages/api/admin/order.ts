export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelect, sbPatch, sbDelete, supaConfigured } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: editar las CANTIDADES de un pedido. Recibe { id, items:[{id, qty}] }.
// qty=0 elimina la línea. Recalcula el line_total de cada ítem y el total del pedido.
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ ok: true, demo: true });
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const orderId = Number(b?.id);
  const edits = Array.isArray(b?.items) ? b.items : [];
  if (!orderId) return json({ error: 'id inválido.' }, 400);

  // Precio unitario actual de cada ítem (no se confía en el cliente para el precio).
  const current = await sbSelect(`teia_order_items?order_id=eq.${orderId}&select=id,unit_price`);
  const priceById: Record<string, number> = Object.fromEntries(
    (current as any[]).map((i) => [String(i.id), Number(i.unit_price) || 0])
  );

  for (const e of edits) {
    const id = Number(e?.id);
    if (!id || !(String(id) in priceById)) continue;
    const qty = Math.max(0, parseInt(e?.qty) || 0);
    if (qty === 0) {
      await sbDelete(`teia_order_items?id=eq.${id}`);
    } else {
      await sbPatch(`teia_order_items?id=eq.${id}`, { qty, line_total: priceById[String(id)] * qty });
    }
  }

  // Recalcular el total del pedido leyendo los ítems que quedaron.
  const fresh = await sbSelect(`teia_order_items?order_id=eq.${orderId}&select=line_total`);
  const total = (fresh as any[]).reduce((s, i) => s + (Number(i.line_total) || 0), 0);
  await sbPatch(`teia_orders?id=eq.${orderId}`, { total });

  return json({ ok: true, total });
};
