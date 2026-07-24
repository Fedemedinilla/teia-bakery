export const prerender = false;
import type { APIRoute } from 'astro';
import { sbSelectStrict, supaConfigured } from '../../lib/supabase';
import { hasCuitShape, normCuit } from '../../lib/cuit';
import { makeSession, SESSION_COOKIE, COOKIE_OPTS } from '../../lib/session';
import { DEMO_CLIENTS } from '../../lib/demo';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// La puerta: el CUIT es la llave. Solo entra quien Teia dio de alta (y no dio de baja).
// Al entrar se firma una cookie con el id de la cuenta — de ahí en más el servidor sabe
// quién es y qué catálogo le toca sin volver a preguntar ni confiar en el navegador.
export const POST: APIRoute = async ({ request, cookies }) => {
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const cuit = normCuit(b?.cuit);
  if (!hasCuitShape(cuit)) return json({ error: 'Ingresá tu CUIT completo (11 números).' }, 400);

  const denied = { error: 'Ese CUIT todavía no está habilitado para pedir. Escribinos y te damos de alta.' };

  if (!supaConfigured()) {
    const c = DEMO_CLIENTS.find((x) => x.cuit === cuit);
    if (!c) return json(denied, 403);
    cookies.set(SESSION_COOKIE, makeSession(c.id), { ...COOKIE_OPTS, secure: false });
    return json({ ok: true });
  }

  const rows = await sbSelectStrict(`teia_clients?cuit=eq.${cuit}&select=id,active`);
  if (rows === null) return json({ error: 'No pudimos verificar tu CUIT ahora. Probá de nuevo en un momento.' }, 503);
  const c = (rows as any[])[0];
  if (!c || c.active === false) return json(denied, 403);

  cookies.set(SESSION_COOKIE, makeSession(c.id), COOKIE_OPTS);
  return json({ ok: true });
};
