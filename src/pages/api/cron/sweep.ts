export const prerender = false;
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelect, supaConfigured, env } from '../../../lib/supabase';
import { archiveOrder } from '../admin/archive';
import { gConfigured, mirrorToSheet } from '../../../lib/google';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Barrido nocturno (Vercel cron, 03:00 AR): reintenta el archivado de los pedidos confirmados
// que quedaron con archive_status='error' (o donde nunca corrió). La consulta a la base además
// hace de KEEP-ALIVE: el free tier de Supabase pausa el proyecto tras ~7 días sin actividad.
//
// Seguridad: si CRON_SECRET está seteada en Vercel, el cron manda `Authorization: Bearer <secret>`
// y acá se exige (comparación timing-safe). Sin CRON_SECRET configurada se acepta el GET pelado
// — la operación es idempotente (mismo path de PDF → sobreescribe) y está capada por corrida.
// La admin autenticada también puede dispararlo a mano.

const MAX_PER_RUN = 5; // maxDuration=30s y cada archivado son 2 PDFs + 2 uploads

// FAIL-CLOSED: sin CRON_SECRET no entra nadie. Antes devolvía true y el endpoint quedaba
// abierto — cualquiera podía dispararlo en loop y quemar cuota de Google/Supabase/Vercel.
function cronAuthOk(request: Request): boolean {
  const secret = env('CRON_SECRET');
  if (!secret) return false;
  const a = Buffer.from(request.headers.get('authorization') || '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const GET: APIRoute = async ({ request }) => {
  // La autorización va SIEMPRE primero: si se evaluara después de supaConfigured(), un
  // deploy sin las env vars de Supabase dejaría el endpoint abierto.
  if (!cronAuthOk(request) && !isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true });

  const pending = await sbSelect(
    `teia_orders?status=eq.confirmado&or=(archive_status.eq.error,archive_status.is.null)` +
      `&select=id,order_number&order=id.asc&limit=${MAX_PER_RUN}`
  );

  const results: any[] = [];
  for (const o of pending as any[]) {
    const r = await archiveOrder(o.id);
    results.push({ id: o.id, order: o.order_number, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
  }

  // Rebuild nocturno del Sheet espejo: además de reflejar los reintentos de recién, corrige
  // cualquier drift del día (es un rebuild completo desde la base, la fuente de verdad).
  let mirror: string = 'sin configurar';
  if (gConfigured()) {
    try { await mirrorToSheet(); mirror = 'ok'; } catch (e: any) { mirror = 'error: ' + ((e && e.message) || e); }
  }
  return json({ ok: true, swept: results.length, results, mirror });
};
