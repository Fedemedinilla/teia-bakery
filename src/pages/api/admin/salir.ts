export const prerender = false;
import type { APIRoute } from 'astro';
import { clearAdminCookie } from '../../../lib/auth';

// Cerrar sesión del panel. Borra la cookie y manda a la pantalla de ingreso.
//
// El Set-Cookie de borrado se arma con los MISMOS atributos que el de alta (misma función), que es
// la única forma de garantizar que efectivamente la pise: si difieren en Path o Secure, el
// navegador guarda una segunda cookie y el "Salir" no hace nada.
export const POST: APIRoute = async ({ request }) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: '/administradora',
      'Set-Cookie': clearAdminCookie(request),
      'Cache-Control': 'no-store',
    },
  });
