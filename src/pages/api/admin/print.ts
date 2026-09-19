export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelectStrict, sbDownload, storagePath, supaConfigured } from '../../../lib/supabase';
import { gConfigured, printFileName, uploadPrintCopy } from '../../../lib/google';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin: deja el remito de un pedido en la carpeta "Remitos para imprimir" de Drive, que la
// administradora comparte con la encargada del local.
//
// Al confirmar un pedido la copia ya sale sola (ver archive.ts). Este botón existe para los dos
// casos que el automático no cubre: un remito que ella ya borró de la carpeta y necesita
// reimprimir, y los pedidos confirmados ANTES de que esto existiera.
//
// DESCARGA el PDF que ya está en Storage en vez de regenerarlo. Dos razones: el papel que se
// imprime en el local es literalmente el mismo documento que recibió el comercio, y este endpoint
// no escribe una sola fila ni un solo objeto — es imposible que "Mandar a imprimir" rompa un
// pedido. Para regenerar el PDF ya está el botón "Reintentar", que es otra cosa y lo dice.
export const POST: APIRoute = async ({ request }) => {
  // La autorización va PRIMERO, antes incluso de leer el cuerpo: si se evaluara después de
  // supaConfigured(), un deploy sin las env vars de Supabase dejaría el endpoint abierto.
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

  // El cuerpo acepta SOLO el id. Nada de path, nombre de archivo ni carpeta: todo lo demás se
  // deriva de la base, así que el navegador no puede pedir que se suba un objeto arbitrario.
  const id = Number(b?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id inválido.' }, 400);

  const rows = await sbSelectStrict(
    `teia_orders?id=eq.${id}&select=id,order_number,client_name,status,confirmed_at,created_at,remito_cliente_url`
  );
  if (rows === null) return json({ error: 'No se pudo leer el pedido. Probá de nuevo.' }, 503);
  const order = (rows as any[])[0];
  if (!order) return json({ error: 'El pedido no existe.' }, 404);

  if (order.status !== 'confirmado' && order.status !== 'entregado') {
    return json({ error: 'El remito se arma al confirmar el pedido. Confirmalo y después mandalo a imprimir.' }, 409);
  }
  // La precondición es TENER REMITO, no estar 'archivado': si Drive falló, el pedido queda en
  // error pero el PDF ya está en Storage (archive.ts lo guarda antes de intentar Drive). Justo
  // ahí es cuando este botón más hace falta.
  if (!order.remito_cliente_url) {
    return json({ error: 'Este pedido todavía no tiene remito. Tocá "Reintentar" para generarlo, y después mandalo a imprimir.' }, 409);
  }
  if (!gConfigured()) {
    return json({ error: 'Google no está conectado, así que no hay carpeta donde dejarlo.' }, 503);
  }

  const bytes = await sbDownload('teia-remitos', storagePath(order.remito_cliente_url));
  // Un Uint8Array vacío es truthy: hay que mirarle el largo, o subiríamos un PDF de 0 bytes.
  if (!bytes || bytes.length === 0) {
    return json({ error: 'No se pudo leer el remito guardado. Probá de nuevo en un momento.' }, 502);
  }

  const name = printFileName(order);
  try {
    await uploadPrintCopy(name, bytes);
  } catch (e: any) {
    const msg = (e && e.message) || '';
    // Lo de la papelera se le pasa TAL CUAL: es lo único que ella puede arreglar sola.
    if (/papelera/i.test(msg)) return json({ error: msg }, 409);
    console.warn('[teia] no se pudo mandar a imprimir', id, '→', msg || e);
    return json({ error: 'No se pudo dejar el remito en la carpeta de impresión. Probá de nuevo.' }, 502);
  }

  return json({ ok: true, file: name });
};
