export const prerender = false;
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelectStrict, sbPatch, sbUpload, env, supaConfigured } from '../../../lib/supabase';
import { buildRemito } from '../../../lib/remito';
import { gConfigured, ensureMonthClientPath, driveUploadPdf, tryMirror, printFileName, uploadPrintCopy, withDeadline } from '../../../lib/google';

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
    // Se guarda el PATH del objeto (no una URL): el bucket es privado y el remito se sirve
    // con una URL firmada temporal vía /api/admin/remito (gated por la clave del panel).
    const remitoPath = await withRetry(async () => {
      const path = `remito-${id}-${token}-cliente-v${version}.pdf`;
      const ok = await sbUpload('teia-remitos', path, Buffer.from(bytesCliente), 'application/pdf');
      if (!ok) throw new Error('No se pudo subir el remito.');
      return path;
    });

    // ⚠️ El remito se marca disponible ACA, apenas está en Storage y ANTES de intentar Drive.
    // Antes este patch estaba al final: si Google fallaba, el catch marcaba archive_status =
    // "error" y remito_cliente_url NUNCA se escribía. O sea que el PDF existía, estaba bien y
    // estaba subido, pero el panel no lo podía servir: Mica no le podía mandar el remito al
    // comercio por un problema de Drive, que es un espejo y no el original.
    // Ahora Drive puede fallar sin llevarse puesto el remito: el pedido queda en "error" para
    // que el botón Reintentar y el barrido nocturno lo completen, pero la URL ya está.
    await sbPatch(`teia_orders?id=eq.${id}`, { remito_cliente_url: remitoPath, remito_interno_url: null });

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
      remito_cliente_url: remitoPath, // el PATH del objeto, no una URL pública
      remito_interno_url: null, // ya no se genera hoja interna (ya escrito arriba)
    });

    // Copia PLANA a "Remitos para imprimir": de ahí imprime la encargada del local, sin que la
    // administradora tenga que descargar cada PDF y mandárselo por mail.
    //
    // VA ÚLTIMA y es BEST EFFORT, y las dos cosas importan:
    //  · Última, porque el estado del pedido ya quedó durable en el PATCH de arriba. Si esto
    //    fuera antes, una lambda que se muere acá dejaría archive_status en null con el remito
    //    perfecto y subido.
    //  · Best effort, porque marcar 'error' le mostraría "Falta guardarlo en Drive" y Reintentar
    //    sobre un pedido que en Drive está bien (un problema de la carpeta de impresión no es un
    //    problema del archivo). El compensador es el botón "Mandar a imprimir", que hace
    //    exactamente esto a pedido.
    const imprimible = order.status === 'confirmado' || order.status === 'entregado';
    // Solo lo reciente. Sin este tope, la primera corrida del barrido nocturno sobre pedidos
    // viejos con archivado fallido le volcaría meses de remitos en la carpeta recién compartida,
    // justo el día que la encargada la abre por primera vez. NaN → false → no se copia.
    const reciente = Date.now() - new Date(order.confirmed_at || order.created_at || NaN).getTime() < 48 * 3600 * 1000;
    if (gConfigured() && imprimible && reciente) {
      try {
        // 5 s, no 8: la confirmación tiene 30 s en total y el archivado ya se lleva la mayor parte
        // (una decena de idas y vueltas a Drive), y después todavía corre el espejo del Sheet. Si
        // esto se estirara demasiado, el confirm entero se cortaría por timeout — el pedido queda
        // igual confirmado y archivado, pero Mica ve un error donde no lo hay.
        await withDeadline(uploadPrintCopy(printFileName(order), bytesCliente), 5000);
      } catch (e: any) {
        console.warn('[teia] la copia para imprimir falló', id, '→', (e && e.message) || e);
      }
    }

    return { ok: true, cliente: remitoPath };
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
