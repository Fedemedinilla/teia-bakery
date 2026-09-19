// Piezas de PLATA y de pedidos que comparten el panel (editar un pedido) y el armado de pedidos
// (/administradora/armar y /api/admin/armar). Funciones puras: se prueban sin base (test-armar).

/** Los descuentos que ofrece el panel. Una LISTA CERRADA: un valor inventado en el cuerpo no llega a la base. */
export const DESCUENTOS = [0, 5, 10, 15, 20];

/**
 * Total del pedido a partir de la suma de sus líneas. Sin descuento, la suma tal cual (a centavos),
 * como el alta del comercio (api/order.ts): redondear a pesos dejaba un remito con líneas que suman
 * $3.703,68 y un total de $3.704. Con descuento se redondea a pesos, como siempre (la línea
 * "Descuento" del remito absorbe la diferencia). La misma fórmula en el panel, el armado y la edición.
 */
export function totalConDescuento(subtotal: number, pct: number): number {
  return pct ? Math.round(subtotal * (1 - pct / 100)) : Math.round(subtotal * 100) / 100;
}

/** Plata a centavos enteros, para COMPARAR montos sin el ruido del punto flotante. */
export const centavos = (n: unknown) => Math.round(Number(n) * 100);

/**
 * El día de entrega que escribe la administradora: '' / null → null (sin fecha, "a coordinar");
 * 'AAAA-MM-DD' de un día que EXISTE → ese texto; cualquier otra cosa → undefined (se rechaza).
 * Ida y vuelta por Date.UTC: '2026-02-30' no es un día (Postgres lo rechaza y el pedido no entraba).
 */
export function fechaDeEntrega(v: unknown): string | null | undefined {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, me - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== me - 1 || f.getUTCDate() !== d) return undefined;
  if (a < 2020 || a > 2100) return undefined;
  return s;
}

/** La clave de UN armado (la genera la página). El mismo formato que exige la función SQL. */
export const ARMADO_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Tope de cantidad por línea: el mismo que el alta del comercio. */
export const QTY_MAX = 9999;

/**
 * La huella de lo que tiene un pedido: "producto x cantidad", ordenado por producto (y cantidad), separado
 * por comas. EXACTAMENTE el mismo formato que arma la función SQL teia_armar_pedido sobre las líneas
 * guardadas, para saber si un armado que llega por segunda vez es el mismo pedido o uno cambiado.
 */
export function huellaDe(lineas: { product_id: number; qty: number }[]): string {
  return [...lineas]
    .sort((a, b) => Number(a.product_id) - Number(b.product_id) || Number(a.qty) - Number(b.qty))
    .map((l) => `${Number(l.product_id)}x${Number(l.qty)}`)
    .join(',');
}

export type LineaVieja = { product_id: number | null; name: string; qty: number; unit_price?: number | null };
export type ProductoDeHoy = { id: number; name: string; price: number; stock: number; pack_label?: string };

/**
 * Qué se precarga al "↻ Repetir" un pedido viejo, con los productos y precios de HOY de la lista de
 * la cuenta. Nada se omite en silencio: cada decisión vuelve con su motivo para mostrársela.
 *  · Producto borrado (product_id null), oculto o fuera de su lista hoy → omitido.
 *  · Precio $0 hoy → omitido (el panel no deja vender a $0).
 *  · El mismo producto en dos líneas (un error que el panel marca en rojo) → se juntan, avisando.
 *  · Una suma mayor al tope → se topea, avisando.
 *  · Sin stock hoy → se precarga igual, avisando: ella decide.
 *  · Precio distinto al del pedido viejo → se precarga con el de hoy, avisando cuánto cambió.
 */
export function lineasParaRepetir(viejas: LineaVieja[], hoy: Map<number, ProductoDeHoy>) {
  const cantidades = new Map<number, number>();
  const veces = new Map<number, number>();
  const precioViejo = new Map<number, number>();
  const omitidas: { name: string; motivo: string }[] = [];
  for (const l of viejas) {
    const id = l.product_id == null ? null : Number(l.product_id);
    const qty = Math.floor(Number(l.qty));
    if (id == null || !Number.isInteger(id)) { omitidas.push({ name: l.name, motivo: 'ese producto ya no existe' }); continue; }
    const p = hoy.get(id);
    if (!p) { omitidas.push({ name: l.name, motivo: 'hoy no está en su lista (o está oculto)' }); continue; }
    if (!(Number(p.price) > 0)) { omitidas.push({ name: p.name, motivo: 'hoy no tiene precio cargado' }); continue; }
    if (!(qty > 0)) continue;
    cantidades.set(id, (cantidades.get(id) || 0) + qty);
    veces.set(id, (veces.get(id) || 0) + 1);
    if (l.unit_price != null && !precioViejo.has(id)) precioViejo.set(id, Number(l.unit_price));
  }
  const lineas: { product_id: number; qty: number }[] = [];
  const juntadas: { name: string; veces: number; qty: number }[] = [];
  const topeadas: { name: string; qty: number }[] = [];
  const sinStock: { name: string; stock: number }[] = [];
  const cambiosDePrecio: { name: string; antes: number; hoy: number }[] = [];
  for (const [id, suma] of cantidades) {
    const p = hoy.get(id)!;
    const qty = Math.min(QTY_MAX, suma);
    if (suma > QTY_MAX) topeadas.push({ name: p.name, qty: suma });
    if ((veces.get(id) || 0) > 1) juntadas.push({ name: p.name, veces: veces.get(id)!, qty });
    if (!(Number(p.stock) > 0)) sinStock.push({ name: p.name, stock: Number(p.stock) || 0 });
    const antes = precioViejo.get(id);
    if (antes != null && centavos(antes) !== centavos(p.price)) cambiosDePrecio.push({ name: p.name, antes, hoy: Number(p.price) });
    lineas.push({ product_id: id, qty });
  }
  return { lineas, omitidas, juntadas, topeadas, sinStock, cambiosDePrecio };
}
