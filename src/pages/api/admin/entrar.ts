export const prerender = false;
import type { APIRoute } from 'astro';
import { adminPasswordOk, setAdminCookie } from '../../../lib/auth';
import { env } from '../../../lib/supabase';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Entrada al panel: la clave del panel a cambio de la cookie firmada.
//
// Va por JSON y no por formulario: detrás del proxy de Vercel, el checkOrigin de Astro rechaza
// los POST con content-type de formulario aunque vengan del propio sitio (ver la nota del mismo
// problema en la puerta de los clientes).
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

  if (!env('TEIA_ADMIN_PASSWORD')) {
    return json({ error: 'El panel no tiene clave configurada (falta TEIA_ADMIN_PASSWORD).' }, 503);
  }

  if (!adminPasswordOk(b?.clave)) {
    // Mensaje único y sin pistas: no se dice si la clave era corta, larga o parecida.
    return json({ error: 'Clave incorrecta.' }, 403);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setAdminCookie(request),
      'Cache-Control': 'no-store',
    },
  });
};
