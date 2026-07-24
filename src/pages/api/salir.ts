export const prerender = false;
import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../lib/session';

// "Salir": borra la cookie de sesión y manda a la puerta. Es un POST de formulario (sin JS)
// que responde 303 + Set-Cookie explícito — así el navegador SIEMPRE termina en la puerta,
// sin depender de que corra JS ni de cómo el framework fusione las cookies.
const bye = (request: Request) =>
  new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': clearSessionCookie(request), 'Cache-Control': 'no-store' },
  });

// Solo POST: con GET, un <img src="/api/salir"> de otro sitio (o un prefetch del navegador)
// desloguearía al cliente sin que lo pida. El POST de formulario además queda cubierto por
// el checkOrigin de Astro contra CSRF.
export const POST: APIRoute = ({ request }) => bye(request);
