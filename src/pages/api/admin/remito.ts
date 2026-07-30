export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin, authChallenge } from '../../../lib/auth';
import { sbSelectStrict, sbSignedUrl, supaConfigured } from '../../../lib/supabase';

// Sirve el remito de un pedido con una URL FIRMADA temporal. El bucket `teia-remitos` es
// privado: sin este proxy no hay forma de leer un remito. Gated por la clave del panel, así
// que un link del Sheet o del panel reenviado a un tercero NO abre el PDF sin la clave.
// authChallenge (no 401 pelado) para que al abrir el link en una pestaña nueva el navegador
// pida la clave si hace falta, en vez de mostrar un error.
export const GET: APIRoute = async ({ request, url }) => {
  if (!isTeiaAdmin(request)) return authChallenge();
  if (!supaConfigured()) return new Response('Sin configurar.', { status: 503 });

  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return new Response('id inválido.', { status: 400 });

  const rows = await sbSelectStrict(`teia_orders?id=eq.${id}&select=remito_cliente_url`);
  if (rows === null) return new Response('No se pudo leer el pedido.', { status: 503 });
  const stored = (rows as any[])[0]?.remito_cliente_url;
  if (!stored) return new Response('Este pedido no tiene remito.', { status: 404 });

  // `stored` es el path del objeto. Compat con remitos viejos que guardaron la URL pública
  // completa: si trae el prefijo del bucket, se recorta al path. Sale de la base, no del cliente.
  const marker = '/teia-remitos/';
  const path = stored.includes(marker) ? stored.slice(stored.indexOf(marker) + marker.length).split('?')[0] : stored;

  const signed = await sbSignedUrl('teia-remitos', path, 120); // 2 min: alcanza para abrir/descargar
  if (!signed) return new Response('No se pudo generar el enlace del remito.', { status: 502 });

  return new Response(null, {
    status: 302,
    headers: { Location: signed, 'Cache-Control': 'no-store' },
  });
};
