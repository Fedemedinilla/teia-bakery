export const prerender = false;
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { isTeiaAdmin, authChallenge } from '../../../../lib/auth';
import { env } from '../../../../lib/supabase';
import { readOAuthState, OAUTH_STATE_COOKIE, clearOAuthStateCookie } from '../../../../lib/session';

// Admin: Google vuelve acá con el ?code. Se canjea por el refresh_token y se MUESTRA UNA VEZ
// para pegarlo en Vercel (env = el único lugar donde vive el secreto; la app no lo persiste).
// Mismo flujo para el handoff: la clienta consiente desde SU cuenta y se pega su token.
const esc = (s: any) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const GET: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return authChallenge();
  const u = new URL(request.url);
  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');

  // Todo lo que se interpola va ESCAPADO: `error` lo controla quien arma el link, y esta
  // respuesta es HTML servido en el origen de la app — sin escapar, era XSS contra la admin.
  // CSP propia por si algo se escapara igual.
  const html = (body: string, status = 200) =>
    new Response(
      `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Conectar Google — Teia</title>` +
        `<body style="font-family:system-ui;max-width:680px;margin:40px auto;padding:0 16px;color:#33291F;line-height:1.55">${body}</body></html>`,
      {
        status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
          'Cache-Control': 'no-store',
          'Set-Cookie': clearOAuthStateCookie(request), // el state es de un solo uso
        },
      }
    );

  const volver = `<p><a href="/administradora">← Volver al panel</a></p>`;
  if (err) return html(`<h2>Google rechazó la conexión</h2><p><code>${esc(err)}</code></p>${volver}`, 400);
  if (!code) return html(`<h2>Falta el código de Google.</h2>${volver}`, 400);

  // Anti-CSRF: el `state` tiene que ser el que emitió /start en ESTE navegador. Sin esto,
  // alguien podía mandarle a la admin un callback con SU code y hacer que la app conectara
  // el Drive del atacante (y le mostrara su refresh token para pegarlo en Vercel).
  const cookieState = request.headers.get('cookie')?.match(new RegExp(`${OAUTH_STATE_COOKIE}=([^;]+)`))?.[1];
  const urlState = u.searchParams.get('state') || '';
  if (!readOAuthState(cookieState, urlState)) {
    return html(`<h2>La conexión no se pudo verificar</h2><p>Volvé a empezar desde el botón “Conectar Google” del panel.</p>${volver}`, 400);
  }

  // Misma construcción que en start.ts (https + host del proxy): el canje exige la MISMA
  // redirect_uri que se usó en el consentimiento.
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || u.host;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_OAUTH_CLIENT_ID') || '',
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET') || '',
      redirect_uri: `https://${host}/api/admin/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const o: any = await r.json().catch(() => ({}));
  if (!r.ok || !o.refresh_token) {
    // No se refleja la respuesta cruda de Google (puede traer datos del request).
    return html(
      `<h2>No vino el refresh token</h2><p>Google respondió <code>${esc(r.status)}</code>${o?.error ? ` (<code>${esc(o.error)}</code>)` : ''}.</p>` +
        `<p>Probá de nuevo desde el panel — el botón fuerza <code>prompt=consent</code>, que siempre emite uno.</p>${volver}`,
      500
    );
  }
  return html(
    `<h2>✓ Google conectado</h2>` +
      `<p>Último paso (una sola vez): copiá este token y pegalo en <b>Vercel → Settings → Environment Variables</b> como <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> (Sensitive) y redeployá.</p>` +
      `<p style="background:#F6EFE3;border:1px solid #E7DBC8;border-radius:8px;padding:12px;word-break:break-all"><code>${esc(o.refresh_token)}</code></p>` +
      `<p>Con eso, los remitos se archivan solos en el Drive de esta cuenta (Remitos Teia/año/mes/cliente) y la planilla espejo se crea y actualiza sola.</p>` +
      volver
  );
};
