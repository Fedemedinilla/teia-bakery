export const prerender = false;
import type { APIRoute } from 'astro';
import { esSesionDelPanel } from '../../../lib/auth';
import { sbSelect, sbSelectStrict, sbPatch, sbRpc, supaConfigured } from '../../../lib/supabase';
import { catalogOf, catalogLabel } from '../../../lib/catalogs';
import { esPanelNuevo, PANEL_VIEJO } from '../../../lib/panel';
import { DESCUENTOS, totalConDescuento, centavos, fechaDeEntrega, ARMADO_ID, QTY_MAX, huellaDe } from '../../../lib/pedidos';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const pesos = (n: number) => '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });

// La administradora ARMA un pedido a nombre de un comercio (tarea 3: "🛒 Armar pedido" y "↻ Repetir",
// desde /administradora/armar). Pedido de la clienta: "tengo un cliente que me hace el mismo pedido
// todos los viernes... poder armar un pedido que no sea con mi CUIT".
//
// Qué lo distingue del alta del comercio (/api/order), y por qué:
//   · Solo la SESIÓN DEL PANEL (cookie), no Basic Auth: es la única escritura que no avisa a nadie.
//   · Los datos de la cuenta salen de la base: a nombre de quién (client_name = el nombre de la
//     cuenta, nunca del cuerpo), su lista y sus precios. Del cuerpo solo salen las cantidades y los
//     datos de entrega.
//   · Lo que ella VIO viaja con el pedido (el precio de cada línea, la lista, el total) y se compara
//     en centavos con la base: si algo cambió mientras armaba, no se crea y se le dice qué.
//   · Se graba con la función SQL teia_armar_pedido: el pedido y sus líneas en UNA transacción, y
//     con la clave del armado (armado_id) para que un reintento nunca lo duplique.
//   · Queda marcado placed_by = 'teia' y NO manda push ni mail: no se avisa a sí misma. Esto lo
//     decide este endpoint, no el cuerpo: el alta del comercio no puede marcar ni silenciar nada.
export const POST: APIRoute = async ({ request }) => {
  if (!esSesionDelPanel(request)) {
    return json({ sesion: true, error: 'Se cerró la sesión del panel. No se creó nada: lo que cargaste quedó guardado en este aparato. Entrá de nuevo y volvé a tocar Crear.' }, 401);
  }
  // Solo JSON: un <form> de otro sitio (text/plain, urlencoded) no llega a la lógica.
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'Formato inválido.' }, 415);
  }
  if (!supaConfigured()) return json({ ok: true, demo: true, order_number: 'TEIA-DEMO' });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  if (!esPanelNuevo(b)) return json({ error: PANEL_VIEJO }, 409);

  // ─── 1. Validar el cuerpo, sin tocar la base ─────────────────────────────────────────────────
  const recargarPagina = 'Recargá la página y volvé a armarlo.';
  if (typeof b.armado_id !== 'string' || !ARMADO_ID.test(b.armado_id)) return json({ error: 'Falta la clave del armado. ' + recargarPagina }, 400);
  const entero = (x: unknown) => typeof x === 'number' && Number.isInteger(x);
  if (!entero(b.client_id) || b.client_id <= 0) return json({ error: 'Falta el comercio. ' + recargarPagina }, 400);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return json({ error: 'El pedido está vacío: poné la cantidad de al menos un producto.' }, 400);
  if (items.length > 200) return json({ error: 'Demasiados productos en un pedido.' }, 400);
  for (const it of items) {
    if (!it || !entero(it.product_id) || it.product_id <= 0 || typeof it.precio !== 'number' || !Number.isFinite(it.precio)) {
      return json({ error: 'El pedido tiene un producto inválido. ' + recargarPagina }, 400);
    }
    if (!entero(it.qty) || it.qty < 1 || it.qty > QTY_MAX) {
      return json({ error: `Las cantidades van de 1 a ${QTY_MAX}, sin decimales. Revisalas y volvé a tocar Crear.` }, 400);
    }
  }
  if (new Set(items.map((it: any) => it.product_id)).size !== items.length) {
    return json({ error: 'El mismo producto aparece dos veces. ' + recargarPagina }, 400);
  }
  if (!DESCUENTOS.includes(b.discount_pct)) return json({ error: 'Descuento inválido. ' + recargarPagina }, 400);
  const pct: number = b.discount_pct;
  if (typeof b.total_visto !== 'number' || !Number.isFinite(b.total_visto)) return json({ error: 'Falta el total. ' + recargarPagina }, 400);
  // Mismo saneado que el alta del comercio: estos textos van al remito y al panel.
  const clean = (v: any, max: number) => String(v ?? '').replace(/[<>"']/g, ' ').slice(0, max).trim();
  const client_contact = clean(b.client_contact, 160);
  const delivery_address = clean(b.delivery_address, 300);
  const notes = clean(b.notes, 500);
  if (!client_contact) return json({ error: 'Falta el contacto (WhatsApp o mail) para la entrega.' }, 400);
  if (!delivery_address) return json({ error: 'Falta la dirección de entrega.' }, 400);
  const delivery_date = fechaDeEntrega(b.delivery_date);
  if (delivery_date === undefined) return json({ error: 'El día de entrega no es una fecha válida.' }, 400);

  // ─── 1b. ¿Este armado ya se creó? ANTES de validar precios y cuenta ───────────────────────────
  // Un intento anterior pudo haber entrado sin que llegara la respuesta. Si se validara primero, un
  // precio que cambió en el medio daría "no se creó nada" sobre un pedido que existe (auditoría de la
  // tarea 3). Y si ella cambió cantidades antes de reintentar, NO se le puede contestar "listo".
  const huellaPedida = huellaDe(items);
  const noActivo = () => {
    console.warn('[teia] falta la función teia_armar_pedido: correr supabase/2026-09-19-armar-pedidos.sql');
    return json({ error: 'Armar pedidos todavía no está activo: a la base le falta una actualización. Avisá a soporte. No se creó nada.' }, 503);
  };
  const incierto = () => json({ incierto: true, error: 'No sé si se creó el pedido (se cortó la comunicación con la base). Tocá Reintentar: si ya se había creado, no se duplica.' }, 503);
  const errorDeRpc = (r: { status: number; code?: string }) => {
    if (r.code === 'PGRST202' || r.status === 404) return noActivo();
    // La respuesta no llegó: puede haber entrado. Reintentar con la MISMA clave es seguro.
    if (r.status === 0 || r.status >= 500) return incierto();
    console.warn('[teia] la base rechazó un armado', r.status, r.code);
    return json({ recargar: true, error: 'No se pudo crear el pedido: algo cambió mientras lo armabas (¿se borró un producto o la cuenta?). Recargá la página y revisalo. No se creó nada.' }, 409);
  };
  // "Último pedido" de la cuenta (lo muestra el Sheet y ordena el atajo del panel). Idempotente: también
  // cuando el armado ya existía (su primera respuesta pudo perderse antes de llegar acá).
  const ultimoPedido = () => sbPatch(`teia_clients?id=eq.${b.client_id}`, { last_order_at: new Date().toISOString() });
  const yaCreado = async (d: any) => {
    // Sin pedido de verdad en la respuesta, no se afirma nada.
    if (!(Number.isInteger(Number(d?.id)) && Number(d.id) > 0 && d.order_number)) return incierto();
    const mismo = String(d.huella ?? '') === huellaPedida && Number(d.discount_pct) === pct && Number(d.client_id) === b.client_id;
    if (!mismo) {
      return json({
        otro_armado: true, order_number: d.order_number,
        error: `Este pedido ya se había creado como ${d.order_number} (${pesos(Number(d.total))}), con otras cantidades o descuento: lo que cambiaste después NO se guardó. Revisalo en Pedidos: si le falta algo, sumáselo desde su tarjeta. Si en cambio es otro pedido aparte, tocá "Crear como otro pedido".`,
      }, 409);
    }
    await ultimoPedido();
    return json({ ok: true, id: Number(d.id), order_number: d.order_number, total: Number(d.total), repetido: true, status: String(d.status || '') });
  };
  const previo = await sbRpc<any>('teia_armar_pedido', { p: { armado_id: b.armado_id, solo_buscar: true } });
  if (!previo.ok) return errorDeRpc(previo);
  if (previo.data) return yaCreado(previo.data);

  // ─── 2. La cuenta y su lista, desde la base ──────────────────────────────────────────────────
  const cuentas = await sbSelectStrict(`teia_clients?id=eq.${b.client_id}&select=id,business_name,catalog,active`);
  if (cuentas === null) return json({ error: 'No se pudo leer la cuenta del comercio. No se creó nada: probá de nuevo en un momento.' }, 503);
  const cuenta = (cuentas as any[])[0];
  if (!cuenta) return json({ recargar: true, error: 'Esta cuenta ya no existe (se borró desde otro lado). No se creó nada.' }, 404);
  if (cuenta.active === false) {
    return json({ error: `${cuenta.business_name} está dado de baja. Para armarle un pedido: Clientes → ${cuenta.business_name} → Ver cuenta → Estado: Habilitado. No se creó nada.` }, 409);
  }
  const catalog = catalogOf(cuenta.catalog);
  if (b.catalog_visto !== catalog) {
    return json({ recargar: true, error: `${cuenta.business_name} ahora está en la lista ${catalogLabel(catalog)}: los productos y precios son otros. Recargá la página: los productos de su lista nueva son otros, así que las cantidades hay que volver a cargarlas. No se creó nada.` }, 409);
  }

  // ─── 3. Precios de HOY, de SU lista; todo lo que no coincide con lo que ella vio, junto ────────
  const ids = items.map((it: any) => it.product_id);
  const prods = await sbSelectStrict(`teia_products?id=in.(${ids.join(',')})&active=is.true&catalog=eq.${catalog}&select=id,name,pack_label,price`);
  if (prods === null) return json({ error: 'No se pudieron leer los precios. No se creó nada: probá de nuevo en un momento.' }, 503);
  const porId = new Map<number, any>((prods as any[]).map((p) => [Number(p.id), p]));
  const faltan = ids.filter((id: number) => !porId.has(id));
  const sinPrecio = (prods as any[]).filter((p) => !(Number(p.price) > 0));
  const cambiaron = items.filter((it: any) => porId.has(it.product_id) && Number(porId.get(it.product_id).price) > 0
    && centavos(porId.get(it.product_id).price) !== centavos(it.precio));
  if (faltan.length || sinPrecio.length || cambiaron.length) {
    // Los nombres de los que faltan, de la base (no del navegador); si ni eso se puede leer, genérico.
    const nombres = faltan.length ? await sbSelect(`teia_products?id=in.(${faltan.join(',')})&select=id,name`) : [];
    const nombreDe = (id: number) => (nombres as any[]).find((p) => Number(p.id) === id)?.name || 'un producto';
    const partes: string[] = [];
    if (faltan.length) partes.push(`ya no están en su lista (o se ocultaron): ${faltan.map(nombreDe).join(', ')}`);
    if (sinPrecio.length) partes.push(`no tienen precio cargado: ${sinPrecio.map((p) => p.name).join(', ')}`);
    if (cambiaron.length) {
      partes.push('cambió el precio de: ' + cambiaron.map((it: any) => {
        const p = porId.get(it.product_id);
        return `${p.name} (${pesos(it.precio)} → ${pesos(Number(p.price))})`;
      }).join(', '));
    }
    return json({
      error: `No se creó nada: ${partes.join('; ')}. Ya lo actualicé en la pantalla: revisá el pedido y el total, y volvé a tocar Crear.`,
      // La página actualiza en el lugar, sin perder lo cargado: los precios de hoy y lo que hay que sacar.
      precios: Object.fromEntries((prods as any[]).filter((p) => Number(p.price) > 0).map((p) => [String(p.id), Number(p.price)])),
      quitar: [...faltan, ...sinPrecio.map((p) => Number(p.id))],
    }, 409);
  }

  // ─── 4. Las líneas y el total, con la fórmula del panel ──────────────────────────────────────
  const lineas = items.map((it: any) => {
    const p = porId.get(it.product_id);
    const unit_price = Number(p.price);
    return { product_id: it.product_id, name: p.name, pack_label: p.pack_label || '', qty: it.qty, unit_price,
      line_total: Math.round(unit_price * it.qty * 100) / 100 };
  });
  const subtotal = lineas.reduce((s: number, l: any) => s + l.line_total, 0);
  const total = totalConDescuento(subtotal, pct);
  if (centavos(total) !== centavos(b.total_visto)) {
    return json({
      error: `No se creó nada: el total da ${pesos(total)} y la pantalla mostraba ${pesos(b.total_visto)}. Recargá la página (lo que cargaste se guarda) y revisalo.`,
      recargar: true,
    }, 409);
  }

  // ─── 5. Grabar: pedido + líneas en una transacción, idempotente ──────────────────────────────
  const r = await sbRpc<any>('teia_armar_pedido', {
    p: {
      armado_id: b.armado_id, client_id: cuenta.id, client_name: cuenta.business_name,
      client_contact, delivery_address, delivery_date: delivery_date || '', notes,
      total, discount_pct: pct, items: lineas,
    },
  });
  if (!r.ok) return errorDeRpc(r);
  const d = r.data || {};
  // Otra llamada con la misma clave ganó la carrera (dos toques a la vez): mismo criterio que arriba.
  if (d.repetido) return yaCreado(d);
  if (!(Number.isInteger(Number(d.id)) && Number(d.id) > 0 && d.order_number)) return incierto();
  await ultimoPedido();
  return json({ ok: true, id: Number(d.id), order_number: d.order_number, total: Number(d.total), repetido: false, status: 'pendiente' });
};
