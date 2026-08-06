export const prerender = false;
import type { APIRoute } from 'astro';
import { tryMirror } from '../../../lib/google';
import { catalogOf } from '../../../lib/catalogs';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbPatch, sbDelete, supaConfigured, sbSelectStrict } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: create / update (id present = update) / delete (action='delete') a product.
// image_url llega ya resuelto: o una URL pegada, o la URL pública que devolvió /api/admin/upload.
export const POST: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true }); // demo: nada que persistir

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

  // ── Solo el ENCUADRE ────────────────────────────────────────────────────────────────────
  // Camino propio, y no un "patch parcial" del de abajo, por una razón concreta: ese arma la
  // fila ENTERA desde el body y la pisa. Mandarle solo la imagen le borraría el nombre, el rubro
  // y el precio (o rebotaría con "Falta el nombre", que es lo que pasaba). Acá se tocan dos
  // columnas y nada más.
  if (b?.action === 'encuadre') {
    const id = Number(b?.id);
    if (!id) return json({ error: 'id inválido.' }, 400);
    const recorte = String(b?.image_url || '').slice(0, 400).trim();
    if (!recorte) return json({ error: 'No llegó el recorte.' }, 400);
    const patch: Record<string, any> = { image_url: recorte };
    // La ORIGINAL se escribe una sola vez: la primera. Si ya está guardada no se pisa, porque
    // si no, el segundo encuadre pasaría a hacerse sobre el primer recorte y la foto se
    // degradaría con cada ajuste — justo lo que se quiso evitar.
    const actual = await sbSelectStrict(`teia_products?id=eq.${id}&select=image_original_url`);
    if (actual === null) return json({ error: 'No se pudo leer el producto. Probá de nuevo.' }, 503);
    const yaTiene = String(((actual as any[])[0] || {}).image_original_url || '').trim();
    if (!yaTiene) patch.image_original_url = String(b?.image_original_url || '').slice(0, 400).trim();

    const ok = await sbPatch(`teia_products?id=eq.${id}`, patch);
    if (ok) await tryMirror();
    return ok ? json({ ok: true }) : json({ error: 'No se pudo guardar el encuadre.' }, 500);
  }

  const row = {
    name: String(b?.name || '').slice(0, 160).trim(),
    description: String(b?.description || '').slice(0, 300).trim(),
    category: String(b?.category || '').slice(0, 60).trim(),
    image_url: String(b?.image_url || '').slice(0, 400).trim(),
    image_original_url: String(b?.image_original_url || '').slice(0, 400).trim(),
    pack_label: String(b?.pack_label || '').slice(0, 40).trim(),
    price: Number(b?.price) || 0,
    stock: parseInt(b?.stock) || 0,
    low_stock_threshold: parseInt(b?.low_stock_threshold) || 5,
    active: b?.active !== false,
    catalog: catalogOf(b?.catalog), // a qué lista pertenece (general / chungo)
  };
  if (!row.name) return json({ error: 'Falta el nombre.' }, 400);

  const ok = b?.id
    ? await sbPatch(`teia_products?id=eq.${Number(b.id)}`, row)
    : !!(await sbInsert('teia_products', row));

  if (ok) await tryMirror(); // la pestaña Productos del Sheet queda al día
  return ok ? json({ ok: true }) : json({ error: 'No se pudo guardar.' }, 500);
};
