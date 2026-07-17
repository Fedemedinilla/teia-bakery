export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin, authChallenge } from '../../../../lib/auth';
import { env } from '../../../../lib/supabase';

// Admin: Google vuelve acá con el ?code. Se canjea por el refresh_token y se MUESTRA UNA VEZ
// para pegarlo en Vercel (env = el único lugar donde vive el secreto; la app no lo persiste).
// Mismo flujo para el handoff: la clienta consiente desde SU cuenta y se pega su token.
export const GET: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return authChallenge();
  const u = new URL(request.url);
  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');
  const html = (body: string, status = 200) =>
    new Response(
      `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Conectar Google — Teia</title>` +
        `<body style="font-family:system-ui;max-width:680px;margin:40px auto;padding:0 16px;color:#33291F;line-height:1.55">${body}</body></html>`,
      { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  if (err) return html(`<h2>Google rechazó la conexión</h2><p><code>${err}</code></p><p><a href="/administradora">← Volver al panel</a></p>`, 400);
  if (!code) return html('<h2>Falta el código de Google.</h2><p><a href="/administradora">← Volver al panel</a></p>', 400);

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_OAUTH_CLIENT_ID') || '',
      client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET') || '',
      redirect_uri: `${u.origin}/api/admin/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const o: any = await r.json().catch(() => ({}));
  if (!r.ok || !o.refresh_token) {
    return html(
      `<h2>No vino el refresh token</h2><p>Respuesta de Google (${r.status}): <code>${String(JSON.stringify(o)).slice(0, 300)}</code></p>` +
        `<p>Probá de nuevo desde el panel — el botón fuerza <code>prompt=consent</code>, que siempre emite uno.</p><p><a href="/administradora">← Volver</a></p>`,
      500
    );
  }
  return html(
    `<h2>✓ Google conectado</h2>` +
      `<p>Último paso (una sola vez): copiá este token y pegalo en <b>Vercel → Settings → Environment Variables</b> como <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> (Sensitive) y redeployá.</p>` +
      `<p style="background:#F6EFE3;border:1px solid #E7DBC8;border-radius:8px;padding:12px;word-break:break-all"><code>${o.refresh_token}</code></p>` +
      `<p>Con eso, los remitos se archivan solos en el Drive de esta cuenta (Remitos Teia/año/mes/cliente) y la planilla espejo se crea y actualiza sola.</p>` +
      `<p><a href="/administradora">← Volver al panel</a></p>`
  );
};
