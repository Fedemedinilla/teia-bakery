export const prerender = false;
import type { APIRoute } from 'astro';
import { sbSelectStrict, supaConfigured } from '../../lib/supabase';
import { hasCuitShape, normCuit } from '../../lib/cuit';
import { setSessionCookie } from '../../lib/session';
import { codeRequiredFrom, codeMatches } from '../../lib/accesscode';
import { readSettingsStrict } from '../../lib/settings';
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

  // UN solo mensaje para todos los rechazos: no revela si un CUIT está dado de alta o no
  // (evita que alguien enumere la cartera probando CUITs). Cubre los tres casos —no habilitado,
  // dado de baja, código incorrecto— sin distinguirlos.
  const denied = {
    error: 'No pudimos verificar tus datos. Si ya sos cliente, revisá el CUIT y el código; si todavía no pedís por mayor, escribinos y te damos de alta.',
  };

  // El interruptor se lee UNA vez por intento de entrada. readSettings usa la lectura no
  // estricta: si la tabla de ajustes fallara, cae a la env var de respaldo — nunca deja a todo
  // el mundo afuera ni a todo el mundo adentro por un hipo de la base.
  // ESTRICTA: si no se puede leer el ajuste, NO se asume que el 2º factor está apagado. Se corta
  // igual que cuando no se puede leer la cuenta — un hipo de la base no puede bajar la puerta.
  const ajustes = await readSettingsStrict();
  if (ajustes === null) return json({ error: 'No pudimos verificar tus datos ahora. Probá de nuevo en un momento.' }, 503);
  const pideCodigo = codeRequiredFrom(ajustes);

  if (!supaConfigured()) {
    const c: any = DEMO_CLIENTS.find((x) => x.cuit === cuit);
    if (!c) return json(denied, 403);
    if (pideCodigo && !codeMatches(b?.code, c.access_code)) return json(denied, 403);
    return enter(request, c.id);
  }

  // `access_code` se pide SOLO si el 2º factor está encendido: así la app no depende de que
  // esa columna exista mientras el modo esté apagado (si se pide y no está, PostgREST corta
  // la consulta entera y nadie puede entrar). El SQL hay que correrlo ANTES de encenderlo.
  const cols = pideCodigo ? 'id,active,access_code' : 'id,active';
  const rows = await sbSelectStrict(`teia_clients?cuit=eq.${cuit}&select=${cols}`);
  if (rows === null) return json({ error: 'No pudimos verificar tu CUIT ahora. Probá de nuevo en un momento.' }, 503);
  const c = (rows as any[])[0];
  if (!c || c.active === false) return json(denied, 403);

  // Segundo factor, solo si está encendido (TEIA_REQUIRE_CODE). Una cuenta sin código cargado
  // NO puede entrar cuando el modo está activo: fallar cerrado, no dejar pasar sin verificar.
  if (pideCodigo && !codeMatches(b?.code, c.access_code)) return json(denied, 403);

  return enter(request, c.id);
};
