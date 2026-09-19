export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelectStrict, sbPatch, sbPatchReturning, supaConfigured } from '../../../lib/supabase';
import { archiveOrder } from './archive';
import { tryMirror, withDeadline, tiempoRestante } from '../../../lib/google';
import { montoEscrito, porQueNoSeEntiende } from '../../../lib/montos';
import { PANEL_VIEJO, esPanelNuevo } from '../../../lib/panel';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: confirm a pending order → decrement stock per item, flag low stock, and run the
// app-native archiver (2 remitos PDF → Supabase Storage). Confirms are serial (one admin), so
// the read-then-write stock loop is fine for this volume.
export const POST: APIRoute = async ({ request }) => {
  const inicio = Date.now();
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true }); // demo: nada que persistir

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const id = Number(body?.id);
  if (!id) return json({ error: 'id' }, 400);

  // Los dos montos del remito viajan CON el confirm, no aparte.
  //
  // Es la secuencia que describió Mica: "cuando confirmo el pedido, le agrego al remito el costo
  // del envío y ahí le mando el remito con el total final". O sea que los escribe y toca
  // Confirmar. Si este endpoint no los recibiera, se guardarían recién al tocar Guardar —un botón
  // que ella no tiene por qué saber que hay que apretar ANTES— y el remito, que se genera acá
  // adentro, saldría con los renglones en blanco.
  // Un panel de antes del deploy manda SIEMPRE los dos montos, con lo que su pantalla mostraba:
  // confirmar desde una pantalla vieja le borraba (o le volvía a poner) el envío al remito, y un
  // confirmado ya no se edita. Se rechaza sin tocar nada (ver lib/panel.ts).
  if (!esPanelNuevo(body) && ('saldo_anterior' in body || 'costo_envio' in body)) {
    return json({ error: PANEL_VIEJO }, 409);
  }
  const extras: Record<string, any> = {};
  for (const campo of ['saldo_anterior', 'costo_envio'] as const) {
    if (!(campo in (body || {}))) continue;
    // El saldo puede ser negativo (a favor del comercio); el costo de envío no: un "-8000" le
    // descontaba el flete al total del remito (auditoría del 19/9).
    const opciones = { negativo: campo === 'saldo_anterior' };
    const m = montoEscrito(body[campo], opciones);
    if (m === undefined) {
      return json({ error: 'El ' + (campo === 'costo_envio' ? 'costo de envío' : 'saldo anterior') + ' ' + porQueNoSeEntiende(body[campo], opciones) + '. No se confirmó nada.' }, 400);
    }
    extras[campo] = m;
  }

  // Claim ATÓMICO: pendiente → confirmado en un solo PATCH condicional. Si llegan dos requests
  // en paralelo (doble click), solo una recibe la fila; la otra ve [] y aborta SIN tocar stock.
  // (El chequeo-de-status-y-después-patch anterior dejaba pasar a las dos → stock descontado 2×.)
  const claimed = await sbPatchReturning<any>(`teia_orders?id=eq.${id}&status=eq.pendiente`, {
    status: 'confirmado', confirmed_at: new Date().toISOString(), ...extras,
  });
  if (claimed === null) return json({ error: 'No se pudo confirmar. Probá de nuevo.' }, 500);
  if (!claimed.length) return json({ error: 'Este pedido ya se confirmó o se borró desde otro lado. Recargá la página para ver cómo quedó.' }, 409);
  const order = claimed[0];

  // Ítems con select estricto: si la lectura falla, se revierte el claim para no dejar un
  // pedido "confirmado" sin stock descontado ni remitos.
  const items = await sbSelectStrict(`teia_order_items?order_id=eq.${id}&select=product_id,name,qty`);
  if (items === null) {
    await sbPatch(`teia_orders?id=eq.${id}`, { status: 'pendiente', confirmed_at: null });
    return json({ error: 'No se pudo leer el pedido. Probá de nuevo.' }, 500);
  }
  const lowStock: string[] = [];
  const shortages: string[] = []; // pedidos por encima del stock: Mica tiene que enterarse
  // Lo que NO se pudo descontar. Antes un fallo al leer o al escribir el stock de un producto se
  // salteaba en silencio: el pedido quedaba confirmado, el catálogo seguía ofreciendo esa mercadería
  // y nadie se enteraba. Ahora se le dice cuál restar a mano (auditoría del 19/9).
  const sinDescontar: string[] = [];
  for (const it of items as any[]) {
    if (!it.product_id) continue; // el producto se borró del catálogo: no hay stock que descontar
    const prods = await sbSelectStrict(`teia_products?id=eq.${it.product_id}&select=id,name,stock,low_stock_threshold`);
    if (prods === null) { sinDescontar.push(`${it.name} ×${it.qty}`); continue; }
    const p = (prods as any[])[0];
    if (!p) continue;
    const stock = Number(p.stock), qty = Number(it.qty);
    // Se descuenta la cantidad pedida ENTERA, aunque el stock quede en negativo. Antes frenaba en 0,
    // y entonces borrar el pedido reponía lo pedido y no lo descontado: con 3 en stock y 10 pedidos,
    // confirmar dejaba 0 y borrar dejaba 10 (siete tortas que no existen, ofrecidas en el catálogo).
    // El negativo dice la verdad —se vendió más de lo que había— y el catálogo lo muestra "sin stock".
    const newStock = stock - qty;
    const hecho = await sbPatch(`teia_products?id=eq.${p.id}`, { stock: newStock });
    // El faltante se anuncia con el stock en que QUEDÓ, así que solo después de escribirlo: si la
    // escritura falla, el producto va a "restáselo a mano" y no a "quedó en -7", que era falso.
    if (!hecho) { sinDescontar.push(`${p.name} ×${qty}`); continue; }
    if (qty > stock) shortages.push(`${p.name}: pedía ${qty} y había ${stock} (quedó en ${newStock})`);
    if (newStock <= Number(p.low_stock_threshold)) lowStock.push(`${p.name} (${newStock})`);
  }
  if (sinDescontar.length) console.warn('[teia] no se pudo descontar stock al confirmar', order.order_number, '→', sinDescontar.join(', '));

  // Archivar (app-native): genera el remito → Supabase Storage + Drive. No rompe el confirm:
  // archiveOrder captura sus propios errores (quedan en archive_status='error').
  //
  // Los dos pasos de Google van CON TOPE. Un fallo de Google se atrapa; un CUELGUE no: sin tope se
  // comía los 30 s y el panel no recibía la respuesta, ni los avisos de stock que vienen en ella
  // (verificación del 19/9: el tope estaba solo en el espejo, y el cuelgue llegaba antes, en Drive).
  // El archivado tiene hasta 12 s; el espejo, todo lo que quede de los 30 s (tiempoRestante).
  // Si el archivado no termina a tiempo, el remito queda para el botón Reintentar y el barrido
  // nocturno (que toma archive_status null o 'error').
  try { await withDeadline(archiveOrder(id), Math.min(12000, tiempoRestante(inicio))); } catch (e: any) { console.warn('[teia] archivado sin respuesta al confirmar:', id, (e && e.message) || e); }
  // Sheet espejo al día (best effort, nunca rompe el confirm).
  try { await withDeadline(tryMirror(), tiempoRestante(inicio)); } catch (e: any) { console.warn('[teia] espejo Sheet sin respuesta al confirmar:', (e && e.message) || e); }

  // Low-stock alert. For now logged; next step = email via Resend to Teia.
  if (lowStock.length) console.warn('[teia] poco stock tras confirmar', order.order_number, '→', lowStock.join(', '));

  return json({ ok: true, low_stock: lowStock, shortages, stock_sin_descontar: sinDescontar });
};
