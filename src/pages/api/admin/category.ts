export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbDelete, supaConfigured } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: crear (default) o borrar (action='delete') un rubro/categoría.
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ ok: true, demo: true }); // demo: no persiste
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

  if (b?.action === 'delete') {
    const id = Number(b?.id);
    if (!id) return json({ error: 'id inválido.' }, 400);
    const ok = await sbDelete(`teia_categories?id=eq.${id}`);
    return ok ? json({ ok: true }) : json({ error: 'No se pudo eliminar.' }, 500);
  }

  const name = String(b?.name || '').slice(0, 60).trim();
  if (!name) return json({ error: 'Falta el nombre del rubro.' }, 400);
  const created = await sbInsert('teia_categories', { name, sort_order: parseInt(b?.sort_order) || 0 });
  return created ? json({ ok: true }) : json({ error: 'Ya existe un rubro con ese nombre.' }, 409);
};
