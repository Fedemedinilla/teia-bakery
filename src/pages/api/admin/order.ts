export const prerender = false;
import type { APIRoute } from 'astro';
import { isTeiaAdmin } from '../../../lib/auth';
import { sbSelectStrict, sbPatch, sbPatchReturning, sbInsert, sbDelete, sbDeleteReturning, supaConfigured } from '../../../lib/supabase';
import { catalogOf } from '../../../lib/catalogs';
import { tryMirror, gConfigured, printFileName, trashPrintCopy, withDeadline, tiempoRestante } from '../../../lib/google';
import { montoEscrito, porQueNoSeEntiende } from '../../../lib/montos';
import { PANEL_VIEJO, esPanelNuevo } from '../../../lib/panel';
import { DESCUENTOS, totalConDescuento } from '../../../lib/pedidos';

const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

// Admin only: BORRAR un pedido (action='delete', en cualquier estado) o EDITAR uno PENDIENTE:
// cantidades, productos nuevos, descuento, montos del remito y datos de entrega. Ver la rama de
// edición más abajo: el orden de las escrituras está pensado para que nunca quede a medias.
export const POST: APIRoute = async ({ request }) => {
  const inicio = Date.now();
  if (!isTeiaAdmin(request)) return new Response('no autorizado', { status: 401 });
  if (!supaConfigured()) return json({ ok: true, demo: true });

  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const orderId = Number(b?.id);
  if (!orderId) return json({ error: 'id inválido.' }, 400);

  // Borrar el pedido (la FK on delete cascade elimina sus ítems). Si estaba CONFIRMADO, primero se
  // repone el stock que el confirm descontó: si no, el catálogo queda mintiendo "sin stock" sobre
  // mercadería que nunca se va a entregar.
  //
  // El orden, y por qué (auditorías del 19/9):
  //   1. Leer el pedido y, si está confirmado, SUS LÍNEAS, antes de tocar nada. Las líneas de un
  //      confirmado no cambian (la edición solo toca pendientes), y leerlas después del claim dejaba
  //      una carrera: otro Borrar hacía el DELETE, la cascada se llevaba las líneas y el stock no se
  //      reponía nunca.
  //   2. ANULAR con un PATCH condicionado (confirmado → anulado). Solo el que gana repone el stock; el
  //      que pierde no borra nada. Un reintento que lo encuentra ya 'anulado' va directo al DELETE,
  //      sin reponer otra vez (antes el reintento reponía de nuevo: mercadería fantasma).
  //   3. Reponer, MIRANDO cada escritura. Lo que no se pudo se dice por nombre y el pedido queda
  //      anulado (visible) para que ella lo sume a mano.
  //   4. DELETE condicionado al estado esperado: si otro dispositivo lo confirmó en el medio, no se
  //      borra un pedido cuyo stock ya se descontó.
  //   5. Sacar la copia de impresión y actualizar el Sheet, con topes que entren en los 30 s.
  if (b?.action === 'delete') {
    // Se piden además los campos del nombre del remito: hacen falta para sacarlo de la carpeta
    // de impresión, y después del DELETE ya no se pueden leer.
    const rows = await sbSelectStrict(
      `teia_orders?id=eq.${orderId}&select=id,order_number,client_name,status,confirmed_at,created_at,remito_cliente_url`
    );
    if (rows === null) return json({ error: 'No se pudo borrar. No se cambió nada: probá de nuevo.' }, 500);
    if (!(rows as any[]).length) return json({ error: 'El pedido no existe.' }, 404);
    const row = (rows as any[])[0];
    const recargar = 'Este pedido cambió desde otro lado (¿se está borrando o se confirmó desde el celular?). No se borró nada: recargá la página.';

    if (row.status === 'confirmado') {
      // 1. Las líneas, ANTES del claim.
      const its = await sbSelectStrict(`teia_order_items?order_id=eq.${orderId}&select=product_id,name,qty`);
      if (its === null) return json({ error: 'No se pudo leer el pedido para reponer el stock. No se cambió nada: probá de nuevo.' }, 500);
      const detalle = (its as any[]).filter((it) => it.product_id).map((it) => `${it.name} ×${it.qty}`).join(', ');

      // 2. Anular: solo uno gana.
      const anulado = await sbPatchReturning(`teia_orders?id=eq.${orderId}&status=eq.confirmado`, { status: 'anulado' });
      if (anulado === null) {
        // Sin respuesta no se sabe si entró: se relee, y cada resultado tiene su mensaje. Antes "no se
        // pudo releer" caía junto con "quedó anulado": el panel le decía que sumara el stock a mano y
        // que el próximo Borrar no reponía, pero el pedido seguía confirmado y ese Borrar reponía otra
        // vez. Resultado: el doble de mercadería en el catálogo (verificación del 19/9).
        const ahora = await sbSelectStrict(`teia_orders?id=eq.${orderId}&select=status`);
        if (ahora === null) {
          return json({
            recargar: true,
            error: 'No sé si se empezó a borrar (se cortó la comunicación con la base). No sumes ni restes stock todavía: recargá la página y fijate cómo quedó el pedido.',
          }, 500);
        }
        if (!(ahora as any[]).length) return json({ recargar: true, error: 'Este pedido ya se borró desde otro lado. Recargá la página.' }, 409);
        const estado = (ahora as any[])[0].status;
        if (estado === 'confirmado') return json({ error: 'No se pudo borrar. No se cambió nada: probá de nuevo en un momento.' }, 500);
        if (estado !== 'anulado') return json({ error: recargar }, 409);
        // Quedó anulado: el PATCH entró y se perdió la respuesta (o lo anuló otro dispositivo, que es
        // el que repone). Este intento NO repuso nada, y el próximo Borrar tampoco repone.
        return json({
          anulado: true,
          recargar: true,
          error: `El pedido quedó anulado, pero este intento NO repuso el stock (se cortó la comunicación con la base). Salvo que lo estuvieras borrando al mismo tiempo desde otro dispositivo, sumá a mano en Productos: ${detalle || 'los productos de este pedido'}. Después recargá y tocá Borrar para sacar el pedido (ya no repone nada).`,
        }, 500);
      }
      if (!anulado.length) return json({ error: recargar }, 409);

      // 3. Reponer lo que el confirm descontó. Desde el 19/9 el confirm descuenta la cantidad pedida
      //    ENTERA aunque deje el stock en negativo, así que reponer la cantidad pedida es la inversa
      //    exacta. (Con el confirm de antes, que frenaba en 0, un pedido confirmado con faltante
      //    repone de más al borrarse: por eso el confirm ya no frena.)
      const sinReponer: string[] = [];
      for (const it of its as any[]) {
        if (!it.product_id) continue; // el producto se borró del catálogo: no hay stock que reponer
        const prods = await sbSelectStrict(`teia_products?id=eq.${it.product_id}&select=id,stock`);
        if (prods === null) { sinReponer.push(`${it.name} ×${it.qty}`); continue; }
        const p = (prods as any[])[0];
        if (!p) continue; // borrado del catálogo
        const hecho = await sbPatch(`teia_products?id=eq.${p.id}`, { stock: Number(p.stock) + Number(it.qty) });
        if (!hecho) sinReponer.push(`${it.name} ×${it.qty}`);
      }
      if (sinReponer.length) {
        // No se borra: queda ANULADO (visible en el panel) y el mensaje dice qué sumar a mano. Un
        // reintento lo borra sin volver a reponer lo que sí se repuso.
        return json({
          anulado: true,
          error: `El pedido quedó anulado, pero no se pudo reponer el stock de: ${sinReponer.join(', ')}. Sumáselo a mano en Productos, y después tocá Borrar de nuevo para sacar el pedido.`,
        }, 500);
      }
    }

    // 4. DELETE condicionado al estado esperado.
    const esperado = row.status === 'confirmado' ? 'anulado' : String(row.status);
    const borradas = await sbDeleteReturning(`teia_orders?id=eq.${orderId}&status=eq.${encodeURIComponent(esperado)}`);
    const yaRepuesto = esperado === 'anulado';
    if (borradas === null) {
      return json({
        anulado: yaRepuesto,
        error: yaRepuesto
          ? 'No se pudo borrar, pero el stock ya se repuso: el pedido quedó anulado. Tocá Borrar de nuevo para sacarlo (no se vuelve a reponer).'
          : 'No se pudo borrar. Probá de nuevo.',
      }, 500);
    }
    if (!borradas.length) {
      // No se borró ninguna fila: o cambió de estado, o ya lo borró otro Borrar (el que lo encontró
      // 'anulado' va directo al DELETE sin reponer). En el segundo caso está hecho lo que ella pidió,
      // y decirle "no se borró nada" era falso.
      const sigue = await sbSelectStrict(`teia_orders?id=eq.${orderId}&select=id`);
      if (sigue !== null && !(sigue as any[]).length) return json({ ok: true });
      return json({ anulado: yaRepuesto, error: recargar }, 409);
    }

    // 5. Sacar el remito de la carpeta que imprime el local, y el Sheet. Van DESPUÉS del DELETE y con
    //    tope: si Google se CUELGA (no falla: cuelga), un try/catch no alcanza. La copia tiene hasta
    //    8 s; el espejo, todo lo que quede de los 30 s de la función (tiempoRestante).
    if (gConfigured() && row.remito_cliente_url) {
      try { await withDeadline(trashPrintCopy(printFileName(row)), Math.min(8000, tiempoRestante(inicio))); }
      catch (e: any) { console.warn('[teia] no se pudo sacar la copia de impresión', orderId, '→', (e && e.message) || e); }
    }
    try { await withDeadline(tryMirror(), tiempoRestante(inicio)); } catch (e: any) { console.warn('[teia] espejo Sheet sin respuesta al borrar:', (e && e.message) || e); }
    return json({ ok: true });
  }

  // ═══ EDICIÓN de un pedido PENDIENTE ═══════════════════════════════════════════════════════════
  // Recibe { id, items?: [{id, qty}], add?: [{product_id, qty}], discount_pct?, montos?, datos? }.
  //   · items: las líneas que ya están. Un 0 ESCRITO la saca; si no, es su cantidad nueva.
  //   · add:   productos NUEVOS, para "cambiar una torta por otra" sin que el comercio rehaga el
  //            pedido (pedido de la clienta, 11/9). El precio sale de la base, de SU lista.
  //
  // EL ORDEN ES TODO, y cada paso existe por un modo de falla concreto:
  //   1. Validar lo que llega, sin tocar la base.
  //   2. Leer pedido, líneas, cuenta y productos (estricto) y validar contra eso.
  //   3. CLAIM de versión: la primera escritura. Pone en fila dos guardados a la vez (doble clic,
  //      dos pestañas) y verifica "sigue pendiente" en el mismo acto.
  //   4. ALTAS, en un solo INSERT (atómico). Van ANTES que las bajas: si algo falla después, sobra
  //      una línea a la vista; nunca falta una, ni queda el pedido vacío.
  //   5. BAJAS y cambios de cantidad, CHEQUEADOS uno por uno.
  //   6. Total recalculado desde la base y PATCH final condicionado a "pendiente y es mi versión".

  // Un panel de antes del deploy manda siempre los montos (y las cantidades sin `desde`) con lo que
  // su pantalla mostraba: desde una pantalla vieja pisa lo guardado desde el otro dispositivo. Se
  // rechaza sin escribir nada; el panel viejo muestra el mensaje (ver lib/panel.ts).
  if (!esPanelNuevo(b) && ('saldo_anterior' in b || 'costo_envio' in b)) {
    return json({ error: PANEL_VIEJO }, 409);
  }

  // ── 1. Validar lo que llega ──
  const edits = Array.isArray(b?.items) ? b.items : [];
  const altas = Array.isArray(b?.add) ? b.add : [];
  if (edits.length > 200 || altas.length > 50) return json({ error: 'Demasiadas líneas en un solo guardado.' }, 400);

  // `desde` (opcional) = la cantidad que la pantalla MOSTRABA. Si la base ya tiene otra, alguien la
  // cambió desde otro lado (el celular, otra pestaña) y esta pantalla está vieja: se corta en vez de
  // pisar ese cambio en silencio. Mica usa la compu del local Y el celular, así que pasa.
  const cambios: { id: number; qty: number; desde: number | null }[] = [];
  for (const e of edits) {
    const id = Number(e?.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'Una línea del pedido no es válida. Recargá la página.' }, 400);
    const qty = cantidadEntera(e?.qty);
    if (qty === null) {
      return json({ error: 'Cada cantidad tiene que ser un número entero entre 0 y 9999 (0 saca el producto del pedido). No se guardó nada.' }, 400);
    }
    const desde = e?.desde === undefined ? null : cantidadEntera(e.desde);
    if (e?.desde !== undefined && desde === null) return json({ error: 'Una línea del pedido no es válida. Recargá la página.' }, 400);
    cambios.push({ id, qty, desde });
  }
  if (new Set(cambios.map((c) => c.id)).size !== cambios.length) {
    return json({ error: 'Una línea vino dos veces. Recargá la página. No se guardó nada.' }, 400);
  }
  const nuevas: { product_id: number; qty: number }[] = [];
  for (const a of altas) {
    const pid = Number(a?.product_id);
    if (!Number.isInteger(pid) || pid <= 0) return json({ error: 'Un producto a agregar no es válido. Recargá la página.' }, 400);
    const qty = cantidadEntera(a?.qty);
    if (qty === null || qty < 1) {
      return json({ error: 'La cantidad de un producto agregado tiene que ser un número entero entre 1 y 9999. No se guardó nada.' }, 400);
    }
    nuevas.push({ product_id: pid, qty });
  }
  if (new Set(nuevas.map((n) => n.product_id)).size !== nuevas.length) {
    return json({ error: 'Agregaste el mismo producto dos veces. No se guardó nada.' }, 409);
  }

  // Descuento de una LISTA CERRADA, validado acá y no en el navegador: es plata, así que un valor
  // inventado en el cuerpo (105, -20, "abc") no llega a la base. Fuera de la lista = 0, el error
  // que no perjudica a Teia. Si no vino, se mantiene el del pedido (se lee más abajo).
  const pctPedido: number | undefined = 'discount_pct' in b
    ? (DESCUENTOS.includes(Number(b.discount_pct)) ? Number(b.discount_pct) : 0)
    : undefined;

  // Los dos montos del remito, validados ANTES de escribir nada (antes se validaban después de
  // haber escrito las cantidades, y un "ocho mil" cortaba con 400 dejando medio guardado). NO
  // entran en `total`: `total` es la venta de mercadería, que suman el Sheet y los reportes.
  const montos: Record<string, number | null> = {};
  for (const campo of ['saldo_anterior', 'costo_envio'] as const) {
    if (!(campo in b)) continue;
    // El saldo puede ser negativo (a favor del comercio); el costo de envío no: un "-8000" le
    // descontaba el flete al total del remito (auditoría del 19/9).
    const opciones = { negativo: campo === 'saldo_anterior' };
    const m = montoEscrito(b[campo], opciones);
    if (m === undefined) {
      return json({ error: 'El ' + (campo === 'costo_envio' ? 'costo de envío' : 'saldo anterior') + ' ' + porQueNoSeEntiende(b[campo], opciones) + '. No se guardó nada.' }, 400);
    }
    montos[campo] = m; // null = vacío → el remito imprime el renglón para completar a mano
  }

  // Lo que vino para el ENCABEZADO (el panel manda solo lo que ella cambió). Si un guardado queda a
  // medias ANTES del PATCH final, nada de esto se aplicó: el panel recarga y ella lo pierde de vista,
  // así que el mensaje lo nombra para que lo vuelva a cargar.
  const encabezado = [
    'discount_pct' in b && 'el descuento',
    'costo_envio' in montos && 'el costo de envío',
    'saldo_anterior' in montos && 'el saldo anterior',
    ('client_name' in b || 'client_contact' in b || 'delivery_address' in b || 'delivery_date' in b) && 'los datos de entrega',
    'notes' in b && 'las notas',
  ].filter(Boolean) as string[];
  const sinAplicar = encabezado.length
    ? ` Esto NO se guardó y hay que volver a cargarlo: ${encabezado.join(', ')}.`
    : '';

  // ── 2. Leer y validar contra la base (todo ESTRICTO: [] y "no pude leer" no se confunden) ──
  const ords = await sbSelectStrict(`teia_orders?id=eq.${orderId}&select=id,status,client_id,version,discount_pct`);
  if (ords === null) return json({ error: 'No se pudo leer el pedido. No se guardó nada: probá de nuevo en un momento.' }, 503);
  const pedido = (ords as any[])[0];
  if (!pedido) return json({ error: 'El pedido no existe.' }, 404);
  // Solo PENDIENTES. Al confirmar se descuenta el stock y se arma el remito: editar después dejaría
  // el pedido distinto de su remito y de su stock. (Hasta la v1.1 esto no se chequeaba, y un
  // confirmado se podía editar llamando al endpoint directo.) Borrar sigue andando: es otra rama.
  if (pedido.status !== 'pendiente') {
    return json({ error: 'Este pedido ya no está pendiente: solo se puede editar antes de confirmarlo. Recargá la página.' }, 409);
  }

  const current = await sbSelectStrict(`teia_order_items?order_id=eq.${orderId}&select=id,product_id,name,qty,unit_price`);
  if (current === null) return json({ error: 'No se pudo leer el pedido. No se guardó nada: probá de nuevo en un momento.' }, 503);
  const lineaPorId = new Map((current as any[]).map((l) => [Number(l.id), l]));
  // Una línea que ya no es de este pedido es una pantalla vieja (se editó en otra pestaña). Antes
  // se salteaba en silencio y el panel decía "Guardado" sin haber guardado ese cambio.
  if (cambios.some((c) => !lineaPorId.has(c.id))) {
    return json({ error: 'Una de las líneas ya no está en el pedido (¿se guardó recién, o lo editaste en el celular o en otra pestaña?). Recargá la página para ver cómo quedó. No se guardó nada.' }, 409);
  }
  const pisadas = cambios.filter((c) => c.desde !== null && Number(lineaPorId.get(c.id).qty) !== c.desde);
  if (pisadas.length) {
    const detalle = pisadas.map((c) => `${lineaPorId.get(c.id).name} (ahora tiene ${Number(lineaPorId.get(c.id).qty)})`).join(', ');
    // "¿se guardó recién?": también llega acá el reintento de un guardado propio cuya respuesta se
    // perdió. Culpar siempre "al otro dispositivo" sería falso en ese caso.
    return json({ error: `Esta pantalla está vieja: ${detalle} ${pisadas.length > 1 ? 'ya no son lo que mostraba' : 'ya no es lo que mostraba'} (¿se guardó recién, o se cambió desde el celular u otra pestaña?). Recargá la página y volvé a hacer el cambio. No se guardó nada.` }, 409);
  }

  let filasNuevas: any[] = [];
  if (nuevas.length) {
    // La lista —y con ella los precios— sale de la CUENTA del pedido. Sin cuenta no se sabe:
    // catalogOf caería a 'general' en silencio, y a un pedido de Chungo se le cobrarían precios de
    // otra lista. Cambiar cantidades sí se puede: esas líneas ya tienen su precio.
    const sinCuenta = 'La cuenta de este pedido se borró, así que no se puede saber su lista de precios. Se pueden cambiar las cantidades, pero no agregar productos.';
    if (!pedido.client_id) return json({ error: sinCuenta }, 409);
    const cuentas = await sbSelectStrict(`teia_clients?id=eq.${Number(pedido.client_id)}&select=id,catalog`);
    if (cuentas === null) return json({ error: 'No se pudo leer la cuenta del comercio. No se guardó nada: probá de nuevo en un momento.' }, 503);
    if (!(cuentas as any[]).length) return json({ error: sinCuenta }, 409);
    const catalog = catalogOf((cuentas as any[])[0].catalog);

    // Un producto que YA está en el pedido no se agrega: se le cambia la cantidad a su línea.
    // Incluso si esa línea viene en 0 en este mismo guardado — sacarlo y volver a ponerlo sería un
    // cambio de precio encubierto (la línea vieja lleva el precio de cuando se pidió). Una línea
    // vieja sin product_id (su producto se borró de la base) no cuenta.
    const enPedido = new Map((current as any[]).filter((l) => l.product_id != null).map((l) => [Number(l.product_id), l.name]));
    const repetidos = nuevas.filter((n) => enPedido.has(n.product_id));
    if (repetidos.length) {
      const nombres = repetidos.map((n) => enPedido.get(n.product_id)).join(', ');
      const varios = repetidos.length > 1;
      return json({ error: `${nombres} ${varios ? 'ya están' : 'ya está'} en el pedido: cambiale la cantidad en su línea (si no la ves, recargá la página: se agregó recién o desde otro lado). No se guardó nada.` }, 409);
    }

    // Solo productos ACTIVOS de la lista de ESTE comercio, con el precio de la base. Lo que venga en
    // el cuerpo además del id y la cantidad se ignora: el navegador no decide precios.
    const ids = nuevas.map((n) => n.product_id);
    const prods = await sbSelectStrict(`teia_products?id=in.(${ids.join(',')})&active=is.true&catalog=eq.${catalog}&select=id,name,pack_label,price`);
    if (prods === null) return json({ error: 'No se pudieron leer los productos. No se guardó nada: probá de nuevo en un momento.' }, 503);
    const prodPorId = new Map((prods as any[]).map((p) => [Number(p.id), p]));
    const faltan = nuevas.filter((n) => !prodPorId.has(n.product_id));
    if (faltan.length) {
      // Los nombres salen de la BASE (sin filtro de lista ni de activo), nunca del navegador.
      const todos = await sbSelectStrict(`teia_products?id=in.(${faltan.map((f) => f.product_id).join(',')})&select=id,name`);
      const nombres = todos
        ? faltan.map((f) => (todos as any[]).find((t) => Number(t.id) === f.product_id)?.name || 'Un producto').join(', ')
        : faltan.length > 1 ? 'Unos productos' : 'Un producto';
      return json({ error: `${nombres}: ${faltan.length > 1 ? 'no están disponibles' : 'no está disponible'} para este comercio (se desactivó, o es de otra lista). No se guardó nada.` }, 409);
    }
    // Un producto recién creado puede estar a $0 (la columna tiene default 0): no entra una línea gratis.
    const sinPrecio = nuevas.filter((n) => !(Number(prodPorId.get(n.product_id).price) > 0));
    if (sinPrecio.length) {
      const nombres = sinPrecio.map((n) => prodPorId.get(n.product_id).name).join(', ');
      return json({ error: sinPrecio.length > 1
        ? `${nombres} no tienen precio cargado. Cargáselos en Productos y volvé a agregarlos. No se guardó nada.`
        : `${nombres} no tiene precio cargado. Cargáselo en Productos y volvé a agregarlo. No se guardó nada.` }, 400);
    }
    filasNuevas = nuevas.map((n) => {
      const p = prodPorId.get(n.product_id);
      const unit = Number(p.price);
      return { order_id: orderId, product_id: Number(p.id), name: p.name, pack_label: p.pack_label || '', qty: n.qty, unit_price: unit, line_total: unit * n.qty };
    });
  }

  // Un pedido no puede quedar sin productos: se podría confirmar igual, y su remito quedaría en error
  // para siempre ("No se pudieron leer los ítems del pedido"). Si ya no va, se borra.
  // Solo corta si ESTE guardado es el que lo vacía. Un pendiente que ya estaba vacío (la versión de
  // producción de hasta hoy dejaba vaciarlo) tiene que poder seguir cambiando descuento, montos y
  // datos, o que le agreguen un producto.
  const quedan = (current as any[]).filter((l) => {
    const c = cambios.find((x) => x.id === Number(l.id));
    return !c || c.qty > 0;
  }).length + filasNuevas.length;
  if (quedan === 0 && (current as any[]).length > 0) {
    return json({ error: 'Un pedido no puede quedar sin productos. Si ya no va, borralo con el botón Borrar. No se guardó nada.' }, 400);
  }

  // ── 3. Claim de versión: la PRIMERA escritura ──
  // Condicionado a "sigue pendiente y nadie lo tocó desde que lo leí". Si dos guardados salen a la
  // vez, solo uno encuentra la versión que leyó; el otro recibe [] y se corta sin escribir nada.
  // Sin esto, un doble clic metía la torta nueva dos veces (la tabla no impide duplicados).
  // Subir la versión no cambia ningún archivo: solo la usa el archivado, que corre al confirmar.
  // ⚠️ LÍMITE CONOCIDO (auditoría del 18/9): esto no es un candado. Un segundo guardado que lee el
  // pedido DESPUÉS de este claim y las líneas ANTES de nuestro INSERT pasa su propio claim y puede
  // duplicar la línea nueva. Hacen falta dos dispositivos guardando el mismo pedido con décimas de
  // segundo de diferencia. Lo cierra de verdad una transacción (función SQL con `for update`), que
  // pide SQL en producción: quedó anotado para la etapa de monitoreo. Mientras tanto, si pasa, el
  // que pierde recibe el aviso del paso 6 y el panel recarga; la tarjeta marca el producto repetido
  // (y el total, si no cuadra con las líneas). Lo mismo con un Confirmar desde otro dispositivo en
  // el medio (confirm.ts no mira la versión): la edición avisa y la tarjeta confirmada marca el
  // total que no coincide.
  const version = Number(pedido.version) || 1;
  const claim = await sbPatchReturning(`teia_orders?id=eq.${orderId}&status=eq.pendiente&version=eq.${version}`, { version: version + 1 });
  if (claim === null) return json({ error: 'No se pudo guardar. No se cambió nada: probá de nuevo en un momento.' }, 503);
  if (!claim.length) {
    return json({ error: 'El pedido cambió mientras lo editabas (otra pestaña, el celular, un doble clic, o se confirmó). No se guardó nada: recargá la página y volvé a hacer el cambio.' }, 409);
  }

  // ¿Se escribió (o PUDO escribirse) alguna línea? Decide si una falla de más abajo es "no se guardó
  // nada" (el panel deja lo que ella tipeó y ofrece Reintentar) o "quedó a medias" (partial: el
  // panel recarga para mostrar lo que hay de verdad). Antes todo fallo de abajo era partial, y el
  // panel recargaba y le borraba el envío que acababa de escribir aunque no se hubiera tocado nada.
  let tocoLineas = false;

  // ── 4. Altas: un solo INSERT (atómico: entran todas o ninguna) ──
  if (filasNuevas.length) {
    tocoLineas = true;
    const creadas = await sbInsert('teia_order_items', filasNuevas);
    if (!creadas) {
      // null no distingue "Supabase dijo que no" de "se cortó la respuesta": el INSERT pudo haber
      // entrado. Se trata como a medias, para que ella vea el pedido real antes de reintentar (un
      // reintento a ciegas contestaría "ya está en el pedido").
      return json({ partial: true, error: 'No se pudo confirmar que el producto se haya agregado. Recargá la página para ver cómo quedó el pedido antes de volver a guardar.' + sinAplicar }, 500);
    }
  }

  // ── 5. Bajas y cambios de cantidad, CHEQUEADOS ──
  // Antes no se miraba el resultado: si fallaba sacar la torta, quedaba cobrada y el panel decía
  // "Guardado". Con el cambio de producto eso es cobrar dos tortas. El filtro lleva también el
  // pedido: una línea de OTRO pedido no se toca aunque viniera su id.
  const noSePudo: string[] = [];
  for (const c of cambios) {
    const l = lineaPorId.get(c.id);
    if (c.qty === Number(l.qty)) continue; // sin cambio: no se escribe
    tocoLineas = true;
    const donde = `teia_order_items?id=eq.${c.id}&order_id=eq.${orderId}`;
    const hecho = c.qty === 0
      ? await sbDelete(donde)
      : await sbPatch(donde, { qty: c.qty, line_total: (Number(l.unit_price) || 0) * c.qty });
    if (!hecho) noSePudo.push(l.name);
  }
  // Lo que se le dice de las líneas en un guardado a medias. "Las líneas se guardaron" era falso si
  // una baja había fallado: la torta seguía, y si ella tocaba Guardar como le pedía el mensaje, el
  // total se recalculaba CON la torta, el aviso rojo desaparecía y se cobraban las dos.
  const lineasTxt = () => noSePudo.length
    ? `Se guardó una parte: ${noSePudo.join(', ')} ${noSePudo.length > 1 ? 'siguen' : 'sigue'} en el pedido (no se pudo sacar ni cambiar)`
    : 'Las líneas se guardaron';

  // ── 6. Total desde la base y PATCH final condicionado ──
  // Aunque algo haya fallado arriba, el total se recalcula con lo que de verdad quedó: el pedido
  // nunca muestra un total que no sea la suma de sus líneas.
  const nadaGuardado = 'No se guardó nada: probá de nuevo en un momento.';
  const fresh = await sbSelectStrict(`teia_order_items?order_id=eq.${orderId}&select=line_total`);
  if (fresh === null) {
    return tocoLineas
      ? json({ partial: true, error: `${lineasTxt()}, pero no se pudo recalcular el total. Recargá la página, revisá el pedido y volvé a guardar.` + sinAplicar }, 503)
      : json({ error: nadaGuardado }, 503);
  }
  const subtotal = (fresh as any[]).reduce((s, i) => s + (Number(i.line_total) || 0), 0);
  const pct = pctPedido ?? (Number(pedido.discount_pct) || 0);
  // La fórmula vive en lib/pedidos.ts (la misma del armado de pedidos): sin descuento, a centavos;
  // con descuento, a pesos.
  const total = totalConDescuento(subtotal, pct);

  // Encabezado: total + descuento + montos + datos editables (los NOT NULL solo si vienen con texto).
  const patch: Record<string, any> = { total, discount_pct: pct, ...montos };
  const name = String(b?.client_name ?? '').slice(0, 160).trim();
  if (name) patch.client_name = name;
  const contact = String(b?.client_contact ?? '').slice(0, 160).trim();
  if (contact) patch.client_contact = contact;
  const addr = String(b?.delivery_address ?? '').slice(0, 300).trim();
  if (addr) patch.delivery_address = addr;
  if ('delivery_date' in b) patch.delivery_date = b.delivery_date || null;
  if ('notes' in b) patch.notes = String(b?.notes ?? '').slice(0, 500).trim();

  // Condicionado a "sigue pendiente y es MI versión": si alguien lo confirmó entre el claim y acá
  // (hace falta otra pestaña), no se pisa — el remito y el stock ya se armaron con lo anterior.
  let fin = await sbPatchReturning(`teia_orders?id=eq.${orderId}&status=eq.pendiente&version=eq.${version + 1}`, patch);
  if (fin === null) {
    // null no distingue "Supabase dijo que no" de "se cortó la respuesta": el PATCH pudo haber
    // entrado. Antes se contestaba "no se guardó nada" y el selector de descuento volvía a "Sin
    // descuento" con el −20 % ya aplicado en la base. Se relee y se compara con lo que se mandó.
    const claves = Object.keys(patch);
    const rel = await sbSelectStrict(`teia_orders?id=eq.${orderId}&select=status,version,${claves.join(',')}`);
    const fila = rel ? (rel as any[])[0] : undefined;
    const aplicado = !!fila && fila.status === 'pendiente' && Number(fila.version) === version + 1 &&
      claves.every((k) => mismoValor(fila[k], patch[k]));
    if (aplicado) {
      fin = [fila]; // entró: se sigue como un guardado normal
    } else if (rel === null) {
      return json({ partial: true, error: 'No sé si se guardó: se cortó la comunicación con la base. Recargá la página para ver cómo quedó el pedido.' }, 500);
    } else {
      return tocoLineas
        ? json({ partial: true, error: `${lineasTxt()}, pero no se pudo guardar el total ni los datos del pedido. Recargá la página, revisá el pedido y volvé a guardar.` + sinAplicar }, 500)
        : json({ error: nadaGuardado }, 500);
    }
  }
  if (!fin.length) {
    // Alguien lo tocó entre el claim y acá. El mensaje depende de QUÉ pasó: antes decía siempre "se
    // confirmó", y con otro guardado encima eso era falso (el pedido seguía pendiente).
    const ahora = await sbSelectStrict(`teia_orders?id=eq.${orderId}&select=status`);
    const estado = ahora && (ahora as any[])[0] ? String((ahora as any[])[0].status) : ahora ? 'borrado' : 'desconocido';
    const que = estado === 'confirmado'
      ? 'El pedido se confirmó mientras guardabas: el remito y el stock pueden no incluir este cambio.'
      : estado === 'borrado'
        ? 'El pedido se borró mientras guardabas.'
        : estado === 'pendiente'
          ? 'Otro guardado cambió este pedido al mismo tiempo (¿el celular u otra pestaña?). El total de este guardado no se aplicó.' + sinAplicar
          : 'El pedido cambió mientras guardabas.';
    return tocoLineas
      ? json({ partial: true, error: `${que}${noSePudo.length ? ' ' + lineasTxt() + '.' : ''} Recargá la página y revisá cómo quedó.` }, 409)
      : json({ error: `${que} No se guardó nada: recargá la página y volvé a hacer el cambio.` }, 409);
  }
  // Con tope: el Sheet es un espejo. Sin tope, un cuelgue de Google se comía los 30 s de la función
  // DESPUÉS de haber guardado todo; el panel recibía un 504, ofrecía Reintentar y el reintento
  // contestaba "ya está en el pedido" sobre un guardado que había salido bien.
  // 20 s y no menos: withDeadline deja de ESPERAR pero no cancela, y el espejo reescribe cada pestaña
  // (borra y escribe). Un tope corto cortaría a la mitad un espejo lento pero sano; con 20 s solo se
  // corta un cuelgue, que a los 30 s se habría cortado igual. Se corrige solo en el próximo espejo.
  try { await withDeadline(tryMirror(), 20000); } catch (e: any) { console.warn('[teia] espejo Sheet sin respuesta al editar:', (e && e.message) || e); }

  if (noSePudo.length) {
    return json({ partial: true, total, error: `Se guardó una parte. No se pudo actualizar: ${noSePudo.join(', ')}. Recargá la página para ver cómo quedó el pedido.` }, 500);
  }
  return json({ ok: true, total });
};

// ¿El valor que devolvió la base es el que se mandó? Para releer un PATCH cuya respuesta se perdió.
// Los numeric pueden volver como número o como texto ("8000.00"); null es null.
function mismoValor(enBase: unknown, enviado: unknown): boolean {
  if (enviado === null || enviado === undefined) return enBase === null || enBase === undefined;
  if (typeof enviado === 'number') return Number(enBase) === enviado;
  return String(enBase ?? '') === String(enviado);
}

// Una cantidad escrita por la administradora: entero 0..9999, o null si no es eso.
// ⚠️ Vacío NO es cero. `parseInt('') || 0` daba 0, y 0 SACA la línea: un campo que quedaba vacío
// borraba un producto del pedido sin aviso. Acá '' es un error, y el 0 tiene que estar escrito.
function cantidadEntera(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 9999 ? v : null;
  if (typeof v === 'string' && /^\s*\d{1,4}\s*$/.test(v)) return Number(v.trim());
  return null;
}
