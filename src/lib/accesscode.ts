// Segundo factor OPCIONAL para entrar al catálogo: un código por cuenta que Teia entrega
// junto con el link. Existe porque el CUIT de un comercio es un dato PÚBLICO (está en cada
// factura y en la constancia de AFIP), así que por sí solo no alcanza para proteger precios.
//
// ⚠️ APAGADO por defecto. Se enciende con la env var `TEIA_REQUIRE_CODE=true` en Vercel.
// Mientras esté apagado, la columna `access_code` existe pero no se pide nada: la entrada
// funciona igual que hoy (solo CUIT). Encenderlo NO requiere tocar código.
import crypto from 'node:crypto';
import { env } from './supabase';

export function codeRequired(): boolean {
  return String(env('TEIA_REQUIRE_CODE') || '').toLowerCase() === 'true';
}

// Alfabeto sin caracteres que se confunden al dictarlo por WhatsApp (sin O/0, I/1/L).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// Formato "4K7M-9X2P": corto, legible y fácil de dictar. ~10^12 combinaciones.
export function newAccessCode(): string {
  const pick = () => ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `${block()}-${block()}`;
}

// Se compara sin distinguir mayúsculas ni guiones: quien lo tipea a mano no debería fallar
// por un detalle de formato. La comparación es en tiempo constante.
export function normCode(s: any): string {
  return String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function codeMatches(given: any, stored: any): boolean {
  const a = Buffer.from(normCode(given));
  const b = Buffer.from(normCode(stored));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
