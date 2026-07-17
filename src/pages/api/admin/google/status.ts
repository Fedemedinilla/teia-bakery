export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../../lib/auth';
import { googleStatus } from '../../../../lib/google';

// Admin: estado de la conexión Google + links reales al Sheet espejo y la carpeta de Drive
// (el panel los usa para armar sus botones — nada hardcodeado, sobrevive el handoff).
export const GET: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  const s = await googleStatus();
  return new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json' } });
};
