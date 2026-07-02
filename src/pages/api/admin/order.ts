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
  if (!orderId) return json({ error: 'id inválido.' }, 400);

  // Borrar el pedido (la FK on delete cascade elimina sus ítems). No restaura stock.
  if (b?.action === 'delete') {
    const ok = await sbDelete(`teia_orders?id=eq.${orderId}`);
    return ok ? json({ ok: true }) : json({ error: 'No se pudo borrar.' }, 500);
  }

  const edits = Array.isArray(b?.items) ? b.items : [];

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

  // Recalcular el total: subtotal de los ítems, menos el descuento fiel (0 o 10%).
  const fresh = await sbSelect(`teia_order_items?order_id=eq.${orderId}&select=line_total`);
  const subtotal = (fresh as any[]).reduce((s, i) => s + (Number(i.line_total) || 0), 0);
  let pct: number;
  if ('discount_pct' in b) {
    pct = [0, 10].includes(Number(b.discount_pct)) ? Number(b.discount_pct) : 0;
  } else {
    // No vino el descuento en este request → mantener el que ya tenía el pedido.
    const cur = await sbSelect(`teia_orders?id=eq.${orderId}&select=discount_pct`);
    pct = Number((cur as any[])[0]?.discount_pct) || 0;
  }
  const total = Math.round(subtotal * (1 - pct / 100));

  // Patch del pedido: total + descuento + detalles editables (los NOT NULL solo si vienen con texto).
  const patch: Record<string, any> = { total, discount_pct: pct };
  const name = String(b?.client_name ?? '').slice(0, 160).trim();
  if (name) patch.client_name = name;
  const contact = String(b?.client_contact ?? '').slice(0, 160).trim();
  if (contact) patch.client_contact = contact;
  const addr = String(b?.delivery_address ?? '').slice(0, 300).trim();
  if (addr) patch.delivery_address = addr;
  if ('delivery_date' in b) patch.delivery_date = b.delivery_date || null;
  if ('notes' in b) patch.notes = String(b?.notes ?? '').slice(0, 500).trim();
  await sbPatch(`teia_orders?id=eq.${orderId}`, patch);

  return json({ ok: true, total });
};
