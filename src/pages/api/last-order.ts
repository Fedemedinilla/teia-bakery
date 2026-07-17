export const prerender = false;
import type { APIRoute } from 'astro';
import { sbSelect, supaConfigured } from '../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Normaliza un teléfono a sus últimos 10 dígitos (ignora +54, 9, espacios, guiones) para poder
// matchear aunque lo hayan escrito con otro formato.
const normPhone = (s: string) => { const d = String(s).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };

// Público: traer el último pedido de un cliente por su WhatsApp/email. La tienda NO tiene login,
// así que identificamos al cliente por el contacto que dejó al pedir. Devuelve los ítems a PRECIO
// ACTUAL y saltea productos que ya no existan o estén ocultos.
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ ok: false, error: 'La búsqueda por WhatsApp funciona con la tienda publicada.' });

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const raw = String(body?.contact || '').trim().slice(0, 160);
  const isEmail = raw.includes('@');
  const needle = isEmail ? raw.toLowerCase() : normPhone(raw);
  if ((isEmail && needle.length < 5) || (!isEmail && needle.length < 6)) {
    return json({ error: 'Ingresá tu WhatsApp o email.' }, 400);
  }

  // Recorremos los pedidos recientes y matcheamos el contacto normalizado. Para el volumen de una
  // pastelería alcanza; si crece mucho, conviene una columna normalizada + índice.
  const orders = await sbSelect('teia_orders?select=id,order_number,client_contact,created_at&order=created_at.desc&limit=1000');
  const match = (orders as any[]).find((o) => {
    const c = String(o.client_contact || '').trim().toLowerCase();
    if (!isEmail) return normPhone(c) === needle;
    // Igualdad EXACTA (no substring: 'ana@x.com' no debe matchear 'mariana@x.com').
    // Tolera contactos guardados como "Nombre <mail@x.com>" o "mail@x.com / 11 5555".
    if (c === needle) return true;
    const tok = c.split(/[\s,;<>()\/]+/).find((t) => t.includes('@'));
    return tok === needle;
  });
  if (!match) return json({ ok: false, error: 'No encontramos pedidos con ese contacto.' });

  const rawItems = await sbSelect(`teia_order_items?order_id=eq.${match.id}&select=product_id,qty`);
  const pids = [...new Set((rawItems as any[]).map((i) => i.product_id).filter(Boolean))];
  const prods = pids.length
    ? await sbSelect(`teia_products?id=in.(${pids.join(',')})&select=id,name,pack_label,price,active`)
    : [];
  const pById: Record<string, any> = Object.fromEntries((prods as any[]).map((p) => [String(p.id), p]));

  const items: any[] = [];
  for (const it of rawItems as any[]) {
    const p = it.product_id ? pById[String(it.product_id)] : null;
    if (!p || p.active === false) continue; // producto borrado u oculto → no se puede reordenar
    items.push({ id: p.id, name: p.name, pack: p.pack_label, price: Number(p.price) || 0, qty: Math.max(1, parseInt(it.qty) || 1) });
  }
  if (!items.length) return json({ ok: false, error: 'Tus productos anteriores ya no están disponibles.' });

  return json({ ok: true, order_number: match.order_number || '', items });
};
