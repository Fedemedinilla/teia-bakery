export const prerender = false;
import type { APIRoute } from 'astro';
import { sbSelectStrict, supaConfigured } from '../../lib/supabase';
import { isValidCuit, normCuit } from '../../lib/cuit';
import { DEMO_CLIENTS, DEMO_LAST_ORDER } from '../../lib/demo';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Público: la "sesión" del cliente mayorista. Recibe { cuit } y devuelve su cuenta (datos +
// descuento fiel) y su último pedido a precios ACTUALES (borrados/ocultos se saltean).
// El CUIT es un dato semi-público en AR y esto solo devuelve lo que ese comercio ya sabe de
// sí mismo — decisión consciente, mismo criterio que la búsqueda por WhatsApp que reemplaza.
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const cuit = normCuit(b?.cuit);
  if (!isValidCuit(cuit)) return json({ error: 'Ingresá un CUIT válido (11 dígitos).' }, 400);

  if (!supaConfigured()) {
    const c = DEMO_CLIENTS.find((x) => x.cuit === cuit);
    return c
      ? json({ ok: true, client: { business_name: c.business_name, client_contact: c.client_contact, delivery_address: c.delivery_address, discount_pct: c.discount_pct }, last_order: DEMO_LAST_ORDER })
      : json({ ok: true, unknown: true });
  }

  const rows = await sbSelectStrict(`teia_clients?cuit=eq.${cuit}&select=id,business_name,client_contact,delivery_address,discount_pct`);
  if (rows === null) return json({ error: 'No se pudo consultar. Probá de nuevo en un momento.' }, 503);
  const c = (rows as any[])[0];
  if (!c) return json({ ok: true, unknown: true }); // cuenta nueva: se crea sola con el primer pedido

  let last_order: any = null;
  const lastRows = await sbSelectStrict(`teia_orders?client_id=eq.${c.id}&select=id,order_number&order=created_at.desc&limit=1`);
  const last = lastRows && (lastRows as any[])[0];
  if (last) {
    const rawItems = (await sbSelectStrict(`teia_order_items?order_id=eq.${last.id}&select=product_id,qty&order=id.asc`)) || [];
    const pids = [...new Set((rawItems as any[]).map((i) => i.product_id).filter(Boolean))];
    const prods = pids.length
      ? (await sbSelectStrict(`teia_products?id=in.(${pids.join(',')})&active=is.true&select=id,name,pack_label,price`)) || []
      : [];
    const pById: Record<string, any> = Object.fromEntries((prods as any[]).map((p) => [String(p.id), p]));
    const items: any[] = [];
    for (const it of rawItems as any[]) {
      const p = it.product_id ? pById[String(it.product_id)] : null;
      if (!p) continue;
      items.push({ id: p.id, name: p.name, pack: p.pack_label, price: Number(p.price) || 0, qty: Math.max(1, parseInt(it.qty) || 1) });
    }
    if (items.length) last_order = { order_number: last.order_number || '', items };
  }

  return json({
    ok: true,
    client: {
      business_name: c.business_name,
      client_contact: c.client_contact,
      delivery_address: c.delivery_address,
      discount_pct: Number(c.discount_pct) || 0,
    },
    last_order,
  });
};
