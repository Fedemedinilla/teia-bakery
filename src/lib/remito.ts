// Generador de remitos PDF (pdf-lib, JS puro → anda en Vercel serverless). Dos variantes:
//  - 'cliente':  remito prolijo y con marca, para el cliente.
//  - 'interno':  hoja de preparación para Mica (checkboxes + notas destacadas).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';

const ACCENT = rgb(0.690, 0.408, 0.298); // #B0684C terracota
const INK = rgb(0.200, 0.160, 0.122);    // #33291F
const INK2 = rgb(0.486, 0.427, 0.361);   // #7C6D5C
const LINE = rgb(0.855, 0.796, 0.694);   // #DBCBB1
const SOFT = rgb(0.941, 0.886, 0.831);   // #F0E2D4

export type RemitoVariant = 'cliente' | 'interno';

const money = (n: any) => '$' + Number(n || 0).toLocaleString('es-AR');

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
    .replace(/[\r\n\f\t]+/g, ' ')
    .replace(/−/g, '-')
    .replace(NON_WINANSI, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function fmtDate(s?: string): string {
  if (!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); // fecha "solo día" → sin corrimiento de zona
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function clip(font: PDFFont, s: string, size: number, maxW: number): string {
  s = safe(s);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxW) s = s.slice(0, -1);
  return s + '…';
}

export async function buildRemito(order: any, items: any[], variant: RemitoVariant): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const W = 595.28, H = 841.89; // A4 vertical (pts)
  const page: PDFPage = doc.addPage([W, H]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesB = await doc.embedFont(StandardFonts.TimesRomanBold);

  const M = 48;
  const text = (s: string, x: number, y: number, font: PDFFont, size: number, color = INK) =>
    page.drawText(safe(s), { x, y, size, font, color });
  const right = (s: string, xR: number, y: number, font: PDFFont, size: number, color = INK) => {
    const t = safe(s);
    page.drawText(t, { x: xR - font.widthOfTextAtSize(t, size), y, size, font, color });
  };
  const hr = (y: number, thickness = 0.75, color = LINE) =>
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness, color });

  // barra de acento + marca
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: ACCENT });
  let y = H - 56;
  text('Teia Bakery', M, y, timesB, 24, ACCENT);
  text('Pastelería mayorista', M, y - 16, helv, 9, INK2);

  const title = variant === 'cliente' ? 'REMITO' : 'PREPARACIÓN · INTERNO';
  right(title, W - M, y, helvB, variant === 'cliente' ? 18 : 13, INK);
  right(order.order_number || ('#' + order.id), W - M, y - 18, helv, 11, INK2);
  right('Fecha: ' + fmtDate(order.confirmed_at || order.created_at), W - M, y - 33, helv, 9, INK2);

  y -= 52;
  hr(y, 1);
  y -= 26;

  // datos del cliente
  text('Cliente', M, y, helvB, 9, INK2);
  text(clip(helvB, order.client_name || '', 14, W - 2 * M), M, y - 17, helvB, 14, INK);
  text('Contacto: ' + (order.client_contact || '—'), M, y - 34, helv, 10, INK2);
  text('Dirección: ' + clip(helv, order.delivery_address || '—', 10, W - 2 * M - 60), M, y - 49, helv, 10, INK2);
  const dd = order.delivery_date ? 'Día de entrega: ' + fmtDate(order.delivery_date) : 'Día de entrega: a coordinar por WhatsApp';
  text(dd, M, y - 64, helv, 10, variant === 'interno' ? INK : INK2);
  y -= 92;

  // encabezado de la tabla
  const cPack = 300, cQty = 388, cUnit = 470, cSub = W - M;
  page.drawRectangle({ x: M - 6, y: y - 7, width: W - 2 * M + 12, height: 22, color: SOFT });
  text('Producto', M, y, helvB, 9, INK);
  text('Pack', cPack, y, helvB, 9, INK);
  right('Cant.', cQty, y, helvB, 9, INK);
  right('P. unit.', cUnit, y, helvB, 9, INK);
  right('Subtotal', cSub, y, helvB, 9, INK);
  y -= 25;

  // filas
  for (const it of items) {
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

  // total (con desglose si hay descuento fiel)
  y -= 12;
  const pct = Number(order.discount_pct) || 0;
  if (pct > 0) {
    const subtotal = items.reduce((s, it) => s + (Number(it.line_total) || 0), 0);
    right('Subtotal', cUnit, y, helv, 10, INK2);
    right(money(subtotal), cSub, y, helv, 10, INK2);
    y -= 16;
    right(`Descuento fiel (-${pct}%)`, cUnit, y, helv, 10, ACCENT);
    right('-' + money(subtotal - Number(order.total)), cSub, y, helv, 10, ACCENT);
    y -= 18;
  }
  right('Total', cUnit, y, helvB, 12, INK);
  right(money(order.total), cSub, y, helvB, 15, ACCENT);
  y -= 34;

  // aclaraciones (destacadas en el interno)
  if (order.notes) {
    const boxH = 46;
    page.drawRectangle({ x: M - 6, y: y - boxH + 12, width: W - 2 * M + 12, height: boxH, color: SOFT });
    text('Aclaraciones', M, y, helvB, 9, INK);
    text(clip(helv, order.notes, 10, W - 2 * M - 12), M, y - 16, helv, 10, INK);
    y -= boxH + 8;
  }

  // pie
  if (variant === 'cliente') {
    text('¡Gracias por tu compra! El pago se coordina con Teia al momento de la entrega.', M, 62, helv, 9, INK2);
  } else {
    text('Marcá cada ítem a medida que lo preparás.', M, 62, helv, 9, INK2);
  }
  hr(46, 0.5);
  text('Teia Bakery · Mayorista', M, 32, helv, 8, INK2);
  right(variant === 'cliente' ? 'Remito para el cliente' : 'Copia interna · cocina', W - M, 32, helv, 8, INK2);

  return await doc.save();
}
