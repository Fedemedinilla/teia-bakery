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

export const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: true,
  maxAge: SESSION_MAX_AGE,
};
