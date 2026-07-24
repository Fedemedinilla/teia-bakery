export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin, authChallenge } from '../../../../lib/auth';
import { env } from '../../../../lib/supabase';
import { GOOGLE_SCOPE } from '../../../../lib/google';
import { newOAuthState, oauthStateCookie } from '../../../../lib/session';

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
  // SIEMPRE https + host real del proxy: detrás del edge de Vercel la función ve la request
  // como http, y para Google "http://..." ≠ la URI registrada en https → redirect_uri_mismatch.
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
  const redirect = `https://${host}/api/admin/google/callback`;
  const state = newOAuthState(); // anti-CSRF: se verifica al volver
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();
  // ?debug=1 → muestra la URI exacta que se le manda a Google (para compararla letra por
  // letra con la registrada en GCP si algo no matchea).
  if (new URL(request.url).searchParams.get('debug')) {
    return new Response(`redirect_uri que manda la app:\n${redirect}`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Set-Cookie': oauthStateCookie(request, state), 'Cache-Control': 'no-store' },
  });
};
