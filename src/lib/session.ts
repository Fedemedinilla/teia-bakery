// La "sesión" del comercio que entró con su CUIT. Es una cookie FIRMADA (HMAC con la
// service key) y HttpOnly: el navegador no puede fabricarla ni cambiarse de catálogo
// editando el localStorage. El servidor resuelve SIEMPRE quién es el cliente desde acá.
import crypto from 'node:crypto';
import { env } from './supabase';

export const SESSION_COOKIE = 'teia_sess';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 días

// El secreto de firma. Si no hay NINGUNA fuente, se lanza en vez de caer a un valor conocido:
// un fallback hardcodeado dejaría que cualquiera firme una sesión para cualquier comercio.
function secret(): string {
  const s = env('SUPABASE_SERVICE_ROLE_KEY') || env('TEIA_ADMIN_PASSWORD');
  if (s) return s;
  if (env('NODE_ENV') === 'production') throw new Error('Falta el secreto de sesión (SUPABASE_SERVICE_ROLE_KEY o TEIA_ADMIN_PASSWORD).');
  return 'teia-dev-only-secret'; // solo dev/demo local, nunca con datos reales
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

// ---- state anti-CSRF del flujo OAuth de Google ----
// Un valor al azar que se guarda en cookie y viaja a Google; al volver tienen que coincidir.
// Sin esto, alguien podía hacerle abrir a la admin un callback con SU code y conectar su Drive.
export const OAUTH_STATE_COOKIE = 'teia_oauth_state';

export function newOAuthState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function oauthStateCookie(request: Request, state: string): string {
  return [
    `${OAUTH_STATE_COOKIE}=${state}`,
    'Path=/api/admin/google',
    'HttpOnly',
    'SameSite=Lax',
    isSecureRequest(request) ? 'Secure' : '',
    'Max-Age=600', // 10 minutos: el consentimiento no lleva más
  ].filter(Boolean).join('; ');
}

export function clearOAuthStateCookie(request: Request): string {
  return [
    `${OAUTH_STATE_COOKIE}=`,
    'Path=/api/admin/google',
    'HttpOnly',
    'SameSite=Lax',
    isSecureRequest(request) ? 'Secure' : '',
    'Max-Age=0',
  ].filter(Boolean).join('; ');
}

export function readOAuthState(fromCookie: string | undefined, fromUrl: string): boolean {
  if (!fromCookie || !fromUrl) return false;
  const a = Buffer.from(fromCookie), b = Buffer.from(fromUrl);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
