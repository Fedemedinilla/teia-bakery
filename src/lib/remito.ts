// Generador de remitos PDF (pdf-lib, JS puro → anda en Vercel serverless). Dos variantes:
//  - 'cliente':  remito prolijo y con marca, para el cliente.
//  - 'interno':  hoja de preparación para Mica (checkboxes + notas destacadas).
// Pagina solo: pedidos largos siguen en una segunda hoja con encabezado de continuación.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { LOGO_TEIA_PNG, LOGO_TEIA_W, LOGO_TEIA_H } from './logo-teia';

const ACCENT = rgb(0.690, 0.408, 0.298); // #B0684C terracota
const INK = rgb(0.200, 0.160, 0.122);    // #33291F
const INK2 = rgb(0.486, 0.427, 0.361);   // #7C6D5C
const LINE = rgb(0.855, 0.796, 0.694);   // #DBCBB1
const SOFT = rgb(0.941, 0.886, 0.831);   // #F0E2D4

export type RemitoVariant = 'cliente' | 'interno';

// Datos del negocio, tal cual los tiene Mica en su planilla. En un solo lugar: si cambia el
// local o el teléfono, se toca acá y sale en todos los remitos.
// ⚠️ Este teléfono NO es el mismo que TEIA_WHATSAPP (el de la puerta, +54 9 11 3101-9238). Son
// dos números distintos a propósito: uno es el del local en el remito, el otro es por donde
// escriben los comercios que quieren darse de alta.
const NEGOCIO_DIR = 'Av. Sir Alexander Fleming 1750 - Martínez';
const NEGOCIO_CEL = 'Cel: 11-7623-9937';

const money = (n: any) => '$' + Number(n || 0).toLocaleString('es-AR');

/**
 * Normaliza un monto que escribió la administradora para guardarlo.
 * Devuelve `null` si dejó el campo vacío (= no cargado → el remito no dibuja nada), o
 * `undefined` si lo que escribió no es un número, para que el que llama lo rechace.
 * Acepta "12.500", "$12.500" y "-3000" (el saldo puede ser a favor del comercio).
 */
export function montoEscrito(v: any): number | null | undefined {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const limpio = s.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
  // ⚠️ SIN ESTE CHEQUEO, "ocho mil" se guardaba como CERO.
  // Al sacar las letras no queda ningún dígito, y `Number('')` es 0 — no NaN. O sea que un
  // monto escrito con palabras entraba como "cero pesos de envío" en silencio, y el remito
  // salía con un total que no era el que ella quería cobrar.
  // Es la cuarta vez en este proyecto que el cero de JavaScript muerde: también pasó con
  // TEIA_MIN_ORDER=0, con el umbral de envío en 0 y con el número del globo.
  if (!/[0-9]/.test(limpio)) return undefined;
  const n = Number(limpio);
  if (!Number.isFinite(n) || Math.abs(n) > 99_999_999) return undefined;
  return Math.round(n * 100) / 100;
}

/** Monto opcional. null = NO CARGADO (ese renglón no se dibuja).
 *  Hace falta explícito porque `Number(null) || 0` da 0 y borraría la diferencia entre
 *  "cargó cero" y "no cargó nada" — que en un remito son dos cosas distintas: un envío de $0
 *  se imprime ("no te cobro envío"), uno vacío no se imprime.
 *  ⚠️ También devuelve null si el valor guardado NO es un número. Antes eso era inofensivo
 *  porque igual salía el renglón en blanco y se veía que faltaba algo; ahora un dato ilegible
 *  desaparece del papel sin dejar rastro. La validación fuerte está en montoEscrito(), que es
 *  por donde entra todo lo que escribe la administradora. */
const monto = (v: any): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// WinAnsi (CP1252) es lo ÚNICO que las fuentes estándar de pdf-lib saben dibujar; un solo
// carácter fuera (emoji, ★, CJK) tira "WinAnsi cannot encode" y deja el pedido en
// archive_status='error' para siempre. Todo texto pasa por acá antes de medirse o dibujarse:
// NFC compone acentos sueltos de teclados móviles, los saltos de línea pasan a espacio,
// el '−' tipográfico pasa a '-', y lo no representable se elimina.
const CP1252_EXTRAS =
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ' +
  '‘’“”•–—˜™š›œžŸ';
const NON_WINANSI = new RegExp('[^\\x20-\\x7E\\u00A0-\\u00FF' + CP1252_EXTRAS + ']', 'g');
function safe(s: any): string {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[\r\n\f\t]+/g, ' · ') // separador visible: las aclaraciones de varias líneas se leen como ítems
    .replace(/−/g, '-')
    .replace(NON_WINANSI, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  const str = String(s);
  // Fecha "solo día" (delivery_date): formatear por regex, sin zona (evita el corrimiento).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // Timestamps (confirmed_at/created_at): SIEMPRE en hora argentina — con el día UTC, un
  // pedido confirmado a las 22:00 salía fechado al día siguiente.
  const d = new Date(str);
  return isNaN(d.getTime())
    ? safe(str)
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
}

function clip(font: PDFFont, s: string, size: number, maxW: number): string {
  s = safe(s);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
  return s + '…';
}

// Word-wrap a lo ancho: para las aclaraciones (hasta 500 chars — antes se cortaban a UNA línea
// y "sin frutos secos (alergia)" podía quedar afuera del papel).
function wrap(font: PDFFont, s: string, size: number, maxW: number): string[] {
  const words = safe(s).split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(cand, size) <= maxW) { cur = cand; continue; }
    if (cur) lines.push(cur);
    cur = font.widthOfTextAtSize(w, size) <= maxW ? w : clip(font, w, size, maxW);
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export async function buildRemito(order: any, items: any[], variant: RemitoVariant): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const W = 595.28, H = 841.89; // A4 vertical (pts)
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesB = await doc.embedFont(StandardFonts.TimesRomanBold);

  // Logo real de Teia. Si por lo que sea no se pudiera embeber, el remito sigue
  // saliendo con el wordmark tipográfico: la marca no puede voltear un pedido.
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try { logo = await doc.embedPng(Buffer.from(LOGO_TEIA_PNG, 'base64')); } catch { logo = null; }
  /** Dibuja el logo con la altura pedida y devuelve su alto real. */
  const drawLogo = (x: number, yTop: number, alto: number) => {
    if (!logo) return 0;
    const ancho = alto * (LOGO_TEIA_W / LOGO_TEIA_H);
    page.drawImage(logo, { x, y: yTop - alto, width: ancho, height: alto });
    return alto;
  };

  const M = 48;
  const BOTTOM = 100; // debajo de esto vive el pie de página
  const num = order.order_number || ('#' + order.id);

  let page: PDFPage;
  let y = 0;

  const text = (s: string, x: number, yy: number, font: PDFFont, size: number, color = INK) =>
    page.drawText(safe(s), { x, y: yy, size, font, color });
  const right = (s: string, xR: number, yy: number, font: PDFFont, size: number, color = INK) => {
    const t = safe(s);
    page.drawText(t, { x: xR - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
  };
  const hr = (yy: number, thickness = 0.75, color = LINE) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness, color });

  // pie de página (se dibuja en TODAS las hojas)
  const footer = () => {
    if (variant === 'cliente') {
      text('¡Gracias por tu compra! El pago se coordina con Teia al momento de la entrega.', M, 62, helv, 9, INK2);
    } else {
      text('Marcá cada ítem a medida que lo preparás.', M, 62, helv, 9, INK2);
    }
    hr(46, 0.5);
    text('Teia Bakery · Mayorista', M, 32, helv, 8, INK2);
    // "Remito para el cliente" salió a pedido de Mica: el que lo recibe ya sabe que es suyo.
    // La marca de la copia interna se queda, ahí sí distingue dos papeles parecidos.
    if (variant === 'interno') right('Copia interna · cocina', W - M, 32, helv, 8, INK2);
  };

  // encabezado de la tabla de ítems (se repite al continuar en otra hoja)
  const cPack = 300, cQty = 388, cUnit = 470, cSub = W - M;
  const tableHead = () => {
    page.drawRectangle({ x: M - 6, y: y - 7, width: W - 2 * M + 12, height: 22, color: SOFT });
    text('Producto', M, y, helvB, 9, INK);
    text('Pack', cPack, y, helvB, 9, INK);
    right('Cant.', cQty, y, helvB, 9, INK);
    right('P. unit.', cUnit, y, helvB, 9, INK);
    right('Subtotal', cSub, y, helvB, 9, INK);
    y -= 25;
  };

  // hoja nueva: cierra la actual con su pie y abre una de continuación
  const newPage = () => {
    footer();
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: ACCENT });
    y = H - 52;
    if (logo) drawLogo(M, y + 9, 9);
    else text('Teia Bakery', M, y, timesB, 14, ACCENT);
    right(`${variant === 'cliente' ? 'REMITO' : 'PREPARACIÓN · INTERNO'} ${num} · continuación`, W - M, y, helvB, 10, INK2);
    y -= 16;
    hr(y, 0.75);
    y -= 24;
  };

  // si no entra `space` antes del pie → hoja nueva (+ encabezado de tabla si estamos en ítems)
  const ensure = (space: number, inTable = false) => {
    if (y - space < BOTTOM) { newPage(); if (inTable) tableHead(); }
  };

  // ---- primera hoja: marca + datos del pedido ----
  page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: ACCENT });
  y = H - 56;
  if (logo) drawLogo(M, y + 12, 13);
  else text('Teia Bakery', M, y, timesB, 24, ACCENT);
  // Debajo del logo van los datos del negocio, igual que en la planilla que usaba Mica.
  // Antes acá decía "Pastelería mayorista", que ella pidió sacar: en un remito no aporta nada y
  // le sacaba el lugar al dato que sí sirve, que es dónde queda el local y a qué número llamar.
  text(NEGOCIO_DIR, M, y - 16, helv, 9, INK2);
  text(NEGOCIO_CEL, M, y - 28, helv, 9, INK2);

  const title = variant === 'cliente' ? 'REMITO' : 'PREPARACIÓN · INTERNO';
  right(title, W - M, y, helvB, variant === 'cliente' ? 18 : 13, INK);
  right(num, W - M, y - 18, helv, 11, INK2);
  right('Fecha: ' + fmtDate(order.confirmed_at || order.created_at), W - M, y - 33, helv, 9, INK2);

  y -= 58; // 6pt más que antes: bajo el logo ahora hay dos renglones, no uno
  hr(y, 1);
  y -= 26;

  // datos del cliente
  text('Cliente', M, y, helvB, 9, INK2);
  text(clip(helvB, order.client_name || '', 14, W - 2 * M), M, y - 17, helvB, 14, INK);
  text(clip(helv, 'Contacto: ' + (order.client_contact || '—'), 10, W - 2 * M), M, y - 34, helv, 10, INK2);
  text('Dirección: ' + clip(helv, order.delivery_address || '—', 10, W - 2 * M - 60), M, y - 49, helv, 10, INK2);
  const dd = order.delivery_date ? 'Día de entrega: ' + fmtDate(order.delivery_date) : 'Día de entrega: a coordinar por WhatsApp';
  text(dd, M, y - 64, helv, 10, variant === 'interno' ? INK : INK2);
  y -= 92;

  // ---- tabla de ítems (pagina si hace falta) ----
  tableHead();
  for (const it of items) {
    ensure(24, true);
    let nameX = M;
    if (variant === 'interno') {
      page.drawRectangle({ x: M, y: y - 2, width: 12, height: 12, borderColor: INK2, borderWidth: 1 });
      nameX = M + 20;
    }
    text(clip(helv, it.name || '', 10, cPack - nameX - 10), nameX, y, helv, 10, INK);
    text(it.pack_label || '', cPack, y, helv, 9, INK2);
    right(String(it.qty ?? ''), cQty, y, variant === 'interno' ? helvB : helv, variant === 'interno' ? 11 : 10, INK);
    right(money(it.unit_price), cUnit, y, helv, 9, INK2);
    right(money(it.line_total), cSub, y, helvB, 10, INK);
    hr(y - 9, 0.4); // separador en el HUECO entre filas (no sobre el texto)
    y -= 24;
  }

  // ---- total (con desglose si hay descuento, y los extras que carga Teia) ----
  //
  // ⚠️ REGLA DEL BLOQUE, escrita porque se rompió una vez. Pedido textual de Mica:
  //   "me gustaría que el saldo anterior no se sume al monto del pedido nuevo... hay locales que
  //    pagan siempre a contra pedido, entonces siempre tienen un saldo anterior y si se les va
  //    sumando al pedido nuevo va a ser un quilombo"
  //
  //   · TOTAL FINAL = total del pedido + costo de envío. EL SALDO NO ENTRA, NUNCA.
  //   · El saldo va ABAJO de todo, como recordatorio, y dice que no está incluido. Va abajo a
  //     propósito: arriba del total, cualquiera asume que está sumado.
  //   · Si no se cargó nada, no se dibuja NADA de esto y el remito queda como antes de que la
  //     función existiera. Los renglones en blanco que había —para completar a mano— los pidió
  //     ella y después los pidió sacar: "si no se pone nada... no tendría q aparecer en el
  //     remito, porque sino queda abajo de todo de nuevo un total final vacío".
  //   · Un envío de $0 SÍ se imprime (dice "no te cobro envío", es información) pero NO dispara
  //     el TOTAL FINAL: sería el mismo número que el total del pedido, dos veces seguidas.
  const pct = Number(order.discount_pct) || 0;
  const saldo = monto(order.saldo_anterior);
  const envio = monto(order.costo_envio);
  const haySaldo = saldo !== null && saldo !== 0;   // un saldo en cero no es un saldo
  const hayEnvio = envio !== null;
  const hayFinal = envio !== null && envio !== 0;   // solo si el envío mueve el número

  // El alto se reserva según lo que se va a dibujar de verdad. Antes reservaba 76pt siempre, y
  // eso empujaba a una hoja nueva un pedido largo SIN extras, para imprimir un bloque vacío.
  const altoExtras = (hayEnvio ? 18 : 0) + (hayFinal ? 22 : 0) + (haySaldo ? 30 : 0);
  ensure((pct > 0 ? 92 : 58) + altoExtras);
  y -= 12;
  if (pct > 0) {
    const subtotal = items.reduce((s, it) => s + (Number(it.line_total) || 0), 0);
    right('Subtotal', cUnit, y, helv, 10, INK2);
    right(money(subtotal), cSub, y, helv, 10, INK2);
    y -= 16;
    right(`Descuento (-${pct}%)`, cUnit, y, helv, 10, ACCENT);
    right('-' + money(subtotal - Number(order.total)), cSub, y, helv, 10, ACCENT);
    y -= 18;
  }

  // El total de la MERCADERÍA. Se lleva el destaque (15pt terracota) salvo que abajo venga un
  // TOTAL FINAL distinto: dos números grandes seguidos no dicen cuál hay que pagar.
  right(hayFinal ? 'Total del pedido' : 'Total', cUnit, y, helvB, 12, INK);
  right(money(order.total), cSub, y, helvB, hayFinal ? 12 : 15, hayFinal ? INK : ACCENT);
  y -= 20;

  if (hayEnvio) {
    right('Costo de envío', cUnit, y, helv, 10, INK2);
    right(money(envio), cSub, y, helv, 10, INK2);
    y -= 18;
  }

  if (hayFinal) {
    page.drawLine({ start: { x: cUnit - 70, y: y + 14 }, end: { x: cSub, y: y + 14 }, thickness: 0.75, color: LINE });
    right('TOTAL FINAL', cUnit, y, helvB, 12, INK);
    right(money(Number(order.total) + (envio as number)), cSub, y, helvB, 15, ACCENT);
    y -= 22;
  }

  if (haySaldo) {
    // Un saldo NEGATIVO es plata a favor del comercio. money(-3000) imprimía "$-3.000", que se
    // lee mal y encima ambiguo; se rotula al derecho y el signo desaparece.
    const aFavor = (saldo as number) < 0;
    right(aFavor ? 'Saldo a favor tuyo' : 'Saldo pedido anterior', cUnit, y, helv, 10, INK2);
    right(money(Math.abs(saldo as number)), cSub, y, helv, 10, INK2);
    y -= 12;
    right('(no está incluido en el total de arriba)', cSub, y, helv, 8, INK2);
    y -= 18;
  }

  y -= 12;

  // ---- aclaraciones (multilínea; destacadas en el interno) ----
  if (order.notes) {
    const noteLines = wrap(helv, order.notes, 10, W - 2 * M - 12);
    const boxH = 30 + 15 * noteLines.length;
    ensure(boxH + 8);
    page.drawRectangle({ x: M - 6, y: y - boxH + 12, width: W - 2 * M + 12, height: boxH, color: SOFT });
    text('Aclaraciones', M, y, helvB, 9, INK);
    noteLines.forEach((ln, i) => text(ln, M, y - 16 - 15 * i, helv, 10, INK));
    y -= boxH + 8;
  }

  footer();
  return await doc.save();
}
