// Segundo factor OPCIONAL para entrar al catálogo: una contraseña por cuenta que Teia entrega
// junto con el link. Existe porque el CUIT de un comercio es un dato PÚBLICO (está en cada
// factura y en la constancia de AFIP), así que por sí solo no alcanza para proteger precios.
//
// ⚠️ APAGADO por defecto. Se enciende con la env var `TEIA_REQUIRE_CODE=true` en Vercel.
// Mientras esté apagado, la columna `access_code` existe pero no se pide nada: la entrada
// funciona igual que hoy (solo CUIT). Encenderlo NO requiere tocar código.
//
// La contraseña la ESCRIBE la administradora a mano, como el resto de los datos del cliente
// (antes había un botón que la generaba al azar; lo pidió sacar).
import crypto from 'node:crypto';
import { env } from './supabase';

export function codeRequired(): boolean {
  return String(env('TEIA_REQUIRE_CODE') || '').toLowerCase() === 'true';
}

/** Mínimo de caracteres útiles. Evita que una cuenta quede con una contraseña de un dígito. */
export const CODE_MIN = 4;

/**
 * Deja la contraseña en su forma comparable. Se ignoran mayúsculas, espacios, guiones, símbolos
 * y ACENTOS: la contraseña viaja por WhatsApp y la tipea otra persona, así que no puede fallar
 * por un detalle de escritura. "Panadería 2026!" y "panaderia2026" son la misma.
 *
 * ⚠️ Los acentos se sacan ANTES de filtrar, y ese orden importa. Antes se filtraba directo con
 * [^0-9A-Z], que BORRABA la "í" pero conservaba la "i": "Panadería" quedaba "PANADERA" y
 * "panaderia" quedaba "PANADERIA" — dos cosas distintas, y el comercio no podía entrar. Con
 * códigos generados por máquina nunca pasaba porque el alfabeto no tenía acentos; escribiéndolas
 * a mano, aparece a la primera ñ.
 */
export function normCode(s: any): string {
  return String(s ?? '')
    .normalize('NFD')                 // "í" → "i" + tilde suelta
    .replace(/[̀-ͯ]/g, '')  // se descarta la tilde suelta (también la de la ñ)
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

export function codeMatches(given: any, stored: any): boolean {
  const a = Buffer.from(normCode(given));
  const b = Buffer.from(normCode(stored));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
