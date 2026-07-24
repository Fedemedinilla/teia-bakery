export const prerender = false;
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelectStrict, sbPatch, sbUpload, env, supaConfigured } from '../../../lib/supabase';
import { buildRemito } from '../../../lib/remito';
import { gConfigured, ensureMonthClientPath, driveUploadPdf, tryMirror } from '../../../lib/google';

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
// (Próximo: acá se sumará el espejo Sheet/Drive — ruta OAuth drive.file, ver BUCKETLIST.)
export async function archiveOrder(id: number): Promise<{ ok: boolean; error?: string; cliente?: string }> {
  // Lecturas ESTRICTAS: null = no se pudo leer (red/5xx). Antes un fallo transitorio acá
  // devolvía [] y el remito salía VACÍO pero quedaba marcado 'archivado' para siempre.
  const orders = await sbSelectStrict(`teia_orders?id=eq.${id}&select=*`);
  if (orders === null) return { ok: false, error: 'No se pudo leer el pedido. Reintentá.' };
  const order = (orders as any[])[0];
  if (!order) return { ok: false, error: 'El pedido no existe.' };
  const items = await sbSelectStrict(`teia_order_items?order_id=eq.${id}&select=*&order=id.asc`);

  try {
    // Todo pedido real tiene ≥1 ítem (la creación rechaza carritos vacíos): acá items vacío
    // o null = fallo de lectura → error retryable (queda para el botón Reintentar y el sweep).
    if (items === null || !(items as any[]).length) throw new Error('No se pudieron leer los ítems del pedido.');
    const version = Number(order.version) || 1;
    const token = pathToken(id);
    // UN solo remito (decisión de la clienta en la Meet 01): el mismo que le manda al cliente
    // es el que archiva. La hoja interna de preparación quedó fuera de scope.
    const bytesCliente = await withRetry(() => buildRemito(order, items as any[], 'cliente'));
    const cliente = await withRetry(async () => {
      const path = `remito-${id}-${token}-cliente-v${version}.pdf`;
      const url = await sbUpload('teia-remitos', path, Buffer.from(bytesCliente), 'application/pdf');
      if (!url) throw new Error('No se pudo subir el remito.');
      return url;
    });

    // Espejo a DRIVE (cuenta de la clienta, OAuth drive.file): carpeta año/mes/comercio con
    // nombres legibles. Mismos bytes, mismo retry; idempotente (reintentar actualiza, no
    // duplica). Si Google no está conectado, se saltea; si falla, el pedido queda en 'error'
    // y el botón Reintentar / el barrido nocturno lo completan.
    if (gConfigured()) {
      await withRetry(async () => {
        const when = order.confirmed_at || order.created_at;
        const folder = await ensureMonthClientPath(when, order.client_name);
        const num = order.order_number || '#' + order.id;
        // fecha en el nombre (DD-MM-AAAA, hora argentina) — pedido de la clienta
        const fecha = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' })
          .format(new Date(when || Date.now())).replace(/\//g, '-');
        await driveUploadPdf(folder, `${num} - ${fecha} - Remito.pdf`, bytesCliente);
      });
    }

    await sbPatch(`teia_orders?id=eq.${id}`, {
      archive_status: 'archivado',
      archive_error: null,
      archived_at: new Date().toISOString(),
      remito_cliente_url: cliente,
      remito_interno_url: null, // ya no se genera hoja interna
    });
    return { ok: true, cliente };
  } catch (e: any) {
    const msg = ((e && e.message) || 'Error desconocido').slice(0, 300);
    await sbPatch(`teia_orders?id=eq.${id}`, { archive_status: 'error', archive_error: msg });
    return { ok: false, error: msg };
  }
}

// Admin: reintentar el archivado de un pedido a mano (botón "Reintentar" del panel).
export const POST: APIRoute = async ({ request }) => {
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true });
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const id = Number(b?.id);
  if (!id) return json({ error: 'id inválido.' }, 400);
  const res = await archiveOrder(id);
  await tryMirror(); // el Sheet refleja el nuevo estado de archivado (best effort)
  return res.ok ? json(res) : json({ error: res.error }, 500);
};
