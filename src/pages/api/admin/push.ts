export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbInsert, sbDelete, supaConfigured } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// Guarda o borra la suscripción a notificaciones del teléfono de la administradora.
// El gate de admin va PRIMERO (antes de mirar la config), igual que en el resto de /api/admin/*:
// si no, un deploy sin Supabase dejaría el endpoint abierto.
export const POST: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

  const endpoint = String(b?.endpoint || '').trim();
  // El endpoint lo emite el navegador y siempre es https (Apple o Google según el teléfono).
  if (!endpoint || !endpoint.startsWith('https://') || endpoint.length > 800) {
    return json({ error: 'suscripción inválida' }, 400);
  }

  if (b?.action === 'baja') {
    const ok = await sbDelete(`teia_push_subs?endpoint=eq.${encodeURIComponent(endpoint)}`);
    return ok ? json({ ok: true }) : json({ error: 'No se pudo desactivar.' }, 500);
  }

  const p256dh = String(b?.p256dh || '').trim();
  const auth = String(b?.auth || '').trim();
  if (!p256dh || !auth) return json({ error: 'suscripción incompleta' }, 400);

  // Se borra la anterior con el mismo endpoint antes de insertar: el navegador puede volver a
  // suscribirse con claves nuevas y quedarían dos filas apuntando al mismo teléfono.
  await sbDelete(`teia_push_subs?endpoint=eq.${encodeURIComponent(endpoint)}`);

  const fila = await sbInsert('teia_push_subs', { endpoint, p256dh, auth });
  if (!fila) return json({ error: 'No se pudo activar. ¿Corriste el SQL de teia_push_subs?' }, 500);
  return json({ ok: true });
};
