export const prerender = false;
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelect, sbPatch, sbUpload, env, supaConfigured } from '../../../lib/supabase';
import { buildRemito } from '../../../lib/remito';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Reintenta una operación hasta `tries` veces con back-off (0.3s, 0.9s). Para fallos transitorios.
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 300 * Math.pow(3, i))); }
  }
  throw last;
}

// Token estable + no adivinable para el path del PDF: idempotente (mismo pedido → mismo path,
// se sobreescribe) pero imposible de adivinar desde afuera (HMAC con la service_role key).
function pathToken(id: number): string {
  return crypto.createHmac('sha256', env('SUPABASE_SERVICE_ROLE_KEY') || 'x').update(String(id)).digest('hex').slice(0, 16);
}

// Genera los 2 remitos, los sube a Supabase Storage y guarda las URLs + estado en el pedido.
// NUNCA lanza: captura sus errores y los deja en archive_status='error' + archive_error.
// (Fase 2: acá se sumará el espejo al Google Sheet, una vez lista la service account.)
export async function archiveOrder(id: number): Promise<{ ok: boolean; error?: string; cliente?: string; interno?: string }> {
  const orders = await sbSelect(`teia_orders?id=eq.${id}&select=*`);
  const order = (orders as any[])[0];
  if (!order) return { ok: false, error: 'El pedido no existe.' };
  const items = await sbSelect(`teia_order_items?order_id=eq.${id}&select=*&order=id.asc`);

  try {
    const version = Number(order.version) || 1;
    const token = pathToken(id);
    const upload = (variant: 'cliente' | 'interno') => withRetry(async () => {
      const bytes = await buildRemito(order, items as any[], variant);
      const path = `remito-${id}-${token}-${variant}-v${version}.pdf`;
      const url = await sbUpload('teia-remitos', path, Buffer.from(bytes), 'application/pdf');
      if (!url) throw new Error(`No se pudo subir el remito (${variant}).`);
      return url;
    });

    const cliente = await upload('cliente');
    const interno = await upload('interno');

    await sbPatch(`teia_orders?id=eq.${id}`, {
      archive_status: 'archivado',
      archive_error: null,
      archived_at: new Date().toISOString(),
      remito_cliente_url: cliente,
      remito_interno_url: interno,
    });
    return { ok: true, cliente, interno };
  } catch (e: any) {
    const msg = ((e && e.message) || 'Error desconocido').slice(0, 300);
    await sbPatch(`teia_orders?id=eq.${id}`, { archive_status: 'error', archive_error: msg });
    return { ok: false, error: msg };
  }
}

// Admin: reintentar el archivado de un pedido a mano (botón "Reintentar" del panel).
export const POST: APIRoute = async ({ request }) => {
  if (!supaConfigured()) return json({ ok: true, demo: true });
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const id = Number(b?.id);
  if (!id) return json({ error: 'id inválido.' }, 400);
  const res = await archiveOrder(id);
  return res.ok ? json(res) : json({ error: res.error }, 500);
};
