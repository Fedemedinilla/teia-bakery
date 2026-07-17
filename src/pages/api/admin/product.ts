export const prerender = false;
import type { APIRoute } from 'astro';
import { tryMirror } from '../../../lib/google';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbPatch, sbDelete, supaConfigured } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: create / update (id present = update) / delete (action='delete') a product.
// image_url llega ya resuelto: o una URL pegada, o la URL pública que devolvió /api/admin/upload.
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ ok: true, demo: true }); // demo: nada que persistir
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  // Borrar producto: primero lo desvinculamos de los pedidos (los ítems guardan snapshot de
  // nombre/precio, así que el historial no se pierde) para no romper la FK, y después se elimina.
  if (b?.action === 'delete') {
    const id = Number(b?.id);
    if (!id) return json({ error: 'id inválido.' }, 400);
    await sbPatch(`teia_order_items?product_id=eq.${id}`, { product_id: null });
    const ok = await sbDelete(`teia_products?id=eq.${id}`);
    if (ok) await tryMirror();
    return ok ? json({ ok: true }) : json({ error: 'No se pudo eliminar.' }, 500);
  }

  const row = {
    name: String(b?.name || '').slice(0, 160).trim(),
    description: String(b?.description || '').slice(0, 300).trim(),
    category: String(b?.category || '').slice(0, 60).trim(),
    image_url: String(b?.image_url || '').slice(0, 400).trim(),
    pack_label: String(b?.pack_label || '').slice(0, 40).trim(),
    price: Number(b?.price) || 0,
    stock: parseInt(b?.stock) || 0,
    low_stock_threshold: parseInt(b?.low_stock_threshold) || 5,
    active: b?.active !== false,
  };
  if (!row.name) return json({ error: 'Falta el nombre.' }, 400);

  const ok = b?.id
    ? await sbPatch(`teia_products?id=eq.${Number(b.id)}`, row)
    : !!(await sbInsert('teia_products', row));

  if (ok) await tryMirror(); // la pestaña Productos del Sheet queda al día
  return ok ? json({ ok: true }) : json({ error: 'No se pudo guardar.' }, 500);
};
