export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { supaConfigured } from '../../../lib/supabase';
import { pedidosPendientes } from '../../../lib/push';

// Cuántos pedidos están esperando. Es el número del globo sobre el ícono de la app.
//
// Existe porque el globo no puede depender solo del push. El push solo llega cuando entra un
// pedido: si Mica confirma uno desde el celular, la app de la PC se queda con el número viejo
// hasta que alguien le avise. Con esto, el panel repinta el globo cada vez que se lo mira.
//
// Usa la MISMA definición de "pendiente" que el push (pedidosPendientes de lib/push.ts), para que
// el número del globo y el que manda el aviso no puedan discrepar nunca.
export const GET: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });

  // null = "no sé". El que llama NO debe tocar el globo con esto: borrarlo diría "no tenés nada".
  const pendientes = supaConfigured() ? await pedidosPendientes() : null;

  return new Response(JSON.stringify({ pendientes }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
