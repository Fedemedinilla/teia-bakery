/**
 * Convierte el logo de Teia (Illustrator, PDF-compatible) en PNG transparente
 * recortado al contenido, listo para el header de la app y para el remito.
 *
 * Uso:  node scripts/logo.mjs "C:/ruta/Logo Web.ai"
 *
 * El logo es de un solo color sobre blanco, así que la transparencia se
 * reconstruye exacta: el alfa sale de cuánto se aparta el pixel del blanco y el
 * color queda fijo en el de marca. Eso conserva el antialias de los remates
 * finos de la serif, que es donde se nota si se recorta con umbral.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { pdf } from 'pdf-to-img';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SALIDA = resolve(AQUI, '../public');

export const MARRON = [0x2d, 0x21, 0x19]; // #2D2119 — muestreado del archivo original

// ── PNG: leer (RGBA, sin entrelazado) ────────────────────────────────────────
function leerPng(buf) {
  let off = 8, w = 0, h = 0, ct = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const tipo = buf.toString('ascii', off + 4, off + 8);
    const d = buf.slice(off + 8, off + 8 + len);
    if (tipo === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    if (tipo === 'IDAT') idat.push(d);
    if (tipo === 'IEND') break;
    off += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const fila = Buffer.from(raw.slice(pos, pos + stride)); pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? fila[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      if (f === 1) fila[i] = (fila[i] + a) & 255;
      else if (f === 2) fila[i] = (fila[i] + b) & 255;
      else if (f === 3) fila[i] = (fila[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        fila[i] = (fila[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp, d = (y * w + x) * 4;
      px[d] = fila[s]; px[d + 1] = fila[s + (bpp > 2 ? 1 : 0)]; px[d + 2] = fila[s + (bpp > 2 ? 2 : 0)];
      px[d + 3] = bpp === 4 ? fila[s + 3] : bpp === 2 ? fila[s + 1] : 255;
    }
    prev = fila;
  }
  return { w, h, px };
}

// ── PNG: escribir (RGBA, filtro 0) ───────────────────────────────────────────
function crc32(buf) {
  let c, tabla = crc32.t;
  if (!tabla) {
    tabla = crc32.t = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tabla[n] = c >>> 0; }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = tabla[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(datos.length, 0);
  cab.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo, 'ascii'), datos])), 0);
  return Buffer.concat([cab, datos, crc]);
}

function escribirPng(w, h, px) {
  const bruto = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    bruto[y * (w * 4 + 1)] = 0;
    px.copy(bruto, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(bruto, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

// ── conversión ───────────────────────────────────────────────────────────────
/** Blanco → transparente, todo lo demás → color de marca con el alfa del trazo. */
function aTransparente({ w, h, px }, [r, g, b]) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const lum = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
    const alfa = Math.round((1 - lum) * 255);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = alfa;
  }
  return { w, h, px: out };
}

/** Recorta el aire de alrededor, dejando un margen parejo. */
function recortar({ w, h, px }, margen = 8) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { w, h, px };
  x0 = Math.max(0, x0 - margen); y0 = Math.max(0, y0 - margen);
  x1 = Math.min(w - 1, x1 + margen); y1 = Math.min(h - 1, y1 + margen);
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) px.copy(out, y * nw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4);
  return { w: nw, h: nh, px: out };
}

// ── main ─────────────────────────────────────────────────────────────────────
const origen = process.argv[2];
if (!origen) { console.error('Uso: node scripts/logo.mjs "ruta/al/Logo Web.ai"'); process.exit(1); }

mkdirSync(SALIDA, { recursive: true });
const doc = await pdf(readFileSync(origen), { scale: 6 });
let primera = null;
for await (const p of doc) { primera = p; break; }

const limpio = recortar(aTransparente(leerPng(primera), MARRON));
writeFileSync(resolve(SALIDA, 'logo-teia.png'), escribirPng(limpio.w, limpio.h, limpio.px));
console.log(`✓ public/logo-teia.png — ${limpio.w}x${limpio.h}`);

// Versión chica para el remito, embebida en base64: en serverless la carpeta
// public/ no está en el disco de la función, así que el PDF no puede leerla.
const escala = 620 / limpio.w;
const rw = Math.round(limpio.w * escala), rh = Math.round(limpio.h * escala);
const chico = Buffer.alloc(rw * rh * 4);
for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
  // Promedio de la caja de origen: baja bien un trazo fino sin dentarlo.
  const x0 = Math.floor(x / escala), x1 = Math.min(limpio.w, Math.ceil((x + 1) / escala));
  const y0 = Math.floor(y / escala), y1 = Math.min(limpio.h, Math.ceil((y + 1) / escala));
  let a = 0, n = 0;
  for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) { a += limpio.px[(sy * limpio.w + sx) * 4 + 3]; n++; }
  const d = (y * rw + x) * 4;
  chico[d] = MARRON[0]; chico[d + 1] = MARRON[1]; chico[d + 2] = MARRON[2];
  chico[d + 3] = n ? Math.round(a / n) : 0;
}
const png = escribirPng(rw, rh, chico);
writeFileSync(resolve(AQUI, '../src/lib/logo-teia.ts'),
  `// Generado por scripts/logo.mjs desde el original de Illustrator. No editar a mano.\n` +
  `// El logo va embebido porque public/ no existe en el disco de una función serverless.\n` +
  `export const LOGO_TEIA_PNG = '${png.toString('base64')}';\n` +
  `export const LOGO_TEIA_W = ${rw};\nexport const LOGO_TEIA_H = ${rh};\n`, 'utf8');
console.log(`✓ src/lib/logo-teia.ts — ${rw}x${rh} (${Math.round(png.length / 1024)} kB)`);
