export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbPatch } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: create or update a product (id present = update). Image upload to Supabase
// Storage comes next; for now image_url is a pasted link.
export const POST: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const row = {
    name: String(b?.name || '').slice(0, 160).trim(),
    image_url: String(b?.image_url || '').slice(0, 400).trim(),
    pack_label: String(b?.pack_label || '').slice(0, 40).trim(),
    price: Number(b?.price) || 0,
    stock: parseInt(b?.stock) || 0,
    low_stock_threshold: parseInt(b?.low_stock_threshold) || 5,
  };
  if (!row.name) return json({ error: 'Falta el nombre.' }, 400);

  const ok = b?.id
    ? await sbPatch(`products?id=eq.${Number(b.id)}`, row)
    : !!(await sbInsert('products', row));

  return ok ? json({ ok: true }) : json({ error: 'No se pudo guardar.' }, 500);
};
