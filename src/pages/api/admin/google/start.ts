export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin, authChallenge } from '../../../../lib/auth';
import { env } from '../../../../lib/supabase';
import { GOOGLE_SCOPE } from '../../../../lib/google';

// Admin: arranca el consentimiento de Google ("Conectar Google" del panel). Redirige a la
// pantalla de Google; al aceptar, Google vuelve a /api/admin/google/callback con el code.
// prompt=consent + access_type=offline fuerzan a que SIEMPRE venga un refresh_token.
export const GET: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return authChallenge();
  const clientId = env('GOOGLE_OAUTH_CLIENT_ID');
  if (!clientId) {
    return new Response('Falta GOOGLE_OAUTH_CLIENT_ID en las env vars de Vercel (y su SECRET). Creá el OAuth Client en Google Cloud primero.', {
      status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const redirect = `${new URL(request.url).origin}/api/admin/google/callback`;
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
    }).toString();
  return Response.redirect(url, 302);
};
