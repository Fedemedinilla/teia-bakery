export const prerender = false;
import type { APIRoute } from 'astro';
import { sbSelectStrict, supaConfigured } from '../../lib/supabase';
import { hasCuitShape, normCuit } from '../../lib/cuit';
import { setSessionCookie } from '../../lib/session';
import { codeRequired, codeMatches } from '../../lib/accesscode';
import { DEMO_CLIENTS } from '../../lib/demo';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// La puerta: el CUIT es la llave. Solo entra quien Teia dio de alta (y no dio de baja).
// Al entrar se firma una cookie con el id de la cuenta — de ahí en más el servidor sabe
// quién es y qué catálogo le toca sin volver a preguntar ni confiar en el navegador.
const enter = (request: Request, clientId: number) =>
  new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setSessionCookie(request, clientId),
      'Cache-Control': 'no-store',
    },
  });

export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const cuit = normCuit(b?.cuit);
  if (!hasCuitShape(cuit)) return json({ error: 'Ingresá tu CUIT completo (11 números).' }, 400);

  const denied = { error: 'Ese CUIT todavía no está habilitado para pedir. Escribinos y te damos de alta.' };
  const badCode = { error: 'El CUIT o el código no coinciden. Revisalos, o pedinos el código de nuevo.' };

  if (!supaConfigured()) {
    const c: any = DEMO_CLIENTS.find((x) => x.cuit === cuit);
    if (!c) return json(denied, 403);
    if (codeRequired() && !codeMatches(b?.code, c.access_code)) return json(badCode, 403);
    return enter(request, c.id);
  }

  const rows = await sbSelectStrict(`teia_clients?cuit=eq.${cuit}&select=id,active,access_code`);
  if (rows === null) return json({ error: 'No pudimos verificar tu CUIT ahora. Probá de nuevo en un momento.' }, 503);
  const c = (rows as any[])[0];
  if (!c || c.active === false) return json(denied, 403);

  // Segundo factor, solo si está encendido (TEIA_REQUIRE_CODE). Una cuenta sin código cargado
  // NO puede entrar cuando el modo está activo: fallar cerrado, no dejar pasar sin verificar.
  if (codeRequired() && !codeMatches(b?.code, c.access_code)) return json(badCode, 403);

  return enter(request, c.id);
};
