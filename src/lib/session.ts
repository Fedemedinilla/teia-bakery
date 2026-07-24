// La "sesión" del comercio que entró con su CUIT. Es una cookie FIRMADA (HMAC con la
// service key) y HttpOnly: el navegador no puede fabricarla ni cambiarse de catálogo
// editando el localStorage. El servidor resuelve SIEMPRE quién es el cliente desde acá.
import crypto from 'node:crypto';
import { env } from './supabase';

export const SESSION_COOKIE = 'teia_sess';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 días

function secret(): string {
  return env('SUPABASE_SERVICE_ROLE_KEY') || env('TEIA_ADMIN_PASSWORD') || 'teia-dev-secret';
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex').slice(0, 32);
}

// client_id → valor de cookie
export function makeSession(clientId: number): string {
  const p = String(clientId);
  return `${p}.${sign(p)}`;
}

// valor de cookie → client_id, o null si falta / está adulterada
export function readSession(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 1) return null;
  const payload = raw.slice(0, i);
  const given = Buffer.from(raw.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const id = Number(payload);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ¿la request llegó por https? (detrás de Vercel el TLS termina en el edge y la función ve
// http, así que manda el x-forwarded-proto). Define si la cookie lleva el flag Secure.
export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  try { return new URL(request.url).protocol === 'https:'; } catch { return false; }
}

// El header Set-Cookie se arma A MANO (en vez de usar cookies.set/delete de Astro) para que
// PONER y BORRAR usen exactamente los mismos atributos: si difieren, el borrado puede no
// pisar la cookie original y el "Salir" no hace nada.
function cookieHeader(value: string, secure: boolean, maxAge: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ');
}

export function setSessionCookie(request: Request, clientId: number): string {
  return cookieHeader(makeSession(clientId), isSecureRequest(request), SESSION_MAX_AGE);
}

export function clearSessionCookie(request: Request): string {
  return cookieHeader('', isSecureRequest(request), 0);
}
