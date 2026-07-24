export const prerender = false;
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../lib/session';

// "Cambiar de cuenta": borra la cookie de sesión y vuelve a la puerta.
export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
